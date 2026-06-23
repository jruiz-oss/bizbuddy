-- Single shared Google Business Profile connection for the whole agency.
-- Exactly one row (id = 1). Replaces the previous approach of reading whichever
-- user row happened to have a token, which caused intermittent re-OAuth prompts.
CREATE TABLE IF NOT EXISTS "google_connection" (
  "id" integer PRIMARY KEY DEFAULT 1,
  "access_token" text,
  "refresh_token" text,
  "connected_by_user_id" varchar REFERENCES "users"("id"),
  "connected_email" text,
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "google_connection_singleton" CHECK ("id" = 1)
);

-- Seed the shared connection from the most recently-updated user that already has
-- a refresh token, so the existing connection keeps working and nobody has to
-- re-authenticate after this migration runs.
INSERT INTO "google_connection" ("id", "access_token", "refresh_token", "connected_by_user_id", "connected_email")
SELECT 1, u."access_token", u."refresh_token", u."id", u."email"
FROM "users" u
WHERE u."refresh_token" IS NOT NULL
ORDER BY u."updated_at" DESC
LIMIT 1
ON CONFLICT ("id") DO NOTHING;
