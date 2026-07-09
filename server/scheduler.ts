import cron from "node-cron";
import { db } from "./db";
import { jobs, clients, clientLocations, reviewEmailGroups, reviewEmailGroupLocations, users, locationPerformanceData, activityLog, googleConnection } from "@shared/schema";
import { and, desc, eq, inArray, isNotNull, isNull, lt, max, or, sql } from "drizzle-orm";
import type { InsertLocationPerformanceData } from "@shared/schema";
import { storage } from "./storage";
import { processJob } from "./job-processor";
import { sendEmail, type InlineImage, type EmailAttachment, type UserTokens } from "./gmail-service";
import { generateReviewsXlsx } from "./utils/review-xlsx-generator";
import { generateStarsHtml, generateLocationCopyText, generateLocationMailtoHref, generateLocationCopyHtml, generateReviewEmailHtml as generateReviewEmailHtmlTemplate } from "./utils/review-email-template";
import { classifyReviewThemes } from "./utils/review-theme-classifier";
import { classifyReviewCategories } from "./utils/review-category-classifier";
import fs from "fs";
import path from "path";

export function initializeScheduler() {
  console.log("Initializing scheduler...");
  
  // Run every minute to check for scheduled posts
  cron.schedule("* * * * *", async () => {
    try {
      // Find all scheduled posts that should be sent now (using UTC)
      const now = new Date();
      const currentHour = String(now.getUTCHours()).padStart(2, '0');
      const currentMinute = String(now.getUTCMinutes()).padStart(2, '0');
      const currentTime = `${currentHour}:${currentMinute}`;
      
      // Get today's UTC date (midnight UTC)
      const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      
      const scheduledJobs = await db.select().from(jobs).where(
        and(
          eq(jobs.isScheduled, true),
          eq(jobs.status, "scheduled")
        )
      );
      
      // Filter jobs that are due (at or past their scheduled time)
      const jobsToProcess = scheduledJobs.filter(job => {
        if (!job.scheduledDate || !job.scheduledTime) return false;
        
        const jobDate = new Date(job.scheduledDate);
        // Get the UTC date portion of the job's scheduled date
        const jobDateUTC = new Date(Date.UTC(jobDate.getUTCFullYear(), jobDate.getUTCMonth(), jobDate.getUTCDate()));
        
        const isToday = jobDateUTC.getTime() === todayStart.getTime();
        const isPastDate = jobDateUTC.getTime() < todayStart.getTime();
        
        // Parse scheduled time and current time for comparison
        const [jobHour, jobMinute] = job.scheduledTime.split(':').map(Number);
        const [currentHourNum, currentMinuteNum] = currentTime.split(':').map(Number);
        const jobMinutes = jobHour * 60 + jobMinute;
        const currentMinutes = currentHourNum * 60 + currentMinuteNum;
        
        // Process if: past date, OR today and time is at or past scheduled time
        const isDue = isPastDate || (isToday && currentMinutes >= jobMinutes);
        
        if (isDue) {
          console.log(`🔍 Job ${job.id} is DUE: scheduled ${job.scheduledTime}, current ${currentTime} (past date: ${isPastDate}, today: ${isToday})`);
        }
        
        return isDue;
      });
      
      if (jobsToProcess.length === 0) {
        if (now.getMinutes() === 0) {
          console.log(`🕐 Scheduled posts check at ${currentTime}... none to process`);
        }
        return;
      }
      
      console.log(`🚀 Processing ${jobsToProcess.length} post(s) at ${currentTime}`);
      
      // Process each scheduled job. Atomically claim the job first so that an
      // overlapping cron tick (or a second instance/replica) can't pick up the
      // same job and double-post to Google. Only the tick that wins the
      // status flip (scheduled -> running) proceeds.
      for (const job of jobsToProcess) {
        try {
          const claimed = await db.update(jobs)
            .set({ status: "running" })
            .where(and(eq(jobs.id, job.id), eq(jobs.status, "scheduled")))
            .returning({ id: jobs.id });

          if (claimed.length === 0) {
            console.log(`⏭️ Job ${job.id} already claimed by another run — skipping`);
            continue;
          }

          console.log(`📤 Processing scheduled job: ${job.id}`);
          await processJob(job.id);
        } catch (error) {
          console.error(`❌ Failed to process scheduled job ${job.id}:`, error);
        }
      }
    } catch (error) {
      console.error("❌ Error in scheduled posts check:", error);
    }
  });
  
  // Check for scheduled review emails every minute
  cron.schedule("* * * * *", async () => {
    try {
      await checkScheduledReviewEmails();
    } catch (error) {
      console.error("❌ Error in review email scheduler:", error);
    }
  });
  
  // Run weekly location sync: checks daily at 3 AM UTC but only executes the full
  // Google pull when 7+ days have passed since the last successful sync.
  cron.schedule("0 3 * * *", async () => {
    let activeUserId: string | undefined;
    try {
      const [user] = await db.select({ id: users.id, lastLocationSyncAt: users.lastLocationSyncAt })
        .from(users)
        .where(isNotNull(users.accessToken))
        .limit(1);

      activeUserId = user?.id;

      if (user?.lastLocationSyncAt) {
        const daysSinceLast = (Date.now() - user.lastLocationSyncAt.getTime()) / 86400000;
        if (daysSinceLast < 7) {
          console.log(`⏭️ [Weekly Sync] Skipping — last sync was ${daysSinceLast.toFixed(1)} days ago (next sync in ~${(7 - daysSinceLast).toFixed(1)} days)`);
          return;
        }
      }

      console.log("🔄 [Weekly Sync] Starting scheduled location sync from Google Business Profile...");
      await syncLocationsFromGoogle();
    } catch (error: any) {
      console.error("❌ [Weekly Sync] Scheduled sync failed:", error);
      const errMsg = String(error?.message || error?.response?.data?.error || error || "");
      const errStatus = error?.response?.status ?? error?.status;
      const isInvalidGrant =
        errMsg.includes("invalid_grant") ||
        error?.response?.data?.error === "invalid_grant";
      const isSuspended =
        errStatus === 403 && /(disabled|suspended|permission_denied)/i.test(errMsg);
      if (!activeUserId) {
        console.warn("[Weekly Sync] No active user resolved; skipping accountState propagation.");
        return;
      }
      try {
        if (isInvalidGrant) {
          await db.update(clients)
            .set({ accountState: "needs_reauth", updatedAt: new Date() })
            .where(eq(clients.userId, activeUserId));
          console.warn(`⚠️  [Weekly Sync] Marked clients for user ${activeUserId} as needs_reauth (invalid_grant)`);
        } else if (isSuspended) {
          await db.update(clients)
            .set({ accountState: "suspended", updatedAt: new Date() })
            .where(eq(clients.userId, activeUserId));
          console.warn(`⚠️  [Weekly Sync] Marked clients for user ${activeUserId} as suspended (Google 403)`);
        }
      } catch (markErr) {
        console.error("Failed to update accountState after scheduler failure:", markErr);
      }
    }
  });

  // Nightly GBP performance data sync at 4 AM UTC — fetches 90 days for every location
  // and upserts into DB. Over time this builds an unlimited historical archive.
  cron.schedule("0 4 * * *", async () => {
    await syncPerfData();
  });

  // Startup catch-up: if the latest performance data is more than 2 days old,
  // run the sync so the dashboard is never stale after a restart or deploy.
  // In production the OAuth token restore can take a couple of minutes, so we
  // poll every 30 s for up to 10 minutes rather than giving up after one try.
  (async () => {
    const MAX_WAIT_MS = 10 * 60 * 1000;
    const POLL_MS = 30_000;
    const started = Date.now();
    for (;;) {
      await new Promise(r => setTimeout(r, POLL_MS));
      if (Date.now() - started > MAX_WAIT_MS) {
        console.log("📊 [Perf Sync] Startup catch-up: gave up waiting for auth after 10 min");
        break;
      }
      try {
        const { googleOAuthAuth } = await import("./google-service-auth");
        if (!(await googleOAuthAuth.ensureAuthenticated())) {
          console.log("📊 [Perf Sync] Startup catch-up: no shared Google connection yet — will retry in 30 s");
          continue;
        }
        const [row] = await db.select({ latest: max(locationPerformanceData.date) }).from(locationPerformanceData);
        const latest = row?.latest ? new Date(row.latest as string) : null;
        const twoDaysAgo = new Date();
        twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
        if (!latest || latest < twoDaysAgo) {
          console.log(`📊 [Perf Sync] Startup catch-up: latest data is ${latest ? latest.toISOString().slice(0, 10) : "missing"} — running now`);
          await syncPerfData();
        } else {
          console.log(`📊 [Perf Sync] Startup catch-up: data is current (${latest.toISOString().slice(0, 10)}) — skipping`);
        }
        break;
      } catch (err) {
        console.error("❌ [Perf Sync] Startup catch-up check failed:", err);
        break;
      }
    }
  })();

  // On startup, catch any review emails that were due while the server was down
  // (e.g. a deploy restart landing exactly on a scheduled send time).
  // Wait 10 s for the DB connection and OAuth tokens to settle first.
  setTimeout(async () => {
    console.log('🔍 [Startup catch-up] Checking for review emails due/missed during restart...');
    try {
      await checkScheduledReviewEmails();
    } catch (err) {
      console.error('❌ [Startup catch-up] Review email check failed:', err);
    }
  }, 10_000);

  // Kick off a one-time geocode backfill ~30 s after boot so any rows missing
  // lat/lng (typically because GBP didn't return latlng for service-area
  // businesses or the row was created before the feature shipped) get filled
  // in by the rate-limited background worker.
  setTimeout(async () => {
    try {
      const { backfillMissingCoordinates } = await import("./utils/geocode");
      await backfillMissingCoordinates();
    } catch (err) {
      console.error("🗺️  [Startup] Geocode backfill failed:", err);
    }
  }, 30_000);

  console.log("✅ Scheduler initialized - checking every minute for scheduled posts and review emails; weekly location sync at 3 AM UTC");
}

// ---- Date-anchored scheduling helpers (Phoenix time, UTC-7 fixed, no DST) ----
const PHOENIX_OFFSET_MS = 7 * 60 * 60 * 1000;

/** Convert a Phoenix wall-clock (Y, monthIdx, day, hh, mm) to a UTC epoch ms. */
function phoenixWallToUtcMs(y: number, monthIdx: number, day: number, hh: number, mm: number): number {
  return Date.UTC(y, monthIdx, day, hh, mm, 0, 0) + PHOENIX_OFFSET_MS;
}

/** Most recent Phoenix weekday (0=Sun..6=Sat) at hh:mm that is <= nowMs. Only used as a
 *  fallback anchor for legacy groups created before startDate existed. */
function mostRecentWeekdayMs(nowMs: number, weekday: number, hh: number, mm: number): number {
  const p = new Date(nowMs - PHOENIX_OFFSET_MS);
  for (let back = 0; back < 8; back++) {
    const candUtc = phoenixWallToUtcMs(p.getUTCFullYear(), p.getUTCMonth(), p.getUTCDate() - back, hh, mm);
    const dow = new Date(candUtc - PHOENIX_OFFSET_MS).getUTCDay();
    if (dow === weekday && candUtc <= nowMs) return candUtc;
  }
  return phoenixWallToUtcMs(p.getUTCFullYear(), p.getUTCMonth(), p.getUTCDate(), hh, mm);
}

/** The k-th monthly occurrence after the start month, clamped to the month's length
 *  (e.g. a Jan 31 anchor lands on Feb 28). */
function monthlyOccurrenceMs(startY: number, startMonthIdx: number, startDay: number, k: number, hh: number, mm: number): number {
  const total = startMonthIdx + k;
  const y = startY + Math.floor(total / 12);
  const m = ((total % 12) + 12) % 12;
  const daysInMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return phoenixWallToUtcMs(y, m, Math.min(startDay, daysInMonth), hh, mm);
}

/**
 * Most recent scheduled send instant (UTC ms) at or before nowMs, anchored on the group's
 * startDate + emailTime and repeating by frequency (weekly/biweekly/monthly). Returns null
 * if the first send hasn't been reached yet — which also enforces "never send before startDate".
 */
function computeDueAtMs(group: typeof reviewEmailGroups.$inferSelect, nowMs: number): number | null {
  const [hhS, mmS] = (group.emailTime || "09:00").split(":");
  const hh = parseInt(hhS) || 0;
  const mm = parseInt(mmS) || 0;
  const frequency = group.frequency || "weekly";

  let firstSendMs: number, sy: number, smIdx: number, sd: number;
  if (group.startDate) {
    const [y, mo, d] = group.startDate.split("-").map(Number);
    sy = y; smIdx = mo - 1; sd = d;
    firstSendMs = phoenixWallToUtcMs(sy, smIdx, sd, hh, mm);
  } else {
    // Legacy group with no startDate: anchor to the configured weekday.
    firstSendMs = mostRecentWeekdayMs(nowMs, parseInt(group.emailDay) || 1, hh, mm);
    const p = new Date(firstSendMs - PHOENIX_OFFSET_MS);
    sy = p.getUTCFullYear(); smIdx = p.getUTCMonth(); sd = p.getUTCDate();
  }

  if (nowMs < firstSendMs) return null;

  if (frequency === "monthly") {
    let dueMs = firstSendMs, k = 0;
    for (;;) {
      const occ = monthlyOccurrenceMs(sy, smIdx, sd, k + 1, hh, mm);
      if (occ <= nowMs) { dueMs = occ; k++; } else break;
    }
    return dueMs;
  }

  const periodMs = (frequency === "biweekly" ? 14 : 7) * 86400000;
  const n = Math.floor((nowMs - firstSendMs) / periodMs);
  return firstSendMs + n * periodMs;
}

// Groups with a send currently running in THIS process. Prevents a slow send
// (large groups take minutes) from overlapping with its own retry tick.
const inFlightReviewEmailSends = new Set<string>();

/** Minutes to wait before retry attempt N+1 (N = attempts already made). Capped at 60. */
function retryBackoffMs(attemptsMade: number): number {
  return Math.min(attemptsMade * 10, 60) * 60_000;
}

/**
 * Hard cap on attempts per occurrence (~6.5 h of trying with the backoff above).
 * Covers any realistic transient outage; a permanent config problem (e.g. an
 * invalid recipient address) stops retrying after this instead of spamming
 * history until the next occurrence. The failed history entries carry the error.
 */
const MAX_SEND_ATTEMPTS_PER_OCCURRENCE = 10;

/**
 * Runs every minute (and once on startup). Sends any enabled group whose most recent
 * scheduled occurrence is due and hasn't been sent yet.
 *
 * Send-confirmation model:
 *  - lastSendAttemptAt is the atomic claim marker — set when an attempt STARTS.
 *  - lastEmailSentAt advances ONLY after Gmail confirms the send (or the occurrence
 *    is deliberately skipped, e.g. sheet format with zero reviews).
 *
 * So a failed or interrupted attempt (auth not restored yet after a deploy, Gmail
 * error, process killed mid-send) no longer consumes the occurrence: the group stays
 * due and is retried with backoff (10, 20, 30 … capped at 60 minutes between tries)
 * until it sends or the next occurrence supersedes it. Duplicate protection comes
 * from the optimistic claim on lastSendAttemptAt plus the in-process in-flight set.
 */
async function checkScheduledReviewEmails() {
  const now = new Date();
  const nowMs = now.getTime();

  // Get every group — including disabled ones — so we can surface *why* a group
  // isn't sending instead of silently skipping it. A group that goes quiet for a
  // week with zero log trace is exactly what let "Restaurant Crew" slip through
  // (isEnabled/recipientEmail edge cases were invisible until someone happened to
  // re-save the group in the UI).
  const everyGroup = await db.select().from(reviewEmailGroups);

  // Once an hour, log a one-line status for every group so a stuck/disabled/
  // missing-recipient group shows up in logs long before a week goes by.
  if (now.getUTCMinutes() === 0) {
    for (const g of everyGroup) {
      const due = g.isEnabled ? computeDueAtMs(g, nowMs) : null;
      const lastSent = g.lastEmailSentAt ? new Date(g.lastEmailSentAt).toISOString() : "never";
      const attemptInfo = (g.sendAttemptCount ?? 0) > 0 && due !== null && (g.lastEmailSentAt ? new Date(g.lastEmailSentAt).getTime() : 0) < due
        ? ` | ${g.sendAttemptCount} failed attempt(s), last error: ${g.lastSendError ?? "unknown"}`
        : "";
      const status = !g.isEnabled
        ? "DISABLED"
        : !g.recipientEmail
          ? "NO RECIPIENT EMAIL — will never send"
          : due === null
            ? "not due yet (before startDate/first send)"
            : (g.lastEmailSentAt ? new Date(g.lastEmailSentAt).getTime() : 0) >= due
              ? "up to date"
              : `OVERDUE — was due ${new Date(due).toISOString()}, retrying${attemptInfo}`;
      console.log(`🩺 [Review email health] "${g.name}" (${g.id}) — ${status} | last sent: ${lastSent}`);
    }
  }

  const allGroups = everyGroup.filter(g => g.isEnabled);

  for (const group of allGroups) {
    if (!group.recipientEmail) {
      console.warn(`⚠️ Skipping group "${group.name}" (${group.id}) — enabled but has no recipient email set`);
      continue;
    }

    try {
      const dueAtMs = computeDueAtMs(group, nowMs);
      if (dueAtMs === null) continue; // first send not reached yet (also covers "before startDate")

      const lastMs = group.lastEmailSentAt ? new Date(group.lastEmailSentAt).getTime() : 0;
      if (lastMs >= dueAtMs) continue; // already sent for this occurrence

      // A send for this group is still running in this process — never overlap it.
      if (inFlightReviewEmailSends.has(group.id)) continue;

      // Retry backoff: only attempts made AFTER this occurrence became due count.
      // An attempt marker older than dueAt belongs to a previous occurrence and
      // must not delay the current one.
      const attemptMs = group.lastSendAttemptAt ? new Date(group.lastSendAttemptAt).getTime() : 0;
      const attemptsThisOccurrence = attemptMs >= dueAtMs ? (group.sendAttemptCount ?? 0) : 0;

      // Too many failed attempts — stop retrying this occurrence. The failed
      // history entries and lastSendError keep the evidence visible.
      if (attemptsThisOccurrence >= MAX_SEND_ATTEMPTS_PER_OCCURRENCE) {
        console.error(`🛑 Giving up on review email for group "${group.name}" after ${attemptsThisOccurrence} failed attempts (last error: ${group.lastSendError ?? "unknown"}) — will try again at the next scheduled occurrence`);
        await db.update(reviewEmailGroups)
          .set({
            lastEmailSentAt: now, // consume the occurrence so retries stop
            lastSendError: `gave up after ${attemptsThisOccurrence} failed attempts: ${group.lastSendError ?? "unknown error"}`,
          })
          .where(and(
            eq(reviewEmailGroups.id, group.id),
            or(
              isNull(reviewEmailGroups.lastEmailSentAt),
              lt(reviewEmailGroups.lastEmailSentAt, new Date(dueAtMs))
            )
          ));
        continue;
      }

      if (attemptsThisOccurrence > 0) {
        if (nowMs < attemptMs + retryBackoffMs(attemptsThisOccurrence)) continue; // wait out the backoff
        console.log(`🔁 Retrying review email for group "${group.name}" — attempt ${attemptsThisOccurrence + 1} (last error: ${group.lastSendError ?? "unknown"})`);
      }

      // Atomic claim on the ATTEMPT marker (optimistic lock on its previous value).
      // Only one process/tick can flip lastSendAttemptAt from the value we read, so
      // concurrent ticks and replicas can't double-send. Crucially, lastEmailSentAt
      // is NOT touched here — a claim that then fails no longer eats the occurrence.
      const claimed = await db.update(reviewEmailGroups)
        .set({ lastSendAttemptAt: now, sendAttemptCount: attemptsThisOccurrence + 1 })
        .where(and(
          eq(reviewEmailGroups.id, group.id),
          or(
            isNull(reviewEmailGroups.lastEmailSentAt),
            lt(reviewEmailGroups.lastEmailSentAt, new Date(dueAtMs))
          ),
          group.lastSendAttemptAt
            ? eq(reviewEmailGroups.lastSendAttemptAt, group.lastSendAttemptAt)
            : isNull(reviewEmailGroups.lastSendAttemptAt)
        ))
        .returning({ id: reviewEmailGroups.id });

      if (claimed.length === 0) {
        console.log(`⏭️ Skipping duplicate email for group "${group.name}" — already claimed by another process`);
        continue;
      }

      console.log(`📧 Sending scheduled review email for group "${group.name}" (${group.id}) — due ${new Date(dueAtMs).toISOString()}, attempt ${attemptsThisOccurrence + 1}`);
      inFlightReviewEmailSends.add(group.id);
      // Fire and forget — do NOT await. Sending can take several minutes for large groups
      // (sequential Google API calls per location). The claim above plus the in-flight set
      // guarantee only one attempt runs at a time.
      sendScheduledReviewEmailForGroup(group)
        .then(async (result) => {
          if (result.outcome === "sent" || result.outcome === "skip") {
            // Confirmed send (or deliberate skip) — NOW the occurrence is consumed.
            await db.update(reviewEmailGroups)
              .set({
                lastEmailSentAt: new Date(),
                sendAttemptCount: 0,
                lastSendError: result.outcome === "sent" ? null : (result.detail ?? null),
              })
              .where(eq(reviewEmailGroups.id, group.id));
            if (result.outcome === "skip") {
              console.log(`⏭️ Review email for group "${group.name}" skipped this occurrence: ${result.detail}`);
            }
          } else {
            // Failed — leave lastEmailSentAt alone so the next tick retries after backoff.
            await db.update(reviewEmailGroups)
              .set({ lastSendError: result.detail ?? "unknown error" })
              .where(eq(reviewEmailGroups.id, group.id));
            console.warn(`🔁 Review email attempt ${attemptsThisOccurrence + 1} for "${group.name}" failed — will retry in ~${retryBackoffMs(attemptsThisOccurrence + 1) / 60000} min: ${result.detail}`);
          }
        })
        .catch(async (error) => {
          console.error(`❌ Uncaught error sending review email for group "${group.name}":`, error);
          try {
            await db.update(reviewEmailGroups)
              .set({ lastSendError: error instanceof Error ? error.message : String(error) })
              .where(eq(reviewEmailGroups.id, group.id));
          } catch (dbErr) {
            console.error(`❌ Also failed to record the send error for "${group.name}":`, dbErr);
          }
        })
        .finally(() => {
          inFlightReviewEmailSends.delete(group.id);
        });
    } catch (error) {
      console.error(`❌ Error checking review email schedule for group ${group.id}:`, error);
    }
  }
}

/**
 * Tokens used for sending the review emails through Gmail.
 *
 * Preferred source: the shared agency Google connection (google_connection row) —
 * it's the connection the team actively maintains, it always has the gmail.send
 * scope, and refreshed tokens are persisted back to the same row. The previous
 * behavior ("first user row with an access token", no ORDER BY) picked an
 * effectively random employee's personal token; whenever that person's token had
 * been revoked or gone stale, scheduled sends failed intermittently.
 *
 * Fallback: the most recently updated user that still has a refresh token, then
 * any user with an access token — deterministic instead of arbitrary.
 */
async function resolveGmailSendTokens(): Promise<UserTokens | null> {
  try {
    const [conn] = await db.select().from(googleConnection).where(eq(googleConnection.id, 1)).limit(1);
    if (conn?.accessToken) {
      return {
        accessToken: conn.accessToken,
        refreshToken: conn.refreshToken ?? null,
        userId: conn.connectedByUserId ?? "shared-connection",
        persistRefreshedToken: async (newAccessToken: string) => {
          await db.update(googleConnection)
            .set({ accessToken: newAccessToken, updatedAt: new Date() })
            .where(eq(googleConnection.id, 1));
        },
      };
    }
  } catch (err) {
    console.error("⚠️ Failed to load shared connection for Gmail send, falling back to user tokens:", err);
  }

  const candidates = await db.select().from(users)
    .where(isNotNull(users.accessToken))
    .orderBy(desc(users.updatedAt));
  const chosen = candidates.find(u => u.refreshToken) ?? candidates[0];
  if (!chosen?.accessToken) return null;
  return { accessToken: chosen.accessToken, refreshToken: chosen.refreshToken ?? null, userId: chosen.id };
}

export async function syncPerfData() {
  console.log("📊 [Perf Sync] Starting GBP performance data sync...");
  try {
    const { googleOAuthAuth } = await import("./google-service-auth");
    if (!(await googleOAuthAuth.ensureAuthenticated())) {
      console.log("⏭️ [Perf Sync] Skipping — no shared Google connection");
      return { success: false, reason: "not_authenticated" };
    }

    const locations = await db.select({
      id: clientLocations.id,
      gbpLocationId: clientLocations.gbpLocationId,
    })
      .from(clientLocations)
      .where(isNotNull(clientLocations.gbpLocationId));

    const endDate = new Date();
    endDate.setDate(endDate.getDate() - 1);
    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - 89);

    let successCount = 0;
    let errorCount = 0;
    let firstError: string | null = null;

    for (const location of locations) {
      try {
        const gbpId = location.gbpLocationId!;
        let locationName: string;
        if (gbpId.startsWith('accounts/')) {
          const locIdx = gbpId.indexOf('/locations/');
          locationName = locIdx !== -1 ? gbpId.slice(locIdx + 1) : `locations/${gbpId.split('/').pop()}`;
        } else if (gbpId.startsWith('locations/')) {
          locationName = gbpId;
        } else {
          locationName = `locations/${gbpId}`;
        }

        const metrics = await googleOAuthAuth.getLocationPerformanceMetrics(locationName, startDate, endDate);
        const records: InsertLocationPerformanceData[] = metrics.daily.map((d: any) => ({
          locationId: location.id,
          date: d.date,
          callClicks: d.callClicks,
          websiteClicks: d.websiteClicks,
          directionRequests: d.directionRequests,
          impressions: d.impressions,
        }));
        await storage.upsertLocationPerformanceBatch(records);
        successCount++;
        // 200ms delay to stay within Google API rate limits
        await new Promise(r => setTimeout(r, 200));
      } catch (err: any) {
        errorCount++;
        const msg = err?.message || String(err);
        if (!firstError) firstError = msg;
        if (errorCount <= 3) {
          console.error(`❌ [Perf Sync] Error for location ${location.gbpLocationId}: ${msg}`);
        }
      }
    }

    console.log(`📊 [Perf Sync] Done — ${successCount} locations synced, ${errorCount} errors${firstError ? ` (first error: ${firstError})` : ""}`);
    return { success: true, successCount, errorCount, firstError };
  } catch (error: any) {
    console.error("❌ [Perf Sync] Sync failed:", error);
    return { success: false, reason: error?.message || String(error) };
  }
}

export async function syncLocationsFromGoogle() {
  const { googleOAuthAuth } = await import("./google-service-auth");

  // Load the shared Google connection if not already in memory.
  if (!(await googleOAuthAuth.ensureAuthenticated())) {
    console.log("⚠️ [Daily Sync] No shared Google connection — skipping sync until someone connects Google.");
    return;
  }

  // Determine a user to associate synced locations with. Prefer whoever connected
  // the shared Google connection; fall back to any user with a token on record.
  const [activeUser] = await db.select().from(users).where(isNotNull(users.accessToken)).limit(1);
  const userId = activeUser?.id;
  if (!userId) {
    console.log("⚠️ [Daily Sync] Could not determine userId — skipping.");
    return;
  }

  const accounts = await googleOAuthAuth.getAccounts();
  console.log(`📊 [Daily Sync] Found ${accounts.length} accounts`);

  let newCount = 0;
  let updatedCount = 0;

  for (const account of accounts) {
    const accountId = account.name?.split('/').pop() || account.name;

    // Upsert the client/account record
    const existingClient = await storage.getClient(accountId);
    const clientData = {
      id: accountId,
      userId,
      name: account.accountName || account.name,
      accountNumber: account.accountNumber,
      type: account.type || 'PERSONAL',
    };
    if (!existingClient) {
      await storage.createClient(clientData);
    } else {
      await db.update(clients)
        .set({ name: clientData.name, accountNumber: clientData.accountNumber, type: clientData.type, updatedAt: new Date() })
        .where(eq(clients.id, accountId));
    }

  }

  // Fetch ALL locations at once using the wildcard endpoint (per-account endpoint returns 400)
  const allLocations = await googleOAuthAuth.getAllLocations();
  console.log(`📍 [Daily Sync] Fetched ${allLocations.length} total locations`);

  // Only process locations belonging to accounts we explicitly track
  const knownAccountIds = new Set(accounts.map((a: any) => a.name?.split('/').pop() || a.name));

  for (const location of allLocations) {
    const locationId = location.name?.split('/').pop() || location.name;

    // Extract account ID from location name: "accounts/12345/locations/67890" → "12345"
    const nameParts = (location.name || '').split('/');
    const accountId = nameParts.length >= 4 ? nameParts[1] : '';
    if (!accountId) continue;

    let status = 'unknown';
    const googleStatus = location.openInfo?.status?.toUpperCase();
    if (googleStatus === 'OPEN') status = 'active';
    else if (googleStatus === 'CLOSED_TEMPORARILY') status = 'temporarily_closed';
    else if (googleStatus === 'CLOSED_PERMANENTLY') status = 'permanently_closed';

    const gbpLat = location.latlng?.latitude;
    const gbpLng = location.latlng?.longitude;
    const hasGbpCoords = typeof gbpLat === 'number' && typeof gbpLng === 'number';

    // Fields safe to update regardless of ownership (never overwrite clientId on existing records)
    const updateFields: any = {
      gbpLocationId: location.name,
      name: location.title || 'Unnamed Location',
      address: location.storefrontAddress
        ? `${location.storefrontAddress.addressLines?.join(', ') || ''}, ${location.storefrontAddress.locality || ''}, ${location.storefrontAddress.administrativeArea || ''}`.trim()
        : '',
      city: location.storefrontAddress?.locality || '',
      phone: location.phoneNumbers?.primaryPhone || '',
      website: location.websiteUri || '',
      description: location.profile?.description || null,
      regularHours: location.regularHours || null,
      googleLocationId: location.name,
      zipCode: location.storefrontAddress?.postalCode || '',
      categories: Array.isArray(location.categories)
        ? location.categories.map((c: any) => c.displayName).join(', ')
        : '',
      isVerified: true,
      status,
      editPending: !!location.metadata?.hasPendingEdits,
      updatedAt: new Date(),
    };

    if (hasGbpCoords) {
      updateFields.latitude = String(gbpLat);
      updateFields.longitude = String(gbpLng);
    }

    const existing = await storage.getLocation(locationId);
    if (!existing) {
      // Only create new locations for accounts we explicitly track
      if (!knownAccountIds.has(accountId)) continue;
      await storage.createLocation({ id: locationId, clientId: accountId, ...updateFields });
      newCount++;
    } else {
      // Detect changes to core info before overwriting
      const CORE_FIELDS = ["name", "phone", "address", "website", "description"] as const;
      const infoChanges = CORE_FIELDS.flatMap((field) => {
        const oldVal = ((existing as any)[field] ?? "").toString().trim();
        const newVal = (updateFields[field] ?? "").toString().trim();
        return oldVal && newVal && oldVal !== newVal ? [{ field, old: oldVal, new: newVal }] : [];
      });
      if (infoChanges.length > 0) {
        try {
          await storage.createActivityLog({
            userId,
            clientId: existing.clientId,
            clientLocationId: locationId,
            action: "location_info_changed",
            payloadJson: { changes: infoChanges },
          });
          console.log(`📝 [Sync] Logged info change for "${existing.name}" → "${updateFields.name}" (${infoChanges.map(c => c.field).join(", ")})`);
        } catch (err) {
          console.error(`❌ [Sync] Failed to log info change for location ${locationId}:`, err);
        }
      }
      // Preserve the existing clientId — don't overwrite with an untracked account
      await storage.updateLocation(locationId, updateFields);
      updatedCount++;
    }
  }

  console.log(`✅ [Weekly Sync] Done — ${newCount} new, ${updatedCount} updated locations across ${accounts.length} accounts`);

  // Trigger background geocoding for any rows still missing lat/lng (whether
  // GBP didn't return latlng on this run or on prior syncs). The worker is
  // rate-limited to 1 lookup/second so this is safe to run on every sync.
  try {
    const { backfillMissingCoordinates, geocodeQueue } = await import("./utils/geocode");
    const enqueued = await backfillMissingCoordinates();
    if (enqueued > 0) {
      console.log(`🗺️  [Sync] Background geocoder queued ${enqueued} location(s); queue size ${geocodeQueue.size()}`);
    }
  } catch (geoErr) {
    console.error("🗺️  [Sync] Failed to enqueue geocode backfill:", geoErr);
  }

  // Record the sync timestamp so the weekly guard can calculate the next window
  await db.update(users)
    .set({ lastLocationSyncAt: new Date() })
    .where(eq(users.id, userId));

  try {
    await db.update(clients)
      .set({ accountState: "verified", updatedAt: new Date() })
      .where(and(eq(clients.userId, userId), eq(clients.accountState, "needs_reauth")));
  } catch (clearErr) {
    console.warn("[Sync] Failed to clear needs_reauth on scheduled sync:", clearErr);
  }
}

/**
 * Outcome of a scheduled send attempt. The scheduler maps this onto the group row:
 *  - "sent"  → lastEmailSentAt advances (occurrence consumed), attempt counter resets
 *  - "skip"  → occurrence deliberately consumed without an email (e.g. sheet with 0 reviews)
 *  - "retry" → occurrence stays due; retried on the next tick after backoff
 */
export type ReviewEmailSendResult = { outcome: "sent" | "skip" | "retry"; detail?: string };

export async function sendScheduledReviewEmailForGroup(group: typeof reviewEmailGroups.$inferSelect, isTest = false): Promise<ReviewEmailSendResult> {
  // History entry ids created for this attempt (one per client), so the final
  // outcome can be written onto the same rows. Declared outside the try so the
  // outer catch can still flip them to "failed".
  const sendingEntryIds = new Map<string | null, string>();
  type Bucket = { locations: (typeof clientLocations.$inferSelect)[]; reviewCount: number };
  const clientBuckets = new Map<string | null, Bucket>();

  // Recipients depend only on group config — resolve up front so history entries
  // can be written before the (slow, failure-prone) fetch/send pipeline runs.
  const toRecipients = group.recipientEmail.split(',').map(e => e.trim()).filter(Boolean).join(', ');
  const ccRecipients = group.ccEmail
    ? group.ccEmail.split(',').map((e: string) => e.trim()).filter(Boolean).join(', ')
    : undefined;

  const basePayload = (status: string, reviewCount: number | null, errorMessage: string | null, bucket: Bucket) => ({
    groupId: group.id,
    groupName: group.name,
    recipient: toRecipients,
    cc: ccRecipients ?? null,
    reviewCount,
    locationCount: bucket.locations.length,
    locationNames: bucket.locations.map((l) => l.name),
    minStars: group.minStars,
    maxStars: group.maxStars,
    lookbackDays: group.lookbackDays,
    trigger: "scheduled",
    status,
    error: errorMessage,
  });

  // Writes the final outcome onto the "sending" rows created at attempt start
  // (falling back to a fresh insert if that create failed). Each write is
  // isolated and retried once so one DB error can't wipe out the rest.
  async function finalizeHistory(status: "sent" | "failed" | "skipped", errorMessage: string | null) {
    if (isTest) return;
    for (const [clientId, bucket] of Array.from(clientBuckets.entries())) {
      const payloadJson = basePayload(status, bucket.reviewCount, errorMessage, bucket);
      const existingId = sendingEntryIds.get(clientId);
      try {
        if (existingId) {
          await storage.updateActivityLog(existingId, { payloadJson });
        } else {
          await storage.createActivityLog({ userId: group.userId, clientId: clientId ?? undefined, action: "review_email_sent", payloadJson });
        }
      } catch (logErr) {
        console.error(`❌ Failed to write activity log for review email "${group.name}" (client ${clientId}), retrying once:`, logErr);
        try {
          if (existingId) {
            await storage.updateActivityLog(existingId, { payloadJson });
          } else {
            await storage.createActivityLog({ userId: group.userId, clientId: clientId ?? undefined, action: "review_email_sent", payloadJson });
          }
        } catch (retryErr) {
          console.error(`❌ Activity log write failed again for review email "${group.name}" (client ${clientId}) — history will be missing this send:`, retryErr);
        }
      }
    }
  }

  try {
    // Get all location IDs in this group
    const groupLocations = await db.select().from(reviewEmailGroupLocations).where(
      eq(reviewEmailGroupLocations.groupId, group.id)
    );

    if (groupLocations.length === 0) {
      console.log(`📧 No locations in group "${group.name}"`);
      return { outcome: "skip", detail: "no locations configured in this group" };
    }

    const locationIds = groupLocations.map(gl => gl.locationId);

    // Get location details for the selected locations
    const locations = await db.select().from(clientLocations).where(
      inArray(clientLocations.id, locationIds)
    );

    if (locations.length === 0) {
      console.log(`📧 No valid locations in group "${group.name}"`);
      return { outcome: "skip", detail: "no valid locations in this group" };
    }

    // ── Preflight: every RETRYABLE infrastructure requirement is checked here,
    // BEFORE any history rows are written or Google is called. A failure at this
    // stage leaves the occurrence due, so it retries once tokens/connection come
    // back (e.g. the first minutes after a deploy while OAuth state restores).
    const { googleOAuthAuth } = await import("./google-service-auth");
    if (!(await googleOAuthAuth.ensureAuthenticated())) {
      console.log(`⚠️ No shared Google connection yet — review email for "${group.name}" will retry once Google is connected/restored.`);
      return { outcome: "retry", detail: "shared Google connection not available" };
    }

    const gmailTokens = await resolveGmailSendTokens();
    if (!gmailTokens) {
      console.error(`❌ Cannot send review email for group "${group.name}" — no Gmail tokens available (shared connection or user)`);
      return { outcome: "retry", detail: "no Gmail tokens available" };
    }

    // Group locations by client. clientId is NOT NULL in the schema, but fall back
    // to a null bucket defensively so a row is never silently dropped.
    for (const loc of locations) {
      const key = loc.clientId ?? null;
      const bucket = clientBuckets.get(key) ?? { locations: [], reviewCount: 0 };
      bucket.locations.push(loc);
      clientBuckets.set(key, bucket);
    }

    // ── History-first: record the attempt as "sending" BEFORE the long pipeline
    // runs. If the process dies mid-send (deploy landing during a 5-minute send),
    // the entry survives as evidence instead of the send becoming invisible. The
    // next attempt marks any such leftovers "interrupted".
    if (!isTest) {
      try {
        const staleCutoff = new Date(Date.now() - 30 * 60_000);
        const staleRows = await db.select().from(activityLog).where(and(
          eq(activityLog.action, "review_email_sent"),
          lt(activityLog.timestamp, staleCutoff),
          sql`${activityLog.payloadJson}->>'groupId' = ${group.id}`,
          sql`${activityLog.payloadJson}->>'status' = 'sending'`
        ));
        for (const row of staleRows) {
          await storage.updateActivityLog(row.id, {
            payloadJson: { ...(row.payloadJson as any), status: "interrupted", error: "Send was interrupted (server restart or crash) — retried automatically" },
          });
        }
      } catch (staleErr) {
        console.error(`⚠️ Failed to clean up stale 'sending' history for group "${group.name}":`, staleErr);
      }

      for (const [clientId, bucket] of Array.from(clientBuckets.entries())) {
        try {
          const row = await storage.createActivityLog({
            userId: group.userId,
            clientId: clientId ?? undefined,
            action: "review_email_sent",
            payloadJson: basePayload("sending", null, null, bucket),
          });
          sendingEntryIds.set(clientId, row.id);
        } catch (createErr) {
          console.error(`⚠️ Failed to create 'sending' history entry for group "${group.name}" (client ${clientId}) — will insert at completion instead:`, createErr);
        }
      }
    }

    const allReviews: any[] = [];
    const minStars = group.minStars;
    const maxStars = group.maxStars;

    // Track all locations and their review counts
    const allCheckedLocations: { name: string; address?: string; reviewCount: number }[] = [];

    // Track fetch failures — if EVERY location fails we must not send a misleading
    // "no new reviews" email; the attempt fails and is retried instead.
    let fetchErrorCount = 0;
    let firstFetchError: string | null = null;
    
    // Get reviews from the lookback period (excluding today in Phoenix time)
    const lookbackDays = group.lookbackDays || 7;
    const lookbackOffset = (group as any).lookbackOffset || 0; // days to shift window back; 0 = current period
    // Calculate midnight in Phoenix timezone (UTC-7, no DST) so the boundary
    // is consistent regardless of whether the server runs in UTC or another zone
    const PHOENIX_OFFSET_MS = 7 * 60 * 60 * 1000; // UTC-7 in ms
    const nowPhoenixMs = Date.now() - PHOENIX_OFFSET_MS;
    const midnightPhoenixMs = Math.floor(nowPhoenixMs / 86400000) * 86400000;
    const today = new Date(midnightPhoenixMs + PHOENIX_OFFSET_MS); // midnight Phoenix expressed as UTC
    // Rolling window: periodEnd is always "today" (excludes today's reviews, per the
    // comment above), periodStart is lookbackDays before that. lookbackOffset shifts
    // the whole window back further (e.g. to preview "last period" rather than current).
    // NOTE: this used to snap periodEnd to the most recent complete Mon–Sun calendar week,
    // which could push the effective cutoff several days earlier than "today" and made
    // recent reviews look like they were missing/"too old" right after they were fetched.
    // periodEnd is exclusive (reviews < periodEnd), periodStart is inclusive (reviews >= periodStart)
    const offsetMs = lookbackOffset * 86400000;
    const periodEnd = new Date(midnightPhoenixMs - offsetMs + PHOENIX_OFFSET_MS);
    const periodStart = new Date(midnightPhoenixMs - offsetMs - lookbackDays * 86400000 + PHOENIX_OFFSET_MS);
    
    for (const location of locations) {
      let matchingReviewCount = 0;
      // Diagnostic counters — log per-location star breakdown so we can verify
      // why a location appears to have "no matching reviews" even when GBP shows some.
      const starCounts: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
      const inWindowStarCounts: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
      let oldestReviewDate: Date | null = null;
      let newestReviewDate: Date | null = null;
      let totalFetched = 0;
      let droppedAsToday = 0;
      let droppedAsTooOld = 0;
      try {
        const startDateStr = periodStart.toISOString().split('T')[0];
        const reviews = await googleOAuthAuth.getReviews(location.gbpLocationId, startDateStr);
        totalFetched = reviews.length;
        
        for (const review of reviews) {
          let starRating = 0;
          if (review.starRating) {
            if (typeof review.starRating === 'string') {
              const ratingMap: any = { 'FIVE': 5, 'FOUR': 4, 'THREE': 3, 'TWO': 2, 'ONE': 1 };
              starRating = ratingMap[review.starRating.toUpperCase()] || 0;
            } else {
              starRating = Number(review.starRating) || 0;
            }
          }
          starCounts[starRating] = (starCounts[starRating] || 0) + 1;

          const reviewDate = review.createTime ? new Date(review.createTime) : null;
          if (reviewDate) {
            if (!oldestReviewDate || reviewDate < oldestReviewDate) oldestReviewDate = reviewDate;
            if (!newestReviewDate || reviewDate > newestReviewDate) newestReviewDate = reviewDate;
          }

          // Date window check (excluding today in Phoenix time)
          const inWindow = reviewDate ? (reviewDate >= periodStart && reviewDate < periodEnd) : false;
          if (reviewDate && !inWindow) {
            if (reviewDate >= today) droppedAsToday++;
            else droppedAsTooOld++;
          }
          if (inWindow) inWindowStarCounts[starRating] = (inWindowStarCounts[starRating] || 0) + 1;

          // Filter by star rating and date (excluding today)
          if (starRating >= minStars && starRating <= maxStars && inWindow) {
            matchingReviewCount++;
            allReviews.push({
              reviewer: review.reviewer?.displayName || 'Anonymous',
              starRating,
              comment: review.comment || '',
              createTime: review.createTime,
              locationName: location.name,
              locationAddress: location.address,
              gbpLocationId: location.gbpLocationId,
              reviewReply: review.reviewReply || undefined,
            });
          }
        }

        const fmt = (d: Date | null) => d ? d.toISOString() : 'n/a';
        console.log(
          `📊 [Review diag] "${location.name}" — fetched ${totalFetched} | ` +
          `stars(all): 1★${starCounts[1]||0} 2★${starCounts[2]||0} 3★${starCounts[3]||0} 4★${starCounts[4]||0} 5★${starCounts[5]||0} unrated:${starCounts[0]||0} | ` +
          `in-window: 1★${inWindowStarCounts[1]||0} 2★${inWindowStarCounts[2]||0} 3★${inWindowStarCounts[3]||0} 4★${inWindowStarCounts[4]||0} 5★${inWindowStarCounts[5]||0} | ` +
          `dropped: today=${droppedAsToday} tooOld=${droppedAsTooOld} | ` +
          `dates: oldest=${fmt(oldestReviewDate)} newest=${fmt(newestReviewDate)} | ` +
          `window: ${periodStart.toISOString()} → ${periodEnd.toISOString()} | ` +
          `matched ${minStars}-${maxStars}★: ${matchingReviewCount}`
        );
      } catch (error) {
        fetchErrorCount++;
        if (!firstFetchError) firstFetchError = error instanceof Error ? error.message : String(error);
        console.error(`❌ Error fetching reviews for location ${location.id} ("${location.name}"):`, error);
      }

      // Track this location regardless of review count
      allCheckedLocations.push({
        name: location.name,
        address: location.address || undefined,
        reviewCount: matchingReviewCount
      });
    }
    console.log(
      `📊 [Review diag] Group "${group.name}" summary: ${locations.length} location(s) checked | ` +
      `lookback: ${lookbackDays} days (offset: ${lookbackOffset}) | star filter: ${minStars}-${maxStars} | ` +
      `total matching reviews: ${allReviews.length}${fetchErrorCount > 0 ? ` | fetch errors: ${fetchErrorCount}/${locations.length}` : ""}`
    );

    // Every single location failed to fetch — almost certainly an auth/quota outage,
    // not a genuinely review-free week. Sending now would deliver a false "No New
    // Reviews" email; fail the attempt and let the backoff retry after recovery.
    if (fetchErrorCount === locations.length) {
      const detail = `review fetch failed for all ${locations.length} location(s): ${firstFetchError ?? "unknown error"}`;
      console.error(`❌ ${detail} — not sending for group "${group.name}"`);
      await finalizeHistory("failed", detail);
      return { outcome: "retry", detail };
    }

    // Theme classification — runs when API key is set and there are reviews to classify.
    // Works with or without user-defined themes (discovery-only mode if themes list is empty).
    const groupThemes: string[] = (group as any).themes || [];
    if (process.env.ANTHROPIC_API_KEY && allReviews.length > 0) {
      const reviewsForClassification = allReviews.map((r: any, i: number) => ({
        index: i,
        comment: r.comment || "",
      }));
      const themeMap = await classifyReviewThemes(reviewsForClassification, groupThemes);
      for (const [idx, themes] of Array.from(themeMap.entries())) {
        allReviews[idx].themes = themes;
      }

      // Category classification — single Shop/Donate/Other bucket per review.
      // Drives which section of the sheet each row lands in. Uncategorized → "Other".
      const categoryMap = await classifyReviewCategories(reviewsForClassification);
      for (let i = 0; i < allReviews.length; i++) {
        allReviews[i].category = categoryMap.get(i) || "Other";
      }
    }

    // Determine the app base URL for copy links.
    // Priority: explicit APP_URL env var → Replit domains → undefined (buttons hidden)
    const appBaseUrl =
      process.env.APP_URL?.trim() ||
      (process.env.REPLIT_DOMAINS?.split(',')[0]?.trim()
        ? `https://${process.env.REPLIT_DOMAINS.split(',')[0].trim()}`
        : undefined);

    const outputFormat = (group as any).outputFormat || 'email';
    const starText = minStars === maxStars ? `${minStars} star` : `${minStars}-${maxStars} stars`;

    // For sheet format, skip if no reviews (nothing to attach). This consumes the
    // occurrence deliberately AND leaves a visible "skipped" history entry so a
    // quiet week is distinguishable from a broken scheduler.
    if (outputFormat === 'sheet' && allReviews.length === 0) {
      console.log(`📊 No reviews to include in spreadsheet for group "${group.name}", skipping`);
      const detail = `no ${minStars}-${maxStars} star reviews in the period — spreadsheet not sent`;
      await finalizeHistory("skipped", detail);
      return { outcome: "skip", detail };
    }

    // Generate email HTML with all checked locations (even if no reviews)
    // Display dates match the rolling window used for fetching:
    // _endDate = last day included (periodEnd is exclusive, so subtract 1 day)
    // _startDate = first day included (periodStart)
    const _endDate = new Date(periodEnd.getTime() - 86400000);
    const _startDate = periodStart;
    const schedulerDateRange = `${_startDate.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Phoenix" })} – ${_endDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Phoenix" })}`;
    const emailHtml = generateReviewEmailHtmlTemplate(allReviews, group.name, minStars, maxStars, schedulerDateRange, allCheckedLocations, group.customMessage || undefined, appBaseUrl);

    let subjectText: string;
    if (group.customSubject?.trim()) {
      subjectText = group.customSubject.trim();
    } else if (allReviews.length === 0) {
      subjectText = `Review Summary — No New ${starText} Reviews`;
      console.log(`📧 No matching reviews for group "${group.name}", sending summary email`);
    } else {
      const allLocationNames = allReviews.map((r: any) => r.locationName).filter(Boolean) as string[];
      const uniqueLocationNames = Array.from(new Set(allLocationNames));
      
      const combinedNames: string[] = [];
      const usedIndices = new Set<number>();
      
      for (let i = 0; i < uniqueLocationNames.length; i++) {
        if (usedIndices.has(i)) continue;
        
        const name1 = uniqueLocationNames[i];
        let baseName = name1;
        
        for (let j = i + 1; j < uniqueLocationNames.length; j++) {
          if (usedIndices.has(j)) continue;
          
          const name2 = uniqueLocationNames[j];
          const words1 = name1.toLowerCase().split(/\s+/);
          const words2 = name2.toLowerCase().split(/\s+/);
          const maxWords = Math.max(words1.length, words2.length);
          
          let commonWords = 0;
          for (let k = 0; k < Math.min(words1.length, words2.length); k++) {
            if (words1[k] === words2[k]) commonWords++;
            else break;
          }
          
          if (commonWords >= maxWords * 0.8 || commonWords >= 3) {
            usedIndices.add(j);
            const originalWords = name1.split(/\s+/);
            baseName = originalWords.slice(0, commonWords).join(' ');
          }
        }
        
        usedIndices.add(i);
        combinedNames.push(baseName);
      }
      
      const locationNamesText = combinedNames.length > 0 
        ? ` - ${combinedNames.join(', ')}`
        : '';
      
      subjectText = `${allReviews.length} New Review${allReviews.length !== 1 ? 's' : ''} — ${starText}${locationNamesText}`;
    }
    
    // (toRecipients / ccRecipients are resolved at the top of this function so the
    // "sending" history entries could be written before the pipeline started.)

    // Load the logo for inline CID embedding (works without any external URL)
    const inlineImages: InlineImage[] = [];
    const prodLogoPath = path.join(process.cwd(), 'dist', 'public', 'commit-logo.png');
    const devLogoPath = path.join(process.cwd(), 'client', 'public', 'commit-logo.png');
    const logoFilePath = fs.existsSync(prodLogoPath) ? prodLogoPath : devLogoPath;
    if (fs.existsSync(logoFilePath)) {
      inlineImages.push({
        cid: 'commit-logo',
        filename: 'commit-logo.png',
        mimeType: 'image/png',
        base64Data: fs.readFileSync(logoFilePath).toString('base64'),
      });
    } else {
      console.warn('⚠️ commit-logo.png not found, email will be sent without logo');
    }

    // Build xlsx attachment if this group uses sheet format
    let xlsxAttachments: EmailAttachment[] | undefined;
    if (outputFormat === 'sheet' && allReviews.length > 0) {
      console.log(`📊 Generating spreadsheet attachment for group "${group.name}"...`);
      const breakout = ((group as any).sheetBreakout || 'region') as 'region' | 'location' | 'none';
      // Use the same Mon–Sun window as the fetch: _startDate (Monday) through _endDate (Sunday)
      const dateRange = `${_startDate.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Phoenix" })} – ${_endDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Phoenix" })}`;
      const reviewsForSheet = allReviews.map((r: any) => ({
        locationName: r.locationName || 'Unknown',
        locationAddress: r.locationAddress,
        starRating: r.starRating,
        reviewer: r.reviewer,
        reviewDate: r.createTime,
        reviewText: r.comment || '',
        responseAuthor: r.reviewReply?.comment ? (r.reviewReply?.author || 'Owner') : undefined,
        responseDate: r.reviewReply?.updateTime || undefined,
        responseText: r.reviewReply?.comment || undefined,
        themes: r.themes as string[] | undefined,
        category: r.category as "Shop" | "Donate" | "Other" | undefined,
      }));
      const xlsxBuffer = await generateReviewsXlsx(reviewsForSheet, breakout, group.name, dateRange);
      // Filename: custom sheet name (falls back to group name) + dynamic date range.
      const sheetBaseName = ((group as any).sheetName?.trim()) || group.name;
      const slug = (s: string) => s.toLowerCase().replace(/[^\w]+/g, '-').replace(/^-+|-+$/g, '');
      const filename = `${slug(sheetBaseName)}-${slug(dateRange)}.xlsx`;
      xlsxAttachments = [{
        filename,
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        data: xlsxBuffer,
      }];
    }

    // For sheet format, use a short plain-text body; otherwise use the HTML email
    const emailBody = outputFormat === 'sheet' && xlsxAttachments
      ? (group.customMessage
          ? `${group.customMessage}`
          : `Please find attached your review recap for the past ${lookbackDays} days${lookbackOffset > 0 ? ` (${lookbackOffset}–${lookbackOffset + lookbackDays} days ago)` : ''}.\n\n${allReviews.length} review${allReviews.length !== 1 ? 's' : ''} with ${starText} across ${allCheckedLocations.length} location${allCheckedLocations.length !== 1 ? 's' : ''}.`)
      : emailHtml;
    const emailIsHtml = outputFormat !== 'sheet' || !xlsxAttachments;

    // Fill in the per-client review counts now that reviews are fetched. The
    // buckets (and their "sending" history entries) were created before the
    // pipeline started; this only patches the counts used in the final write.
    const reviewCountByLocation = allReviews.reduce<Record<string, number>>((acc, r) => {
      const k = r.gbpLocationId ?? "";
      if (k) acc[k] = (acc[k] || 0) + 1;
      return acc;
    }, {});
    for (const bucket of Array.from(clientBuckets.values())) {
      bucket.reviewCount = bucket.locations.reduce(
        (sum, loc) => sum + (loc.gbpLocationId ? (reviewCountByLocation[loc.gbpLocationId] ?? 0) : 0),
        0
      );
    }

    try {
      const result = await sendEmail(
        {
          to: toRecipients,
          subject: subjectText,
          body: emailBody,
          isHtml: emailIsHtml,
          cc: ccRecipients || undefined,
          inlineImages: (!xlsxAttachments && inlineImages.length > 0) ? inlineImages : undefined,
          attachments: xlsxAttachments,
        },
        gmailTokens,
      );
      if (result.success) {
        console.log(`✅ Sent review email to ${toRecipients}${ccRecipients ? ` (cc: ${ccRecipients})` : ''} for group "${group.name}"`);
        await finalizeHistory("sent", null);
        return { outcome: "sent" };
      } else {
        console.error(`❌ Failed to send review email for group "${group.name}": ${result.error}`);
        await finalizeHistory("failed", result.error ?? "unknown send error");
        return { outcome: "retry", detail: result.error ?? "unknown send error" };
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`❌ Failed to send review email for group "${group.name}":`, error);
      await finalizeHistory("failed", msg);
      return { outcome: "retry", detail: msg };
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`❌ Error sending scheduled review email for group "${group.name}":`, error);
    // Flip any "sending" entries to failed so the attempt stays visible, then let
    // the scheduler retry — an unexpected exception must never eat the occurrence.
    try {
      await finalizeHistory("failed", msg);
    } catch (histErr) {
      console.error(`❌ Also failed to finalize history after error for group "${group.name}":`, histErr);
    }
    return { outcome: "retry", detail: msg };
  }
}

