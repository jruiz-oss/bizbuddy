ALTER TABLE "review_email_groups" ADD COLUMN IF NOT EXISTS "lookback_offset" integer NOT NULL DEFAULT 0;
