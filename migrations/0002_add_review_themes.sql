ALTER TABLE "review_email_groups" ADD COLUMN IF NOT EXISTS "themes" json DEFAULT '[]'::json;
