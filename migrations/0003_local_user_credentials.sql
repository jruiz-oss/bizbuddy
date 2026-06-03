-- Add app-level credentials to local_users (independent of Google OAuth)
ALTER TABLE "local_users" ADD COLUMN IF NOT EXISTS "email" text UNIQUE;
ALTER TABLE "local_users" ADD COLUMN IF NOT EXISTS "password_hash" text;
