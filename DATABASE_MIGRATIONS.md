# Database migrations

## Why this exists

This project used to sync schema with `drizzle-kit push` (`npm run db:push`).
`push` diffs your whole `schema.ts` against the live DB and reconciles everything
in one shot — and when it sees a change it considers destructive, it will
truncate/recreate a table rather than fail. Because `review_email_group_locations`
has an `ON DELETE CASCADE` to `review_email_groups`, a single bad push wiped the
review groups and all their location assignments.

We've replaced `push` with **versioned migrations**: every schema change becomes a
reviewed `.sql` file under `./migrations`. Nothing runs against the DB unless it's
in a file you can read first, so a stray truncate can't sneak through.

## One-time setup (do this once, before the next deploy)

Your production DB already has all the tables, so we tell drizzle the baseline is
"already applied" instead of trying to recreate them:

```bash
# point at the PRODUCTION database, then:
DATABASE_URL="<your prod url>" npm run db:baseline
```

This writes one bookkeeping row and touches no existing data. Run it once. (On a
brand-new/empty DB, skip this and just run `npm run db:migrate` — it builds
everything from the baseline.)

## Day-to-day: changing the schema

1. Edit `shared/schema.ts` (add a column, table, etc.).
2. Generate a migration and **read the SQL it produces**:

   ```bash
   npm run db:generate          # writes a new file under ./migrations
   ```

3. Commit the generated `.sql` file and the `meta/` changes along with your code.
4. Deploy. Railway runs `node dist/migrate.js` before the server starts, applying
   only the new, already-reviewed migration. To apply manually instead:

   ```bash
   DATABASE_URL="<url>" npm run db:migrate
   ```

## Rules

- **Do not run `npm run db:push` against production anymore.** It's left in
  `package.json` only for throwaway local experiments. Use generate + migrate.
- Always open the generated `.sql` before deploying. If you ever see `DROP TABLE`,
  `TRUNCATE`, or a `DROP COLUMN` you didn't intend, stop and fix the schema.
- `drizzle-kit` is pinned to `0.30.6` to match `drizzle-orm@0.39.1`; newer
  `drizzle-kit` errors against this ORM version.

## Files

- `migrations/` — generated SQL + journal (commit these).
- `scripts/migrate.ts` — applies pending migrations (bundled to `dist/migrate.js` at build).
- `scripts/baseline-existing-db.ts` — one-time adoption for the existing DB.
