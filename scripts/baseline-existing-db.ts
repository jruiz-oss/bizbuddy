// ONE-TIME script. Run this exactly once, against a database that ALREADY has
// the current tables (i.e. your existing production DB created via `db:push`).
//
// It registers the 0000_baseline migration as "already applied" WITHOUT running
// its CREATE TABLE statements, by writing the bookkeeping row drizzle's migrator
// looks for. After this, `npm run db:migrate` will skip the baseline and only
// apply NEW migrations you generate going forward.
//
// On a brand-new / empty database you do NOT run this — just run `npm run db:migrate`,
// which will create everything from the baseline.
//
// Safe to run more than once: it will not duplicate the baseline row.
import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";
import crypto from "node:crypto";
import fs from "node:fs";

neonConfig.webSocketConstructor = ws;

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL must be set.");
  }

  const journal = JSON.parse(
    fs.readFileSync("./migrations/meta/_journal.json", "utf-8"),
  ) as { entries: { idx: number; when: number; tag: string }[] };

  const baseline = journal.entries.find((e) => e.idx === 0);
  if (!baseline) throw new Error("No baseline (idx 0) entry found in journal.");

  const sql = fs.readFileSync(`./migrations/${baseline.tag}.sql`, "utf-8");
  const hash = crypto.createHash("sha256").update(sql).digest("hex");

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  // Drizzle's default migration bookkeeping location/shape.
  await pool.query(`CREATE SCHEMA IF NOT EXISTS "drizzle";`);
  await pool.query(
    `CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
       id SERIAL PRIMARY KEY,
       hash text NOT NULL,
       created_at bigint
     );`,
  );

  const existing = await pool.query(
    `SELECT 1 FROM "drizzle"."__drizzle_migrations" WHERE hash = $1 LIMIT 1;`,
    [hash],
  );

  if (existing.rowCount && existing.rowCount > 0) {
    console.log("Baseline already registered. Nothing to do.");
  } else {
    await pool.query(
      `INSERT INTO "drizzle"."__drizzle_migrations" (hash, created_at) VALUES ($1, $2);`,
      [hash, baseline.when],
    );
    console.log(
      "Baseline registered as applied. Existing tables left untouched.",
    );
    console.log("From now on use: npm run db:generate && npm run db:migrate");
  }

  await pool.end();
}

main().catch((err) => {
  console.error("Baseline step failed:", err);
  process.exit(1);
});
