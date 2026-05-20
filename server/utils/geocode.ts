/**
 * U.S. Census geocoder + a simple rate-limited background worker.
 *
 * The Census `onelineaddress` endpoint is fully public — no key, no quota —
 * but the API is slow (~250 ms / call) and we want to be polite, so we run
 * geocoding in a background queue capped at 1 lookup per second. The sync
 * request returns immediately; lat/lng land on the row a few seconds later
 * and the next page refresh picks them up.
 *
 * Docs: https://geocoding.geo.census.gov/geocoder/Geocoding_Services_API.pdf
 */
import { storage } from "../storage";
import { db } from "../db";
import { clientLocations } from "@shared/schema";
import { isNull, sql, and } from "drizzle-orm";

export interface GeocodeResult {
  lat: number;
  lng: number;
}

export async function geocodeAddressUSCensus(
  address: string,
): Promise<GeocodeResult | null> {
  const trimmed = (address || "").trim();
  if (!trimmed) return null;

  try {
    const url = new URL(
      "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress",
    );
    url.searchParams.set("address", trimmed);
    url.searchParams.set("benchmark", "Public_AR_Current");
    url.searchParams.set("format", "json");

    const res = await fetch(url.toString(), {
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;

    const data = (await res.json()) as {
      result?: {
        addressMatches?: Array<{
          coordinates?: { x: number | string; y: number | string };
        }>;
      };
    };
    const match = data?.result?.addressMatches?.[0];
    if (!match?.coordinates) return null;

    const lat = Number(match.coordinates.y);
    const lng = Number(match.coordinates.x);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Background geocoding queue
// ─────────────────────────────────────────────────────────────────────────
//
// We deliberately keep this in-process (no external job runner) because the
// volume is tiny — at most a few hundred new locations every two weeks. The
// queue dedupes by locationId, processes 1 job/second, and silently drops
// addresses the Census can't match (the row stays without coords until the
// user fixes the address or GBP returns latlng on the next sync).

interface GeocodeJob {
  locationId: string;
  address: string;
}

class GeocodeQueue {
  private queue: GeocodeJob[] = [];
  private seen = new Set<string>();
  private running = false;
  // 1 request per second is conservative for the public Census endpoint
  private readonly intervalMs = 1_000;

  enqueue(job: GeocodeJob) {
    if (!job.address || !job.locationId) return;
    if (this.seen.has(job.locationId)) return;
    this.seen.add(job.locationId);
    this.queue.push(job);
    if (!this.running) void this.run();
  }

  enqueueMany(jobs: GeocodeJob[]) {
    for (const j of jobs) this.enqueue(j);
  }

  size(): number {
    return this.queue.length;
  }

  private async run() {
    this.running = true;
    try {
      while (this.queue.length > 0) {
        const job = this.queue.shift();
        if (!job) break;
        try {
          const coords = await geocodeAddressUSCensus(job.address);
          if (coords) {
            await storage.updateLocation(job.locationId, {
              latitude: String(coords.lat),
              longitude: String(coords.lng),
            });
          }
        } catch (err) {
          console.error(`🗺️  geocode worker: job ${job.locationId} failed`, err);
        } finally {
          // Always release the locationId after the attempt so a future
          // re-enqueue (e.g. address fixed) can run again.
          this.seen.delete(job.locationId);
        }
        if (this.queue.length > 0) {
          await new Promise((r) => setTimeout(r, this.intervalMs));
        }
      }
    } finally {
      this.running = false;
    }
  }
}

export const geocodeQueue = new GeocodeQueue();

/**
 * Scan the database for any locations still missing lat/lng (e.g. rows
 * created before this code shipped, or where GBP didn't return latlng on
 * the last sync) and enqueue them for the background worker.
 *
 * Called at server startup and after every sync (manual or scheduled).
 */
export async function backfillMissingCoordinates(limit = 200): Promise<number> {
  const rows = await db
    .select({
      id: clientLocations.id,
      address: clientLocations.address,
    })
    .from(clientLocations)
    .where(
      and(
        sql`(${clientLocations.latitude} IS NULL OR ${clientLocations.longitude} IS NULL)`,
        sql`${clientLocations.address} IS NOT NULL AND length(trim(${clientLocations.address})) > 0`,
      ),
    )
    .limit(limit);

  geocodeQueue.enqueueMany(
    rows.map((r) => ({ locationId: r.id, address: r.address ?? "" })),
  );
  if (rows.length > 0) {
    console.log(
      `🗺️  Geocode backfill: enqueued ${rows.length} location(s) (queue size now ${geocodeQueue.size()})`,
    );
  }
  return rows.length;
}
