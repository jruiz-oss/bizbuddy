import express, { type Request, Response, NextFunction } from "express";
import cors from "cors";
import session from "express-session";
import pgSession from "connect-pg-simple";
import { registerRoutes } from "./routes";
import { serveStatic, log } from "./vite";
import { pool } from "./db";
import { initializeScheduler } from "./scheduler";

const app = express();

// Trust proxy — required for secure cookies behind Railway/Vercel TLS termination
app.set('trust proxy', 1);

// CORS — allow requests from the Vercel frontend in production, localhost in dev
const allowedOrigins = [
  process.env.FRONTEND_URL,          // e.g. https://bizbuddy.vercel.app
  "http://localhost:5173",
  "http://localhost:5000",
].filter(Boolean) as string[];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (curl, mobile, same-origin)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error(`CORS blocked: ${origin}`));
  },
  credentials: true,
}));

// CSRF protection. Session cookies are SameSite=None (required for the
// cross-origin Vercel → Railway setup), so browsers attach them to cross-site
// requests. Browsers always send an Origin header on cross-origin state-changing
// requests — reject any that isn't ours. Requests with no Origin header
// (curl, server-to-server, most same-origin GETs) pass through.
app.use((req: Request, res: Response, next: NextFunction) => {
  const method = req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return next();
  const origin = req.headers.origin;
  if (origin && !allowedOrigins.includes(origin)) {
    return res.status(403).json({ message: 'Cross-origin request blocked' });
  }
  next();
});

// Baseline security headers (no extra packages needed).
app.use((req: Request, res: Response, next: NextFunction) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  // CSP: tighten what can load on each page.
  // - script-src: self + the CDN used by /api/copy-review's inline DOMPurify page
  // - img-src: self + data URIs (profile pictures) + https (Google/external avatars)
  // - connect-src: self (API calls from the SPA)
  // 'unsafe-inline' on style-src covers Tailwind's runtime style injection; remove
  // once the build emits hashed style chunks.
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https:",
      "connect-src 'self'",
      "font-src 'self' data:",
      "frame-ancestors 'none'",
    ].join('; '),
  );
  if (process.env.NODE_ENV === 'production') {
    // 180 days; add 'preload' once you're confident every subdomain is HTTPS.
    res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  }
  next();
});

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: false, limit: '10mb' }));

// Session secret — must be a stable, secret value. A random per-boot value would
// invalidate every session on restart, and a hardcoded literal is not a secret.
const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('SESSION_SECRET environment variable must be set in production.');
  }
  console.warn('WARNING: SESSION_SECRET is not set. Using an insecure development-only secret.');
}

// Session middleware with database persistence
const PgSession = pgSession(session);
app.use(
  session({
    store: new PgSession({
      pool,
      tableName: 'session',
    }),
    secret: sessionSecret || 'dev-only-insecure-secret-do-not-use-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax', // 'none' required for cross-origin (Vercel → Railway)
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    },
  })
);

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      // Do NOT log response bodies — they can contain invite codes, emails,
      // and other sensitive data that doesn't belong in log storage.
      log(`${req.method} ${path} ${res.statusCode} in ${duration}ms`);
    }
  });

  next();
});

(async () => {
  try {
    const server = await registerRoutes(app);

    app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
      const status = err.status || err.statusCode || 500;
      const message = err.message || "Internal Server Error";
      // Log, never rethrow: an uncaught throw here can crash the whole process,
      // turning any request that triggers an error into a denial of service.
      console.error("Unhandled request error:", err);
      if (!res.headersSent) {
        res.status(status).json({ message });
      }
    });

    // In development: serve frontend via Vite dev server
    // In production with API_ONLY=true (Railway): skip static files — Vercel handles the frontend
    // In production without API_ONLY (local full build): serve the built frontend
    if (app.get("env") === "development") {
      // Dynamic import keeps `vite` (a devDependency) out of the production
      // bundle's static imports — it is only loaded when actually in dev.
      const { setupVite } = await import("./vite-dev");
      await setupVite(app, server);
    } else if (!process.env.API_ONLY) {
      serveStatic(app);
    }

    // Load the shared Google connection into memory at boot so a restart never
    // bounces users back to the OAuth screen and background jobs can run.
    try {
      const { googleOAuthAuth } = await import("./google-service-auth");
      const loaded = await googleOAuthAuth.loadSharedConnection();
      log(loaded
        ? "Shared Google connection loaded at startup"
        : "No shared Google connection yet — first login will set it for everyone");
    } catch (e) {
      console.error("Failed to load shared Google connection at startup:", e);
    }

    // A suggested-edit scan runs for minutes in-process, so a restart mid-scan
    // would otherwise leave its row stuck at "running" forever and the UI
    // spinning with it.
    //
    // Two mechanisms, deliberately:
    //  1. SIGTERM (what Railway sends on every deploy) — the process that owns
    //     the scan marks its own runs interrupted. Precise, and safe during a
    //     rolling deploy where a new instance is already up.
    //  2. A heartbeat sweep — the backstop for a hard crash that never gets to
    //     run (1). Never keyed off "this process just booted", because during a
    //     rolling deploy that would flag a scan still running on the old one.
    try {
      const { markInterruptedScans, shutdownActiveScans } = await import(
        "./suggested-edits-scanner"
      );

      // Not awaited: a slow/unreachable DB here must not delay opening the port
      // and failing Railway's healthcheck.
      markInterruptedScans().catch((e) =>
        console.error("Startup interrupted-scan sweep failed:", e),
      );
      setInterval(() => {
        markInterruptedScans("Scan stopped responding and was marked interrupted.").catch((e) =>
          console.error("Interrupted-scan sweep failed:", e),
        );
      }, 60 * 1000).unref();

      let shuttingDown = false;
      const onSignal = (signal: string) => {
        if (shuttingDown) return;
        shuttingDown = true;
        shutdownActiveScans(`Server ${signal === "SIGINT" ? "stopped" : "restarted"} while the scan was running.`)
          .catch((e) => console.error("Failed to flag scans on shutdown:", e))
          .finally(() => process.exit(0));
      };
      process.once("SIGTERM", () => onSignal("SIGTERM"));
      process.once("SIGINT", () => onSignal("SIGINT"));
    } catch (e) {
      console.error("Failed to set up scan interruption handling:", e);
    }

    // Initialize scheduler for scheduled posts, hours, and review emails
    initializeScheduler();

    const port = parseInt(process.env.PORT || '5000', 10);
    server.listen({
      port,
      host: "0.0.0.0",
      reusePort: true,
    }, () => {
      log(`serving on port ${port}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
})();
