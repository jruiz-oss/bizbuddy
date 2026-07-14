-- Attribute scheduled review-email sends to a person instead of "System".
--
-- Scheduled sends run unattended, so the "review_email_sent" activity log had no
-- team member to point at and always displayed as "System". We now record who
-- created the schedule and stamp that person onto each send's activity entry.
--
-- Nullable with no backfill: existing groups have no known creator, so their sends
-- fall back to the account owner during activity enrichment (which is the chosen
-- behavior for any activity without an attached team member).
ALTER TABLE "review_email_groups"
  ADD COLUMN IF NOT EXISTS "created_by_local_user_id" varchar REFERENCES "local_users"("id");
