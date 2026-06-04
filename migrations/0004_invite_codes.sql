-- Invite codes: required for new local users to set up their account credentials
CREATE TABLE IF NOT EXISTS "invite_codes" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" varchar NOT NULL REFERENCES "users"("id"),
  "code" text NOT NULL UNIQUE,
  "created_by_local_user_id" varchar REFERENCES "local_users"("id"),
  "used_by_local_user_id" varchar REFERENCES "local_users"("id"),
  "used_at" timestamp,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp NOT NULL DEFAULT now()
);
