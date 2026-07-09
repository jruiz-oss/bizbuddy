-- Review email send-attempt tracking.
--
-- Previously the scheduler stamped last_email_sent_at at CLAIM time (before the
-- send actually ran). Any failure after that point — Google connection not yet
-- restored after a deploy, Gmail token problems, a restart mid-send — consumed
-- the occurrence permanently: no email, no retry, and usually no history entry.
--
-- The claim marker now lives in last_send_attempt_at, and last_email_sent_at
-- only advances after Gmail confirms the send (or the occurrence is deliberately
-- skipped). send_attempt_count drives retry backoff; last_send_error is surfaced
-- in the hourly health log.
ALTER TABLE "review_email_groups" ADD COLUMN IF NOT EXISTS "last_send_attempt_at" timestamp;
ALTER TABLE "review_email_groups" ADD COLUMN IF NOT EXISTS "send_attempt_count" integer NOT NULL DEFAULT 0;
ALTER TABLE "review_email_groups" ADD COLUMN IF NOT EXISTS "last_send_error" text;
