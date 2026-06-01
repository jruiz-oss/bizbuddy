// Applies pending Drizzle migrations from ./migrations to the database in
// DATABASE_URL. Safe to run repeatedly — already-applied migrations are skipped
// (tracked in the drizzle.__drizzle_migrations table). This REPLACES `db:push`
// for production: it only ever runs the reviewed SQL committed under ./migrations,
// so it can never truncate or drop a table without that statement being in a file
// you've seen.
import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { migrate } from "drizzle-orm/neon-serverless/migrator";
import ws from "ws";

neonConfig.webSocketConstructor = ws;

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL must be set to run migrations.");
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle({ client: pool });

  console.log("Running migrations from ./migrations ...");
  await migrate(db, { migrationsFolder: "./migrations" });
  console.log("Migrations applied successfully.");

  await pool.end();
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
