# BizBuddy

BizBuddy is a web application for bulk managing Google Business Profiles, allowing users to update hours, create posts, and upload photos across multiple locations.

## Run & Operate

**Environment Variables:**
- `GOOGLE_CLOUD_PROJECT_ID`: Required for Google Cloud Storage photo uploads.
- Google OAuth credentials for API access.

**Commands:**
- `npm run dev`: Start development server (frontend and backend).
- `npm run build`: Build production assets.
- `npm run check`: Run TypeScript type checking.
- Database schema changes: use versioned migrations only — `npm run db:generate` then `npm run db:migrate`. NEVER run `db:push` against production; it has wiped data before. See DATABASE_MIGRATIONS.md.
- Scheduled review emails are handled in-app by the cron scheduler in `server/scheduler.ts` (no external script).

## Stack

- **Frontend:** React, TypeScript, Radix UI, Tailwind CSS, TanStack Query, Wouter, Vite
- **Backend:** Express.js, TypeScript, Drizzle ORM, node-cron
- **Database:** PostgreSQL (Neon serverless)
- **Validation:** Zod
- **Build Tool:** Vite

## Where things live

- `/client`: Frontend source code.
    - `/client/src/components/ui/`: Reusable UI components.
    - `/client/src/pages/`: Page components (e.g., `dashboard.tsx`, `posts.tsx`, `jobs.tsx`, `locations.tsx`).
- `/server`: Backend source code.
    - `/shared/schema.ts`: Database schema definition (source-of-truth, used by Drizzle).
    - `/server/routes.ts`: API endpoints.
    - `/server/google-service-auth.ts`, `/server/google-auth.ts`: Google API authentication and scope definitions.
- `/shared/schema.ts`: Shared schema definitions (e.g., `clientLocations` and `clients` schema extensions).
- `scripts/send-scheduled-emails.ts`: Script for sending scheduled emails.
- `index.css`: Global CSS, including Tailwind config and custom properties for theming.

## Architecture decisions

- **Server State Management:** TanStack Query on the frontend for robust server state handling, including optimistic updates and caching.
- **ORM Choice:** Drizzle ORM for type safety, performance, and developer experience with PostgreSQL.
- **Scheduler:** Lightweight cron-based system for automated operations, including a nightly GBP performance data sync to build historical archives.
- **Geocoding:** Background, rate-limited worker for geocoding addresses using U.S. Census `onelineaddress` when GBP doesn't provide coordinates.
- **Bulk Operations:** Queue-based job processing system with rate limiting, batching, and retry logic for efficient handling of Google API interactions.

## Product

- **Google Business Profile Management:** Bulk update hours, create posts, upload photos for business locations.
- **Scheduled Operations:** Configure recurring posts and hours updates with client-specific timezones.
- **Suggested Edits Review:** Scan for and manage Google-suggested updates to business locations.
- **Activity Logging:** Comprehensive audit trail of all system events and user actions.
- **Interactive Map View:** Manage locations through an interactive map with status-coded pins and bulk action capabilities.
- **Authentication:** Secure OAuth 2.0 with Google as the identity provider.

## User preferences

Preferred communication style: Simple, everyday language.

## Gotchas

- **Google API Rate Limits:** Operations are rate-limited to comply with Google Business Profile API quotas (default 3 requests/second).
- **Session Persistence:** Sessions last 7 days; users will need to re-authenticate afterwards.
- **Geocoding Latency:** Initial geocoding for new locations might have a slight delay due to rate limiting, but sync operations are immediate.
- **Email Scheduler:** The scheduled email script `scripts/send-scheduled-emails.ts` requires a Replit Scheduled Deployment to run reliably when the app is not actively in use.
- **Database Schema Updates:** After modifying `shared/schema.ts`, run `npm run db:generate` to create a migration, then `npm run db:migrate` to apply it. Do NOT use `db:push` — it has wiped production data. See DATABASE_MIGRATIONS.md.

## Pointers

- **Google Business Profile API:** [https://developers.google.com/my-business](https://developers.google.com/my-business)
- **Radix UI Documentation:** [https://www.radix-ui.com/](https://www.radix-ui.com/)
- **Tailwind CSS Documentation:** [https://tailwindcss.com/docs](https://tailwindcss.com/docs)
- **Drizzle ORM Documentation:** [https://orm.drizzle.team/](https://orm.drizzle.team/)
- **TanStack Query Documentation:** [https://tanstack.com/query/latest](https://tanstack.com/query/latest)
- **Leaflet (react-leaflet):** [https://react-leaflet.js.org/](https://react-leaflet.js.org/)
- **Replit Scheduled Deployments:** _Populate as you build_