import type { Express } from "express";
import { createServer, type Server } from "http";
import multer from "multer";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import verificationRoutes from "./verification-routes";
import { storage } from "./storage";
import { sendScheduledReviewEmailForGroup, syncPerfData } from "./scheduler";
import { insertClientSettingsSchema, insertJobSchema, insertAppleLocationSchema, posts, clients, jobItems, clientLocations, jobs, suggestedEdits, suggestedEditActions, activityLog, locationFolders, users, locationPerformanceData, type InsertClientLocation } from "@shared/schema";
import { processJob, progressEmitter } from "./job-processor";
import { z } from "zod";
import type { Response } from "express";
import { googleStorageService } from "./google-storage-service.js";
import { db } from "./db";
import { eq, and, or, desc, inArray, gte, lte, sql } from "drizzle-orm";
import { put as blobPut } from "@vercel/blob";
import { sendEmail, sendHtmlEmail, sendTextEmail } from "./gmail-service";
import { generateReviewEmailHtml } from "./utils/review-email-template";

// Resolve the acting local user from the SERVER session (set at login).
// Never trust the client-supplied X-Local-User-Id header for authorization —
// it is freely spoofable. The header is ignored here intentionally.
function getLocalUserId(req: any): string | null {
  const localUserId = req.session?.localUserId;
  return typeof localUserId === 'string' ? localUserId : null;
}

// Password hashing helpers (Node built-in crypto, no extra packages)
function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  // Defensive: malformed/legacy stored values must fail closed, not throw.
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const verify = crypto.scryptSync(password, salt, 64).toString('hex');
  const hashBuf = Buffer.from(hash, 'hex');
  const verifyBuf = Buffer.from(verify, 'hex');
  // timingSafeEqual throws on length mismatch — guard it.
  if (hashBuf.length !== verifyBuf.length) return false;
  return crypto.timingSafeEqual(hashBuf, verifyBuf);
}

// Strip passwordHash and add hasPassword for safe API responses
function safeLocalUser(user: any) {
  const { passwordHash, ...rest } = user;
  return { ...rest, hasPassword: !!passwordHash };
}

// Helper function to convert Decimal fields to numbers for JSON serialization
function normalizeLocation(loc: any) {
  if (!loc) return loc;
  return {
    ...loc,
    averageRating: loc.averageRating ? Number(loc.averageRating) : null,
    totalReviews: loc.totalReviews ? Number(loc.totalReviews) : 0,
  };
}

function normalizeLocations(locs: any[]) {
  return locs.map(normalizeLocation);
}


// Configure multer for in-memory file storage (for GBP posts)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB max file size
    files: 10, // max 10 files per upload
  },
  fileFilter: (req, file, cb) => {
    // Allow only image files for photo uploads
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  }
});

// Configure multer for profile picture uploads (in-memory for object storage upload)
const profilePictureUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB max for profile pictures
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  }
});


// SSE connection tracking
const sseConnections = new Map<string, Set<Response>>();

// Listen to progress events and broadcast to SSE clients
progressEmitter.on("progress", (progress) => {
  const jobConnections = sseConnections.get(progress.jobId);
  if (jobConnections) {
    const data = JSON.stringify(progress);
    jobConnections.forEach(res => {
      try {
        res.write(`data: ${data}\n\n`);
      } catch (error) {
        console.error("Error writing to SSE connection:", error);
        // Remove broken connections
        jobConnections.delete(res);
      }
    });
  }
});

export async function registerRoutes(app: Express): Promise<Server> {
  // Auth middleware for protected uploads / routes.
  const requireAuth = (req: any, res: any, next: any) => {
    if (!req.session?.userId) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    next();
  };

  // Global API auth gate. Every /api/* route requires an authenticated Google
  // session (req.session.userId) EXCEPT the public allowlist below. This is the
  // real server-side enforcement — previously the only protection was per-route
  // requireAuth applied inconsistently, leaving most routes wide open.
  // Note: the Google OAuth flow lives at /auth/google(/callback), outside /api.
  const PUBLIC_API_PATHS = new Set<string>([
    "/api/health",
    "/api/auth/status",
    "/api/auth/logout",
    "/api/auth/revoke-google",
    "/api/copy-review", // public share link opened from review emails
  ]);
  app.use("/api", (req, res, next) => {
    // req.path is relative to the "/api" mount point (e.g. "/health").
    const fullPath = "/api" + req.path.replace(/\/$/, "");
    if (PUBLIC_API_PATHS.has(fullPath) || PUBLIC_API_PATHS.has("/api" + req.path)) {
      return next();
    }
    if (!req.session?.userId) {
      return res.status(401).json({ message: "Authentication required" });
    }
    next();
  });

  // Verification routes (now behind the global auth gate above)
  app.use("/api/verification", verificationRoutes);

  // Health check endpoint (no auth required)
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // Post image upload: file -> Google Cloud Storage (gbp_images bucket) -> public URL.
  // Images are foldered by client name to match the existing bucket structure.
  app.post("/api/images/upload", requireAuth, upload.single('image'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      if (!googleStorageService.isConfigured()) {
        return res.status(503).json({ message: "Google Cloud Storage not configured (GOOGLE_CLOUD_PROJECT_ID missing)" });
      }

      // Resolve client name for folder placement (optional — falls back to bucket root)
      let folder: string | undefined;
      const clientId = req.body?.clientId;
      if (clientId) {
        const client = await storage.getClient(clientId);
        folder = client?.name;
      }

      const url = await googleStorageService.uploadImage(
        req.file.buffer,
        req.file.originalname,
        req.file.mimetype,
        folder,
      );

      res.json({ url });
    } catch (error: any) {
      console.error("Error uploading image to GCS:", error);
      res.status(500).json({ message: error.message || "Failed to upload image" });
    }
  });

  // Profile picture upload endpoint (requires authentication - auth runs BEFORE multer)
  // Stores image as a base64 data URL directly in the DB — no external storage needed
  app.post("/api/upload/profile-picture", requireAuth, profilePictureUpload.single('file'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      const dataUrl = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
      res.json({ url: dataUrl });
    } catch (error) {
      console.error("Error uploading profile picture:", error);
      res.status(500).json({ message: "Failed to upload profile picture" });
    }
  });

  // Job progress endpoints
  app.get("/api/jobs/:id", async (req, res) => {
    try {
      const job = await storage.getJob(req.params.id);
      if (!job) {
        return res.status(404).json({ message: "Job not found" });
      }
      
      // Include items if requested or by default for full job details
      const includeItems = req.query.includeItems !== 'false';
      if (includeItems) {
        const jobItems = await storage.getJobItems(req.params.id);
        
        // Enrich with location details
        const enrichedItems = await Promise.all(jobItems.map(async (item) => {
          const location = await storage.getLocation(item.clientLocationId);
          return {
            ...item,
            locationName: location?.name || (item.payload as any)?.locationTitle || 'Unknown Location',
            locationAddress: location?.address || '',
          };
        }));
        
        return res.json({ ...job, items: enrichedItems });
      }
      
      res.json(job);
    } catch (error) {
      console.error("Error fetching job:", error);
      res.status(500).json({ message: "Failed to fetch job" });
    }
  });

  app.get("/api/jobs/:id/progress", async (req, res) => {
    try {
      const job = await storage.getJob(req.params.id);
      if (!job) {
        return res.status(404).json({ message: "Job not found" });
      }
      
      // Pull the first error message from failed job items so the UI can show why it failed
      let errorMessage: string | undefined;
      const isDone = job.status === "failed" || job.status === "partial" || job.status === "success";
      if (isDone && (job.errorCount ?? 0) > 0) {
        const items = await storage.getJobItems(job.id);
        const firstFailed = items.find(i => i.status === "failed" && i.errorText);
        if (firstFailed?.errorText) {
          // Strip very long stack/system messages down to the human-readable first sentence
          errorMessage = firstFailed.errorText.split("\n")[0].slice(0, 300);
        }
      }

      const progress = {
        jobId: job.id,
        status: job.status,
        totalItems: job.totalItems,
        successCount: job.successCount,
        errorCount: job.errorCount,
        processedCount: job.processedCount || 0,
        percent: job.totalItems > 0 ? Math.round(((job.processedCount || 0) / job.totalItems) * 100) : 0,
        step: job.status === "queued" ? 1 : job.status === "running" ? 2 : 3,
        errorMessage,
      };
      
      res.json(progress);
    } catch (error) {
      console.error("Error fetching job progress:", error);
      res.status(500).json({ message: "Failed to fetch job progress" });
    }
  });

  app.get("/api/jobs/:id/stream", (req, res) => {
    const jobId = req.params.id;
    
    // Set SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Cache-Control'
    });

    // Add connection to tracking
    if (!sseConnections.has(jobId)) {
      sseConnections.set(jobId, new Set());
    }
    sseConnections.get(jobId)!.add(res);

    console.log(`SSE client connected for job ${jobId}`);

    // Send initial connection message
    res.write(`data: ${JSON.stringify({ type: "connected", jobId })}\n\n`);

    // Handle client disconnect
    req.on('close', () => {
      console.log(`SSE client disconnected for job ${jobId}`);
      const connections = sseConnections.get(jobId);
      if (connections) {
        connections.delete(res);
        if (connections.size === 0) {
          sseConnections.delete(jobId);
        }
      }
    });
  });

  app.get("/api/jobs/:id/items", async (req, res) => {
    try {
      const jobItems = await storage.getJobItems(req.params.id);
      
      // Enrich with location details
      const enrichedItems = await Promise.all(jobItems.map(async (item) => {
        const location = await storage.getLocation(item.clientLocationId);
        return {
          ...item,
          locationName: location?.name || (item.payload as any)?.locationTitle || 'Unknown Location',
          locationAddress: location?.address || '',
        };
      }));
      
      res.json(enrichedItems);
    } catch (error) {
      console.error("Error fetching job items:", error);
      res.status(500).json({ message: "Failed to fetch job items" });
    }
  });

  // Get scheduled posts for the current user
  app.get("/api/scheduled-posts", async (req, res) => {
    try {
      const userId = req.session?.userId;
      if (!userId) {
        return res.status(401).json({ message: "Not authenticated" });
      }

      // Get all scheduled jobs with their items
      const scheduledJobs = await db.select()
        .from(jobs)
        .where(
          and(
            eq(jobs.type, "posts"),
            eq(jobs.isScheduled, true),
            eq(jobs.status, "scheduled")
          )
        )
        .orderBy(desc(jobs.createdAt));

      // Enrich with job items for each job
      const enrichedJobs = await Promise.all(scheduledJobs.map(async (job) => {
        const items = await storage.getJobItems(job.id);
        
        // Get location details for each item
        const enrichedItems = await Promise.all(items.map(async (item) => {
          const location = await storage.getLocation(item.clientLocationId);
          return {
            ...item,
            locationName: location?.name || (item.payload as any)?.locationTitle || 'Unknown',
            locationAddress: location?.address || '',
          };
        }));

        return {
          ...job,
          items: enrichedItems,
        };
      }));

      res.json(enrichedJobs);
    } catch (error) {
      console.error("Error fetching scheduled posts:", error);
      res.status(500).json({ message: "Failed to fetch scheduled posts" });
    }
  });

  // Cancel a scheduled post
  app.post("/api/scheduled-posts/:id/cancel", async (req, res) => {
    try {
      const userId = req.session?.userId;
      if (!userId) {
        return res.status(401).json({ message: "Not authenticated" });
      }

      const jobId = req.params.id;
      const job = await storage.getJob(jobId);

      if (!job) {
        return res.status(404).json({ message: "Scheduled post not found" });
      }

      if (job.status !== "scheduled") {
        return res.status(400).json({ message: "Can only cancel scheduled posts" });
      }

      // Update job status to cancelled
      await storage.updateJob(jobId, { status: "cancelled" });

      res.json({ message: "Scheduled post cancelled successfully" });
    } catch (error) {
      console.error("Error cancelling scheduled post:", error);
      res.status(500).json({ message: "Failed to cancel scheduled post" });
    }
  });

  // OAuth Authentication Routes
  app.get("/auth/google", async (req, res) => {
    try {
      const { googleOAuthAuth } = await import("./google-service-auth");
      
      // Determine the origin from the request
      const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'https';
      const host = req.headers['host'] || req.hostname;
      const origin = `${protocol}://${host}`;
      
      // Store the origin in the session for use during callback
      (req.session as any).oauthOrigin = origin;
      
      console.log(`🌐 OAuth initiated from origin: ${origin}`);
      
      const authUrl = googleOAuthAuth.getAuthUrl(origin);
      res.redirect(authUrl);
    } catch (error) {
      console.error('Error initiating Google OAuth:', error);
      res.status(500).json({ error: 'Failed to initiate authentication' });
    }
  });

  app.get("/auth/google/callback", async (req, res) => {
    try {
      const { googleOAuthAuth } = await import("./google-service-auth");
      const code = req.query.code as string;
      
      if (!code) {
        return res.status(400).json({ error: 'No authorization code received' });
      }
      
      // Get the origin stored during OAuth initiation, or determine from current request
      let origin = (req.session as any).oauthOrigin;
      if (!origin) {
        const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'https';
        const host = req.headers['host'] || req.hostname;
        origin = `${protocol}://${host}`;
      }
      
      console.log(`🌐 OAuth callback received on origin: ${origin}`);
      
      // Pass origin to handleCallback so it uses the correct redirect URI for token exchange
      const tokens = await googleOAuthAuth.handleCallback(code, origin);
      
      // Get user info from Google
      const userInfo = await googleOAuthAuth.getUserInfo();
      console.log('👤 User info from Google:', userInfo);
      
      // Create or get user in database
      let user = await storage.getUserByGoogleId(userInfo.googleId);
      
      if (!user) {
        console.log('📝 Creating new user in database');
        user = await storage.createUser({
          googleId: userInfo.googleId,
          email: userInfo.email,
          name: userInfo.name,
          accessToken: tokens.access_token || null,
          refreshToken: tokens.refresh_token || null,
        });
      } else {
        console.log('✅ User already exists in database, updating tokens');
        user = await storage.updateUserTokens(
          user.id,
          tokens.access_token || '',
          tokens.refresh_token
        );
      }
      
      // Store user ID in session
      req.session.userId = user.id;
      req.session.googleId = user.googleId;
      
      // Clear the stored OAuth origin
      delete (req.session as any).oauthOrigin;
      
      console.log('✅ User authenticated, tokens saved, and session created:', { userId: user.id, email: user.email });
      
      // Redirect to the frontend after successful authentication.
      // In production the frontend lives on Vercel (FRONTEND_URL); fall back to '/' for local dev.
      const frontendUrl = process.env.FRONTEND_URL || '/';
      res.redirect(frontendUrl);
    } catch (error) {
      console.error('Error handling OAuth callback:', error);
      res.status(500).json({ error: 'Authentication failed' });
    }
  });

  app.get("/api/auth/status", async (req, res) => {
    try {
      const { googleOAuthAuth } = await import("./google-service-auth");
      
      // If not authenticated but we have a session, try to restore tokens
      if (!googleOAuthAuth.isAuthenticated() && req.session.userId) {
        const user = await storage.getUser(req.session.userId);
        
        if (user?.accessToken && user?.refreshToken) {
          console.log('🔄 Restoring OAuth tokens from database for user:', user.email);
          await googleOAuthAuth.restoreTokens(user.accessToken, user.refreshToken);
        }
      }
      
      const authenticated = googleOAuthAuth.isAuthenticated();
      console.log('🔍 Auth status - custom OAuth:', authenticated, 'Session userId:', req.session.userId);
      res.json({ authenticated });
    } catch (error) {
      console.error('Auth status error:', error);
      res.json({ authenticated: false });
    }
  });

  app.post("/api/auth/logout", async (req, res) => {
    try {
      const { googleOAuthAuth } = await import("./google-service-auth");
      googleOAuthAuth.logout();
      
      // Destroy session
      req.session.destroy((err) => {
        if (err) {
          console.error('Session destroy error:', err);
        }
      });
      
      res.json({ success: true, message: 'Logged out successfully. Please sign in again.' });
    } catch (error) {
      console.error('Logout error:', error);
      res.status(500).json({ error: 'Logout failed' });
    }
  });

  // Developer: revoke Google auth tokens without destroying session
  app.post("/api/auth/revoke-google", async (req, res) => {
    try {
      const { googleOAuthAuth } = await import("./google-service-auth");
      
      // 1. Clear tokens from memory
      googleOAuthAuth.logout();
      
      // 2. Also clear tokens from the database so the auto-restore can't repopulate them
      const userId = req.session.userId;
      if (userId) {
        await storage.updateUser(userId, { accessToken: null as any, refreshToken: null as any });
        console.log('🔧 [DEV] Google auth tokens wiped from DB for user:', userId);
      }
      
      console.log('🔧 [DEV] Google auth revoked — session preserved, tokens gone from memory + DB');
      res.json({ success: true, message: 'Google authentication revoked. App session preserved.' });
    } catch (error) {
      console.error('Revoke error:', error);
      res.status(500).json({ error: 'Failed to revoke Google auth' });
    }
  });

  // User Settings
  app.get("/api/user/settings", async (req, res) => {
    try {
      const { googleOAuthAuth } = await import("./google-service-auth");
      
      if (!googleOAuthAuth.isAuthenticated()) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      // Get user ID from session
      const userId = req.session.userId;
      if (!userId) {
        return res.status(401).json({ error: 'No user session found. Please log in again.' });
      }

      // Get the user
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      // Calculate next sync date: 7 days after last sync, or next 3 AM UTC if never synced
      const lastSync = user.lastLocationSyncAt ? new Date(user.lastLocationSyncAt) : null;
      let nextSync: Date;
      if (lastSync) {
        nextSync = new Date(lastSync.getTime() + 7 * 24 * 60 * 60 * 1000);
        nextSync.setUTCHours(3, 0, 0, 0);
      } else {
        const now = new Date();
        nextSync = new Date(now);
        nextSync.setUTCHours(3, 0, 0, 0);
        if (nextSync <= now) nextSync.setUTCDate(nextSync.getUTCDate() + 1);
      }

      // Return user settings (excluding sensitive data)
      res.json({
        name: user.name,
        email: user.email,
        timezone: user.timezone || "America/Phoenix",
        notificationEmail: user.notificationEmail || user.email,
        notifyOnJobCompletion: user.notifyOnJobCompletion !== false,
        notifyOnErrors: user.notifyOnErrors !== false,
        notifyWeeklyReport: user.notifyWeeklyReport === true,
        lastLocationSyncAt: lastSync ? lastSync.toISOString() : null,
        nextLocationSyncAt: nextSync.toISOString(),
      });
    } catch (error) {
      console.error('Error fetching user settings:', error);
      res.status(500).json({ error: 'Failed to fetch user settings' });
    }
  });

  app.put("/api/user/settings", async (req, res) => {
    try {
      const { googleOAuthAuth } = await import("./google-service-auth");
      
      if (!googleOAuthAuth.isAuthenticated()) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      // Get user ID from session
      const userId = req.session.userId;
      if (!userId) {
        return res.status(401).json({ error: 'No user session found. Please log in again.' });
      }

      // Validate input
      const settingsSchema = z.object({
        name: z.string().min(1).optional(),
        email: z.string().email().optional(),
        timezone: z.string().optional(),
        notificationEmail: z.string().email().optional(),
        notifyOnJobCompletion: z.boolean().optional(),
        notifyOnErrors: z.boolean().optional(),
        notifyWeeklyReport: z.boolean().optional(),
      });

      const validatedData = settingsSchema.parse(req.body);

      // Get the user
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      // Update user settings
      const updatedUser = await storage.updateUser(user.id, {
        name: validatedData.name,
        email: validatedData.email,
        timezone: validatedData.timezone,
        notificationEmail: validatedData.notificationEmail,
        notifyOnJobCompletion: validatedData.notifyOnJobCompletion,
        notifyOnErrors: validatedData.notifyOnErrors,
        notifyWeeklyReport: validatedData.notifyWeeklyReport,
      });

      res.json({
        name: updatedUser.name,
        email: updatedUser.email,
        timezone: updatedUser.timezone || "America/Phoenix",
        notificationEmail: updatedUser.notificationEmail || updatedUser.email,
        notifyOnJobCompletion: updatedUser.notifyOnJobCompletion !== false,
        notifyOnErrors: updatedUser.notifyOnErrors !== false,
        notifyWeeklyReport: updatedUser.notifyWeeklyReport === true,
      });
    } catch (error) {
      console.error('Error updating user settings:', error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid data', details: error.errors });
      }
      res.status(500).json({ error: 'Failed to update user settings' });
    }
  });

  // Local Users - CRUD endpoints
  app.get("/api/local-users", async (req, res) => {
    try {
      const userId = req.session.userId;
      if (!userId) {
        return res.status(401).json({ error: 'Not authenticated' });
      }
      const localUsers = await storage.getLocalUsersByUserId(userId);
      res.json(localUsers.map(safeLocalUser));
    } catch (error) {
      console.error('Error fetching local users:', error);
      res.status(500).json({ error: 'Failed to fetch local users' });
    }
  });

  app.get("/api/local-users/:id", async (req, res) => {
    try {
      const localUser = await storage.getLocalUser(req.params.id);
      if (!localUser) {
        return res.status(404).json({ error: 'Local user not found' });
      }
      res.json(safeLocalUser(localUser));
    } catch (error) {
      console.error('Error fetching local user:', error);
      res.status(500).json({ error: 'Failed to fetch local user' });
    }
  });

  // Login with password
  app.post("/api/local-users/:id/login", async (req, res) => {
    try {
      const localUser = await storage.getLocalUser(req.params.id);
      if (!localUser) {
        return res.status(404).json({ error: 'User not found' });
      }
      if (!localUser.passwordHash) {
        return res.status(400).json({ error: 'Account not set up yet' });
      }
      const { password } = req.body;
      if (!password) {
        return res.status(400).json({ error: 'Password is required' });
      }
      if (!verifyPassword(password, localUser.passwordHash)) {
        return res.status(401).json({ error: 'Incorrect password' });
      }
      // Establish the local-user identity server-side. This is the authoritative
      // source for getLocalUserId() — not the client header or localStorage.
      (req.session as any).localUserId = localUser.id;
      req.session.save((err) => {
        if (err) {
          console.error('Error saving session on local user login:', err);
          return res.status(500).json({ error: 'Login failed' });
        }
        res.json(safeLocalUser(localUser));
      });
    } catch (error) {
      console.error('Error logging in local user:', error);
      res.status(500).json({ error: 'Login failed' });
    }
  });

  // Set up account (email + password) for the first time
  app.post("/api/local-users/:id/setup", async (req, res) => {
    try {
      const userId = req.session.userId;
      if (!userId) {
        return res.status(401).json({ error: 'Not authenticated' });
      }
      const localUser = await storage.getLocalUser(req.params.id);
      if (!localUser) {
        return res.status(404).json({ error: 'User not found' });
      }
      // If account already has a password, setup is not allowed via this endpoint
      if (localUser.passwordHash) {
        return res.status(400).json({ error: 'Account already set up' });
      }
      const { email, password, inviteCode } = req.body;
      if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required' });
      }
      if (password.length < 6) {
        return res.status(400).json({ error: 'Password must be at least 6 characters' });
      }
      // Super admins can set up their account without an invite code (bootstrap case)
      const isSuperAdmin = localUser.role === 'super_admin';
      if (!isSuperAdmin) {
        if (!inviteCode) {
          return res.status(400).json({ error: 'Invite code is required' });
        }
        // Validate invite code
        const invite = await storage.getInviteCodeByCode(userId, inviteCode.trim());
        if (!invite || !invite.isActive || invite.usedAt) {
          return res.status(400).json({ error: 'Invalid or already used invite code' });
        }
        const passwordHash = hashPassword(password);
        const updated = await storage.updateLocalUser(req.params.id, { email, passwordHash } as any);
        await storage.markInviteCodeUsed(invite.id, req.params.id);
        (req.session as any).localUserId = updated.id;
        req.session.save((err) => {
          if (err) console.error('Error saving session on setup:', err);
          res.json(safeLocalUser(updated));
        });
        return;
      }
      const passwordHash = hashPassword(password);
      const updated = await storage.updateLocalUser(req.params.id, { email, passwordHash } as any);
      // Establish server-side session
      (req.session as any).localUserId = updated.id;
      req.session.save((err) => {
        if (err) console.error('Error saving session on setup:', err);
        res.json(safeLocalUser(updated));
      });
    } catch (error) {
      console.error('Error setting up local user account:', error);
      res.status(500).json({ error: 'Setup failed' });
    }
  });

  app.post("/api/local-users", async (req, res) => {
    try {
      const userId = req.session.userId;
      if (!userId) {
        return res.status(401).json({ error: 'Not authenticated' });
      }
      
      // Check if this is the first local user (auto-assign super_admin)
      const existingUsers = await storage.getLocalUsersByUserId(userId);
      const isFirstUser = existingUsers.length === 0;
      
      // If not first user, require super_admin role
      if (!isFirstUser) {
        const localUserId = getLocalUserId(req);
        if (!localUserId) {
          return res.status(403).json({ error: 'No local user selected' });
        }
        const currentUser = await storage.getLocalUser(localUserId);
        if (!currentUser || currentUser.role !== 'super_admin') {
          return res.status(403).json({ error: 'Only super admins can create team members' });
        }
      }
      
      const { name, title, profilePictureUrl, role } = req.body;
      if (!name) {
        return res.status(400).json({ error: 'Name is required' });
      }
      const localUser = await storage.createLocalUser({
        userId,
        name,
        title: title || null,
        profilePictureUrl: profilePictureUrl || null,
        role: isFirstUser ? 'super_admin' : (role || 'admin'),
      });
      res.status(201).json(safeLocalUser(localUser));
    } catch (error) {
      console.error('Error creating local user:', error);
      res.status(500).json({ error: 'Failed to create local user' });
    }
  });

  app.patch("/api/local-users/:id", async (req, res) => {
    try {
      // Only the user themselves or a super_admin may edit a profile.
      const actingUserId = getLocalUserId(req);
      if (!actingUserId) {
        return res.status(403).json({ error: 'No local user selected' });
      }
      const actingUser = await storage.getLocalUser(actingUserId);
      if (!actingUser || (actingUser.role !== 'super_admin' && actingUser.id !== req.params.id)) {
        return res.status(403).json({ error: 'Not authorized to edit this user' });
      }
      const { name, title, profilePictureUrl } = req.body;
      const localUser = await storage.updateLocalUser(req.params.id, {
        name,
        title,
        profilePictureUrl,
      });
      res.json(safeLocalUser(localUser));
    } catch (error) {
      console.error('Error updating local user:', error);
      res.status(500).json({ error: 'Failed to update local user' });
    }
  });

  app.delete("/api/local-users/:id", async (req, res) => {
    try {
      // Require super_admin role to delete users
      const localUserId = getLocalUserId(req);
      if (!localUserId) {
        return res.status(403).json({ error: 'No local user selected' });
      }
      const currentUser = await storage.getLocalUser(localUserId);
      if (!currentUser || currentUser.role !== 'super_admin') {
        return res.status(403).json({ error: 'Only super admins can delete team members' });
      }
      
      await storage.deleteLocalUser(req.params.id);
      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting local user:', error);
      res.status(500).json({ error: 'Failed to delete local user' });
    }
  });

  // ── Invite Codes ──────────────────────────────────────────────────────────

  // List invite codes (super_admin only)
  app.get("/api/invite-codes", async (req, res) => {
    try {
      const userId = req.session.userId;
      if (!userId) return res.status(401).json({ error: 'Not authenticated' });
      const localUserId = getLocalUserId(req);
      if (!localUserId) return res.status(403).json({ error: 'No local user selected' });
      const currentUser = await storage.getLocalUser(localUserId);
      if (!currentUser || currentUser.role !== 'super_admin') {
        return res.status(403).json({ error: 'Only super admins can manage invite codes' });
      }
      const codes = await storage.listInviteCodes(userId);
      res.json(codes);
    } catch (error) {
      console.error('Error listing invite codes:', error);
      res.status(500).json({ error: 'Failed to list invite codes' });
    }
  });

  // Generate a new invite code (super_admin only)
  app.post("/api/invite-codes", async (req, res) => {
    try {
      const userId = req.session.userId;
      if (!userId) return res.status(401).json({ error: 'Not authenticated' });
      const localUserId = getLocalUserId(req);
      if (!localUserId) return res.status(403).json({ error: 'No local user selected' });
      const currentUser = await storage.getLocalUser(localUserId);
      if (!currentUser || currentUser.role !== 'super_admin') {
        return res.status(403).json({ error: 'Only super admins can create invite codes' });
      }
      // Generate a random readable code
      const code = crypto.randomBytes(4).toString('hex').toUpperCase();
      const invite = await storage.createInviteCode(userId, code, localUserId);
      res.status(201).json(invite);
    } catch (error) {
      console.error('Error creating invite code:', error);
      res.status(500).json({ error: 'Failed to create invite code' });
    }
  });

  // Revoke an invite code (super_admin only)
  app.delete("/api/invite-codes/:id", async (req, res) => {
    try {
      const userId = req.session.userId;
      if (!userId) return res.status(401).json({ error: 'Not authenticated' });
      const localUserId = getLocalUserId(req);
      if (!localUserId) return res.status(403).json({ error: 'No local user selected' });
      const currentUser = await storage.getLocalUser(localUserId);
      if (!currentUser || currentUser.role !== 'super_admin') {
        return res.status(403).json({ error: 'Only super admins can revoke invite codes' });
      }
      await storage.revokeInviteCode(req.params.id);
      res.json({ success: true });
    } catch (error) {
      console.error('Error revoking invite code:', error);
      res.status(500).json({ error: 'Failed to revoke invite code' });
    }
  });

  // Sync accounts from Google Business Profile API
  app.post("/api/sync/accounts", async (req, res) => {
    try {
      console.log('🚀 === SYNC ACCOUNTS ENDPOINT CALLED ===');
      const { googleOAuthAuth } = await import("./google-service-auth");
      
      if (!googleOAuthAuth.isAuthenticated()) {
        console.log('❌ Not authenticated');
        return res.status(401).json({ error: 'Not authenticated. Please log in.' });
      }

      // Get user ID from session
      const userId = req.session.userId;
      if (!userId) {
        console.log('❌ No user session found');
        return res.status(401).json({ error: 'No user session found. Please log in again.' });
      }

      console.log(`🔄 Starting account sync for user ${userId}...`);
      
      // Fetch business accounts from Google using OAuth service
      const accounts = await googleOAuthAuth.getAccounts();
      console.log(`📊 Found ${accounts.length} business accounts from Google`);
      
      if (accounts.length > 0) {
        console.log('📋 Accounts:', accounts.map((a: any) => ({ 
          id: a.name?.split('/').pop(), 
          name: a.accountName || a.name 
        })));
      }
      
      if (accounts.length === 0) {
        return res.json({ 
          success: true, 
          message: 'No accounts found in Google Business Profile',
          accountsCount: 0,
          locationsCount: 0
        });
      }
      
      let accountsCount = 0;
      let newLocationsCount = 0;
      let updatedLocationsCount = 0;
      const locationsNeedingGeocode: Array<{ id: string; address: string }> = [];

      // Step 1: All accounts (including Location Groups) can have locations
      console.log('🔍 Processing all accounts (including Location Groups)...');
      const allAccountsToProcess = accounts;
      
      console.log(`📊 Total accounts to process: ${allAccountsToProcess.length}`);
      
      // Step 2: Sync all accounts to database
      for (const account of allAccountsToProcess) {
        const accountId = account.name?.split('/').pop() || account.name;
        const accountType = account.type || 'PERSONAL';
        
        const clientData = {
          id: accountId,
          userId: userId,
          name: account.accountName || account.name,
          accountNumber: account.accountNumber,
          type: accountType,
        };
        
        // Create or update client
        const existingClient = await storage.getClient(clientData.id);
        if (!existingClient) {
          await storage.createClient(clientData);
          
          // Create default settings for new clients
          await storage.upsertClientSettings({
            clientId: accountId,
            timezone: 'America/Phoenix',
            enableScheduledPosts: false,
            postsCron: '0 9 1,15 * *',
            enableScheduledHours: false,
            hoursCron: '0 9 1 */2 *'
          });
          
          accountsCount++;
          console.log(`✅ Created new account: ${clientData.name}`);
        } else {
          // Update existing client with latest info
          await db.update(clients)
            .set({
              name: clientData.name,
              accountNumber: clientData.accountNumber,
              type: clientData.type,
              updatedAt: new Date()
            })
            .where(eq(clients.id, clientData.id));
          console.log(`ℹ️  Account already exists: ${clientData.name}`);
        }
      }

      // Step 3: Fetch ALL locations at once using the wildcard endpoint (per-account endpoint returns 400)
      console.log('🌍 Fetching all locations via wildcard endpoint...');
      const allLocations = await googleOAuthAuth.getAllLocations();
      console.log(`  └─ Found ${allLocations.length} total locations`);

      // Build a set of known account IDs so we don't try to assign locations to accounts
      // that don't exist in our clients table. The wildcard endpoint returns ALL locations
      // the OAuth credentials can see — potentially across more accounts than we track.
      const knownAccountIds = new Set(
        allAccountsToProcess.map((a: any) => a.name?.split('/').pop() || a.name)
      );

      let skippedCount = 0;

      for (const location of allLocations) {
        const locationId = location.name?.split('/').pop() || location.name;

        // Extract account ID from location name: "accounts/12345/locations/67890" → "12345"
        const nameParts = (location.name || '').split('/');
        const accountId = nameParts.length >= 4 ? nameParts[1] : '';

        // Map Google's openInfo.status to our status
        let status = 'unknown';
        if (location.openInfo?.status) {
          const googleStatus = location.openInfo.status.toUpperCase();
          if (googleStatus === 'OPEN') {
            status = 'active';
          } else if (googleStatus === 'CLOSED_TEMPORARILY') {
            status = 'temporarily_closed';
          } else if (googleStatus === 'CLOSED_PERMANENTLY') {
            status = 'permanently_closed';
          }
        }

        // Pull lat/lng straight from the verified GBP `latlng` field when present.
        // Falls back to the U.S. Census geocoder below when missing (handles
        // service-area businesses, brand-new pins, etc.).
        const gbpLat = location.latlng?.latitude;
        const gbpLng = location.latlng?.longitude;
        const hasGbpCoords = typeof gbpLat === 'number' && typeof gbpLng === 'number';

        const addressForGeocode = location.storefrontAddress
          ? `${location.storefrontAddress.addressLines?.join(', ') || ''}, ${location.storefrontAddress.locality || ''}, ${location.storefrontAddress.administrativeArea || ''} ${location.storefrontAddress.postalCode || ''}`.trim()
          : '';

        // Fields that are safe to update regardless of account ownership
        const updateFields: any = {
          gbpLocationId: location.name,
          name: location.title || 'Unnamed Location',
          address: location.storefrontAddress ?
            `${location.storefrontAddress.addressLines?.join(', ') || ''}, ${location.storefrontAddress.locality || ''}, ${location.storefrontAddress.administrativeArea || ''}`.trim() : '',
          city: location.storefrontAddress?.locality || '',
          phone: location.phoneNumbers?.primaryPhone || location.phoneNumbers?.[0]?.number || '',
          website: location.websiteUri || '',
          description: location.profile?.description || null,
          regularHours: location.regularHours || null,
          googleLocationId: location.name,
          zipCode: location.storefrontAddress?.postalCode || '',
          categories: Array.isArray(location.categories) ? location.categories.map((c: any) => c.displayName).join(', ') : '',
          isVerified: true,
          status: status,
          editPending: !!location.metadata?.hasPendingEdits,
          updatedAt: new Date()
        };

        if (hasGbpCoords) {
          updateFields.latitude = String(gbpLat);
          updateFields.longitude = String(gbpLng);
        }

        // Check if location exists - update (preserve clientId) or create (require known account)
        const existingLocation = await storage.getLocation(locationId);
        if (!existingLocation) {
          // Only create new locations for accounts we explicitly track
          if (!knownAccountIds.has(accountId)) {
            skippedCount++;
            continue;
          }
          await storage.createLocation({ id: locationId, clientId: accountId, ...updateFields });
          newLocationsCount++;
          if (!hasGbpCoords) locationsNeedingGeocode.push({ id: locationId, address: addressForGeocode });
        } else {
          // Detect changes to core info fields before overwriting
          const CORE_FIELDS = ["name", "phone", "address", "website", "description"] as const;
          const infoChanges = CORE_FIELDS.flatMap((field) => {
            const oldVal = ((existingLocation as any)[field] ?? "").toString().trim();
            const newVal = (updateFields[field] ?? "").toString().trim();
            return oldVal && newVal && oldVal !== newVal ? [{ field, old: oldVal, new: newVal }] : [];
          });
          if (infoChanges.length > 0) {
            try {
              await storage.createActivityLog({
                userId,
                clientId: existingLocation.clientId,
                clientLocationId: locationId,
                action: "location_info_changed",
                payloadJson: { changes: infoChanges },
              });
              console.log(`📝 Logged info change for "${existingLocation.name}" → "${updateFields.name}" (${infoChanges.map(c => c.field).join(", ")})`);
            } catch (err) {
              console.error(`❌ Failed to log info change for location ${locationId}:`, err);
            }
          }
          // For updates, preserve the existing clientId — never overwrite it with an unknown account
          await storage.updateLocation(locationId, updateFields);
          updatedLocationsCount++;
          // Geocode only if we don't already have lat/lng on file AND GBP didn't return one
          if (!hasGbpCoords && existingLocation.latitude == null) {
            locationsNeedingGeocode.push({ id: locationId, address: addressForGeocode });
          }
        }
      }

      {
        const { geocodeQueue, backfillMissingCoordinates } = await import("./utils/geocode");
        if (locationsNeedingGeocode.length > 0) {
          geocodeQueue.enqueueMany(
            locationsNeedingGeocode.map((j) => ({ locationId: j.id, address: j.address })),
          );
        }
        await backfillMissingCoordinates();
        console.log(`🗺️  Background geocoder queue size: ${geocodeQueue.size()}`);
      }

      if (skippedCount > 0) {
        console.log(`⏭️  Skipped ${skippedCount} locations from unknown/untracked accounts`);
      }

      const totalLocations = newLocationsCount + updatedLocationsCount;
      console.log(`✅ Sync complete: ${accountsCount} new accounts, ${newLocationsCount} new locations, ${updatedLocationsCount} updated locations`);
      console.log(`📊 Final stats: ${allAccountsToProcess.length} accounts processed, ${totalLocations} total locations`);

      // Record sync timestamp so the bi-weekly scheduler knows when the last sync was
      await db.update(users)
        .set({ lastLocationSyncAt: new Date() })
        .where(eq(users.id, userId));

      // Clear stale needs_reauth / suspended flags after a successful sync.
      try {
        await db.update(clients)
          .set({ accountState: 'verified', updatedAt: new Date() })
          .where(
            and(
              eq(clients.userId, userId),
              or(eq(clients.accountState, 'needs_reauth'), eq(clients.accountState, 'suspended')),
            ),
          );
      } catch (clearErr) {
        console.warn('Failed to clear stale account state on successful sync:', clearErr);
      }

      res.json({ 
        success: true, 
        message: `Synced ${allAccountsToProcess.length} accounts with ${totalLocations} total locations (${newLocationsCount} new, ${updatedLocationsCount} updated)`,
        accountsCount,
        locationsCount: newLocationsCount,
        totalAccounts: allAccountsToProcess.length,
        totalLocations: totalLocations
      });
    } catch (error: any) {
      console.error('❌ Error syncing accounts:', error);

      const errMsg = String(error?.message || error?.response?.data?.error || error || '');
      const errStatus = error?.response?.status ?? error?.status;
      const isInvalidGrant =
        errMsg.includes('invalid_grant') ||
        error?.response?.data?.error === 'invalid_grant';
      const isSuspended =
        errStatus === 403 &&
        /(disabled|suspended|permission_denied)/i.test(errMsg);

      if (isInvalidGrant && req.session?.userId) {
        try {
          await db.update(clients)
            .set({ accountState: 'needs_reauth', updatedAt: new Date() })
            .where(eq(clients.userId, req.session.userId));
          console.warn(`⚠️  Marked all clients for user ${req.session.userId} as needs_reauth (invalid_grant)`);
        } catch (markErr) {
          console.error('Failed to mark clients as needs_reauth:', markErr);
        }
        return res.status(401).json({
          error: 'invalid_grant',
          message: 'Your Google connection has expired. Please reconnect your account.',
          accountState: 'needs_reauth',
        });
      }

      if (isSuspended && req.session?.userId) {
        try {
          await db.update(clients)
            .set({ accountState: 'suspended', updatedAt: new Date() })
            .where(eq(clients.userId, req.session.userId));
          console.warn(`⚠️  Marked all clients for user ${req.session.userId} as suspended (Google 403)`);
        } catch (markErr) {
          console.error('Failed to mark clients as suspended:', markErr);
        }
        return res.status(403).json({
          error: 'account_suspended',
          message: 'Google reports this account as suspended or disabled. Please resolve the issue inside Google Business Profile.',
          accountState: 'suspended',
        });
      }

      res.status(500).json({
        error: 'Failed to sync accounts',
        message: error.message
      });
    }
  });

  // Manual trigger for GBP performance data sync
  app.post("/api/sync/performance", async (req, res) => {
    try {
      const result = await syncPerfData();
      if (!result.success && (result as any).reason === "not_authenticated") {
        return res.status(401).json({ error: "Not authenticated. Please log in." });
      }
      res.json(result);
    } catch (error: any) {
      console.error("❌ Error triggering perf sync:", error);
      res.status(500).json({ error: "Failed to run performance sync", message: error.message });
    }
  });

  // Get all locations (for scan filtering)
  app.get("/api/all-locations", async (req, res) => {
    try {
      const allLocs = await db.select().from(clientLocations);
      res.json(normalizeLocations(allLocs));
    } catch (error) {
      console.error("Error fetching all locations:", error);
      res.status(500).json({ message: "Failed to fetch locations" });
    }
  });

  // Clients - Fetch from Google Business Profile API using OAuth
  app.get("/api/clients", async (req, res) => {
    try {
      const { googleOAuthAuth } = await import("./google-service-auth");
      
      // Get user ID from session
      const userId = req.session.userId;
      
      // Always check database first as a fallback option
      const dbClients = userId ? await storage.getClientsByUserId(userId) : [];
      console.log(`📊 Database has ${dbClients.length} existing clients for user ${userId || 'unknown'}`);
      
      if (!googleOAuthAuth.isAuthenticated()) {
        console.log('⚠️ Not authenticated');
        // Return database clients if available
        if (dbClients.length > 0) {
          console.log(`✅ Returning ${dbClients.length} clients from database (not authenticated)`);
          return res.json(dbClients);
        }
        console.log('❌ No clients in database and not authenticated');
        return res.json([]);
      }
      
      if (!userId) {
        console.log('⚠️ No user session found');
        return res.json([]);
      }
      
      try {
        // Fetch business accounts from Google using OAuth service
        console.log('📊 Fetching business accounts from Google API...');
        const accounts = await googleOAuthAuth.getAccounts();
        console.log(`📊 Found ${accounts.length} business accounts`);
        
        if (accounts.length === 0) {
          console.log('⚠️ Google API returned no accounts, using database');
          if (dbClients.length > 0) {
            return res.json(dbClients);
          }
        }
        
        // Convert Google accounts to our client format and store in database
        const clients = [];
        const newAccountIds: string[] = [];
        
        for (const account of accounts) {
          const clientData = {
            id: account.name?.split('/').pop() || account.name,
            userId: userId, // Use real user ID from session
            name: account.accountName || account.name,
          };
          
          // Check if client already exists
          const existingClient = await storage.getClient(clientData.id);
          if (!existingClient) {
            // Create new client in database
            const newClient = await storage.createClient(clientData);
            clients.push(newClient);
            newAccountIds.push(clientData.id);
            console.log(`✅ Created new account: ${clientData.name} (will sync locations)`);
          } else {
            clients.push(existingClient);
          }
        }

        // Auto-sync locations for any newly created accounts
        if (newAccountIds.length > 0) {
          console.log(`🔄 Auto-syncing locations for ${newAccountIds.length} new accounts...`);
          
          // Sync locations in the background (don't wait for completion)
          (async () => {
            for (const accountId of newAccountIds) {
              try {
                const account = accounts.find((a: any) => a.name?.split('/').pop() === accountId);
                if (!account) continue;
                
                const locations = await googleOAuthAuth.getLocations(account.name);
                console.log(`📍 Found ${locations.length} locations for account ${accountId}`);
                
                for (const location of locations) {
                  const locationId = location.name?.split('/').pop() || location.name;
                  
                  // Map Google's openInfo.status to our status
                  let status = 'unknown';
                  if (location.openInfo?.status) {
                    const googleStatus = location.openInfo.status.toUpperCase();
                    if (googleStatus === 'OPEN') {
                      status = 'active';
                    } else if (googleStatus === 'CLOSED_TEMPORARILY') {
                      status = 'temporarily_closed';
                    } else if (googleStatus === 'CLOSED_PERMANENTLY') {
                      status = 'permanently_closed';
                    }
                  }
                  
                  const locationData = {
                    id: locationId,
                    clientId: accountId,
                    gbpLocationId: location.name,
                    name: location.title || 'Unnamed Location',
                    address: location.storefrontAddress ? 
                      `${location.storefrontAddress.addressLines?.join(', ') || ''}, ${location.storefrontAddress.locality || ''}, ${location.storefrontAddress.administrativeArea || ''}`.trim() : '',
                    city: location.storefrontAddress?.locality || '',
                    googleLocationId: location.name,
                    zipCode: location.storefrontAddress?.postalCode || '',
                    phone: location.phoneNumbers?.[0]?.number || '',
                    website: location.websiteUri || '',
                    categories: Array.isArray(location.categories) ? location.categories.map((c: any) => c.displayName).join(', ') : '',
                    averageRating: location.averageRating || null,
                    totalReviews: location.reviewCount || 0,
                    isVerified: true,
                    status: status,
                    updatedAt: new Date()
                  };
                  
                  await storage.createLocation(locationData);
                  console.log(`✅ Created location: ${locationData.name}`);
                }
              } catch (error) {
                console.error(`❌ Error syncing locations for account ${accountId}:`, error);
              }
            }
            console.log(`✅ Auto-sync complete for ${newAccountIds.length} accounts`);
          })();
        }

        res.json(clients);
      } catch (googleError: any) {
        console.error('⚠️ Google API error, falling back to database:', googleError.message);
        // Fallback: return clients from database if Google API fails
        if (dbClients.length > 0) {
          console.log(`✅ Returning ${dbClients.length} clients from database (fallback)`);
          return res.json(dbClients);
        }
        // Return empty array instead of throwing error
        console.log('❌ No clients available - returning empty array');
        return res.json([]);
      }
    } catch (error: any) {
      console.error('❌ Error fetching Google Business accounts:', error);
      console.error('Error details:', {
        message: error.message,
        stack: error.stack,
        response: error.response?.data
      });
      res.status(500).json({ 
        message: "Failed to fetch Google Business accounts", 
        error: error.message,
        details: error.response?.data?.error?.message || 'No additional details'
      });
    }
  });

  // Analytics overview
  app.get("/api/clients/:id/analytics", async (req, res) => {
    try {
      const { id } = req.params;
      const analytics = await storage.getClientAnalytics(id);
      res.json(analytics);
    } catch (error) {
      console.error("Analytics error:", error);
      res.status(500).json({ message: "Failed to fetch analytics", error: error instanceof Error ? error.message : String(error) });
    }
  });

  // Get reviews for a location
  app.get("/api/locations/:locationId/reviews", async (req, res) => {
    try {
      const { locationId } = req.params;
      const { startDate } = req.query;
      const { googleOAuthAuth } = await import("./google-service-auth");
      
      if (!googleOAuthAuth.isAuthenticated()) {
        return res.status(401).json({ error: 'Not authenticated. Please log in.' });
      }
      
      const location = await storage.getLocation(locationId);
      if (!location) {
        return res.status(404).json({ error: 'Location not found' });
      }
      
      const reviews = await googleOAuthAuth.getReviews(location.gbpLocationId, startDate as string | undefined);
      
      // Transform reviews to include star rating as number
      const transformedReviews = reviews.map((review: any) => {
        let starRating = 0;
        
        // Handle both enum and direct starRating field
        if (review.starRating) {
          if (typeof review.starRating === 'string') {
            const ratingMap: any = {
              'FIVE': 5,
              'FOUR': 4,
              'THREE': 3,
              'TWO': 2,
              'ONE': 1
            };
            starRating = ratingMap[review.starRating.toUpperCase()] || 0;
          } else {
            starRating = Number(review.starRating) || 0;
          }
        }
        
        const transformed = {
          reviewId: review.reviewId || review.name,
          reviewer: review.reviewer?.displayName || 'Anonymous',
          starRating: starRating,
          comment: review.comment || '',
          createTime: review.createTime,
          updateTime: review.updateTime,
          reviewReply: review.reviewReply,
          gbpLocationId: location.gbpLocationId
        };
        
        return transformed;
      });
      
      // Calculate average rating and save to database
      if (transformedReviews.length > 0) {
        const totalRating = transformedReviews.reduce((sum, r) => sum + r.starRating, 0);
        const averageRating = (totalRating / transformedReviews.length).toFixed(1);
        
        try {
          await storage.updateLocation(locationId, {
            averageRating: parseFloat(averageRating),
            totalReviews: transformedReviews.length
          });
          console.log(`⭐ Saved average rating ${averageRating} for location ${location.name} (${transformedReviews.length} reviews)`);
        } catch (error) {
          console.error(`⚠️ Failed to save rating for location ${locationId}:`, error);
        }
      }
      
      console.log(`⭐ Fetched ${transformedReviews.length} reviews for location ${location.name}`);
      res.json(transformedReviews);
    } catch (error: any) {
      console.error('❌ Error fetching reviews:', error);
      const msg: string = error?.message || String(error);
      // Surface the real Google API error so the client can display it
      const statusCode = msg.includes('401') ? 401 : msg.includes('403') ? 403 : 500;
      res.status(statusCode).json({
        message: "Failed to fetch reviews",
        error: msg
      });
    }
  });

  // Activity Log
  app.get("/api/dashboard/dismissed", async (req, res) => {
    try {
      const items = await storage.getDismissedDashboardItems();
      const jobs: string[] = [];
      const activity: string[] = [];
      for (const item of items) {
        if (item.itemType === "job") jobs.push(item.itemId);
        else if (item.itemType === "activity") activity.push(item.itemId);
      }
      res.setHeader("Cache-Control", "no-store");
      res.json({ jobs, activity });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/dashboard/dismissed", async (req, res) => {
    try {
      const { type, id } = req.body || {};
      if ((type !== "job" && type !== "activity") || !id || typeof id !== "string") {
        return res.status(400).json({ message: "type ('job'|'activity') and id required" });
      }
      const userId = (req.session as any)?.userId ?? null;
      await storage.addDismissedDashboardItem(type, id, userId);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/activity-log", async (req, res) => {
    try {
      const { client_id } = req.query;
      if (!client_id || typeof client_id !== "string") {
        return res.status(400).json({ message: "client_id required" });
      }
      
      const activities = await storage.getActivityLogsByClientId(client_id);

      // Collect unique jobIds referenced in payloads
      const jobIds = [...new Set(
        activities
          .map((a: any) => a.payloadJson?.jobId)
          .filter(Boolean)
      )];

      // Fetch those specific jobs to get their statuses
      const jobStatusMap = new Map<string, string>();
      await Promise.all(jobIds.map(async (jobId: string) => {
        const job = await storage.getJob(jobId);
        if (job) jobStatusMap.set(job.id, job.status);
      }));
      
      // Enrich with local user data and job status
      const enrichedActivities = await Promise.all(activities.map(async (activity: any) => {
        const jobId = activity.payloadJson?.jobId;
        // Fall back to payloadJson.status for actions that don't use the job queue (e.g. social media)
        const jobStatus = jobId
          ? (jobStatusMap.get(jobId) ?? null)
          : (activity.payloadJson?.status ?? null);
        if (activity.localUserId) {
          const localUser = await storage.getLocalUser(activity.localUserId);
          return {
            ...activity,
            jobStatus,
            localUser: localUser ? {
              id: localUser.id,
              name: localUser.name,
              title: localUser.title,
              profilePictureUrl: localUser.profilePictureUrl
            } : null
          };
        }
        return { ...activity, jobStatus, localUser: null };
      }));
      
      res.json(enrichedActivities);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch activity log" });
    }
  });

  // Delete activity log entry
  app.delete("/api/activity-log/:id", async (req, res) => {
    try {
      const { id } = req.params;
      
      // Delete the activity log entry using storage layer
      const deleted = await storage.deleteActivityLog(id);
      
      if (!deleted) {
        return res.status(404).json({ message: "Activity log entry not found" });
      }
      
      console.log(`🗑️ Deleted activity log entry: ${id}`);
      res.json({ success: true, message: "Activity log entry deleted successfully" });
    } catch (error) {
      console.error('Delete activity log error:', error);
      res.status(500).json({ message: "Failed to delete activity log entry" });
    }
  });

  // Revert a location_info_changed activity — pushes old values back to GBP and updates local DB
  app.post("/api/activity-log/:id/revert-location-info", async (req, res) => {
    try {
      const { id } = req.params;

      const entry = await storage.getActivityLogById(id);
      if (!entry) {
        return res.status(404).json({ message: "Activity log entry not found" });
      }
      if (entry.action !== "location_info_changed") {
        return res.status(400).json({ message: "This entry is not a location_info_changed event" });
      }

      const changes: Array<{ field: string; old: string; new: string }> = (entry.payloadJson as any)?.changes ?? [];
      if (changes.length === 0) {
        return res.status(400).json({ message: "No changes found in this activity log entry" });
      }

      const location = entry.clientLocationId ? await storage.getLocation(entry.clientLocationId) : null;
      if (!location?.gbpLocationId) {
        return res.status(404).json({ message: "Location or GBP ID not found" });
      }

      const { googleOAuthAuth } = await import("./google-service-auth");
      if (!googleOAuthAuth.isAuthenticated()) {
        return res.status(401).json({ message: "Not authenticated with Google. Please log in." });
      }

      // Push old values back to GBP
      const gbpResult = await googleOAuthAuth.revertLocationInfoChanges(location.gbpLocationId, changes);

      // Update local DB with the old values for each field we successfully reverted
      const localUpdates: Record<string, string> = {};
      for (const change of changes) {
        if (change.field === 'address') continue; // address can't be reverted via string
        if (['name', 'phone', 'website', 'description'].includes(change.field)) {
          localUpdates[change.field] = change.old;
        }
      }
      if (Object.keys(localUpdates).length > 0) {
        await storage.updateLocation(entry.clientLocationId!, localUpdates as any);
      }

      // Log the revert action
      await storage.createActivityLog({
        userId: entry.userId ?? undefined,
        clientId: entry.clientId ?? undefined,
        clientLocationId: entry.clientLocationId ?? undefined,
        action: "location_info_changed",
        payloadJson: {
          changes: changes.map(c => ({ field: c.field, old: c.new, new: c.old })),
          revertedFrom: id,
        },
      });

      console.log(`↩️ Reverted location info for ${location.name} (${entry.clientLocationId})`);
      res.json({ success: true, message: gbpResult.message, skippedFields: gbpResult.skippedFields ?? [] });
    } catch (error: any) {
      console.error("Error reverting location info:", error);
      res.status(500).json({ message: error.message || "Failed to revert location info" });
    }
  });

  // Bulk delete activity log entries
  app.delete("/api/activity-log/bulk", async (req, res) => {
    try {
      const { ids } = req.body;
      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ message: "ids array required" });
      }
      const count = await storage.bulkDeleteActivityLogs(ids);
      console.log(`🗑️ Bulk deleted ${count} activity log entries`);
      res.json({ success: true, deletedCount: count });
    } catch (error) {
      console.error('Bulk delete activity log error:', error);
      res.status(500).json({ message: "Failed to bulk delete activity log entries" });
    }
  });

  // Get ALL locations across all accounts (unified view)
  app.get("/api/locations/all", async (req, res) => {
    try {
      // Get user ID from session
      const userId = req.session.userId;
      if (!userId) {
        return res.status(401).json({ error: 'No user session found. Please log in again.' });
      }

      // Fetch ALL locations for this user across all their clients
      const locations = await storage.getAllLocations(userId);
      
      console.log(`📍 Successfully fetched ${locations.length} total locations across all accounts`);
      res.json(normalizeLocations(locations));
    } catch (error) {
      console.error('Error fetching all locations:', error);
      res.status(500).json({ error: 'Failed to fetch locations' });
    }
  });

  app.get("/api/clients/:id/locations", async (req, res) => {
    try {
      const { id } = req.params;
      
      // Fetch locations from database (includes child folder locations)
      const locations = await storage.getLocationsByClientId(id);
      
      console.log(`📍 Successfully fetched ${locations.length} locations for account: accounts/${id}`);
      res.json(normalizeLocations(locations));
    } catch (error) {
      console.error('Error fetching locations:', error);
      res.status(500).json({ error: 'Failed to fetch locations' });
    }
  });

  // Update location status manually
  app.patch("/api/locations/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const { status } = req.body;
      
      if (!status) {
        return res.status(400).json({ error: 'Status is required' });
      }
      
      const validStatuses = ['active', 'temporarily_closed', 'permanently_closed', 'unknown'];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({ error: 'Invalid status value' });
      }
      
      const updatedLocation = await storage.updateLocation(id, { status });
      console.log(`✏️ Updated location status: ${id} -> ${status}`);
      res.json(normalizeLocation(updatedLocation));
    } catch (error: any) {
      console.error('Error updating location status:', error);
      res.status(500).json({ error: 'Failed to update location status' });
    }
  });
  
  // Update location details and push to Google Business Profile
  const locationDetailsSchema = z.object({
    phone: z.string().optional(),
    website: z.string().optional(),
    description: z.string().optional(),
  }).refine(data => Object.values(data).some(v => v !== undefined), {
    message: "At least one field (phone, website, or description) must be provided"
  });

  app.patch("/api/locations/:id/details", async (req, res) => {
    try {
      const { id } = req.params;
      
      // Validate the request body
      const validatedData = locationDetailsSchema.parse(req.body);
      
      // Get location from database to find the GBP location ID
      const location = await storage.getLocation(id);
      if (!location) {
        return res.status(404).json({ error: 'Location not found' });
      }
      
      const { googleOAuthAuth } = await import("./google-service-auth");
      
      if (!googleOAuthAuth.isAuthenticated()) {
        return res.status(401).json({ error: 'Not authenticated. Please log in.' });
      }
      
      // Build the details object for the Google API call
      const details: { phone?: string; website?: string; description?: string } = {};
      if (validatedData.phone !== undefined) details.phone = validatedData.phone;
      if (validatedData.website !== undefined) details.website = validatedData.website;
      if (validatedData.description !== undefined) details.description = validatedData.description;
      
      // Push changes to Google Business Profile
      const gbpResult = await googleOAuthAuth.updateLocationDetails(location.gbpLocationId, details);
      
      // Update local database
      const localUpdates: Partial<InsertClientLocation> = {};
      if (validatedData.phone !== undefined) localUpdates.phone = validatedData.phone;
      if (validatedData.website !== undefined) localUpdates.website = validatedData.website;
      if (validatedData.description !== undefined) localUpdates.description = validatedData.description;
      
      const updatedLocation = await storage.updateLocation(id, localUpdates);
      
      // Log the activity
      await storage.createActivityLog({
        clientId: location.clientId,
        clientLocationId: id,
        action: "location_details_updated",
        payloadJson: { details, gbpResult },
        localUserId: getLocalUserId(req)
      });
      
      console.log(`✏️ Updated location details: ${id} - pushed to GBP`);
      res.json({ 
        success: true, 
        location: normalizeLocation(updatedLocation),
        gbpResult 
      });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors[0]?.message || 'Invalid request data' });
      }
      console.error('Error updating location details:', error);
      res.status(500).json({ error: error.message || 'Failed to update location details' });
    }
  });

  // Get hidden locations
  app.get("/api/locations/hidden", async (req, res) => {
    try {
      const userId = req.session.userId;
      if (!userId) {
        return res.status(401).json({ error: 'No user session found. Please log in again.' });
      }

      const locations = await storage.getHiddenLocations(userId);
      console.log(`🙈 Successfully fetched ${locations.length} hidden locations`);
      res.json(normalizeLocations(locations));
    } catch (error) {
      console.error('Error fetching hidden locations:', error);
      res.status(500).json({ error: 'Failed to fetch hidden locations' });
    }
  });

  // Bulk call counts (last N days) for the map view's NEARBY badges.
  // Reads from the cached `location_performance_data` table — no Google round
  // trips — so it scales to hundreds of pins without rate-limit issues.
  app.get("/api/locations/call-counts", async (req, res) => {
    try {
      const userId = req.session?.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });

      const daysParam = parseInt((req.query.days as string) || "30", 10);
      const days = Number.isFinite(daysParam) ? Math.max(1, Math.min(365, daysParam)) : 30;
      const compare = req.query.compare === "true";

      const endDate = new Date();
      endDate.setDate(endDate.getDate() - 1);
      const startDate = new Date(endDate);
      startDate.setDate(startDate.getDate() - (days - 1));
      const endStr = endDate.toISOString().slice(0, 10);
      const startStr = startDate.toISOString().slice(0, 10);

      const fetchCounts = async (from: string, to: string): Promise<Record<string, number>> => {
        const rows = await db
          .select({
            locationId: locationPerformanceData.locationId,
            callClicks: sql<number>`coalesce(sum(${locationPerformanceData.callClicks}), 0)`,
          })
          .from(locationPerformanceData)
          .innerJoin(clientLocations, eq(clientLocations.id, locationPerformanceData.locationId))
          .innerJoin(clients, eq(clients.id, clientLocations.clientId))
          .where(
            and(
              eq(clients.userId, userId),
              gte(locationPerformanceData.date, from),
              lte(locationPerformanceData.date, to),
            ),
          )
          .groupBy(locationPerformanceData.locationId);
        const result: Record<string, number> = {};
        for (const r of rows) result[r.locationId] = Number(r.callClicks) || 0;
        return result;
      };

      const counts = await fetchCounts(startStr, endStr);

      if (!compare) {
        return res.json({ counts, days });
      }

      // Previous equivalent period (immediately before the current window)
      const prevEndDate = new Date(startDate);
      prevEndDate.setDate(prevEndDate.getDate() - 1);
      const prevStartDate = new Date(prevEndDate);
      prevStartDate.setDate(prevStartDate.getDate() - (days - 1));
      const prevEndStr = prevEndDate.toISOString().slice(0, 10);
      const prevStartStr = prevStartDate.toISOString().slice(0, 10);

      const previous = await fetchCounts(prevStartStr, prevEndStr);

      res.json({ counts, previous, days });
    } catch (error) {
      console.error("Error fetching bulk call counts:", error);
      res.status(500).json({ error: "Failed to fetch call counts" });
    }
  });

  // Bulk hide locations (must be before /:id routes to avoid matching "bulk" as an id)
  app.post("/api/locations/bulk/hide", async (req, res) => {
    try {
      const { locationIds } = req.body;
      
      if (!Array.isArray(locationIds) || locationIds.length === 0) {
        return res.status(400).json({ error: 'locationIds array is required' });
      }

      await storage.bulkSetLocationsHidden(locationIds, true);
      console.log(`🙈 Bulk hidden ${locationIds.length} locations`);
      res.json({ success: true, count: locationIds.length });
    } catch (error) {
      console.error('Error bulk hiding locations:', error);
      res.status(500).json({ error: 'Failed to hide locations' });
    }
  });

  // Bulk unhide locations (must be before /:id routes to avoid matching "bulk" as an id)
  app.post("/api/locations/bulk/unhide", async (req, res) => {
    try {
      const { locationIds } = req.body;
      
      if (!Array.isArray(locationIds) || locationIds.length === 0) {
        return res.status(400).json({ error: 'locationIds array is required' });
      }

      await storage.bulkSetLocationsHidden(locationIds, false);
      console.log(`👁️ Bulk unhidden ${locationIds.length} locations`);
      res.json({ success: true, count: locationIds.length });
    } catch (error) {
      console.error('Error bulk unhiding locations:', error);
      res.status(500).json({ error: 'Failed to unhide locations' });
    }
  });

  // Bulk update social media URLs for locations
  const socialMediaSchema = z.object({
    twitter: z.string().optional(),
    facebook: z.string().optional(),
    instagram: z.string().optional(),
    youtube: z.string().optional(),
    linkedin: z.string().optional(),
    tiktok: z.string().optional(),
    pinterest: z.string().optional(),
  });

  app.post("/api/locations/bulk/social-media", async (req, res) => {
    try {
      const { locationIds, socialMedia } = req.body;
      
      if (!Array.isArray(locationIds) || locationIds.length === 0) {
        return res.status(400).json({ error: 'locationIds array is required' });
      }

      const validatedSocialMedia = socialMediaSchema.parse(socialMedia || {});
      
      // Import Google OAuth service for pushing to Google Business Profile
      const { googleOAuthAuth } = await import("./google-service-auth");
      const isAuthenticated = googleOAuthAuth.isAuthenticated();
      
      // Require authentication — saving locally without syncing to Google would silently
      // mislead the user into thinking their GBP listings were actually updated.
      if (!isAuthenticated) {
        return res.status(401).json({ 
          error: 'Not authenticated with Google. Please re-authenticate to sync social media links to your Google Business Profile listings.'
        });
      }

      console.log(`📱 Starting bulk social media update for ${locationIds.length} locations`);
      console.log(`📱 Google authenticated: ${isAuthenticated}`);
      
      // Update each location's social media (both local DB and Google)
      const results = await Promise.all(
        locationIds.map(async (id: string) => {
          const location = await storage.getLocation(id);
          if (!location) return { id, success: false, error: 'Not found', googleUpdated: false };
          
          // Merge with existing social media data
          const existingSocialMedia = (location.socialMedia as Record<string, string>) || {};
          const mergedSocialMedia = { ...existingSocialMedia };
          
          // Only update fields that are provided (not undefined)
          Object.entries(validatedSocialMedia).forEach(([key, value]) => {
            if (value !== undefined) {
              if (value === '') {
                delete mergedSocialMedia[key];
              } else {
                mergedSocialMedia[key] = value;
              }
            }
          });
          
          // Save to local database
          await storage.updateLocation(id, { socialMedia: mergedSocialMedia });
          
          // Also push to Google Business Profile if authenticated
          let googleUpdated = false;
          if (isAuthenticated && location.gbpLocationId) {
            try {
              // Build the location name for Google API (format: "locations/{locationId}")
              const locationName = location.gbpLocationId.startsWith('locations/') 
                ? location.gbpLocationId 
                : `locations/${location.gbpLocationId}`;

              // Full resource path needed by the pre-flight attributes endpoint
              const accountId = location.clientId.startsWith('accounts/')
                ? location.clientId
                : `accounts/${location.clientId}`;
              const fullLocationName = `${accountId}/${locationName}`;
                
              await googleOAuthAuth.updateSocialMediaUrls(locationName, validatedSocialMedia, fullLocationName);
              googleUpdated = true;
              console.log(`✅ Updated Google for location: ${location.name}`);
            } catch (googleError: any) {
              console.error(`⚠️ Failed to update Google for ${location.name}:`, googleError.message);
              // Continue even if Google update fails - local DB is already updated
            }
          }
          
          return { id, name: location?.name || id, success: true, googleUpdated };
        })
      );
      
      const successCount = results.filter(r => r.success).length;
      const googleUpdatedCount = results.filter(r => r.googleUpdated).length;
      console.log(`📱 Bulk updated social media for ${successCount}/${locationIds.length} locations (${googleUpdatedCount} synced to Google)`);
      
      // Log activity for the first location's client
      if (locationIds.length > 0) {
        const firstLocation = await storage.getLocation(locationIds[0]);
        if (firstLocation) {
          const socialStatus = googleUpdatedCount < locationIds.length ? "partial" : "success";
          await storage.createActivityLog({
            clientId: firstLocation.clientId,
            action: "bulk_social_media_updated",
            payloadJson: { 
              locationCount: successCount, 
              googleUpdatedCount,
              status: socialStatus,
              socialMedia: validatedSocialMedia,
              // Save location names so the detail view can show who was updated
              locations: results.filter(r => r.success).map(r => ({ id: r.id, name: r.name, googleUpdated: r.googleUpdated }))
            },
            localUserId: getLocalUserId(req)
          });
        }
      }
      
      res.json({ 
        success: true, 
        count: successCount, 
        googleUpdatedCount,
        results 
      });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors[0]?.message || 'Invalid social media data' });
      }
      console.error('Error bulk updating social media:', error);
      res.status(500).json({ error: 'Failed to update social media' });
    }
  });

  // Hide a single location
  app.post("/api/locations/:id/hide", async (req, res) => {
    try {
      const { id } = req.params;
      
      const location = await storage.getLocation(id);
      if (!location) {
        return res.status(404).json({ error: 'Location not found' });
      }

      const updatedLocation = await storage.setLocationHidden(id, true);
      console.log(`🙈 Hidden location: ${location.name}`);
      res.json({ success: true, location: normalizeLocation(updatedLocation) });
    } catch (error) {
      console.error('Error hiding location:', error);
      res.status(500).json({ error: 'Failed to hide location' });
    }
  });

  // Unhide a single location
  app.post("/api/locations/:id/unhide", async (req, res) => {
    try {
      const { id } = req.params;
      
      const location = await storage.getLocation(id);
      if (!location) {
        return res.status(404).json({ error: 'Location not found' });
      }

      const updatedLocation = await storage.setLocationHidden(id, false);
      console.log(`👁️ Unhidden location: ${location.name}`);
      res.json({ success: true, location: normalizeLocation(updatedLocation) });
    } catch (error) {
      console.error('Error unhiding location:', error);
      res.status(500).json({ error: 'Failed to unhide location' });
    }
  });

  // Legacy endpoint - keep for backward compatibility during transition
  app.get("/api/clients/:id/locations/from-google", async (req, res) => {
    try {
      const { id } = req.params;
      const { googleOAuthAuth } = await import("./google-service-auth");
      
      if (!googleOAuthAuth.isAuthenticated()) {
        return res.status(401).json({ error: 'Not authenticated. Please log in.' });
      }
      
      // Construct the account name for Google API
      const accountName = `accounts/${id}`;
      
      // Fetch locations from Google API using OAuth service
      const googleLocations = await googleOAuthAuth.getLocations(accountName);
      
      // Convert Google locations to our format and save them to database
      const locations = [];
      for (const location of googleLocations) {
        const locationId = location.name?.split('/').pop() || location.name;
        const locationData = {
          id: locationId,
          clientId: id,
          gbpLocationId: location.name, // Full GBP location name like accounts/xxx/locations/yyy
          name: location.title || 'Unnamed Location',
          address: location.storefrontAddress ? 
            `${location.storefrontAddress.addressLines?.join(', ') || ''}, ${location.storefrontAddress.locality || ''}, ${location.storefrontAddress.administrativeArea || ''}`.trim() : '',
          city: location.storefrontAddress?.locality || '',
          status: 'active',
          averageRating: location.averageRating ? location.averageRating.toString() : null
        };

        // Try to create or update the location in database
        try {
          const existingLocation = await storage.getLocation(locationId);
          if (existingLocation) {
            await storage.updateLocation(locationId, locationData);
          } else {
            await storage.createLocation(locationData);
          }
        } catch (dbError) {
          console.warn(`⚠️ Could not save location ${locationId} to database:`, dbError);
          // Continue anyway - we'll still return the location data
        }

        // Add additional fields for frontend display
        locations.push({
          ...locationData,
          googleLocationId: location.name, // Alias for backward compatibility
          zipCode: location.storefrontAddress?.postalCode || '',
          phone: location.phoneNumbers?.[0]?.number || '',
          website: location.websiteUri || '',
          categories: Array.isArray(location.categories) ? location.categories.map((c: any) => c.displayName).join(', ') : '',
          averageRating: location.averageRating || null,
          totalReviews: location.reviewCount || 0,
          isVerified: true,
          createdAt: new Date(),
          updatedAt: new Date()
        });
      }

      console.log(`📍 Successfully fetched ${locations.length} locations for account: ${accountName}`);
      res.json(locations);
    } catch (error: any) {
      console.error('❌ Error fetching Google Business locations:', error);
      res.status(500).json({ 
        message: "Failed to fetch Google Business locations", 
        error: error.message 
      });
    }
  });

  // Refresh location ratings from Google by fetching reviews for ALL clients
  app.post("/api/all-clients/locations/refresh-ratings", async (req, res) => {
    try {
      const userId = req.session.userId;
      if (!userId) {
        return res.status(401).json({ error: 'Not authenticated. Please log in.' });
      }
      
      const { googleOAuthAuth } = await import("./google-service-auth");
      
      if (!googleOAuthAuth.isAuthenticated()) {
        return res.status(401).json({ error: 'Not authenticated. Please log in.' });
      }
      
      // Get all clients for this user
      const userClients = await storage.getClientsByUserId(userId);
      let totalUpdated = 0;
      
      for (const client of userClients) {
        try {
          const accountName = `accounts/${client.id}`;
          const googleLocations = await googleOAuthAuth.getLocations(accountName);
          
          for (const location of googleLocations) {
            const locationId = location.name?.split('/').pop() || location.name;
            const gbpLocationId = location.name;
            
            try {
              const existingLocation = await storage.getLocation(locationId);
              if (!existingLocation) continue;
              
              // Fetch reviews for this location to calculate average rating
              const reviews = await googleOAuthAuth.getReviews(gbpLocationId);
              
              if (reviews && reviews.length > 0) {
                // Transform and calculate average
                const ratings = reviews.map((r: any) => {
                  if (typeof r.starRating === 'string') {
                    const map: any = { 'FIVE': 5, 'FOUR': 4, 'THREE': 3, 'TWO': 2, 'ONE': 1 };
                    return map[r.starRating.toUpperCase()] || 0;
                  }
                  return Number(r.starRating) || 0;
                });
                
                const totalRating = ratings.reduce((sum: number, r: number) => sum + r, 0);
                const averageRating = parseFloat((totalRating / ratings.length).toFixed(1));
                
                await storage.updateLocation(locationId, {
                  averageRating,
                  totalReviews: reviews.length
                });
                totalUpdated++;
              } else {
                // No reviews - set to null
                await storage.updateLocation(locationId, {
                  averageRating: null,
                  totalReviews: 0
                });
                totalUpdated++;
              }
            } catch (error) {
              console.warn(`⚠️ Could not update rating for location ${locationId}:`, error);
            }
          }
        } catch (error) {
          console.warn(`⚠️ Could not process client ${client.id}:`, error);
        }
      }
      
      console.log(`⭐ Successfully updated ${totalUpdated} location ratings across all clients`);
      res.json({ message: `Updated ${totalUpdated} location ratings`, updated: totalUpdated });
    } catch (error: any) {
      console.error('❌ Error refreshing all location ratings:', error);
      res.status(500).json({ 
        message: "Failed to refresh location ratings", 
        error: error.message 
      });
    }
  });

  // Refresh location ratings from Google by fetching reviews
  app.post("/api/clients/:id/locations/refresh-ratings", async (req, res) => {
    try {
      const { id } = req.params;
      const { googleOAuthAuth } = await import("./google-service-auth");
      
      if (!googleOAuthAuth.isAuthenticated()) {
        return res.status(401).json({ error: 'Not authenticated. Please log in.' });
      }
      
      const accountName = `accounts/${id}`;
      const googleLocations = await googleOAuthAuth.getLocations(accountName);
      
      let updated = 0;
      for (const location of googleLocations) {
        const locationId = location.name?.split('/').pop() || location.name;
        const gbpLocationId = location.name;
        
        try {
          const existingLocation = await storage.getLocation(locationId);
          if (!existingLocation) continue;
          
          // Fetch reviews for this location to calculate average rating
          const reviews = await googleOAuthAuth.getReviews(gbpLocationId);
          
          if (reviews && reviews.length > 0) {
            // Transform and calculate average
            const ratings = reviews.map((r: any) => {
              if (typeof r.starRating === 'string') {
                const map: any = { 'FIVE': 5, 'FOUR': 4, 'THREE': 3, 'TWO': 2, 'ONE': 1 };
                return map[r.starRating.toUpperCase()] || 0;
              }
              return Number(r.starRating) || 0;
            });
            
            const totalRating = ratings.reduce((sum: number, r: number) => sum + r, 0);
            const averageRating = parseFloat((totalRating / ratings.length).toFixed(1));
            
            await storage.updateLocation(locationId, {
              averageRating,
              totalReviews: reviews.length
            });
            updated++;
            console.log(`⭐ Updated rating for ${location.title}: ${averageRating} (${reviews.length} reviews)`);
          } else {
            // No reviews - set to null
            await storage.updateLocation(locationId, {
              averageRating: null,
              totalReviews: 0
            });
            updated++;
          }
        } catch (error) {
          console.warn(`⚠️ Could not update rating for location ${locationId}:`, error);
        }
      }
      
      console.log(`⭐ Successfully updated ${updated} location ratings for account: ${accountName}`);
      res.json({ message: `Updated ${updated} location ratings`, updated });
    } catch (error: any) {
      console.error('❌ Error refreshing location ratings:', error);
      res.status(500).json({ 
        message: "Failed to refresh location ratings", 
        error: error.message 
      });
    }
  });

  // Location Folders
  app.get("/api/folders", async (req, res) => {
    try {
      if (!req.session?.userId) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      
      const folders = await storage.getFoldersByUserId(req.session.userId);
      res.json(folders);
    } catch (error) {
      console.error("Error fetching folders:", error);
      res.status(500).json({ message: "Failed to fetch folders" });
    }
  });

  app.post("/api/folders", async (req, res) => {
    try {
      if (!req.session?.userId) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      
      const { name, description, color } = req.body;
      
      if (!name) {
        return res.status(400).json({ message: "Folder name is required" });
      }
      
      const folder = await storage.createFolder({
        userId: req.session.userId,
        name,
        description: description || null,
        color: color || null
      });
      
      res.json(folder);
    } catch (error) {
      console.error("Error creating folder:", error);
      res.status(500).json({ message: "Failed to create folder" });
    }
  });

  app.put("/api/folders/:id", async (req, res) => {
    try {
      if (!req.session?.userId) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      
      const { id } = req.params;
      const { name, description, color, targetPosts } = req.body;
      
      const folder = await storage.getFolder(id);
      if (!folder) {
        return res.status(404).json({ message: "Folder not found" });
      }
      
      if (folder.userId !== req.session.userId) {
        return res.status(403).json({ message: "Unauthorized" });
      }
      
      const updates: Partial<{ name: string; description: string | null; color: string | null; targetPosts: number | null }> = {};
      if (name !== undefined) updates.name = name;
      if (description !== undefined) updates.description = description === "" ? null : description;
      if (color !== undefined) updates.color = color === "" ? null : color;
      if (targetPosts !== undefined) updates.targetPosts = targetPosts;
      
      const updatedFolder = await storage.updateFolder(id, updates);
      
      res.json(updatedFolder);
    } catch (error) {
      console.error("Error updating folder:", error);
      res.status(500).json({ message: "Failed to update folder" });
    }
  });

  app.delete("/api/folders/:id", async (req, res) => {
    try {
      if (!req.session?.userId) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      
      const { id } = req.params;
      
      const folder = await storage.getFolder(id);
      if (!folder) {
        return res.status(404).json({ message: "Folder not found" });
      }
      
      if (folder.userId !== req.session.userId) {
        return res.status(403).json({ message: "Unauthorized" });
      }
      
      await storage.deleteFolder(id);
      res.json({ message: "Folder deleted successfully" });
    } catch (error) {
      console.error("Error deleting folder:", error);
      res.status(500).json({ message: "Failed to delete folder" });
    }
  });

  app.get("/api/folders/:id/locations", async (req, res) => {
    try {
      if (!req.session?.userId) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      
      const { id } = req.params;
      
      const folder = await storage.getFolder(id);
      if (!folder) {
        return res.status(404).json({ message: "Folder not found" });
      }
      
      if (folder.userId !== req.session.userId) {
        return res.status(403).json({ message: "Unauthorized" });
      }
      
      const locations = await storage.getLocationsByFolderId(id);
      res.json(locations);
    } catch (error) {
      console.error("Error fetching folder locations:", error);
      res.status(500).json({ message: "Failed to fetch folder locations" });
    }
  });

  app.post("/api/folders/:folderId/locations/:locationId", async (req, res) => {
    try {
      if (!req.session?.userId) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      
      const { folderId, locationId } = req.params;
      
      const folder = await storage.getFolder(folderId);
      if (!folder) {
        return res.status(404).json({ message: "Folder not found" });
      }
      
      if (folder.userId !== req.session.userId) {
        return res.status(403).json({ message: "Unauthorized - folder not owned by user" });
      }
      
      const location = await storage.getLocation(locationId);
      if (!location) {
        return res.status(404).json({ message: "Location not found" });
      }
      
      const client = await storage.getClient(location.clientId);
      if (!client || client.userId !== req.session.userId) {
        return res.status(403).json({ message: "Unauthorized - location not owned by user" });
      }
      
      const assignment = await storage.assignLocationToFolder(folderId, locationId);
      res.json(assignment);
    } catch (error) {
      console.error("Error assigning location to folder:", error);
      res.status(500).json({ message: "Failed to assign location to folder" });
    }
  });

  app.delete("/api/folders/:folderId/locations/:locationId", async (req, res) => {
    try {
      if (!req.session?.userId) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      
      const { folderId, locationId } = req.params;
      
      const folder = await storage.getFolder(folderId);
      if (!folder) {
        return res.status(404).json({ message: "Folder not found" });
      }
      
      if (folder.userId !== req.session.userId) {
        return res.status(403).json({ message: "Unauthorized - folder not owned by user" });
      }
      
      const location = await storage.getLocation(locationId);
      if (!location) {
        return res.status(404).json({ message: "Location not found" });
      }
      
      const client = await storage.getClient(location.clientId);
      if (!client || client.userId !== req.session.userId) {
        return res.status(403).json({ message: "Unauthorized - location not owned by user" });
      }
      
      await storage.unassignLocationFromFolder(folderId, locationId);
      res.json({ message: "Location removed from folder" });
    } catch (error) {
      console.error("Error removing location from folder:", error);
      res.status(500).json({ message: "Failed to remove location from folder" });
    }
  });

  // Location Tags
  app.get("/api/tags", async (req, res) => {
    try {
      if (!req.session?.userId) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      const tags = await storage.getTagsByUserId(req.session.userId);
      res.json(tags);
    } catch (error) {
      console.error("Error fetching tags:", error);
      res.status(500).json({ message: "Failed to fetch tags" });
    }
  });

  app.post("/api/tags", async (req, res) => {
    try {
      if (!req.session?.userId) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      
      const { name, color } = req.body;
      
      if (!name || typeof name !== "string" || name.trim() === "") {
        return res.status(400).json({ message: "Tag name is required" });
      }
      
      const tag = await storage.createTag({
        userId: req.session.userId,
        name: name.trim(),
        color: color || "#6366f1",
      });
      
      res.json(tag);
    } catch (error) {
      console.error("Error creating tag:", error);
      res.status(500).json({ message: "Failed to create tag" });
    }
  });

  app.put("/api/tags/:id", async (req, res) => {
    try {
      if (!req.session?.userId) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      
      const { id } = req.params;
      const { name, color } = req.body;
      
      const tag = await storage.getTag(id);
      if (!tag) {
        return res.status(404).json({ message: "Tag not found" });
      }
      
      if (tag.userId !== req.session.userId) {
        return res.status(403).json({ message: "Unauthorized" });
      }
      
      const updated = await storage.updateTag(id, { name, color });
      res.json(updated);
    } catch (error) {
      console.error("Error updating tag:", error);
      res.status(500).json({ message: "Failed to update tag" });
    }
  });

  app.delete("/api/tags/:id", async (req, res) => {
    try {
      if (!req.session?.userId) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      
      const { id } = req.params;
      const tag = await storage.getTag(id);
      if (!tag) {
        return res.status(404).json({ message: "Tag not found" });
      }
      
      if (tag.userId !== req.session.userId) {
        return res.status(403).json({ message: "Unauthorized" });
      }
      
      await storage.deleteTag(id);
      res.json({ message: "Tag deleted" });
    } catch (error) {
      console.error("Error deleting tag:", error);
      res.status(500).json({ message: "Failed to delete tag" });
    }
  });

  app.get("/api/tags/:id/locations", async (req, res) => {
    try {
      if (!req.session?.userId) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      
      const { id } = req.params;
      const tag = await storage.getTag(id);
      if (!tag) {
        return res.status(404).json({ message: "Tag not found" });
      }
      
      if (tag.userId !== req.session.userId) {
        return res.status(403).json({ message: "Unauthorized" });
      }
      
      const locations = await storage.getLocationsByTagId(id);
      res.json(locations);
    } catch (error) {
      console.error("Error fetching tag locations:", error);
      res.status(500).json({ message: "Failed to fetch tag locations" });
    }
  });

  app.get("/api/locations/:id/tags", async (req, res) => {
    try {
      if (!req.session?.userId) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      
      const { id } = req.params;
      const location = await storage.getLocation(id);
      if (!location) {
        return res.status(404).json({ message: "Location not found" });
      }
      
      const client = await storage.getClient(location.clientId);
      if (!client || client.userId !== req.session.userId) {
        return res.status(403).json({ message: "Unauthorized" });
      }
      
      const tags = await storage.getTagsByLocationId(id);
      res.json(tags);
    } catch (error) {
      console.error("Error fetching location tags:", error);
      res.status(500).json({ message: "Failed to fetch location tags" });
    }
  });

  app.post("/api/tags/:tagId/locations/:locationId", async (req, res) => {
    try {
      if (!req.session?.userId) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      
      const { tagId, locationId } = req.params;
      
      const tag = await storage.getTag(tagId);
      if (!tag) {
        return res.status(404).json({ message: "Tag not found" });
      }
      
      if (tag.userId !== req.session.userId) {
        return res.status(403).json({ message: "Unauthorized - tag not owned by user" });
      }
      
      const location = await storage.getLocation(locationId);
      if (!location) {
        return res.status(404).json({ message: "Location not found" });
      }
      
      const client = await storage.getClient(location.clientId);
      if (!client || client.userId !== req.session.userId) {
        return res.status(403).json({ message: "Unauthorized - location not owned by user" });
      }
      
      const assignment = await storage.assignTagToLocation(tagId, locationId);
      res.json(assignment);
    } catch (error) {
      console.error("Error assigning tag to location:", error);
      res.status(500).json({ message: "Failed to assign tag to location" });
    }
  });

  app.delete("/api/tags/:tagId/locations/:locationId", async (req, res) => {
    try {
      if (!req.session?.userId) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      
      const { tagId, locationId } = req.params;
      
      const tag = await storage.getTag(tagId);
      if (!tag) {
        return res.status(404).json({ message: "Tag not found" });
      }
      
      if (tag.userId !== req.session.userId) {
        return res.status(403).json({ message: "Unauthorized - tag not owned by user" });
      }
      
      const location = await storage.getLocation(locationId);
      if (!location) {
        return res.status(404).json({ message: "Location not found" });
      }
      
      const client = await storage.getClient(location.clientId);
      if (!client || client.userId !== req.session.userId) {
        return res.status(403).json({ message: "Unauthorized - location not owned by user" });
      }
      
      await storage.unassignTagFromLocation(tagId, locationId);
      res.json({ message: "Tag removed from location" });
    } catch (error) {
      console.error("Error removing tag from location:", error);
      res.status(500).json({ message: "Failed to remove tag from location" });
    }
  });

  // Location metrics endpoint
  app.get("/api/locations/:id/metrics", async (req, res) => {
    try {
      if (!req.session?.userId) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      
      const { id } = req.params;
      console.log(`📊 Querying metrics for location ID: ${id}`);
      
      const location = await storage.getLocation(id);
      
      if (!location) {
        console.log(`❌ Location not found: ${id}`);
        return res.status(404).json({ message: "Location not found" });
      }
      
      const client = await storage.getClient(location.clientId);
      if (!client || client.userId !== req.session.userId) {
        return res.status(403).json({ message: "Unauthorized" });
      }
      
      // Count posts this month
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      
      const rows = await db.select().from(posts).where(
        eq(posts.clientLocationId, id)
      );
      
      console.log(`📊 Found ${rows.length} total posts for location ${id}`);
      
      const postsThisMonth = rows.filter(p => 
        new Date(p.createdAt) >= monthStart && !p.deletedAt
      ).length;
      
      console.log(`📊 Posts this month (${monthStart.toDateString()}): ${postsThisMonth}`);
      
      const avgRating = location.averageRating ? parseFloat(location.averageRating as any) : 0;
      
      res.json({
        posts: postsThisMonth,
        targetPosts: location.targetPosts || 0,
        avgRating: parseFloat(avgRating.toFixed(1))
      });
    } catch (error) {
      console.error("Error fetching location metrics:", error);
      res.status(500).json({ message: "Failed to fetch location metrics" });
    }
  });

  // GBP Performance API metrics for a location (live data from Google)
  app.get("/api/locations/:id/performance", async (req, res) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.removeHeader("ETag");
    try {
      if (!req.session?.userId) {
        return res.status(401).json({ message: "Not authenticated" });
      }

      const { googleOAuthAuth } = await import("./google-service-auth");
      const { id } = req.params;

      const daysParam = parseInt((req.query.days as string) || '30', 10);
      if (isNaN(daysParam) || daysParam < 7 || daysParam > 1825) {
        return res.status(400).json({ message: "days must be between 7 and 1825" });
      }

      // offset=0 → current period; offset=1 → one period back; offset=4 → ~1yr back for 90d window
      const offsetParam = parseInt((req.query.offset as string) || '0', 10);
      if (isNaN(offsetParam) || offsetParam < 0 || offsetParam > 20) {
        return res.status(400).json({ message: "offset must be between 0 and 20" });
      }

      const location = await storage.getLocation(id);
      if (!location) return res.status(404).json({ message: "Location not found" });

      const client = await storage.getClient(location.clientId);
      if (!client || client.userId !== req.session.userId) {
        return res.status(403).json({ message: "Unauthorized" });
      }

      if (!location.gbpLocationId) {
        return res.status(400).json({ message: "Location has no GBP location ID" });
      }

      // Convert stored gbpLocationId to the Performance API format: "locations/{id}"
      const gbpId = location.gbpLocationId;
      let fullLocationName: string;
      if (gbpId.startsWith('accounts/')) {
        const locIdx = gbpId.indexOf('/locations/');
        fullLocationName = locIdx !== -1 ? gbpId.slice(locIdx + 1) : `locations/${gbpId.split('/').pop()}`;
      } else if (gbpId.startsWith('locations/')) {
        fullLocationName = gbpId;
      } else {
        fullLocationName = `locations/${gbpId}`;
      }

      // Requested date range — shift back by offsetParam periods for comparison queries
      const endDate = new Date();
      endDate.setDate(endDate.getDate() - 1 - (offsetParam * daysParam)); // yesterday, shifted back
      const startDate = new Date(endDate);
      startDate.setDate(startDate.getDate() - (daysParam - 1));
      const endDateStr = endDate.toISOString().slice(0, 10);
      const startDateStr = startDate.toISOString().slice(0, 10);

      // Only fetch fresh data from Google for the current period (offset=0)
      // Comparison periods use DB data only
      const googleEnd = new Date();
      googleEnd.setDate(googleEnd.getDate() - 1);
      const googleStart = new Date(googleEnd);
      googleStart.setDate(googleStart.getDate() - 89);

      let googleFetchError: string | null = null;
      if (offsetParam === 0) try {
        const freshMetrics = await googleOAuthAuth.getLocationPerformanceMetrics(fullLocationName, googleStart, googleEnd);
        const records = freshMetrics.daily.map((d: any) => ({
          locationId: id,
          date: d.date,
          callClicks: d.callClicks,
          websiteClicks: d.websiteClicks,
          directionRequests: d.directionRequests,
          impressions: d.impressions,
        }));
        await storage.upsertLocationPerformanceBatch(records);
      } catch (googleError: any) {
        const msg: string = googleError?.message || '';
        console.warn(`⚠️ Google perf fetch failed for ${id}:`, msg.slice(0, 120));
        if (msg.includes('<!DOCTYPE html>') || msg.includes('Error 404') || googleError?.status === 404) {
          googleFetchError = 'api_not_enabled';
        } else if (msg.includes('timed out')) {
          googleFetchError = 'timeout';
        } else {
          googleFetchError = 'unknown';
        }
      }

      // Query DB for the full requested range (includes historical beyond 90 days)
      const [dbData, earliestDate] = await Promise.all([
        storage.getLocationPerformanceRange(id, startDateStr, endDateStr),
        storage.getLocationPerformanceEarliestDate(id),
      ]);

      // If we have no data at all, surface the Google error
      if (dbData.length === 0 && googleFetchError) {
        if (googleFetchError === 'api_not_enabled') {
          return res.status(503).json({ message: "The Business Profile Performance API is not enabled for this Google Cloud project. Please enable it at console.cloud.google.com → APIs & Services → Library → search 'Business Profile Performance API'." });
        }
        if (googleFetchError === 'timeout') {
          return res.status(504).json({ message: "Request to Google timed out. Please try again." });
        }
        return res.status(500).json({ message: "Failed to fetch performance data from Google." });
      }

      // Build date-indexed daily map pre-populated with zeros
      const dailyMap: Record<string, { date: string; impressions: number; callClicks: number; websiteClicks: number; directionRequests: number }> = {};
      const cursor = new Date(startDate);
      while (cursor <= endDate) {
        const key = cursor.toISOString().slice(0, 10);
        dailyMap[key] = { date: key, impressions: 0, callClicks: 0, websiteClicks: 0, directionRequests: 0 };
        cursor.setDate(cursor.getDate() + 1);
      }
      for (const row of dbData) {
        dailyMap[row.date] = { date: row.date, impressions: row.impressions, callClicks: row.callClicks, websiteClicks: row.websiteClicks, directionRequests: row.directionRequests };
      }

      const daily = Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date));
      const totals = daily.reduce((acc, d) => ({
        callClicks: acc.callClicks + d.callClicks,
        websiteClicks: acc.websiteClicks + d.websiteClicks,
        directionRequests: acc.directionRequests + d.directionRequests,
        impressionsTotal: acc.impressionsTotal + d.impressions,
      }), { callClicks: 0, websiteClicks: 0, directionRequests: 0, impressionsTotal: 0 });

      res.json({ ...totals, daily, earliestDate });
    } catch (error: any) {
      console.error("Error fetching GBP performance metrics:", error);
      const message = error?.message || "Failed to fetch performance metrics";
      res.status(500).json({ message });
    }
  });

  // GBP Performance aggregate metrics for an entire client (sum across all locations)
  app.get("/api/clients/:clientId/performance", async (req, res) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.removeHeader("ETag");
    try {
      if (!req.session?.userId) {
        return res.status(401).json({ message: "Not authenticated" });
      }

      const { clientId } = req.params;
      const daysParam = parseInt((req.query.days as string) || "30", 10);
      if (isNaN(daysParam) || daysParam < 7 || daysParam > 1825) {
        return res.status(400).json({ message: "days must be between 7 and 1825" });
      }

      const today = new Date();
      const endDate = new Date(today);
      endDate.setDate(endDate.getDate() - 1); // yesterday (most recent complete day)
      const startDate = new Date(endDate);
      startDate.setDate(startDate.getDate() - (daysParam - 1));
      const prevEnd = new Date(startDate);
      prevEnd.setDate(prevEnd.getDate() - 1);
      const prevStart = new Date(prevEnd);
      prevStart.setDate(prevStart.getDate() - (daysParam - 1));

      const fmt = (d: Date) => d.toISOString().slice(0, 10);

      const [currentDaily, previousDaily, locations] = await Promise.all([
        storage.getClientPerformanceDaily(clientId, fmt(startDate), fmt(endDate)),
        storage.getClientPerformanceDaily(clientId, fmt(prevStart), fmt(prevEnd)),
        storage.getLocationsByClientId(clientId),
      ]);

      // Build daily map pre-populated with zeros so the sparkline is continuous
      const dailyMap: Record<string, { date: string; callClicks: number; websiteClicks: number; directionRequests: number; impressions: number }> = {};
      const cursor = new Date(startDate);
      while (cursor <= endDate) {
        const key = fmt(cursor);
        dailyMap[key] = { date: key, callClicks: 0, websiteClicks: 0, directionRequests: 0, impressions: 0 };
        cursor.setDate(cursor.getDate() + 1);
      }
      for (const r of currentDaily) dailyMap[r.date] = r;
      const daily = Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date));

      const sumTotals = (rows: Array<{ callClicks: number; websiteClicks: number; directionRequests: number; impressions: number }>) =>
        rows.reduce(
          (acc, d) => ({
            callClicks: acc.callClicks + d.callClicks,
            websiteClicks: acc.websiteClicks + d.websiteClicks,
            directionRequests: acc.directionRequests + d.directionRequests,
            impressions: acc.impressions + d.impressions,
          }),
          { callClicks: 0, websiteClicks: 0, directionRequests: 0, impressions: 0 },
        );

      const totals = sumTotals(currentDaily);
      const previous = sumTotals(previousDaily);

      // Average rating across locations that have one
      const rated = locations.filter((l: any) => l.averageRating != null);
      const ratingSum = rated.reduce((acc: number, l: any) => acc + parseFloat(l.averageRating as any), 0);
      const avgRating = rated.length > 0 ? parseFloat((ratingSum / rated.length).toFixed(1)) : null;

      res.json({
        totals,
        previous,
        avgRating,
        ratedLocationCount: rated.length,
        locationCount: locations.length,
        daily,
        startDate: fmt(startDate),
        endDate: fmt(endDate),
      });
    } catch (error: any) {
      console.error("Error fetching client performance metrics:", error);
      res.status(500).json({ message: error?.message || "Failed to fetch performance metrics" });
    }
  });

  // Update location target posts
  const targetPostsSchema = z.object({
    targetPosts: z.number().int().min(0).max(1000)
  });

  app.patch("/api/locations/:id/target-posts", async (req, res) => {
    try {
      if (!req.session?.userId) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      
      const { id } = req.params;
      
      const validation = targetPostsSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ message: "Invalid target posts value. Must be a number between 0 and 1000." });
      }
      
      const { targetPosts } = validation.data;
      
      const location = await storage.getLocation(id);
      if (!location) {
        return res.status(404).json({ message: "Location not found" });
      }
      
      const client = await storage.getClient(location.clientId);
      if (!client || client.userId !== req.session.userId) {
        return res.status(403).json({ message: "Unauthorized" });
      }
      
      await db.update(clientLocations).set({ targetPosts }).where(eq(clientLocations.id, id));
      
      res.json({ success: true, targetPosts });
    } catch (error) {
      console.error("Error updating location target posts:", error);
      res.status(500).json({ message: "Failed to update target posts" });
    }
  });

  // Update folder target posts
  app.patch("/api/folders/:id/target-posts", async (req, res) => {
    try {
      if (!req.session?.userId) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      
      const { id } = req.params;
      
      const validation = targetPostsSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ message: "Invalid target posts value. Must be a number between 0 and 1000." });
      }
      
      const { targetPosts } = validation.data;
      
      const folder = await storage.getFolder(id);
      if (!folder) {
        return res.status(404).json({ message: "Folder not found" });
      }
      
      if (folder.userId !== req.session.userId) {
        return res.status(403).json({ message: "Unauthorized" });
      }
      
      await db.update(locationFolders).set({ targetPosts }).where(eq(locationFolders.id, id));
      
      res.json({ success: true, targetPosts });
    } catch (error) {
      console.error("Error updating folder target posts:", error);
      res.status(500).json({ message: "Failed to update target posts" });
    }
  });

  // Folder metrics endpoint
  app.get("/api/folders/:id/metrics", async (req, res) => {
    try {
      if (!req.session?.userId) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      
      const { id } = req.params;
      const folder = await storage.getFolder(id);
      
      if (!folder) {
        return res.status(404).json({ message: "Folder not found" });
      }
      
      if (folder.userId !== req.session.userId) {
        return res.status(403).json({ message: "Unauthorized" });
      }
      
      // Get all locations in folder
      const folderLocations = await storage.getLocationsByFolderId(id);
      
      if (folderLocations.length === 0) {
        return res.json({ posts: 0, targetPosts: folder.targetPosts || 0, avgRating: 0 });
      }
      
      // Count posts this month across all locations in folder
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      
      let totalPosts = 0;
      let totalRating = 0;
      let ratingCount = 0;
      
      for (const location of folderLocations) {
        const rows = await db.select().from(posts).where(
          eq(posts.clientLocationId, location.id)
        );
        
        const postsThisMonth = rows.filter(p => 
          new Date(p.createdAt) >= monthStart && !p.deletedAt
        ).length;
        
        totalPosts += postsThisMonth;
        
        if (location.averageRating) {
          totalRating += parseFloat(location.averageRating as any);
          ratingCount++;
        }
      }
      
      const avgRating = ratingCount > 0 ? (totalRating / ratingCount) : 0;
      
      res.json({
        posts: totalPosts,
        targetPosts: folder.targetPosts || 0,
        avgRating: parseFloat(avgRating.toFixed(1))
      });
    } catch (error) {
      console.error("Error fetching folder metrics:", error);
      res.status(500).json({ message: "Failed to fetch folder metrics" });
    }
  });

  // Client Settings
  app.get("/api/clients/:id/settings", async (req, res) => {
    try {
      const { id } = req.params;
      let settings = await storage.getClientSettings(id);
      
      if (!settings) {
        // Create default settings
        settings = await storage.upsertClientSettings({
          clientId: id,
          timezone: "America/Phoenix",
          enableScheduledPosts: false,
          postsCron: "0 9 1,15 * *",
          enableScheduledHours: false,
          hoursCron: "0 9 1 */2 *"
        });
      }
      
      res.json(settings);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch settings" });
    }
  });

  app.put("/api/clients/:id/settings", async (req, res) => {
    try {
      const { id } = req.params;
      const settingsData = insertClientSettingsSchema.parse({
        ...req.body,
        clientId: id
      });

      const settings = await storage.upsertClientSettings(settingsData);
      
      // Update scheduler
      await scheduler.setupClientSchedule(id);
      
      res.json(settings);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid settings data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to update settings" });
    }
  });

  // Jobs - No authentication required since service account handles it
  app.get("/api/jobs", async (req, res) => {
    try {
      const { client_id } = req.query;
      if (!client_id || typeof client_id !== "string") {
        return res.status(400).json({ message: "client_id required" });
      }
      
      const jobs = await storage.getJobsByClientId(client_id);
      res.json(jobs);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch jobs" });
    }
  });

  app.get("/api/jobs/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const job = await storage.getJob(id);
      
      if (!job) {
        return res.status(404).json({ message: "Job not found" });
      }
      
      const items = await storage.getJobItems(id);
      res.json({ ...job, items });
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch job" });
    }
  });

  // Hours CSV Upload
  app.post("/api/jobs/hours", async (req, res) => {
    try {
      const jobData = insertJobSchema.parse({
        ...req.body,
        type: "hours"
      });

      const job = await storage.createJob(jobData);
      
      await storage.createActivityLog({
        clientId: jobData.clientId,
        action: "hours_csv_uploaded",
        payloadJson: { jobId: job.id },
        localUserId: getLocalUserId(req)
      });

      res.status(201).json(job);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid job data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to create hours job" });
    }
  });

  // Posts CSV Upload
  app.post("/api/jobs/posts", async (req, res) => {
    try {
      const jobData = insertJobSchema.parse({
        ...req.body,
        type: "posts"
      });

      const job = await storage.createJob(jobData);
      
      await storage.createActivityLog({
        clientId: jobData.clientId,
        action: "posts_csv_uploaded",
        payloadJson: { jobId: job.id },
        localUserId: getLocalUserId(req)
      });

      res.status(201).json(job);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid job data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to create posts job" });
    }
  });

  // Photos CSV Upload (NEW)
  app.post("/api/jobs/photos", async (req, res) => {
    try {
      const jobData = insertJobSchema.parse({
        ...req.body,
        type: "photo"
      });

      const job = await storage.createJob(jobData);
      
      await storage.createActivityLog({
        clientId: jobData.clientId,
        action: "photos_csv_uploaded",
        payloadJson: { jobId: job.id },
        localUserId: getLocalUserId(req)
      });

      res.status(201).json(job);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid job data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to create photos job" });
    }
  });

  // IN-APP CONTENT CREATION ENDPOINTS (NEW)
  
  // In-app post creation with Google API integration
  app.post("/api/jobs/create-post", async (req, res) => {
    try {
      const { clientId, locationIds, postData, imageUrl, isDryRun, isScheduled, scheduledDate, scheduledTime, timezoneOffset } = req.body;
      
      console.log('🎬 SERVER RECEIVED postData:', JSON.stringify(postData, null, 2));
      console.log('🎬 SERVER RECEIVED imageUrl:', imageUrl);
      console.log('🎬 SERVER RECEIVED schedule:', { isScheduled, scheduledDate, scheduledTime, timezoneOffset });
      
      // Validate required fields
      if (!clientId || !locationIds || !postData?.summary) {
        return res.status(400).json({ message: "Missing required fields: clientId, locationIds, postData.summary" });
      }

      if (!postData?.callToAction?.actionType || !postData?.callToAction?.url) {
        return res.status(400).json({ message: "Missing required callToAction fields: actionType and url" });
      }

      // Build the GBP post payload
      const gbpPostPayload: any = {
        summary: postData.summary,
        callToAction: {
          actionType: postData.callToAction.actionType,
          url: postData.callToAction.url,
        },
        topicType: postData.topicType || "STANDARD",
      };

      // Add image URL if provided
      if (imageUrl) {
        gbpPostPayload.media = [{
          mediaFormat: "PHOTO",
          sourceUrl: imageUrl
        }];
        console.log(`✅ Image URL added to payload: ${imageUrl}`);
      }

      // Get locations from database instead of Google API to avoid the wildcard issue
      const dbLocations = await storage.getLocationsByClientId(clientId);
      
      // Create a map of location ID to location info
      const locationMap = new Map();
      dbLocations.forEach((location) => {
        locationMap.set(location.id, {
          gbpLocationName: location.gbpLocationId,
          title: location.name || 'Unnamed Location'
        });
      });

      // Fix isDryRun parsing to handle string values correctly
      const parsedIsDryRun = typeof isDryRun === 'string' ? isDryRun === 'true' : !!isDryRun;

      // Create job data
      const jobData: any = {
        clientId,
        type: "posts" as const,
        isDryRun: parsedIsDryRun,
        isScheduled: !!isScheduled,
        totalItems: locationIds.length,
        status: isScheduled ? "scheduled" : "pending" as const,
        successCount: 0,
        errorCount: 0,
        payload: {
          postData: gbpPostPayload
        }
      };
      
      if (isScheduled && scheduledDate && scheduledTime) {
        // Convert local time to UTC for proper scheduler comparison
        // timezoneOffset is in minutes (e.g., -420 for UTC-7)
        const [hours, minutes] = scheduledTime.split(':').map(Number);
        const localDateTime = new Date(scheduledDate);
        localDateTime.setHours(hours, minutes, 0, 0);
        
        // Convert to UTC by adding the timezone offset (offset is negative for west of UTC)
        const offsetMinutes = timezoneOffset || 0;
        const utcDateTime = new Date(localDateTime.getTime() + offsetMinutes * 60 * 1000);
        
        // Store the UTC date and time
        jobData.scheduledDate = utcDateTime;
        jobData.scheduledTime = `${String(utcDateTime.getUTCHours()).padStart(2, '0')}:${String(utcDateTime.getUTCMinutes()).padStart(2, '0')}`;
        
        console.log(`📅 Scheduled for local: ${scheduledDate} ${scheduledTime} (offset: ${offsetMinutes}min)`);
        console.log(`📅 Converted to UTC: ${utcDateTime.toISOString()} time: ${jobData.scheduledTime}`);
      }

      const job = await storage.createJob(jobData);
      
      // Create individual job items for each location with GBP location name
      for (const locationId of locationIds) {
        const locationInfo = locationMap.get(locationId);
        
        if (!locationInfo) {
          console.warn(`⚠️ Location ${locationId} not found in Google API response`);
          continue;
        }

        await storage.createJobItem({
          jobId: job.id,
          clientLocationId: locationId,
          status: "pending",
          payload: {
            postData: gbpPostPayload,
            gbpLocationName: locationInfo.gbpLocationName,
            locationTitle: locationInfo.title
          }
        });
      }
      
      const postLocationDetails = locationIds
        .map((locId: string) => {
          const info = locationMap.get(locId);
          return info ? { id: locId, name: info.title } : null;
        })
        .filter(Boolean);

      await storage.createActivityLog({
        clientId,
        action: "post_created_in_app",
        payloadJson: {
          jobId: job.id,
          summary: postData.summary,
          callToAction: postData.callToAction || null,
          imageUrl: imageUrl || null,
          locationCount: locationIds.length,
          locations: postLocationDetails,
        },
        localUserId: getLocalUserId(req)
      });

      // Start processing the job immediately if not scheduled
      if (!isScheduled) {
        processJob(job.id).catch(error => {
          console.error(`Failed to process job ${job.id}:`, error);
        });
      } else {
        console.log(`📅 Post scheduled for ${scheduledDate} at ${scheduledTime || "09:00"}`);
      }

      res.status(201).json(job);
    } catch (error) {
      console.error('Create post error:', error);
      res.status(500).json({ message: "Failed to create post job" });
    }
  });

  // Get posts for a client
  app.get("/api/clients/:clientId/posts", async (req, res) => {
    try {
      const { clientId } = req.params;
      const basePosts = await storage.getPostsByClientId(clientId);
      
      // Enrich posts with CTA and media from job items
      const enrichedPosts = await Promise.all(basePosts.map(async (post) => {
        try {
          const [jobItem] = await db.select().from(jobItems).where(eq(jobItems.id, post.jobItemId));
          const postData = (jobItem?.payload as any)?.postData || {};
          
          return {
            ...post,
            callToAction: postData.callToAction || null,
            media: postData.media || null,
            topicType: postData.topicType || null
          };
        } catch (error) {
          console.error(`Failed to enrich post ${post.id}:`, error);
          return post;
        }
      }));
      
      res.json(enrichedPosts);
    } catch (error) {
      console.error('Get posts error:', error);
      res.status(500).json({ message: "Failed to fetch posts" });
    }
  });

  // Delete a post
  app.delete("/api/posts/:postId", async (req, res) => {
    try {
      const { postId } = req.params;
      console.log(`🗑️ DELETE /api/posts/${postId} - Starting delete process`);
      
      // Get the post record to retrieve the GBP post name
      const [post] = await db.select().from(posts).where(eq(posts.id, postId));
      
      if (!post) {
        console.log(`❌ Post ${postId} not found in database`);
        return res.status(404).json({ message: "Post not found" });
      }

      console.log(`📋 Found post: ${post.id}, status: ${post.status}, gbpPostName: ${post.gbpPostName}`);

      // Check if already deleted
      if (post.status === "deleted") {
        console.log(`❌ Post ${postId} already deleted`);
        return res.status(400).json({ message: "Post already deleted" });
      }

      // Get the location to find its clientId
      const [location] = await db.select().from(clientLocations).where(eq(clientLocations.id, post.clientLocationId));
      
      if (!location) {
        return res.status(404).json({ message: "Location not found" });
      }

      // Get Google OAuth service
      const { googleOAuthAuth } = await import("./google-service-auth");
      
      if (!googleOAuthAuth.isAuthenticated()) {
        return res.status(401).json({ error: 'Not authenticated. Please log in first.' });
      }

      // Delete from Google Business Profile
      console.log(`🌐 Calling Google API to delete post: ${post.gbpPostName}`);
      
      await googleOAuthAuth.deletePost(post.gbpPostName);
      console.log(`✅ Google API delete successful`);
      
      // Mark as deleted in our database (with user who deleted it)
      const localUserId = getLocalUserId(req);
      await storage.deletePost(postId, localUserId || undefined);
      console.log(`✅ Database updated - post marked as deleted by ${localUserId || 'unknown user'}`);
      
      // Log the deletion with correct clientId
      await storage.createActivityLog({
        clientId: location.clientId,
        clientLocationId: post.clientLocationId,
        action: "post_deleted",
        payloadJson: { postId, summary: post.summary?.substring(0, 50) },
        localUserId: getLocalUserId(req)
      });

      console.log(`✅ Delete complete for post ${postId}`);
      res.json({ success: true, message: "Post deleted successfully" });
    } catch (error: any) {
      console.error('❌ Delete post error:', error);
      res.status(500).json({ message: error.message || "Failed to delete post" });
    }
  });

  // In-app hours editing
  app.post("/api/jobs/create-hours", async (req, res) => {
    try {
      const { clientId, locationIds, scheduleData, isDryRun } = req.body;
      
      // Validate required fields
      if (!clientId || !locationIds || !scheduleData) {
        return res.status(400).json({ message: "Missing required fields: clientId, locationIds, scheduleData" });
      }

      // Get Google OAuth service to fetch location data
      const { googleOAuthAuth } = await import("./google-service-auth");
      
      if (!googleOAuthAuth.isAuthenticated()) {
        return res.status(401).json({ error: 'Not authenticated. Please log in first.' });
      }

      // First, look up locations in our database to find their actual clientIds
      // This handles the case where locations come from different Google accounts
      const dbLocations = await db.select({
        id: clientLocations.id,
        clientId: clientLocations.clientId,
        name: clientLocations.name,
        address: clientLocations.address,
        gbpLocationId: clientLocations.gbpLocationId
      }).from(clientLocations).where(inArray(clientLocations.id, locationIds));
      
      // Group locations by their actual clientId (Google account)
      const locationsByClient = new Map<string, string[]>();
      const dbLocationMap = new Map<string, { name: string; address: string | null; clientId: string; gbpLocationId: string | null }>();
      
      for (const loc of dbLocations) {
        dbLocationMap.set(loc.id, { name: loc.name, address: loc.address, clientId: loc.clientId, gbpLocationId: loc.gbpLocationId });
        if (!locationsByClient.has(loc.clientId)) {
          locationsByClient.set(loc.clientId, []);
        }
        locationsByClient.get(loc.clientId)!.push(loc.id);
      }
      
      // Create a map of location ID to Google location name and address
      const locationMap = new Map();
      
      // Fetch locations from each Google account separately
      for (const [accountClientId, accountLocationIds] of Array.from(locationsByClient.entries())) {
        const accountName = `accounts/${accountClientId}`;
        console.log(`🔍 Fetching Google locations for account: ${accountName}`);
        const googleLocations = await googleOAuthAuth.getLocations(accountName);
        
        googleLocations.forEach((location: any) => {
          const locationId = location.name?.split('/').pop() || location.name;
          // Only add if this location is in our request
          if (accountLocationIds.includes(locationId)) {
            let address = '';
            if (location.address?.addressLines?.[0]) {
              address = location.address.addressLines.join(', ');
            } else if (location.address?.shortFormattedAddress) {
              address = location.address.shortFormattedAddress;
            }
            // Use location.name directly from Google API - it's already the full correct path
            locationMap.set(locationId, {
              gbpLocationName: location.name,
              title: location.title || 'Unnamed Location',
              address: address
            });
          }
        });
      }
      
      // Fallback: for any locations not found in Google API, use database info
      for (const locationId of locationIds) {
        if (!locationMap.has(locationId) && dbLocationMap.has(locationId)) {
          const dbInfo = dbLocationMap.get(locationId)!;
          console.log(`⚠️ Using database fallback for location: ${locationId}`);
          // Use the gbpLocationId from database (format: "locations/{id}"), or construct it properly
          const gbpLocationName = dbInfo.gbpLocationId || `locations/${locationId}`;
          locationMap.set(locationId, {
            gbpLocationName: gbpLocationName,
            title: dbInfo.name,
            address: dbInfo.address || ''
          });
        }
      }

      // Fix isDryRun parsing to handle string values correctly
      const parsedIsDryRun = typeof isDryRun === 'string' ? isDryRun === 'true' : !!isDryRun;

      const jobData = {
        clientId,
        type: "hours" as const,
        isDryRun: parsedIsDryRun,
        totalItems: locationIds.length,
        status: "pending" as const,
        successCount: 0,
        errorCount: 0,
        payload: {
          hoursData: scheduleData
        }
      };

      const job = await storage.createJob(jobData);
      
      // Create individual job items for each location with GBP location name
      for (const locationId of locationIds) {
        const locationInfo = locationMap.get(locationId);
        if (!locationInfo) {
          throw new Error(`Location not found: ${locationId}`);
        }
        
        await storage.createJobItem({
          jobId: job.id,
          clientLocationId: locationId,
          payload: {
            hoursData: scheduleData,
            gbpLocationName: locationInfo.gbpLocationName,
            locationTitle: locationInfo.title,
            locationAddress: locationInfo.address
          }
        });
      }
      
      // Determine hours type from schedule data
      const hoursType = scheduleData.regularHours ? "regular" : scheduleData.specialHours ? "special" : "unknown";
      
      // Get location details for activity log
      const locationDetails = locationIds.map((locId: string) => {
        const locationInfo = locationMap.get(locId);
        return {
          id: locId,
          name: locationInfo?.title || 'Unknown Location'
        };
      });
      
      await storage.createActivityLog({
        clientId,
        action: `${hoursType}_hours_updated_in_app`,
        payloadJson: { 
          jobId: job.id, 
          locationCount: locationIds.length,
          hoursType,
          locations: locationDetails,
          scheduleData: scheduleData
        },
        localUserId: getLocalUserId(req)
      });

      // Start processing the job immediately
      processJob(job.id).catch(error => {
        console.error(`Failed to process job ${job.id}:`, error);
      });

      res.status(201).json(job);
    } catch (error) {
      console.error('Create hours error:', error);
      res.status(500).json({ message: "Failed to create hours job" });
    }
  });

  // In-app photo uploads
  app.post("/api/jobs/create-photos", upload.array('photos', 10), async (req, res) => {
    try {
      const { clientId, locationIds, category, isDryRun } = req.body;
      const files = req.files as Express.Multer.File[];
      
      // Parse locationIds if it's a string
      const parsedLocationIds = typeof locationIds === 'string' ? JSON.parse(locationIds) : locationIds;
      
      // Validate required fields
      if (!clientId || !parsedLocationIds || !files || files.length === 0) {
        return res.status(400).json({ message: "Missing required fields: clientId, locationIds, and at least one photo" });
      }

      // Process uploaded files
      const photoData = files.map(file => ({
        originalName: file.originalname,
        mimetype: file.mimetype,
        size: file.size,
        buffer: file.buffer.toString('base64'), // Store as base64 for now
        category: category || 'general'
      }));

      const jobData = {
        clientId,
        type: "photos" as const,
        isDryRun: isDryRun === 'true',
        totalItems: parsedLocationIds.length,
        status: "pending" as const,
        successCount: 0,
        errorCount: 0,
        payload: {
          photosData: photoData,
          locationIds: parsedLocationIds,
          category: category || 'general'
        }
      };

      const job = await storage.createJob(jobData);
      
      await storage.createActivityLog({
        clientId,
        action: "photos_uploaded_in_app",
        payloadJson: { jobId: job.id, photoCount: files.length, locationCount: parsedLocationIds.length },
        localUserId: getLocalUserId(req)
      });

      // Start processing the job immediately
      processJob(job.id).catch(error => {
        console.error(`Failed to process job ${job.id}:`, error);
      });

      res.status(201).json(job);
    } catch (error) {
      console.error('Create photos error:', error);
      res.status(500).json({ message: "Failed to create photos job" });
    }
  });

  // Job actions
  app.post("/api/jobs/:id/dry-run", async (req, res) => {
    try {
      const { id } = req.params;
      const job = await storage.updateJob(id, { isDryRun: true, status: "running" });
      
      // Here you would integrate with your job processing system
      // For now, we'll just update the status
      setTimeout(async () => {
        await storage.updateJob(id, { status: "success" });
      }, 2000);
      
      res.json(job);
    } catch (error) {
      res.status(500).json({ message: "Failed to run dry-run" });
    }
  });

  app.post("/api/jobs/:id/execute", async (req, res) => {
    try {
      const { id } = req.params;
      const job = await storage.updateJob(id, { isDryRun: false, status: "running" });
      
      // Here you would integrate with your job processing system
      setTimeout(async () => {
        await storage.updateJob(id, { status: "success" });
      }, 5000);
      
      res.json(job);
    } catch (error) {
      res.status(500).json({ message: "Failed to execute job" });
    }
  });

  // Job results download
  app.get("/api/jobs/:id/results.csv", async (req, res) => {
    try {
      const { id } = req.params;
      const job = await storage.getJob(id);
      const items = await storage.getJobItems(id);
      
      if (!job) {
        return res.status(404).json({ message: "Job not found" });
      }

      // Generate CSV content
      const csvHeader = "gbp_location_id,status,error_text\n";
      const csvRows = items.map(item => {
        const location = item.clientLocationId; // You'd need to join with location to get gbp_location_id
        return `${location},${item.status},"${item.errorText || ""}"`;
      }).join("\n");

      const csvContent = csvHeader + csvRows;
      
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="job-${id}-results.csv"`);
      res.send(csvContent);
    } catch (error) {
      res.status(500).json({ message: "Failed to generate results CSV" });
    }
  });

  // ============================================
  // SUGGESTED EDITS ROUTES
  // ============================================

  // Diagnostic endpoint — tests Google API auth + one real location call, returns raw result
  app.get("/api/suggested-edits/diagnose", async (req, res) => {
    try {
      const { googleOAuthAuth } = await import("./google-service-auth");

      const authenticated = googleOAuthAuth.isAuthenticated();
      if (!authenticated) {
        return res.json({ ok: false, step: "isAuthenticated", error: "googleOAuthAuth.isAuthenticated() returned false — tokens not in memory" });
      }

      // Count all locations and how many are hidden
      const allLocs = await db.select().from(clientLocations);
      const totalLocs = allLocs.length;
      const hiddenLocs = allLocs.filter(l => l.hidden).length;
      const visibleLocs = totalLocs - hiddenLocs;

      if (!totalLocs) {
        return res.json({ ok: false, step: "db", error: "No locations found in clientLocations table", locationCounts: { total: 0, hidden: 0, visible: 0 } });
      }

      // Grab first visible location to test against, fall back to first of any
      const testLocations = allLocs.filter(l => !l.hidden);
      if (!testLocations.length) {
        return res.json({ ok: false, step: "hidden_filter", error: `All ${totalLocs} locations are marked hidden — the scan would complete instantly with 0 results`, locationCounts: { total: totalLocs, hidden: hiddenLocs, visible: 0 } });
      }

      const loc = testLocations[0];
      let locationName = loc.gbpLocationId;
      if (!locationName.startsWith('locations/')) locationName = `locations/${locationName}`;

      // Try the raw getLocation call
      let locationResult: any = null;
      let locationError: any = null;
      try {
        locationResult = await googleOAuthAuth.getLocation(locationName);
      } catch (err: any) {
        locationError = err?.message || String(err);
      }

      // Try getGoogleUpdated directly
      let updatedResult: any = null;
      let updatedError: any = null;
      try {
        updatedResult = await googleOAuthAuth.getGoogleUpdatedLocation(locationName);
      } catch (err: any) {
        updatedError = err?.message || String(err);
      }

      return res.json({
        ok: !locationError,
        authenticated,
        locationCounts: { total: totalLocs, hidden: hiddenLocs, visible: visibleLocs },
        testedLocation: { id: loc.id, gbpLocationId: locationName, name: loc.name },
        getLocation: { result: locationResult, error: locationError },
        getGoogleUpdated: { result: updatedResult, error: updatedError },
      });
    } catch (err: any) {
      return res.status(500).json({ ok: false, step: "unexpected", error: err?.message || String(err) });
    }
  });

  // Scan all locations for Google-suggested updates (with SSE progress streaming)
  // Accepts optional query params: folderIds (comma-separated) and locationIds (comma-separated)
  app.get("/api/suggested-edits/scan", async (req, res) => {
    console.log('🚀 [SCAN] Endpoint hit — setting up SSE');
    // Set up SSE headers (X-Accel-Buffering: no disables Railway/Nginx proxy buffering for SSE)
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const sendEvent = (event: string, data: any) => {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    // Heartbeat every 15s — keeps Railway proxy from closing the SSE connection mid-scan
    const heartbeat = setInterval(() => {
      res.write(': heartbeat\n\n');
    }, 15000);

    const cleanup = () => clearInterval(heartbeat);
    req.on('close', cleanup);

    try {
      const { googleOAuthAuth } = await import("./google-service-auth");
      
      if (!googleOAuthAuth.isAuthenticated()) {
        sendEvent('error', { message: "Not authenticated" });
        cleanup(); res.end();
        return;
      }

      // Parse optional folder and location filters from query params
      const folderIdsParam = req.query.folderIds as string | undefined;
      const locationIdsParam = req.query.locationIds as string | undefined;
      
      const folderIds = folderIdsParam ? folderIdsParam.split(',').filter(id => id.trim()) : [];
      const locationIds = locationIdsParam ? locationIdsParam.split(',').filter(id => id.trim()) : [];

      let allLocations: typeof clientLocations.$inferSelect[] = [];

      // If specific folders are selected, get locations from those folders
      if (folderIds.length > 0) {
        const folderLocationIds = new Set<string>();
        for (const folderId of folderIds) {
          const folderLocs = await storage.getLocationsByFolderId(folderId);
          folderLocs.forEach(loc => folderLocationIds.add(loc.id));
        }
        if (folderLocationIds.size > 0) {
          allLocations = await db.select().from(clientLocations)
            .where(inArray(clientLocations.id, Array.from(folderLocationIds)));
        }
      }
      
      // If specific location IDs are selected, add those too (or use exclusively if no folders)
      if (locationIds.length > 0) {
        const specificLocations = await db.select().from(clientLocations)
          .where(inArray(clientLocations.id, locationIds));
        
        // Merge with folder locations (avoid duplicates)
        const existingIds = new Set(allLocations.map(l => l.id));
        for (const loc of specificLocations) {
          if (!existingIds.has(loc.id)) {
            allLocations.push(loc);
          }
        }
      }
      
      // If no filters provided, scan all locations
      if (folderIds.length === 0 && locationIds.length === 0) {
        allLocations = await db.select().from(clientLocations);
      }

      // Filter out hidden locations - they should not appear in suggested edits
      const beforeHiddenFilter = allLocations.length;
      allLocations = allLocations.filter(loc => !loc.hidden);
      const totalLocations = allLocations.length;

      console.log(`🔍 Suggested edits scan: ${beforeHiddenFilter} total locations, ${beforeHiddenFilter - totalLocations} hidden, ${totalLocations} to scan`);

      if (totalLocations === 0) {
        console.warn(`⚠️ Scan has 0 locations to check — completing immediately. All ${beforeHiddenFilter} locations may be marked hidden.`);
      }

      sendEvent('start', { total: totalLocations });

      const results: any[] = [];
      let scanned = 0;
      let withUpdates = 0;
      let errored = 0;
      let firstError: string | null = null;

      // Process locations in parallel batches
      const BATCH_SIZE = 10;

      for (let i = 0; i < allLocations.length; i += BATCH_SIZE) {
        const batch = allLocations.slice(i, i + BATCH_SIZE);

        // Process batch in parallel
        const batchPromises = batch.map(async (location) => {
          try {
            let locationName = location.gbpLocationId;
            if (!locationName.startsWith('locations/')) {
              locationName = `locations/${locationName}`;
            }

            const checkResult = await googleOAuthAuth.checkForGoogleUpdates(locationName);
            
            if (checkResult.hasUpdates) {
              try {
                const suggestedUpdate = await googleOAuthAuth.getGoogleUpdatedLocation(locationName);
                const originalLoc = checkResult.location || {};
                const suggestedLoc = suggestedUpdate?.location || {};
                let diffMask = suggestedUpdate?.diffMask || "";

                console.log(`📋 Raw diffMask for ${locationName}: "${diffMask}"`);

                // Strip non-actionable technical fields that are never meaningful suggestions
                // (latlng = GPS coordinate precision diffs, plusCode = auto-derived)
                const NON_ACTIONABLE_FIELDS = new Set(['latlng', 'plusCode', 'plus_code']);
                diffMask = diffMask
                  .split(",")
                  .map((f: string) => f.trim())
                  .filter((f: string) => f && !NON_ACTIONABLE_FIELDS.has(f))
                  .join(",");

                // If diffMask is empty or only "metadata", compute it by comparing fields
                const nonMetaFields = diffMask.split(",").map((f: string) => f.trim()).filter((f: string) => f && f !== 'metadata');
                if (nonMetaFields.length === 0 && Object.keys(suggestedLoc).length > 0) {
                  const comparableFields = ['title', 'storefrontAddress', 'phoneNumbers', 'websiteUri', 'regularHours', 'profile', 'categories', 'openInfo'];
                  // Strip technical sub-fields from address objects before comparing
                  // to avoid false positives when only GPS coordinates or plus codes differ
                  const stripNonActionable = (obj: any) => {
                    if (!obj || typeof obj !== 'object') return obj;
                    const copy = { ...obj };
                    delete copy.latlng;
                    delete copy.plusCode;
                    delete copy.plus_code;
                    return copy;
                  };

                  const computedFields: string[] = [];
                  for (const field of comparableFields) {
                    let suggestedVal = (suggestedLoc as any)[field];
                    // Only flag as changed if Google actually provided a suggested value for the field.
                    // If the field is absent from the suggested location, Google isn't suggesting a change
                    // for it — it just wasn't included in the partial response.
                    if (suggestedVal === undefined || suggestedVal === null) continue;
                    let origValRaw = (originalLoc as any)[field] ?? null;
                    // For address fields, strip non-actionable sub-fields before comparing
                    if (field === 'storefrontAddress') {
                      origValRaw = stripNonActionable(origValRaw);
                      suggestedVal = stripNonActionable(suggestedVal);
                    }
                    const origVal = JSON.stringify(origValRaw);
                    const suggestValStr = JSON.stringify(suggestedVal);
                    if (origVal !== suggestValStr) {
                      computedFields.push(field);
                    }
                  }
                  if (computedFields.length > 0) {
                    diffMask = computedFields.join(",");
                    console.log(`📋 Computed diffMask for ${locationName}: "${diffMask}"`);
                  } else {
                    // No actionable field diffs found — skip this location rather than
                    // showing a meaningless "metadata" entry that can't be acted on
                    console.log(`📋 No actionable diffs found for ${locationName}, skipping`);
                    return null;
                  }
                }

                // Final check: if the only remaining fields are metadata/non-actionable, skip
                const finalFields = diffMask.split(",").map((f: string) => f.trim()).filter((f: string) => f && f !== 'metadata');
                if (finalFields.length === 0) {
                  console.log(`📋 Only metadata remaining for ${locationName}, skipping`);
                  return null;
                }

                return {
                  locationId: location.id,
                  locationName: location.name,
                  locationAddress: location.address,
                  gbpLocationName: locationName,
                  hasUpdates: true,
                  originalLocation: originalLoc,
                  suggestedLocation: suggestedLoc,
                  diffMask
                };
              } catch (error) {
                console.error(`Error fetching updates for ${locationName}:`, error);
                return {
                  locationId: location.id,
                  locationName: location.name,
                  locationAddress: location.address,
                  gbpLocationName: locationName,
                  hasUpdates: true,
                  originalLocation: checkResult.location || {},
                  suggestedLocation: {},
                  diffMask: "metadata"
                };
              }
            }
            return null;
          } catch (error: any) {
            const msg = error?.message || String(error);
            console.error(`❌ Error checking location ${location.gbpLocationId}:`, msg);
            return { __error: true, message: msg };
          }
        });

        const batchResults = await Promise.all(batchPromises);

        // Count ALL locations in this batch
        scanned += batch.length;

        // Process results
        for (const result of batchResults) {
          if (!result) continue;
          if ((result as any).__error) {
            errored++;
            if (!firstError) firstError = (result as any).message;
          } else {
            withUpdates++;
            results.push(result);
          }
        }

        // If every location so far has errored, bail early with an error event
        if (scanned === errored && scanned >= BATCH_SIZE) {
          console.error(`🚨 Scan aborting early — all ${scanned} locations errored. First error: ${firstError}`);
          sendEvent('error', {
            message: `Google API calls are failing for all locations. ${firstError || 'Check authentication and API permissions.'}`,
            errored,
            scanned
          });
          cleanup(); res.end();
          return;
        }

        // Send progress update
        sendEvent('progress', {
          scanned,
          total: totalLocations,
          withUpdates,
          errored
        });

        // Small delay between batches to avoid rate limiting
        if (i + BATCH_SIZE < allLocations.length) {
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      }

      // Send final results
      sendEvent('complete', {
        scanned,
        withUpdates,
        errored,
        firstError,
        results
      });

      cleanup(); res.end();
    } catch (error) {
      console.error("Error scanning for suggested edits:", error);
      sendEvent('error', { message: "Failed to scan for suggested edits" });
      cleanup(); res.end();
    }
  });

  // Get all suggested edits from the database
  app.get("/api/suggested-edits", async (req, res) => {
    try {
      const { status, clientId } = req.query;
      
      let query = db.select({
        edit: suggestedEdits,
        location: clientLocations
      })
        .from(suggestedEdits)
        .leftJoin(clientLocations, eq(suggestedEdits.clientLocationId, clientLocations.id));
      
      if (status) {
        query = query.where(eq(suggestedEdits.status, status as string)) as typeof query;
      }
      
      if (clientId) {
        query = query.where(eq(clientLocations.clientId, clientId as string)) as typeof query;
      }
      
      const results = await query.orderBy(desc(suggestedEdits.detectedAt));
      
      // Filter out edits for hidden locations
      res.json(results
        .filter(r => !r.location?.hidden)
        .map(r => ({
          ...r.edit,
          locationName: r.location?.name,
          locationAddress: r.location?.address
        })));
    } catch (error) {
      console.error("Error fetching suggested edits:", error);
      res.status(500).json({ message: "Failed to fetch suggested edits" });
    }
  });

  // Check a specific location for Google-suggested updates
  app.get("/api/suggested-edits/check/:locationId", async (req, res) => {
    try {
      const { locationId } = req.params;
      const { googleOAuthAuth } = await import("./google-service-auth");
      
      if (!googleOAuthAuth.isAuthenticated()) {
        return res.status(401).json({ message: "Not authenticated" });
      }

      // Get location from database
      const [location] = await db.select().from(clientLocations).where(eq(clientLocations.id, locationId));
      
      if (!location) {
        return res.status(404).json({ message: "Location not found" });
      }

      // Construct the full location name
      let locationName = location.gbpLocationId;
      if (!locationName.startsWith('locations/')) {
        locationName = `locations/${locationName}`;
      }

      const checkResult = await googleOAuthAuth.checkForGoogleUpdates(locationName);
      
      if (checkResult.hasUpdates) {
        const suggestedUpdate = await googleOAuthAuth.getGoogleUpdatedLocation(locationName);
        
        res.json({
          hasUpdates: true,
          location: checkResult.location,
          suggestedLocation: suggestedUpdate?.location,
          diffMask: suggestedUpdate?.diffMask
        });
      } else {
        res.json({
          hasUpdates: false,
          location: checkResult.location
        });
      }
    } catch (error) {
      console.error("Error checking for suggested edits:", error);
      res.status(500).json({ message: "Failed to check for suggested edits" });
    }
  });

  // Helper to get nested value by path (e.g., "profile.description")
  const getNestedValue = (obj: any, path: string): any => {
    if (!obj) return undefined;
    const parts = path.split('.');
    let current = obj;
    for (const part of parts) {
      if (current === undefined || current === null) return undefined;
      current = current[part];
    }
    return current;
  };

  // Accept a suggested edit
  app.post("/api/suggested-edits/:id/accept", async (req, res) => {
    try {
      const { id } = req.params;
      const { suggestedLocation, originalLocation, diffMask, gbpLocationName, locationName, locationAddress, clientId } = req.body;
      const { googleOAuthAuth } = await import("./google-service-auth");
      
      if (!googleOAuthAuth.isAuthenticated()) {
        return res.status(401).json({ message: "Not authenticated" });
      }

      // Apply the suggested update via the Google API
      const result = await googleOAuthAuth.acceptGoogleUpdate(gbpLocationName, suggestedLocation, diffMask);
      
      if (result.success) {
        // Update the suggested edit in the database if it exists
        if (id !== 'inline') {
          await db.update(suggestedEdits)
            .set({ 
              status: 'accepted',
              resolvedAt: new Date(),
              updatedAt: new Date()
            })
            .where(eq(suggestedEdits.id, id));
        }
        
        // Log the action to history - use getNestedValue for dotted paths
        // Defensive guards for cases where originalLocation might not be provided
        const changes = (diffMask || '').split(',').filter((f: string) => f.trim() && f.trim() !== 'metadata').map((field: string) => {
          const fieldPath = field.trim();
          const suggestedValue = suggestedLocation ? getNestedValue(suggestedLocation, fieldPath) : undefined;
          const originalValue = originalLocation ? getNestedValue(originalLocation, fieldPath) : undefined;
          return {
            fieldPath,
            originalValue: originalValue !== undefined ? originalValue : null,
            suggestedValue: suggestedValue !== undefined ? suggestedValue : 'Updated'
          };
        });
        
        const actorId = getLocalUserId(req);
        const actor = actorId ? await storage.getLocalUser(actorId) : null;
        await db.insert(suggestedEditActions).values({
          gbpLocationName,
          locationName: locationName || 'Unknown Location',
          locationAddress: locationAddress || '',
          actionType: 'accepted',
          diffMask,
          changes,
          localUserId: actorId ?? undefined,
          actedByName: actor?.name ?? null,
          performedAt: new Date()
        });

        if (clientId) {
          await storage.createActivityLog({
            clientId,
            action: "suggested_edit_accepted",
            payloadJson: {
              locationName: locationName || 'Unknown Location',
              locationAddress: locationAddress || '',
              diffMask,
              fields: (diffMask || '').split(',').map((f: string) => f.trim()).filter(Boolean),
            },
            localUserId: getLocalUserId(req),
          });
        }

        res.json({ success: true, message: "Suggested edit accepted" });
      } else {
        res.status(500).json({ message: "Failed to accept suggested edit" });
      }
    } catch (error: any) {
      console.error("Error accepting suggested edit:", error);
      res.status(500).json({ message: error.message || "Failed to accept suggested edit" });
    }
  });

  // Get suggested edit action history
  app.get("/api/suggested-edits/history", async (req, res) => {
    try {
      const { limit = '20' } = req.query;
      const limitNum = Math.min(parseInt(limit as string) || 20, 200);
      
      const history = await db.select()
        .from(suggestedEditActions)
        .orderBy(desc(suggestedEditActions.performedAt))
        .limit(limitNum);
      
      res.json(history);
    } catch (error) {
      console.error("Error fetching suggested edit history:", error);
      res.status(500).json({ message: "Failed to fetch history" });
    }
  });

  // Undo a suggested edit action (revert to original value)
  app.post("/api/suggested-edits/history/:id/undo", async (req, res) => {
    try {
      const { id } = req.params;
      const { googleOAuthAuth } = await import("./google-service-auth");
      
      if (!googleOAuthAuth.isAuthenticated()) {
        return res.status(401).json({ message: "Not authenticated" });
      }

      // Get the history entry
      const [historyEntry] = await db.select()
        .from(suggestedEditActions)
        .where(eq(suggestedEditActions.id, id))
        .limit(1);
      
      if (!historyEntry) {
        return res.status(404).json({ message: "History entry not found" });
      }

      const allowedTypes = ['accepted', 'rejected', 'undone', 'undone_from_accepted', 'undone_from_rejected'];
      if (!allowedTypes.includes(historyEntry.actionType)) {
        return res.status(400).json({ message: "This change cannot be undone" });
      }

      // Determine which value to push to Google and what state to transition to.
      // The toggle chain is:
      //   accepted <-> undone_from_accepted  (push originalValue to undo, push suggestedValue to redo)
      //   rejected <-> undone_from_rejected  (push suggestedValue to undo, push originalValue to redo)
      //   undone (legacy) is treated as undone_from_accepted — push suggestedValue, mark accepted
      const pushOriginal = historyEntry.actionType === 'accepted' || historyEntry.actionType === 'undone_from_rejected';
      const nextActionType =
        historyEntry.actionType === 'accepted'             ? 'undone_from_accepted' :
        historyEntry.actionType === 'undone_from_accepted' ? 'accepted' :
        historyEntry.actionType === 'undone'               ? 'accepted' :
        historyEntry.actionType === 'rejected'             ? 'undone_from_rejected' :
                                                             'rejected';

      const changes = historyEntry.changes as Array<{ fieldPath: string; originalValue: any; suggestedValue: any }>;
      const restoreData: Record<string, any> = {};

      for (const change of changes) {
        const valueToRestore = pushOriginal ? change.originalValue : change.suggestedValue;
        if (valueToRestore !== null && valueToRestore !== undefined) {
          const parts = change.fieldPath.split('.');
          let current = restoreData;
          for (let i = 0; i < parts.length - 1; i++) {
            if (!current[parts[i]]) current[parts[i]] = {};
            current = current[parts[i]];
          }
          current[parts[parts.length - 1]] = valueToRestore;
        }
      }

      // Only call Google if there are actual values to push (skip metadata-only diffs)
      let success = true;
      if (Object.keys(restoreData).length > 0) {
        const result = await googleOAuthAuth.acceptGoogleUpdate(
          historyEntry.gbpLocationName,
          restoreData,
          historyEntry.diffMask || ''
        );
        success = result.success;
      }

      if (success) {
        await db.update(suggestedEditActions)
          .set({ actionType: nextActionType })
          .where(eq(suggestedEditActions.id, id));

        res.json({ success: true, message: "Change undone successfully" });
      } else {
        res.status(500).json({ message: "Failed to undo change" });
      }
    } catch (error: any) {
      console.error("Error undoing suggested edit:", error);
      res.status(500).json({ message: error.message || "Failed to undo change" });
    }
  });

  // Reject a suggested edit
  app.post("/api/suggested-edits/:id/reject", async (req, res) => {
    try {
      const { id } = req.params;
      const { diffMask, gbpLocationName, locationName, locationAddress, originalLocation, suggestedLocation, clientId } = req.body;
      const { googleOAuthAuth } = await import("./google-service-auth");
      
      if (!googleOAuthAuth.isAuthenticated()) {
        return res.status(401).json({ message: "Not authenticated" });
      }

      // Reject the suggested update via the Google API
      const result = await googleOAuthAuth.rejectGoogleUpdate(gbpLocationName, diffMask);
      
      if (result.success) {
        // Update the suggested edit in the database if it exists
        if (id !== 'inline') {
          await db.update(suggestedEdits)
            .set({ 
              status: 'rejected',
              resolvedAt: new Date(),
              updatedAt: new Date()
            })
            .where(eq(suggestedEdits.id, id));
        }
        
        // Log the action to history - include original and suggested values for rejected edits too
        // Defensive guards for cases where originalLocation/suggestedLocation might not be provided
        const changes = (diffMask || '').split(',').filter((f: string) => f.trim() && f.trim() !== 'metadata').map((field: string) => {
          const fieldPath = field.trim();
          const suggestedValue = suggestedLocation ? getNestedValue(suggestedLocation, fieldPath) : undefined;
          const originalValue = originalLocation ? getNestedValue(originalLocation, fieldPath) : undefined;
          return {
            fieldPath,
            originalValue: originalValue !== undefined ? originalValue : null,
            suggestedValue: suggestedValue !== undefined ? suggestedValue : null
          };
        });
        
        const actorId = getLocalUserId(req);
        const actor = actorId ? await storage.getLocalUser(actorId) : null;
        await db.insert(suggestedEditActions).values({
          gbpLocationName,
          locationName: locationName || 'Unknown Location',
          locationAddress: locationAddress || '',
          actionType: 'rejected',
          diffMask,
          changes,
          localUserId: actorId ?? undefined,
          actedByName: actor?.name ?? null,
          performedAt: new Date()
        });

        if (clientId) {
          await storage.createActivityLog({
            clientId,
            action: "suggested_edit_rejected",
            payloadJson: {
              locationName: locationName || 'Unknown Location',
              locationAddress: locationAddress || '',
              diffMask,
              fields: (diffMask || '').split(',').map((f: string) => f.trim()).filter(Boolean),
            },
            localUserId: getLocalUserId(req),
          });
        }

        res.json({ success: true, message: "Suggested edit rejected" });
      } else {
        res.status(500).json({ message: "Failed to reject suggested edit" });
      }
    } catch (error: any) {
      console.error("Error rejecting suggested edit:", error);
      res.status(500).json({ message: error.message || "Failed to reject suggested edit" });
    }
  });

  // Undo/Delete a job and all its associated posts
  app.delete("/api/jobs/:jobId/undo", async (req: any, res) => {
    try {
      const { jobId } = req.params;
      console.log(`🗑️ DELETE /api/jobs/${jobId}/undo - Starting undo process`);
      
      // Authentication check - require session
      if (!req.session?.userId) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      
      // Get the job to verify it exists
      const job = await storage.getJob(jobId);
      if (!job) {
        return res.status(404).json({ message: "Job not found" });
      }
      
      // Authorization check - verify user owns the client that owns this job
      const client = await storage.getClient(job.clientId);
      if (!client || client.userId !== req.session.userId) {
        return res.status(403).json({ message: "Not authorized to undo this job" });
      }
      
      // Get Google OAuth service
      const { googleOAuthAuth } = await import("./google-service-auth");
      
      if (!googleOAuthAuth.isAuthenticated()) {
        return res.status(401).json({ error: 'Not authenticated with Google. Please log in first.' });
      }
      
      let deletedPostsCount = 0;
      let failedDeletesCount = 0;
      const errors: string[] = [];
      
      // For posts jobs, delete all the posts from Google
      if (job.type === "posts") {
        const activePosts = await storage.getActivePostsByJobId(jobId);
        console.log(`📝 Found ${activePosts.length} active posts to delete`);
        
        for (const post of activePosts) {
          try {
            console.log(`🗑️ Deleting post ${post.id} (${post.gbpPostName})`);
            await googleOAuthAuth.deletePost(post.gbpPostName);
            await storage.deletePost(post.id);
            deletedPostsCount++;
          } catch (error: any) {
            console.error(`Failed to delete post ${post.id}:`, error);
            failedDeletesCount++;
            errors.push(`Failed to delete post: ${error.message}`);
            // Still mark it as deleted in our DB to avoid orphaned records
            try {
              await storage.deletePost(post.id);
            } catch (e) {
              // Ignore
            }
          }
        }
      }
      
      // Log the activity before deletion
      await storage.createActivityLog({
        userId: req.session.userId,
        clientId: job.clientId,
        action: "job_undone",
        payloadJson: { 
          jobId, 
          jobType: job.type, 
          deletedPostsCount, 
          failedDeletesCount,
          totalItems: job.totalItems 
        },
        localUserId: getLocalUserId(req)
      });
      
      // Delete the job and its items from the database
      await storage.deleteJob(jobId);
      
      console.log(`✅ Job ${jobId} undone successfully`);
      
      // Build appropriate response message based on job type
      let message = "Job record deleted.";
      if (job.type === "posts") {
        message = `Job undone successfully. ${deletedPostsCount} posts deleted from Google Business Profile.`;
      } else if (job.type === "hours") {
        message = "Job record deleted. Note: Hours changes on Google cannot be automatically reverted.";
      } else if (job.type === "photo") {
        message = "Job record deleted. Note: Photos on Google cannot be automatically removed.";
      }
      
      res.json({ 
        success: true, 
        message,
        jobType: job.type,
        deletedPostsCount,
        failedDeletesCount,
        errors: errors.length > 0 ? errors : undefined
      });
    } catch (error: any) {
      console.error('❌ Undo job error:', error);
      res.status(500).json({ message: error.message || "Failed to undo job" });
    }
  });

  // Bulk undo jobs from activity log (keeps log records, reverts GBP changes)
  app.post("/api/jobs/bulk-undo", async (req: any, res) => {
    try {
      if (!req.session?.userId) {
        return res.status(401).json({ message: "Not authenticated" });
      }

      const { jobIds } = req.body;
      if (!Array.isArray(jobIds) || jobIds.length === 0) {
        return res.status(400).json({ message: "jobIds array required" });
      }

      const { googleOAuthAuth } = await import("./google-service-auth");

      const results: Array<{ jobId: string; success: boolean; message: string; jobType?: string; deletedPostsCount?: number }> = [];

      for (const jobId of jobIds) {
        try {
          const job = await storage.getJob(jobId);
          if (!job) {
            results.push({ jobId, success: false, message: "Job not found" });
            continue;
          }

          const client = await storage.getClient(job.clientId);
          if (!client || client.userId !== req.session.userId) {
            results.push({ jobId, success: false, message: "Not authorized" });
            continue;
          }

          let deletedPostsCount = 0;
          let failedDeletesCount = 0;

          if (job.type === "posts" && googleOAuthAuth.isAuthenticated()) {
            const activePosts = await storage.getActivePostsByJobId(jobId);
            for (const post of activePosts) {
              try {
                await googleOAuthAuth.deletePost(post.gbpPostName);
                await storage.deletePost(post.id);
                deletedPostsCount++;
              } catch {
                failedDeletesCount++;
                try { await storage.deletePost(post.id); } catch {}
              }
            }
          }

          await storage.createActivityLog({
            userId: req.session.userId,
            clientId: job.clientId,
            action: "job_undone",
            payloadJson: { jobId, jobType: job.type, deletedPostsCount, failedDeletesCount, totalItems: job.totalItems },
            localUserId: getLocalUserId(req)
          });

          await storage.deleteJob(jobId);

          let message = "Job reverted.";
          if (job.type === "posts") message = `${deletedPostsCount} posts deleted from Google Business Profile.`;
          else if (job.type === "hours") message = "Hours job removed. Note: hours changes on Google cannot be automatically reverted.";
          else if (job.type === "photo") message = "Photo job removed. Note: photos on Google cannot be automatically removed.";

          results.push({ jobId, success: true, message, jobType: job.type, deletedPostsCount });
        } catch (err: any) {
          results.push({ jobId, success: false, message: err.message || "Failed to undo" });
        }
      }

      const succeeded = results.filter(r => r.success).length;
      const failed = results.filter(r => !r.success).length;
      console.log(`✅ Bulk undo: ${succeeded} succeeded, ${failed} failed`);
      res.json({ success: true, succeeded, failed, results });
    } catch (error: any) {
      console.error('❌ Bulk undo error:', error);
      res.status(500).json({ message: error.message || "Failed to bulk undo" });
    }
  });

  // Email API endpoint - requires authentication
  const sendEmailSchema = z.object({
    to: z.string().min(1, "Email address is required").refine((val) => {
      // Allow comma-separated emails
      const emails = val.split(',').map(e => e.trim()).filter(e => e);
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      return emails.every(email => emailRegex.test(email));
    }, "Invalid email address(es)"),
    subject: z.string().min(1, "Subject is required"),
    body: z.string().min(1, "Body is required"),
    isHtml: z.boolean().optional()
  });
  
  app.post("/api/emails/send", requireAuth, async (req, res) => {
    try {
      const parseResult = sendEmailSchema.safeParse(req.body);

      if (!parseResult.success) {
        return res.status(400).json({
          success: false,
          error: parseResult.error.errors.map(e => e.message).join(", ")
        });
      }

      const { to, subject, body, isHtml } = parseResult.data;

      // Load the current user's OAuth tokens from the database
      const userId = req.session!.userId!;
      const user = await storage.getUser(userId);
      if (!user?.accessToken) {
        return res.status(401).json({ success: false, error: "Google account not connected — please re-authenticate." });
      }

      const result = await sendEmail(
        { to, subject, body, isHtml: isHtml === true },
        { accessToken: user.accessToken, refreshToken: user.refreshToken ?? null, userId: user.id },
      );

      if (result.success) {
        res.json(result);
      } else {
        res.status(500).json(result);
      }
    } catch (error: any) {
      console.error('Email send error:', error);
      res.status(500).json({
        success: false,
        error: error.message || "Failed to send email"
      });
    }
  });

  // Send manual reviews email — same template as automated, with Copy/Email buttons and optional custom message
  app.post("/api/reviews/send-email", requireAuth, async (req, res) => {
    try {
      const { to, cc, reviews, allCheckedLocations, minStars, maxStars, startDate, endDate, customMessage, clientName } = req.body;
      if (!to || !reviews || !Array.isArray(reviews)) {
        return res.status(400).json({ success: false, error: "Missing required fields: to, reviews" });
      }

      const userId = req.session!.userId!;
      const user = await storage.getUser(userId);
      if (!user?.accessToken) {
        return res.status(401).json({ success: false, error: "Google account not connected — please re-authenticate." });
      }

      // Build date range text
      let dateRangeText = '';
      if (startDate && endDate) {
        dateRangeText = `${new Date(startDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${new Date(endDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
      } else if (startDate) {
        dateRangeText = `Since ${new Date(startDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
      } else if (endDate) {
        dateRangeText = `Through ${new Date(endDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
      }

      const appBaseUrl = process.env.FRONTEND_URL?.trim() ||
        process.env.APP_URL?.trim() ||
        (process.env.REPLIT_DOMAINS?.split(',')[0]?.trim()
          ? `https://${process.env.REPLIT_DOMAINS.split(',')[0].trim()}`
          : undefined);

      const emailHtml = generateReviewEmailHtml(
        reviews,
        clientName || 'Reviews',
        minStars ?? 1,
        maxStars ?? 5,
        dateRangeText,
        Array.isArray(allCheckedLocations) ? allCheckedLocations : undefined,
        customMessage || undefined,
        appBaseUrl
      );

      const starText = (minStars ?? 1) === (maxStars ?? 5)
        ? `${minStars ?? 1} star`
        : `${minStars ?? 1}-${maxStars ?? 5} stars`;

      // Build location names for subject (same logic as automated emails)
      let subject: string;
      if (reviews.length === 0) {
        subject = `Review Summary — No New ${starText} Reviews`;
      } else {
        const uniqueNames: string[] = Array.from(new Set(
          (reviews as any[]).map((r: any) => r.locationName).filter(Boolean)
        ));
        const combinedNames: string[] = [];
        const used = new Set<number>();
        for (let i = 0; i < uniqueNames.length; i++) {
          if (used.has(i)) continue;
          const name1 = uniqueNames[i];
          let baseName = name1;
          for (let j = i + 1; j < uniqueNames.length; j++) {
            if (used.has(j)) continue;
            const w1 = name1.toLowerCase().split(/\s+/);
            const w2 = uniqueNames[j].toLowerCase().split(/\s+/);
            let common = 0;
            for (let k = 0; k < Math.min(w1.length, w2.length); k++) {
              if (w1[k] === w2[k]) common++; else break;
            }
            if (common >= Math.max(w1.length, w2.length) * 0.8 || common >= 3) {
              used.add(j);
              baseName = name1.split(/\s+/).slice(0, common).join(' ');
            }
          }
          used.add(i);
          combinedNames.push(baseName);
        }
        const locationPart = combinedNames.length > 0 ? ` - ${combinedNames.join(', ')}` : '';
        subject = `${reviews.length} New Review${reviews.length !== 1 ? 's' : ''} — ${starText}${locationPart}`;
      }

      // Load logo for inline CID embedding (same as automated emails)
      const prodLogoPath = path.join(process.cwd(), 'dist', 'public', 'commit-logo.png');
      const devLogoPath = path.join(process.cwd(), 'client', 'public', 'commit-logo.png');
      const logoFilePath = fs.existsSync(prodLogoPath) ? prodLogoPath : devLogoPath;
      const inlineImages = fs.existsSync(logoFilePath)
        ? [{
            cid: 'commit-logo',
            filename: 'commit-logo.png',
            mimeType: 'image/png',
            base64Data: fs.readFileSync(logoFilePath).toString('base64'),
          }]
        : [];

      const toList = (to as string).split(',').map((e: string) => e.trim()).filter(Boolean).join(', ');
      const lastResult = await sendEmail(
        { to: toList, cc: cc || undefined, subject, body: emailHtml, isHtml: true, inlineImages },
        { accessToken: user.accessToken, refreshToken: user.refreshToken ?? null, userId: user.id }
      );

      if (lastResult.success) {
        res.json({ success: true });
      } else {
        res.status(500).json(lastResult);
      }
    } catch (error: any) {
      console.error('Reviews email send error:', error);
      res.status(500).json({ success: false, error: error.message || "Failed to send email" });
    }
  });

  // Debug: check token scopes and test Gmail API
  app.get("/api/emails/debug", requireAuth, async (req, res) => {
    try {
      const userId = req.session!.userId!;
      const user = await storage.getUser(userId);
      if (!user?.accessToken) {
        return res.json({ error: "No access token in DB — user needs to re-login" });
      }

      // Check what scopes this token actually has via Google tokeninfo
      const tokenInfoRes = await fetch(
        `https://www.googleapis.com/oauth2/v1/tokeninfo?access_token=${user.accessToken}`
      );
      const tokenInfo = await tokenInfoRes.json();

      // Try a real Gmail send to yourself to get the raw error
      const { sendEmail: testSendEmail } = await import("./gmail-service");
      const result = await testSendEmail(
        { to: user.email || "test@test.com", subject: "BizBuddy Gmail debug test", body: "If you see this, Gmail is working!", isHtml: false },
        { accessToken: user.accessToken, refreshToken: user.refreshToken ?? null, userId: user.id }
      );

      res.json({ tokenInfo, gmailTestResult: result });
    } catch (err: any) {
      res.json({ error: err.message, stack: err.stack?.slice(0, 500) });
    }
  });

  // Review Email Groups
  app.get("/api/review-email-groups", requireAuth, async (req, res) => {
    try {
      const groups = await storage.getReviewEmailGroupsByUserId(req.session!.userId!);
      
      // Also fetch location assignments for each group
      const groupsWithLocations = await Promise.all(groups.map(async (group) => {
        const assignments = await storage.getReviewEmailGroupLocations(group.id);
        return {
          ...group,
          locationIds: assignments.map(a => a.locationId)
        };
      }));
      
      res.json(groupsWithLocations);
    } catch (error) {
      console.error("Error fetching review email groups:", error);
      res.status(500).json({ message: "Failed to fetch review email groups" });
    }
  });

  app.post("/api/review-email-groups", requireAuth, async (req, res) => {
    try {
      const { name, recipientEmail, ccEmail, emailDay, emailTime, minStars, maxStars, isEnabled, locationIds, customMessage, customSubject, frequency, lookbackDays, lookbackOffset, startDate, outputFormat, sheetBreakout, sheetName, themes } = req.body;

      if (!name || !recipientEmail) {
        return res.status(400).json({ message: "Name and recipient email are required" });
      }

      const group = await storage.createReviewEmailGroup({
        userId: req.session!.userId!,
        name,
        recipientEmail,
        ccEmail: ccEmail || null,
        // Send day is derived from the start date (the first send day). Falls back to the
        // posted emailDay only for legacy callers that don't send a startDate.
        emailDay: startDate ? String(new Date(startDate + "T12:00:00Z").getUTCDay()) : (emailDay || "1"),
        emailTime: emailTime || "09:00",
        minStars: minStars || 1,
        maxStars: maxStars || 3,
        customMessage: customMessage || null,
        customSubject: customSubject || null,
        isEnabled: isEnabled !== false,
        frequency: frequency || "weekly",
        lookbackDays: lookbackDays || 7,
        lookbackOffset: lookbackOffset || 0,
        startDate: startDate || null,
        outputFormat: outputFormat || "email",
        sheetBreakout: sheetBreakout || "region",
        sheetName: sheetName?.trim() || null,
        themes: Array.isArray(themes) ? themes : [],
      } as any);

      // Set location assignments
      if (locationIds && Array.isArray(locationIds)) {
        await storage.setReviewEmailGroupLocations(group.id, locationIds);
      }
      
      res.json({ ...group, locationIds: locationIds || [] });
    } catch (error) {
      console.error("Error creating review email group:", error);
      res.status(500).json({ message: "Failed to create review email group" });
    }
  });

  app.put("/api/review-email-groups/:id", requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      
      // Verify ownership
      const existing = await storage.getReviewEmailGroup(id);
      if (!existing || existing.userId !== req.session!.userId) {
        return res.status(404).json({ message: "Group not found" });
      }
      
      const { name, recipientEmail, ccEmail, emailDay, emailTime, minStars, maxStars, isEnabled, locationIds, customMessage, customSubject, frequency, lookbackDays, lookbackOffset, startDate, outputFormat, sheetBreakout, sheetName, themes } = req.body;

      const group = await storage.updateReviewEmailGroup(id, {
        name,
        recipientEmail,
        ccEmail: ccEmail || null,
        // Keep the stored send day in sync with the start date (the first send day).
        emailDay: startDate ? String(new Date(startDate + "T12:00:00Z").getUTCDay()) : emailDay,
        emailTime,
        minStars,
        maxStars,
        customMessage: customMessage || null,
        customSubject: customSubject || null,
        isEnabled,
        frequency: frequency || "weekly",
        lookbackDays: lookbackDays || 7,
        lookbackOffset: lookbackOffset ?? 0,
        startDate: startDate || null,
        outputFormat: outputFormat || "email",
        sheetBreakout: sheetBreakout || "region",
        sheetName: sheetName?.trim() || null,
        themes: Array.isArray(themes) ? themes : [],
      } as any);

      // Update location assignments
      if (locationIds && Array.isArray(locationIds)) {
        await storage.setReviewEmailGroupLocations(id, locationIds);
      }
      
      res.json({ ...group, locationIds: locationIds || [] });
    } catch (error) {
      console.error("Error updating review email group:", error);
      res.status(500).json({ message: "Failed to update review email group" });
    }
  });

  app.delete("/api/review-email-groups/:id", requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      
      // Verify ownership
      const existing = await storage.getReviewEmailGroup(id);
      if (!existing || existing.userId !== req.session!.userId) {
        return res.status(404).json({ message: "Group not found" });
      }
      
      await storage.deleteReviewEmailGroup(id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting review email group:", error);
      res.status(500).json({ message: "Failed to delete review email group" });
    }
  });

  // Send a test email for a review group immediately (bypasses schedule)
  app.post("/api/review-email-groups/:id/test", requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const group = await storage.getReviewEmailGroup(id);
      if (!group || group.userId !== req.session!.userId) {
        return res.status(404).json({ message: "Group not found" });
      }
      // Allow caller to override the recipient for test purposes
      const { testEmail } = req.body as { testEmail?: string };
      const groupForTest = testEmail?.trim()
        ? { ...group, recipientEmail: testEmail.trim(), ccEmail: null }
        : group;
      // Fire and forget — the send can take several seconds per location
      sendScheduledReviewEmailForGroup(groupForTest, true).catch((err) => {
        console.error(`❌ Test email failed for group "${group.name}":`, err);
      });
      res.json({ success: true, message: "Test email is being sent. Check your inbox in a moment." });
    } catch (error) {
      console.error("Error sending test review email:", error);
      res.status(500).json({ message: "Failed to send test email" });
    }
  });

  // Public copy-review page — opened when clicking "Copy" in a review email.
  // No auth needed: anyone with the link can use it (link contains the data itself).
  app.get("/api/copy-review", (req, res) => {
    const rawText = (req.query.data as string) || "";
    const rawHtml = (req.query.html as string) || "";
    const decode = (s: string) => {
      try { return Buffer.from(s, "base64url").toString("utf8"); }
      catch { return Buffer.from(s, "base64").toString("utf8"); }
    };
    const text = decode(rawText);
    const richHtml = rawHtml ? decode(rawHtml) : "";
    // Embed untrusted strings into an inline <script> safely: JSON.stringify does
    // NOT escape "</script>", which would let a crafted ?data/?html param break
    // out of the script context. Escaping "<" closes that hole.
    const jsSafe = (s: string) => JSON.stringify(s).replace(/</g, "\\u003c");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    // Block this page from being framed and tighten what inline scripts can load.
    res.setHeader("X-Frame-Options", "DENY");
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Copy Reviews — BizBuddy</title>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/dompurify/3.0.6/purify.min.js"></script>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif; background: #f9fafb; display: flex; flex-direction: column; align-items: center; padding: 24px 16px; min-height: 100vh; }
    .card { background: #fff; border-radius: 12px; box-shadow: 0 2px 12px rgba(0,0,0,0.08); padding: 24px; max-width: 680px; width: 100%; }
    h1 { color: #001f3f; font-size: 20px; margin-bottom: 4px; }
    .subtitle { color: #6b7280; font-size: 14px; margin-bottom: 20px; line-height: 1.5; }
    .btn { display: flex; align-items: center; justify-content: center; gap: 8px; background: #001f3f; color: #fff; border: none; border-radius: 10px; padding: 16px 24px; font-size: 16px; font-weight: 600; cursor: pointer; width: 100%; margin-bottom: 16px; transition: background 0.15s; -webkit-tap-highlight-color: transparent; }
    .btn:hover { background: #003366; }
    .btn:active { transform: scale(0.98); }
    .btn.copied { background: #16a34a; }
    .preview { border-radius: 8px; border: 1px solid #e5e7eb; padding: 16px; max-height: 500px; overflow-y: auto; background: #fff; -webkit-overflow-scrolling: touch; }
    .preview-label { font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; color: #6b7280; font-weight: 600; margin-bottom: 8px; }
    .notice { margin-top: 16px; font-size: 12px; color: #9ca3af; text-align: center; }
    .toast { position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%) translateY(120%); background: #001f3f; color: #fff; padding: 12px 20px; border-radius: 999px; font-size: 14px; font-weight: 600; box-shadow: 0 8px 24px rgba(0,0,0,0.18); transition: transform 0.3s ease; z-index: 50; }
    .toast.show { transform: translateX(-50%) translateY(0); }
    .toast.error { background: #b91c1c; }
    @media (max-width: 480px) {
      body { padding: 12px; }
      .card { padding: 18px; border-radius: 10px; }
      h1 { font-size: 18px; }
    }
  </style>
</head>
<body>
  <div class="card">
    <h1>Review Copy</h1>
    <p class="subtitle">Tap the button below to copy these reviews, then paste them anywhere — email, Docs, notes, a text message, anywhere.</p>
    <button class="btn" id="copyBtn" type="button">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
      <span id="copyBtnLabel">Copy to Mobile / Desktop</span>
    </button>
    <div class="preview-label">Preview</div>
    <div class="preview" id="preview"></div>
    <p class="notice">Generated by BizBuddy</p>
  </div>
  <div class="toast" id="toast"></div>
  <script>
    const plainText = ${jsSafe(text)};
    const richHtml = ${jsSafe(richHtml)};

    // Sanitize the rich HTML before inserting it — the ?html param is attacker
    // controllable, so never assign it to innerHTML unsanitized.
    const safeHtml = (richHtml && window.DOMPurify)
      ? window.DOMPurify.sanitize(richHtml)
      : '';
    // Show the styled preview
    document.getElementById('preview').innerHTML = safeHtml || ('<pre style="white-space:pre-wrap;font-size:13px;color:#374151;">' + plainText.replace(/</g,'&lt;') + '</pre>');

    const btn = document.getElementById('copyBtn');
    const btnLabel = document.getElementById('copyBtnLabel');
    const toastEl = document.getElementById('toast');
    let toastTimer = null;

    function showToast(msg, isError) {
      toastEl.textContent = msg;
      toastEl.classList.toggle('error', !!isError);
      toastEl.classList.add('show');
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2400);
    }

    function markCopied() {
      btnLabel.textContent = '✓ Copied!';
      btn.classList.add('copied');
      showToast('Copied! Now paste into any app.');
      setTimeout(() => {
        btnLabel.textContent = 'Copy to Mobile / Desktop';
        btn.classList.remove('copied');
      }, 2500);
    }

    function legacyCopy(text) {
      // Last-resort copy using a temporary textarea + execCommand. Works on
      // older browsers and as a fallback when the async Clipboard API is
      // blocked. Must run inside a user gesture.
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'absolute';
      ta.style.left = '-9999px';
      ta.style.top = '0';
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, text.length);
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      return ok;
    }

    async function doCopy() {
      // Try rich clipboard first (preserves card formatting on desktop & supported mobile).
      if (safeHtml && navigator.clipboard && window.ClipboardItem) {
        try {
          await navigator.clipboard.write([new ClipboardItem({
            'text/html': new Blob([safeHtml], { type: 'text/html' }),
            'text/plain': new Blob([plainText], { type: 'text/plain' }),
          })]);
          markCopied();
          return;
        } catch (e) { /* fall through */ }
      }
      // Async plain-text clipboard.
      if (navigator.clipboard && navigator.clipboard.writeText) {
        try {
          await navigator.clipboard.writeText(plainText);
          markCopied();
          return;
        } catch (e) { /* fall through */ }
      }
      // Legacy fallback (iOS < 13.4, restrictive WebViews).
      if (legacyCopy(plainText)) {
        markCopied();
        return;
      }
      showToast("Couldn't copy — long-press the preview to copy manually.", true);
    }

    // Bind to both click and touchend so iOS treats it as a true user gesture.
    btn.addEventListener('click', doCopy);
  </script>
</body>
</html>`);
  });

  // Apple Locations routes
  app.get("/api/apple-locations", requireAuth, async (req, res) => {
    try {
      const locations = await storage.getAppleLocationsByUserId(req.session!.userId!);
      res.json(locations);
    } catch (error) {
      console.error("Error fetching Apple locations:", error);
      res.status(500).json({ message: "Failed to fetch Apple locations" });
    }
  });

  app.get("/api/apple-locations/:id", requireAuth, async (req, res) => {
    try {
      const location = await storage.getAppleLocation(req.params.id);
      if (!location || location.userId !== req.session!.userId) {
        return res.status(404).json({ message: "Location not found" });
      }
      res.json(location);
    } catch (error) {
      console.error("Error fetching Apple location:", error);
      res.status(500).json({ message: "Failed to fetch Apple location" });
    }
  });

  app.post("/api/apple-locations", requireAuth, async (req, res) => {
    try {
      const validated = insertAppleLocationSchema.parse({
        ...req.body,
        userId: req.session!.userId
      });
      const location = await storage.createAppleLocation(validated);
      res.json(location);
    } catch (error) {
      console.error("Error creating Apple location:", error);
      res.status(500).json({ message: "Failed to create Apple location" });
    }
  });

  app.put("/api/apple-locations/:id", requireAuth, async (req, res) => {
    try {
      const existing = await storage.getAppleLocation(req.params.id);
      if (!existing || existing.userId !== req.session!.userId) {
        return res.status(404).json({ message: "Location not found" });
      }
      const updateSchema = insertAppleLocationSchema.partial().omit({ userId: true });
      const validated = updateSchema.parse(req.body);
      const location = await storage.updateAppleLocation(req.params.id, validated);
      res.json(location);
    } catch (error) {
      console.error("Error updating Apple location:", error);
      res.status(500).json({ message: "Failed to update Apple location" });
    }
  });

  app.delete("/api/apple-locations/:id", requireAuth, async (req, res) => {
    try {
      const existing = await storage.getAppleLocation(req.params.id);
      if (!existing || existing.userId !== req.session!.userId) {
        return res.status(404).json({ message: "Location not found" });
      }
      await storage.deleteAppleLocation(req.params.id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting Apple location:", error);
      res.status(500).json({ message: "Failed to delete Apple location" });
    }
  });

  app.post("/api/apple-locations/bulk-update", requireAuth, async (req, res) => {
    try {
      const { ids, updates } = req.body;
      if (!ids || !Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ message: "No locations selected" });
      }
      
      // Validate updates
      const updateSchema = insertAppleLocationSchema.partial().omit({ userId: true });
      const validated = updateSchema.parse(updates);
      
      // Verify all locations belong to user
      const userLocations = await storage.getAppleLocationsByUserId(req.session!.userId!);
      const userLocationIds = new Set(userLocations.map(l => l.id));
      const validIds = ids.filter((id: string) => userLocationIds.has(id));
      
      if (validIds.length === 0) {
        return res.status(400).json({ message: "No valid locations to update" });
      }
      
      const updated = await storage.bulkUpdateAppleLocations(validIds, validated);
      res.json(updated);
    } catch (error) {
      console.error("Error bulk updating Apple locations:", error);
      res.status(500).json({ message: "Failed to bulk update Apple locations" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
