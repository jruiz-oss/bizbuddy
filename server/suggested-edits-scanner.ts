// Suggested-edits scanner.
//
// A scan checks every (non-hidden) location against Google's "suggested updates"
// API. With 150+ locations and a low per-minute GBP quota this takes minutes.
//
// It used to run *inside* the SSE request handler, with results returned only in
// the final SSE event and held in React state. That made the run invisible: leave
// the page and the results were gone, with no record the scan ever happened and
// no way to tell "still running" from "died" from "found nothing".
//
// Now: a suggested_edit_scans row is created before the first Google call, the
// scan runs detached from any HTTP request, progress is persisted after every
// batch, and results are saved on completion. Clients subscribe to progress via
// SSE or poll the row — either way the truth lives in the database, not in a
// browser tab.
import { EventEmitter } from "events";
import { db } from "./db";
import { storage } from "./storage";
import { clientLocations, suggestedEditScans } from "@shared/schema";
import { eq, inArray, desc, and, lt } from "drizzle-orm";

export type ScanStatus =
  | "running"
  | "success"
  | "partial"
  | "failed"
  | "cancelled"
  | "interrupted";

export interface ScanResult {
  locationId: string;
  locationName: string;
  locationAddress: string | null;
  gbpLocationName: string;
  hasUpdates: boolean;
  originalLocation: any;
  suggestedLocation: any;
  diffMask: string;
}

export interface ScanProgress {
  scanId: string;
  status: ScanStatus;
  totalLocations: number;
  scannedCount: number;
  withUpdatesCount: number;
  erroredCount: number;
  firstError: string | null;
  percent: number;
  startedAt: string;
  completedAt: string | null;
  startedByName: string | null;
  /** What the run covered, so "Run again" can repeat the same scope. */
  scope: { folderIds: string[]; locationIds: string[] };
}

// Progress fan-out to any connected SSE clients. Purely an optimisation — every
// value emitted here is also written to the scan row, so a client that missed
// the event (or wasn't connected) gets the same answer by polling.
export const scanProgressEmitter = new EventEmitter();
scanProgressEmitter.setMaxListeners(50);

// Scans the current process is actively running, so we can (a) refuse to start a
// second concurrent scan and (b) honour cancellation without a DB round-trip in
// the loop.
const activeScans = new Map<string, { cancelled: boolean }>();

// A "running" row whose heartbeat is older than this belongs to a dead process.
//
// Generous on purpose: the heartbeat only advances between batches, and a single
// batch can legitimately stall for minutes when withQuotaRetry backs off through
// its full 3/6/12/24/48s ladder on two sequential Google calls. Declaring a live
// scan dead is far worse than noticing a dead one late — restarts (the common
// case) are caught immediately at boot via ignoreHeartbeat, not by this window.
const STALE_HEARTBEAT_MS = 8 * 60 * 1000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isQuotaExceededError(error: any): boolean {
  const msg = String(error?.message || error || "");
  return (
    msg.includes("Quota exceeded") ||
    msg.includes("RESOURCE_EXHAUSTED") ||
    error?.code === 429 ||
    error?.status === 429
  );
}

// The GBP Business Information API's per-minute quota is shared across every
// location. A transient 429 is not a real per-location failure — back off and
// retry rather than marking the location errored.
async function withQuotaRetry<T>(
  fn: () => Promise<T>,
  options?: { maxRetries?: number; baseDelayMs?: number },
): Promise<T> {
  const maxRetries = options?.maxRetries ?? 4;
  const baseDelayMs = options?.baseDelayMs ?? 3000;
  let lastError: any;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!isQuotaExceededError(error) || attempt === maxRetries) throw error;
      const delay = baseDelayMs * Math.pow(2, attempt);
      console.warn(
        `⏳ Quota exceeded, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`,
      );
      await sleep(delay);
    }
  }
  throw lastError;
}

export function toProgress(row: typeof suggestedEditScans.$inferSelect): ScanProgress {
  const total = row.totalLocations ?? 0;
  return {
    scanId: row.id,
    status: row.status as ScanStatus,
    totalLocations: total,
    scannedCount: row.scannedCount ?? 0,
    withUpdatesCount: row.withUpdatesCount ?? 0,
    erroredCount: row.erroredCount ?? 0,
    firstError: row.firstError ?? null,
    percent: total > 0 ? Math.round(((row.scannedCount ?? 0) / total) * 100) : 0,
    startedAt: (row.startedAt ?? new Date()).toISOString(),
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    startedByName: row.startedByName ?? null,
    scope: {
      folderIds: (row.scope as any)?.folderIds ?? [],
      locationIds: (row.scope as any)?.locationIds ?? [],
    },
  };
}

export function isTerminalStatus(status: string): boolean {
  return status !== "running";
}

// ── Queries ──────────────────────────────────────────────────────────────────

export async function getScan(scanId: string) {
  const [row] = await db
    .select()
    .from(suggestedEditScans)
    .where(eq(suggestedEditScans.id, scanId))
    .limit(1);
  return row ?? null;
}

/** The scan that is currently running, if any. */
export async function getRunningScan() {
  const [row] = await db
    .select()
    .from(suggestedEditScans)
    .where(eq(suggestedEditScans.status, "running"))
    .orderBy(desc(suggestedEditScans.startedAt))
    .limit(1);
  return row ?? null;
}

/** Most recent scan regardless of status — what the page shows on load. */
export async function getLatestScan() {
  const [row] = await db
    .select()
    .from(suggestedEditScans)
    .orderBy(desc(suggestedEditScans.startedAt))
    .limit(1);
  return row ?? null;
}

/**
 * Drop a field the user has accepted or rejected from the stored scan results.
 *
 * The scan row is now the source of truth for what's pending, and the client
 * re-reads it on focus, on reload, and while polling. Without this the UI would
 * optimistically hide an accepted edit and then have it reappear on the next
 * refresh, because the persisted results still listed it.
 *
 * Removes the location entirely once it has no actionable fields left.
 */
export async function removeResolvedFieldFromScans(gbpLocationName: string, field: string) {
  const [row] = await db
    .select()
    .from(suggestedEditScans)
    .orderBy(desc(suggestedEditScans.startedAt))
    .limit(1);
  if (!row || !Array.isArray(row.results) || row.results.length === 0) return;

  const results = row.results as ScanResult[];
  let changed = false;

  const next = results.reduce<ScanResult[]>((acc, result) => {
    if (result.gbpLocationName !== gbpLocationName) {
      acc.push(result);
      return acc;
    }
    const remaining = (result.diffMask || "")
      .split(",")
      .map((f) => f.trim())
      .filter((f) => f && f !== field && f !== "metadata");

    changed = true;
    if (remaining.length === 0) return acc; // nothing left to act on
    acc.push({ ...result, diffMask: remaining.join(",") });
    return acc;
  }, []);

  if (!changed) return;

  await db
    .update(suggestedEditScans)
    .set({ results: next, withUpdatesCount: next.length })
    .where(eq(suggestedEditScans.id, row.id));
}

// ── Lifecycle ────────────────────────────────────────────────────────────────

/**
 * Mark scans left in "running" by a dead process as interrupted.
 *
 * Railway restarts the server on every deploy. Previously a deploy landing
 * mid-scan just silently killed it. Now the run is flagged so the UI can say
 * "this scan was interrupted — run it again" instead of showing a spinner
 * forever or pretending nothing happened.
 */
export async function markInterruptedScans(
  reason = "Server restarted while the scan was running.",
) {
  // Always heartbeat-based, never "this process has no record of it". During a
  // rolling deploy a fresh instance briefly coexists with the old one, and the
  // old one may still be scanning — a process-local check would declare that
  // live scan dead. A stale heartbeat is the only safe evidence of death.
  const cutoff = new Date(Date.now() - STALE_HEARTBEAT_MS);
  const orphaned = await db
    .select({ id: suggestedEditScans.id })
    .from(suggestedEditScans)
    .where(
      and(
        eq(suggestedEditScans.status, "running"),
        lt(suggestedEditScans.heartbeatAt, cutoff),
      ),
    );

  const stale = orphaned.filter((r) => !activeScans.has(r.id));
  if (stale.length === 0) return 0;

  for (const { id } of stale) {
    await db
      .update(suggestedEditScans)
      .set({ status: "interrupted", firstError: reason, completedAt: new Date() })
      .where(and(eq(suggestedEditScans.id, id), eq(suggestedEditScans.status, "running")));
    const row = await getScan(id);
    if (row) scanProgressEmitter.emit(`scan:${id}`, toProgress(row));
  }
  console.warn(`⚠️ Marked ${stale.length} orphaned suggested-edit scan(s) as interrupted`);
  return stale.length;
}

/**
 * Create a scan row and start the scan detached from the caller's request.
 * Returns immediately with the new row. Throws if a scan is already running.
 */
export async function startScan(opts: {
  folderIds: string[];
  locationIds: string[];
  localUserId?: string | null;
  startedByName?: string | null;
}) {
  const existing = await getRunningScan();
  if (existing) {
    // Only block if it's genuinely alive — a stale row means a dead process.
    const fresh = Date.now() - new Date(existing.heartbeatAt).getTime() < STALE_HEARTBEAT_MS;
    if (fresh || activeScans.has(existing.id)) {
      const err: any = new Error("A scan is already running.");
      err.code = "SCAN_IN_PROGRESS";
      err.scanId = existing.id;
      throw err;
    }
    await markInterruptedScans("A newer scan was started while this one was stalled.");
  }

  let row: typeof suggestedEditScans.$inferSelect;
  try {
    [row] = await db
      .insert(suggestedEditScans)
      .values({
        status: "running",
        scope: { folderIds: opts.folderIds, locationIds: opts.locationIds },
        startedByLocalUserId: opts.localUserId ?? null,
        startedByName: opts.startedByName ?? null,
      })
      .returning();
  } catch (error: any) {
    // The partial unique index on status='running' rejected it — two requests
    // raced past the check above. Point the caller at the run that won.
    const running = await getRunningScan();
    if (running) {
      const err: any = new Error("A scan is already running.");
      err.code = "SCAN_IN_PROGRESS";
      err.scanId = running.id;
      throw err;
    }
    throw error;
  }

  activeScans.set(row.id, { cancelled: false });

  // Detached on purpose: the scan must outlive the HTTP request that started it.
  runScan(row.id, opts.folderIds, opts.locationIds).catch((err) => {
    console.error(`❌ Suggested-edit scan ${row.id} crashed:`, err);
  });

  return row;
}

export async function cancelScan(scanId: string) {
  const handle = activeScans.get(scanId);
  if (handle) handle.cancelled = true;
  await db
    .update(suggestedEditScans)
    .set({ status: "cancelled", completedAt: new Date(), heartbeatAt: new Date() })
    .where(and(eq(suggestedEditScans.id, scanId), eq(suggestedEditScans.status, "running")));
  const row = await getScan(scanId);
  if (row) scanProgressEmitter.emit(`scan:${scanId}`, toProgress(row));
  return row;
}

// ── The scan itself ──────────────────────────────────────────────────────────

async function resolveLocations(folderIds: string[], locationIds: string[]) {
  let locations: (typeof clientLocations.$inferSelect)[] = [];

  if (folderIds.length > 0) {
    const folderLocationIds = new Set<string>();
    for (const folderId of folderIds) {
      const folderLocs = await storage.getLocationsByFolderId(folderId);
      folderLocs.forEach((loc: any) => folderLocationIds.add(loc.id));
    }
    if (folderLocationIds.size > 0) {
      locations = await db
        .select()
        .from(clientLocations)
        .where(inArray(clientLocations.id, Array.from(folderLocationIds)));
    }
  }

  if (locationIds.length > 0) {
    const specific = await db
      .select()
      .from(clientLocations)
      .where(inArray(clientLocations.id, locationIds));
    const seen = new Set(locations.map((l) => l.id));
    for (const loc of specific) {
      if (!seen.has(loc.id)) locations.push(loc);
    }
  }

  if (folderIds.length === 0 && locationIds.length === 0) {
    locations = await db.select().from(clientLocations);
  }

  // Hidden locations never surface in suggested edits.
  return locations.filter((loc) => !loc.hidden);
}

// Never meaningful as a "suggestion": GPS coordinate jitter and auto-derived codes.
const NON_ACTIONABLE_FIELDS = new Set(["latlng", "plusCode", "plus_code"]);

function stripNonActionable(obj: any) {
  if (!obj || typeof obj !== "object") return obj;
  const copy = { ...obj };
  delete copy.latlng;
  delete copy.plusCode;
  delete copy.plus_code;
  return copy;
}

async function checkLocation(
  location: typeof clientLocations.$inferSelect,
  googleOAuthAuth: any,
): Promise<ScanResult | { __error: true; message: string } | null> {
  try {
    let locationName = location.gbpLocationId;
    if (!locationName.startsWith("locations/")) {
      locationName = `locations/${locationName}`;
    }

    const checkResult = await withQuotaRetry(() =>
      googleOAuthAuth.checkForGoogleUpdates(locationName),
    );
    if (!checkResult.hasUpdates) return null;

    try {
      const suggestedUpdate = await withQuotaRetry(() =>
        googleOAuthAuth.getGoogleUpdatedLocation(locationName),
      );
      const originalLoc = checkResult.location || {};
      const suggestedLoc = suggestedUpdate?.location || {};
      let diffMask: string = suggestedUpdate?.diffMask || "";

      diffMask = diffMask
        .split(",")
        .map((f: string) => f.trim())
        .filter((f: string) => f && !NON_ACTIONABLE_FIELDS.has(f))
        .join(",");

      // If Google gave us nothing useful in diffMask, compute it by comparison.
      const nonMetaFields = diffMask
        .split(",")
        .map((f: string) => f.trim())
        .filter((f: string) => f && f !== "metadata");

      if (nonMetaFields.length === 0 && Object.keys(suggestedLoc).length > 0) {
        const comparableFields = [
          "title",
          "storefrontAddress",
          "phoneNumbers",
          "websiteUri",
          "regularHours",
          "profile",
          "categories",
          "openInfo",
        ];
        const computedFields: string[] = [];
        for (const field of comparableFields) {
          let suggestedVal = (suggestedLoc as any)[field];
          // Absent from the suggestion means "not included in this partial
          // response", not "Google wants this cleared".
          if (suggestedVal === undefined || suggestedVal === null) continue;
          let origValRaw = (originalLoc as any)[field] ?? null;
          if (field === "storefrontAddress") {
            origValRaw = stripNonActionable(origValRaw);
            suggestedVal = stripNonActionable(suggestedVal);
          }
          if (JSON.stringify(origValRaw) !== JSON.stringify(suggestedVal)) {
            computedFields.push(field);
          }
        }
        if (computedFields.length === 0) return null;
        diffMask = computedFields.join(",");
      }

      const finalFields = diffMask
        .split(",")
        .map((f: string) => f.trim())
        .filter((f: string) => f && f !== "metadata");
      if (finalFields.length === 0) return null;

      return {
        locationId: location.id,
        locationName: location.name,
        locationAddress: location.address,
        gbpLocationName: locationName,
        hasUpdates: true,
        originalLocation: originalLoc,
        suggestedLocation: suggestedLoc,
        diffMask,
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
        diffMask: "metadata",
      };
    }
  } catch (error: any) {
    const message = error?.message || String(error);
    console.error(`❌ Error checking location ${location.gbpLocationId}:`, message);
    return { __error: true, message };
  }
}

async function finish(
  scanId: string,
  status: ScanStatus,
  fields: Partial<typeof suggestedEditScans.$inferInsert>,
) {
  // Only a *running* scan may be finished. Without this guard the loop can
  // overwrite a terminal status somebody else already set: press Stop while the
  // final batch is in flight and cancelScan writes "cancelled", then the loop
  // falls through and writes "success" over it — reporting a completed scan the
  // user explicitly stopped. Same for a row the sweep marked "interrupted".
  await db
    .update(suggestedEditScans)
    .set({ ...fields, status, completedAt: new Date(), heartbeatAt: new Date() })
    .where(and(eq(suggestedEditScans.id, scanId), eq(suggestedEditScans.status, "running")));
  activeScans.delete(scanId);
  const row = await getScan(scanId);
  if (row) scanProgressEmitter.emit(`scan:${scanId}`, toProgress(row));
}

/**
 * Mark scans this process is running as interrupted, then stop them.
 *
 * Called on SIGTERM (Railway sends one on every deploy). Doing it here — in the
 * process that actually owns the scan — is precise: it can't misfire against a
 * scan running on another instance during a rolling deploy the way a
 * heartbeat-based sweep can.
 */
export async function shutdownActiveScans(
  reason = "Server restarted while the scan was running.",
) {
  const ids = Array.from(activeScans.keys());
  if (ids.length === 0) return 0;
  for (const id of ids) {
    const handle = activeScans.get(id);
    if (handle) handle.cancelled = true;
    try {
      await db
        .update(suggestedEditScans)
        .set({ status: "interrupted", firstError: reason, completedAt: new Date() })
        .where(and(eq(suggestedEditScans.id, id), eq(suggestedEditScans.status, "running")));
    } catch (e) {
      console.error(`Failed to mark scan ${id} interrupted during shutdown:`, e);
    }
  }
  console.warn(`⚠️ Marked ${ids.length} in-flight scan(s) as interrupted before shutdown`);
  return ids.length;
}

async function runScan(scanId: string, folderIds: string[], locationIds: string[]) {
  const handle = activeScans.get(scanId);

  try {
    const { googleOAuthAuth } = await import("./google-service-auth");

    if (!googleOAuthAuth.isAuthenticated()) {
      await finish(scanId, "failed", {
        firstError: "Not authenticated with Google. Reconnect and try again.",
      });
      return;
    }

    const allLocations = await resolveLocations(folderIds, locationIds);
    const totalLocations = allLocations.length;

    await db
      .update(suggestedEditScans)
      .set({ totalLocations, heartbeatAt: new Date() })
      .where(eq(suggestedEditScans.id, scanId));

    const startRow = await getScan(scanId);
    if (startRow) scanProgressEmitter.emit(`scan:${scanId}`, toProgress(startRow));

    if (totalLocations === 0) {
      console.warn(`⚠️ Scan ${scanId} has 0 locations to check (all hidden or filtered out).`);
      await finish(scanId, "success", { results: [], scannedCount: 0 });
      return;
    }

    console.log(`🔍 Scan ${scanId}: checking ${totalLocations} locations`);

    const results: ScanResult[] = [];
    let scanned = 0;
    let withUpdates = 0;
    let errored = 0;
    let firstError: string | null = null;

    // Low concurrency plus real spacing between batches keeps us under the GBP
    // Business Information per-minute quota across 150+ locations.
    const BATCH_SIZE = 3;
    const BATCH_DELAY_MS = 2000;

    for (let i = 0; i < allLocations.length; i += BATCH_SIZE) {
      if (handle?.cancelled) {
        await finish(scanId, "cancelled", {
          results,
          scannedCount: scanned,
          withUpdatesCount: withUpdates,
          erroredCount: errored,
          firstError,
        });
        return;
      }

      const batch = allLocations.slice(i, i + BATCH_SIZE);

      // Touch the heartbeat before the batch too — a slow batch (quota backoff)
      // must not look like a dead process to the interrupted-scan sweep.
      await db
        .update(suggestedEditScans)
        .set({ heartbeatAt: new Date() })
        .where(eq(suggestedEditScans.id, scanId));

      const batchResults = await Promise.all(
        batch.map((location) => checkLocation(location, googleOAuthAuth)),
      );

      scanned += batch.length;

      for (const result of batchResults) {
        if (!result) continue;
        if ((result as any).__error) {
          errored++;
          if (!firstError) firstError = (result as any).message;
        } else {
          withUpdates++;
          results.push(result as ScanResult);
        }
      }

      // Persist progress (and results so far) after every batch, so an
      // interrupted scan still shows what it managed to find.
      await db
        .update(suggestedEditScans)
        .set({
          scannedCount: scanned,
          withUpdatesCount: withUpdates,
          erroredCount: errored,
          firstError,
          results,
          heartbeatAt: new Date(),
        })
        .where(eq(suggestedEditScans.id, scanId));

      const row = await getScan(scanId);
      if (row) scanProgressEmitter.emit(`scan:${scanId}`, toProgress(row));

      // Everything failing means auth/permissions, not bad luck — stop early
      // rather than burning several minutes producing nothing.
      if (scanned === errored && scanned >= BATCH_SIZE) {
        console.error(`🚨 Scan ${scanId} aborting — all ${scanned} locations errored.`);
        await finish(scanId, "failed", {
          results,
          scannedCount: scanned,
          withUpdatesCount: withUpdates,
          erroredCount: errored,
          firstError:
            firstError ||
            "Google API calls are failing for all locations. Check authentication and API permissions.",
        });
        return;
      }

      if (i + BATCH_SIZE < allLocations.length) {
        await sleep(BATCH_DELAY_MS);
      }
    }

    await finish(scanId, errored > 0 ? "partial" : "success", {
      results,
      scannedCount: scanned,
      withUpdatesCount: withUpdates,
      erroredCount: errored,
      firstError,
    });
    console.log(
      `✅ Scan ${scanId} finished: ${withUpdates} update(s) across ${scanned} location(s), ${errored} error(s)`,
    );
  } catch (error: any) {
    console.error(`Error running suggested-edits scan ${scanId}:`, error);
    await finish(scanId, "failed", {
      firstError: error?.message || "Failed to scan for suggested edits",
    });
  } finally {
    activeScans.delete(scanId);
  }
}
