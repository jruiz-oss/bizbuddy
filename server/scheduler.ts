import cron from "node-cron";
import cronParser from "cron-parser";
import { db } from "./db";
import { jobs, clients, clientLocations, reviewEmailGroups, reviewEmailGroupLocations, users, locationPerformanceData } from "@shared/schema";
import { and, eq, inArray, isNotNull, isNull, lt, max, or } from "drizzle-orm";
import type { InsertLocationPerformanceData } from "@shared/schema";
import { storage } from "./storage";
import { processJob } from "./job-processor";
import { sendEmail, type InlineImage, type EmailAttachment } from "./gmail-service";
import { generateReviewsXlsx } from "./utils/review-xlsx-generator";
import { generateStarsHtml, generateLocationCopyText, generateLocationMailtoHref, generateLocationCopyHtml, generateReviewEmailHtml as generateReviewEmailHtmlTemplate } from "./utils/review-email-template";
import { classifyReviewThemes } from "./utils/review-theme-classifier";
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
        eq(jobs.isScheduled, true) &&
        eq(jobs.status, "scheduled")
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
      
      // Process each scheduled job
      for (const job of jobsToProcess) {
        try {
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
        if (!googleOAuthAuth.isAuthenticated()) {
          console.log("📊 [Perf Sync] Startup catch-up: not yet authenticated — will retry in 30 s");
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
    console.log('🔍 [Startup catch-up] Checking for review emails missed during restart (15-min window)...');
    try {
      await checkScheduledReviewEmails(15 * 60 * 1000);
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

async function checkScheduledReviewEmails(lookbackMs = 60_000) {
  const now = new Date();
  
  // Get all enabled email groups
  const allGroups = await db.select().from(reviewEmailGroups).where(
    eq(reviewEmailGroups.isEnabled, true)
  );
  
  for (const group of allGroups) {
    if (!group.recipientEmail) continue;
    
    try {
      // Build cron expression from group settings (emailDay and emailTime).
      // All three frequencies (weekly, biweekly, monthly) use the same weekly cron —
      // extra guards below filter out off-weeks and off-months.
      const [hour, minute] = group.emailTime.split(':');
      const cronExpression = `${parseInt(minute)} ${parseInt(hour)} * * ${group.emailDay}`;
      
      // Parse the cron expression to check if it matches current time
      const interval = cronParser.CronExpressionParser.parse(cronExpression, {
        currentDate: now,
        tz: 'America/Phoenix'
      });
      
      const prevDate = interval.prev().toDate();
      const timeDiff = Math.abs(now.getTime() - prevDate.getTime());
      
      // If within the lookback window (60 s normally; wider on startup catch-up), send
      if (timeDiff < lookbackMs) {
        const frequency = group.frequency || 'weekly';

        // Start date guard: skip if today (Phoenix) is before the configured start date
        if (group.startDate) {
          const PHOENIX_OFFSET_MS = 7 * 60 * 60 * 1000;
          const phoenixDate = new Date(now.getTime() - PHOENIX_OFFSET_MS);
          const todayPhoenix = phoenixDate.toISOString().split('T')[0]; // YYYY-MM-DD
          if (todayPhoenix < group.startDate) {
            console.log(`⏭️ Skipping email for "${group.name}" — start date ${group.startDate} has not been reached yet (today: ${todayPhoenix})`);
            continue;
          }
        }

        // Bi-weekly: skip if we're within 8 days of the last send (or of startDate for
        // brand-new groups where lastEmailSentAt hasn't been recorded yet).
        if (frequency === 'biweekly') {
          const anchor = group.lastEmailSentAt
            ?? (group.startDate ? new Date(group.startDate + 'T12:00:00') : null);
          if (anchor) {
            const daysSinceLast = (now.getTime() - new Date(anchor).getTime()) / 86400000;
            if (daysSinceLast >= 0 && daysSinceLast < 8) {
              console.log(`⏭️ Skipping biweekly email for "${group.name}" — last anchor ${daysSinceLast.toFixed(1)} days ago (off week)`);
              continue;
            }
          }
        }

        // Monthly: only fire on the first occurrence of the weekday in the month
        // i.e. when the Phoenix day-of-month is ≤ 7
        if (frequency === 'monthly') {
          const PHOENIX_OFFSET_MS = 7 * 60 * 60 * 1000;
          const phoenixDate = new Date(now.getTime() - PHOENIX_OFFSET_MS);
          const dayOfMonth = phoenixDate.getUTCDate();
          if (dayOfMonth > 7) {
            console.log(`⏭️ Skipping monthly email for "${group.name}" — day ${dayOfMonth} is not the first occurrence of this weekday`);
            continue;
          }
        }
        // Atomic claim: only the first process/instance to win this UPDATE will send.
        // Any concurrent process will get 0 rows back and skip.
        // The dedupe window matches the lookback so catch-up runs don't double-send.
        const dedupeWindow = new Date(now.getTime() - lookbackMs);
        const claimed = await db.update(reviewEmailGroups)
          .set({ lastEmailSentAt: now })
          .where(and(
            eq(reviewEmailGroups.id, group.id),
            or(
              isNull(reviewEmailGroups.lastEmailSentAt),
              lt(reviewEmailGroups.lastEmailSentAt, dedupeWindow)
            )
          ))
          .returning({ id: reviewEmailGroups.id });

        if (claimed.length === 0) {
          console.log(`⏭️ Skipping duplicate email for group "${group.name}" — already claimed by another process`);
          continue;
        }

        console.log(`📧 Sending scheduled review email for group "${group.name}" (${group.id})`);
        // Fire and forget — do NOT await. Sending can take several minutes for large groups
        // (sequential Google API calls per location). Awaiting would block all future cron ticks.
        // The atomic claim above already guarantees only one send per scheduled window.
        sendScheduledReviewEmailForGroup(group).catch((error) => {
          console.error(`❌ Uncaught error sending review email for group "${group.name}":`, error);
        });
      }
    } catch (error) {
      console.error(`❌ Error checking review email schedule for group ${group.id}:`, error);
    }
  }
}

export async function syncPerfData() {
  console.log("📊 [Perf Sync] Starting GBP performance data sync...");
  try {
    const { googleOAuthAuth } = await import("./google-service-auth");
    if (!googleOAuthAuth.isAuthenticated()) {
      console.log("⏭️ [Perf Sync] Skipping — not authenticated");
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

  // Restore tokens from DB if not currently authenticated
  if (!googleOAuthAuth.isAuthenticated()) {
    const [user] = await db.select().from(users).where(isNotNull(users.accessToken)).limit(1);
    if (user?.accessToken) {
      await googleOAuthAuth.restoreTokens(user.accessToken, user.refreshToken);
    } else {
      console.log("⚠️ [Daily Sync] No stored tokens — skipping sync until user logs in.");
      return;
    }
  }

  if (!googleOAuthAuth.isAuthenticated()) {
    console.log("⚠️ [Daily Sync] Still not authenticated after token restore — skipping.");
    return;
  }

  // Find the user whose tokens we just loaded so we can associate locations to them
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

export async function sendScheduledReviewEmailForGroup(group: typeof reviewEmailGroups.$inferSelect, isTest = false) {
  try {
    // Get all location IDs in this group
    const groupLocations = await db.select().from(reviewEmailGroupLocations).where(
      eq(reviewEmailGroupLocations.groupId, group.id)
    );
    
    if (groupLocations.length === 0) {
      console.log(`📧 No locations in group "${group.name}"`);
      return;
    }
    
    const locationIds = groupLocations.map(gl => gl.locationId);
    
    // Get location details for the selected locations
    const locations = await db.select().from(clientLocations).where(
      inArray(clientLocations.id, locationIds)
    );
    
    if (locations.length === 0) {
      console.log(`📧 No valid locations in group "${group.name}"`);
      return;
    }
    
    // Fetch reviews for each location
    const { googleOAuthAuth } = await import("./google-service-auth");

    // Always load the active user upfront — we need their tokens both for GBP
    // API calls (via googleOAuthAuth) and for sending email via Gmail OAuth.
    const [activeUser] = await db.select().from(users).where(
      isNotNull(users.accessToken)
    ).limit(1);

    // Auto-restore tokens from database if not authenticated
    if (!googleOAuthAuth.isAuthenticated()) {
      console.log("🔄 Not authenticated, attempting to restore tokens from database...");
      try {
        if (activeUser?.accessToken) {
          await googleOAuthAuth.restoreTokens(activeUser.accessToken, activeUser.refreshToken);
          console.log(`✅ Tokens restored from database for user: ${activeUser.email}`);
        } else {
          console.log("⚠️ No stored tokens found in database - user needs to log in");
          return;
        }
      } catch (restoreError) {
        console.error("❌ Failed to restore tokens:", restoreError);
        return;
      }
    }

    if (!googleOAuthAuth.isAuthenticated()) {
      console.log("⚠️ Still not authenticated after token restore attempt");
      return;
    }
    
    const allReviews: any[] = [];
    const minStars = group.minStars;
    const maxStars = group.maxStars;
    
    // Track all locations and their review counts
    const allCheckedLocations: { name: string; address?: string; reviewCount: number }[] = [];
    
    // Get reviews from the lookback period (excluding today in Phoenix time)
    const lookbackDays = group.lookbackDays || 7;
    const lookbackOffset = (group as any).lookbackOffset || 0; // days to shift window back; 0 = current period
    // Calculate midnight in Phoenix timezone (UTC-7, no DST) so the boundary
    // is consistent regardless of whether the server runs in UTC or another zone
    const PHOENIX_OFFSET_MS = 7 * 60 * 60 * 1000; // UTC-7 in ms
    const nowPhoenixMs = Date.now() - PHOENIX_OFFSET_MS;
    const midnightPhoenixMs = Math.floor(nowPhoenixMs / 86400000) * 86400000;
    const today = new Date(midnightPhoenixMs + PHOENIX_OFFSET_MS); // midnight Phoenix expressed as UTC
    // periodEnd shifts back by offset (0 = today, N = N days ago)
    const periodEnd = new Date(today.getTime() - lookbackOffset * 24 * 60 * 60 * 1000);
    const periodStart = new Date(periodEnd.getTime() - lookbackDays * 24 * 60 * 60 * 1000);
    
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
          `window: ${periodStart.toISOString()} → ${today.toISOString()} | ` +
          `matched ${minStars}-${maxStars}★: ${matchingReviewCount}`
        );
      } catch (error) {
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
      `total matching reviews: ${allReviews.length}`
    );

    // Theme classification — only runs when group has themes configured and reviews exist
    const groupThemes: string[] = (group as any).themes || [];
    if (groupThemes.length > 0 && allReviews.length > 0) {
      const reviewsForClassification = allReviews.map((r: any, i: number) => ({
        index: i,
        comment: r.comment || "",
      }));
      const themeMap = await classifyReviewThemes(reviewsForClassification, groupThemes);
      for (const [idx, themes] of Array.from(themeMap.entries())) {
        allReviews[idx].themes = themes;
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

    // For sheet format, skip if no reviews (nothing to attach)
    if (outputFormat === 'sheet' && allReviews.length === 0) {
      console.log(`📊 No reviews to include in spreadsheet for group "${group.name}", skipping`);
      return;
    }

    // Generate email HTML with all checked locations (even if no reviews)
    const _midnightTodayPhoenixMs = Math.floor((Date.now() - PHOENIX_OFFSET_MS) / 86400000) * 86400000;
    // Shift end date back by offset: if offset=0, end is yesterday; if offset=7, end is 7 days ago
    const _endDate = new Date((_midnightTodayPhoenixMs - (lookbackOffset + 1) * 86400000) + PHOENIX_OFFSET_MS);
    const _startDate = new Date((_midnightTodayPhoenixMs - (lookbackOffset + lookbackDays) * 86400000) + PHOENIX_OFFSET_MS);
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
    
    // Build a single comma-separated To: string so CC recipients only get one copy
    // regardless of how many primary recipients are listed
    const toRecipients = group.recipientEmail.split(',').map(e => e.trim()).filter(Boolean).join(', ');
    const ccRecipients = group.ccEmail
      ? group.ccEmail.split(',').map((e: string) => e.trim()).filter(Boolean).join(', ')
      : undefined;

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

    if (!activeUser?.accessToken) {
      console.error(`❌ Cannot send review email for group "${group.name}" — no user tokens available`);
      return;
    }

    // Build xlsx attachment if this group uses sheet format
    let xlsxAttachments: EmailAttachment[] | undefined;
    if (outputFormat === 'sheet' && allReviews.length > 0) {
      console.log(`📊 Generating spreadsheet attachment for group "${group.name}"...`);
      const breakout = ((group as any).sheetBreakout || 'region') as 'region' | 'location' | 'none';
      const nowDate = new Date();
      const rangeEnd = new Date(nowDate);
      rangeEnd.setDate(rangeEnd.getDate() - lookbackOffset);
      const rangeStart = new Date(rangeEnd);
      rangeStart.setDate(rangeStart.getDate() - lookbackDays);
      const dateRange = `${rangeStart.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${rangeEnd.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
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
        {
          accessToken: activeUser.accessToken,
          refreshToken: activeUser.refreshToken ?? null,
          userId: activeUser.id,
        },
      );
      if (result.success) {
        console.log(`✅ Sent review email to ${toRecipients}${ccRecipients ? ` (cc: ${ccRecipients})` : ''} for group "${group.name}"`);

        // Log one activity entry per distinct client involved in this group, so
        // the email shows up in each client's activity log.
        try {
          const reviewCountByLocation = allReviews.reduce<Record<string, number>>((acc, r) => {
            const k = r.gbpLocationId ?? "";
            if (k) acc[k] = (acc[k] || 0) + 1;
            return acc;
          }, {});
          const clientBuckets = new Map<string, { locations: typeof locations; reviewCount: number }>();
          for (const loc of locations) {
            if (!loc.clientId) continue;
            const bucket = clientBuckets.get(loc.clientId) ?? { locations: [], reviewCount: 0 };
            bucket.locations.push(loc);
            bucket.reviewCount += loc.gbpLocationId ? (reviewCountByLocation[loc.gbpLocationId] ?? 0) : 0;
            clientBuckets.set(loc.clientId, bucket);
          }
          if (!isTest) {
            for (const [clientId, bucket] of clientBuckets.entries()) {
              await storage.createActivityLog({
                userId: group.userId,
                clientId,
                action: "review_email_sent",
                payloadJson: {
                  groupId: group.id,
                  groupName: group.name,
                  recipient: toRecipients,
                  cc: ccRecipients ?? null,
                  reviewCount: bucket.reviewCount,
                  locationCount: bucket.locations.length,
                  locationNames: bucket.locations.map((l) => l.name),
                  minStars: group.minStars,
                  maxStars: group.maxStars,
                  lookbackDays: group.lookbackDays,
                  trigger: "scheduled",
                },
              });
            }
          }
        } catch (logErr) {
          console.error(`❌ Failed to write activity log for review email "${group.name}":`, logErr);
        }
      } else {
        console.error(`❌ Failed to send review email for group "${group.name}": ${result.error}`);
      }
    } catch (error) {
      console.error(`❌ Failed to send review email for group "${group.name}":`, error);
    }
  } catch (error) {
    console.error(`❌ Error sending scheduled review email for group:`, error);
  }
}

