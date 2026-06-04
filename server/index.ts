import express, { type Request, Response, NextFunction } from "express";
import cors from "cors";
import session from "express-session";
import pgSession from "connect-pg-simple";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
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
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }
      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }
      log(logLine);
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
      res.status(status).json({ message });
      throw err;
    });

    // In development: serve frontend via Vite dev server
    // In production with API_ONLY=true (Railway): skip static files — Vercel handles the frontend
    // In production without API_ONLY (local full build): serve the built frontend
    if (app.get("env") === "development") {
      await setupVite(app, server);
    } else if (!process.env.API_ONLY) {
      serveStatic(app);
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
