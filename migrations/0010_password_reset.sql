-- Self-service password reset for local_users. Only a hash of the reset token
-- is stored (never the raw value) — same reasoning as password_hash itself.
ALTER TABLE "local_users" ADD COLUMN IF NOT EXISTS "reset_token_hash" text;
ALTER TABLE "local_users" ADD COLUMN IF NOT EXISTS "reset_token_expires_at" timestamp;
