-- Persist suggested-edit scan runs.
--
-- A scan takes minutes (150+ locations against a rate-limited GBP API) and used
-- to exist only as an open EventSource plus React state in one browser tab.
-- Navigating away or reloading discarded the run and every result with it, and
-- nothing was recorded, so the UI could never tell the user whether the scan had
-- actually run, was still running, or had died.
--
-- Each run now gets a row here before the first Google call. Progress counters
-- are written after every batch, results are persisted on completion, and
-- heartbeat_at lets the server detect runs killed mid-flight by a deploy
-- (see markInterruptedScans in server/suggested-edits-scanner.ts).
CREATE TABLE IF NOT EXISTS "suggested_edit_scans" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "status" text NOT NULL DEFAULT 'running',
  "scope" json,
  "total_locations" integer NOT NULL DEFAULT 0,
  "scanned_count" integer NOT NULL DEFAULT 0,
  "with_updates_count" integer NOT NULL DEFAULT 0,
  "errored_count" integer NOT NULL DEFAULT 0,
  "first_error" text,
  "results" json,
  "started_by_local_user_id" varchar REFERENCES "local_users"("id"),
  "started_by_name" text,
  "started_at" timestamp NOT NULL DEFAULT now(),
  "heartbeat_at" timestamp NOT NULL DEFAULT now(),
  "completed_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now()
);

-- "most recent run" is the hot query.
CREATE INDEX IF NOT EXISTS "suggested_edit_scans_started_at_idx"
  ON "suggested_edit_scans" ("started_at" DESC);

-- At most one scan may be running at a time. Enforced in the database rather
-- than only by a read-then-insert check in startScan(), which two simultaneous
-- requests can both pass — two concurrent scans would double the load on an
-- already quota-limited Google API and leave the UI unable to say which run it
-- is showing.
CREATE UNIQUE INDEX IF NOT EXISTS "suggested_edit_scans_one_running_idx"
  ON "suggested_edit_scans" ((1)) WHERE "status" = 'running';
