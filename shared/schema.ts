import { sql, relations } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, boolean, integer, decimal, json, serial, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const session = pgTable("session", {
  sid: varchar("sid").primaryKey(),
  sess: json("sess").notNull(),
  expire: timestamp("expire").notNull(),
});

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  googleId: text("google_id").notNull().unique(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  timezone: text("timezone").default("America/Phoenix"),
  notificationEmail: text("notification_email"),
  notifyOnJobCompletion: boolean("notify_on_job_completion").default(true),
  notifyOnErrors: boolean("notify_on_errors").default(true),
  notifyWeeklyReport: boolean("notify_weekly_report").default(false),
  lastLocationSyncAt: timestamp("last_location_sync_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Single shared Google Business Profile connection for the whole agency.
// There is exactly ONE row (id = 1). When any team member connects Google, the
// tokens land here and every user + background job reads from this row. This is
// what makes "one person logs in and it's set for everyone" true, and what keeps
// a server restart from bouncing people back to the OAuth screen.
export const googleConnection = pgTable("google_connection", {
  id: integer("id").primaryKey().default(1),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  connectedByUserId: varchar("connected_by_user_id").references(() => users.id),
  connectedEmail: text("connected_email"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const clients = pgTable("clients", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  parentId: varchar("parent_id").references(() => clients.id),
  name: text("name").notNull(),
  type: text("type").default("PERSONAL"),  // PERSONAL, ORGANIZATION, LOCATION_GROUP
  accountNumber: text("account_number"),
  logo: text("logo"),
  brandColor: text("brand_color"),
  // verified | needs_reauth | suspended — set by sync when Google returns invalid_grant or 403
  accountState: text("account_state").notNull().default("verified"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const clientSettings = pgTable("client_settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  clientId: varchar("client_id").notNull().references(() => clients.id),
  timezone: text("timezone").notNull().default("America/Phoenix"),
  enableScheduledPosts: boolean("enable_scheduled_posts").notNull().default(false),
  postsCron: text("posts_cron").notNull().default("0 9 1,15 * *"),
  enableScheduledHours: boolean("enable_scheduled_hours").notNull().default(false),
  hoursCron: text("hours_cron").notNull().default("0 9 1 */2 *"),
  enableReviewEmails: boolean("enable_review_emails").notNull().default(false),
  reviewEmailCron: text("review_email_cron").notNull().default("0 9 * * 1"),
  reviewEmailRecipient: text("review_email_recipient"),
  reviewEmailMinStars: integer("review_email_min_stars").notNull().default(1),
  reviewEmailMaxStars: integer("review_email_max_stars").notNull().default(2),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const clientLocations = pgTable("client_locations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  clientId: varchar("client_id").notNull().references(() => clients.id),
  gbpLocationId: text("gbp_location_id").notNull().unique(),
  name: text("name").notNull(),
  address: text("address"),
  city: text("city"),
  phone: text("phone"),
  website: text("website"),
  description: text("description"),
  regularHours: json("regular_hours"),
  socialMedia: json("social_media"), // { twitter, facebook, instagram, youtube, linkedin, tiktok, pinterest }
  status: text("status").notNull().default("active"),
  hidden: boolean("hidden").notNull().default(false),
  // Lat/lng — sourced from GBP `latlng` field; falls back to U.S. Census geocoder when missing.
  latitude: decimal("latitude", { precision: 10, scale: 7 }),
  longitude: decimal("longitude", { precision: 10, scale: 7 }),
  // True when GBP metadata.hasPendingEdits is set (yellow pin on map)
  editPending: boolean("edit_pending").notNull().default(false),
  averageRating: decimal("average_rating", { precision: 2, scale: 1 }),
  totalReviews: integer("total_reviews").default(0),
  lastPostAt: timestamp("last_post_at"),
  lastHoursUpdateAt: timestamp("last_hours_update_at"),
  lastPhotoAt: timestamp("last_photo_at"),
  targetPosts: integer("target_posts").default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const jobs = pgTable("jobs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  clientId: varchar("client_id").notNull().references(() => clients.id),
  localUserId: varchar("local_user_id").references(() => localUsers.id),
  type: text("type").notNull(), // "hours", "posts", "photo"
  status: text("status").notNull().default("queued"), // "queued", "running", "success", "failed", "partial"
  isDryRun: boolean("is_dry_run").notNull().default(true),
  isScheduled: boolean("is_scheduled").notNull().default(false),
  scheduledDate: timestamp("scheduled_date"),
  scheduledTime: text("scheduled_time"), // Format: "HH:MM" in 24-hour format
  totalItems: integer("total_items").notNull().default(0),
  successCount: integer("success_count").notNull().default(0),
  errorCount: integer("error_count").notNull().default(0),
  processedCount: integer("processed_count").notNull().default(0),
  payload: json("payload"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
});

export const jobItems = pgTable("job_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  jobId: varchar("job_id").notNull().references(() => jobs.id),
  clientLocationId: varchar("client_location_id").notNull().references(() => clientLocations.id),
  status: text("status").notNull().default("pending"), // "pending", "success", "failed"
  errorText: text("error_text"),
  payload: json("payload"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const activityLog = pgTable("activity_log", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id),
  localUserId: varchar("local_user_id").references(() => localUsers.id),
  clientId: varchar("client_id").references(() => clients.id),
  clientLocationId: varchar("client_location_id").references(() => clientLocations.id),
  action: text("action").notNull(),
  payloadJson: json("payload_json"),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
});

export const dismissedDashboardItems = pgTable("dismissed_dashboard_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  itemType: text("item_type").notNull(), // 'job' | 'activity'
  itemId: varchar("item_id").notNull(),
  dismissedByUserId: varchar("dismissed_by_user_id").references(() => users.id),
  dismissedAt: timestamp("dismissed_at").defaultNow().notNull(),
}, (table) => ({
  itemUnique: unique().on(table.itemType, table.itemId),
}));

export const insertDismissedDashboardItemSchema = createInsertSchema(dismissedDashboardItems).omit({ id: true, dismissedAt: true });
export type DismissedDashboardItem = typeof dismissedDashboardItems.$inferSelect;
export type InsertDismissedDashboardItem = z.infer<typeof insertDismissedDashboardItemSchema>;

export const posts = pgTable("posts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  jobId: varchar("job_id").notNull().references(() => jobs.id),
  jobItemId: varchar("job_item_id").notNull().references(() => jobItems.id),
  clientLocationId: varchar("client_location_id").notNull().references(() => clientLocations.id),
  gbpPostName: text("gbp_post_name").notNull(),
  summary: text("summary"),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
  deletedBy: varchar("deleted_by"),
});

export const locationAnalytics = pgTable("location_analytics", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  clientLocationId: varchar("client_location_id").notNull().references(() => clientLocations.id),
  date: timestamp("date").notNull(),
  profileViews: integer("profile_views").notNull().default(0),
  rating: decimal("rating", { precision: 2, scale: 1 }),
  postsCount: integer("posts_count").notNull().default(0),
  photosCount: integer("photos_count").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const locationFolders = pgTable("location_folders", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  name: text("name").notNull(),
  description: text("description"),
  color: text("color"),
  targetPosts: integer("target_posts").default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const locationFolderAssignments = pgTable("location_folder_assignments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  folderId: varchar("folder_id").notNull().references(() => locationFolders.id),
  locationId: varchar("location_id").notNull().references(() => clientLocations.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const locationTags = pgTable("location_tags", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  name: text("name").notNull(),
  color: text("color").default("#6366f1"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const locationTagAssignments = pgTable("location_tag_assignments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tagId: varchar("tag_id").notNull().references(() => locationTags.id),
  locationId: varchar("location_id").notNull().references(() => clientLocations.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const suggestedEdits = pgTable("suggested_edits", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  clientLocationId: varchar("client_location_id").notNull().references(() => clientLocations.id),
  gbpLocationName: text("gbp_location_name").notNull(),
  diffMask: text("diff_mask").notNull(),
  fieldName: text("field_name").notNull(),
  originalValue: text("original_value"),
  suggestedValue: text("suggested_value"),
  status: text("status").notNull().default("pending"),
  detectedAt: timestamp("detected_at").defaultNow().notNull(),
  resolvedAt: timestamp("resolved_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// A single "scan all locations for Google-suggested updates" run.
//
// Scans take minutes (150+ locations, rate-limited GBP API). They used to live
// entirely in the browser: an EventSource held open for the whole run, results
// kept in React state only. Closing the tab or navigating away silently threw
// the whole run away with no record it had ever happened. Every run now gets a
// row here BEFORE any Google call, progress is written as it goes, and results
// are persisted — so the UI can always answer "did my scan actually run?".
export const suggestedEditScans = pgTable("suggested_edit_scans", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  // running | success | partial | failed | cancelled | interrupted
  status: text("status").notNull().default("running"),
  // { folderIds: string[], locationIds: string[] } — empty means "scan everything"
  scope: json("scope"),
  totalLocations: integer("total_locations").notNull().default(0),
  scannedCount: integer("scanned_count").notNull().default(0),
  withUpdatesCount: integer("with_updates_count").notNull().default(0),
  erroredCount: integer("errored_count").notNull().default(0),
  firstError: text("first_error"),
  // Array of ScanResult objects — the actual suggested edits found.
  results: json("results"),
  startedByLocalUserId: varchar("started_by_local_user_id").references(() => localUsers.id),
  startedByName: text("started_by_name"),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  // Bumped after every batch. A "running" row with a stale heartbeat means the
  // process died mid-scan (Railway deploy, crash) — see markInterruptedScans().
  heartbeatAt: timestamp("heartbeat_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type SuggestedEditScan = typeof suggestedEditScans.$inferSelect;

export const suggestedEditActions = pgTable("suggested_edit_actions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  clientLocationId: varchar("client_location_id").references(() => clientLocations.id),
  gbpLocationName: text("gbp_location_name").notNull(),
  locationName: text("location_name").notNull(),
  locationAddress: text("location_address"),
  actionType: text("action_type").notNull(),
  diffMask: text("diff_mask"),
  changes: json("changes"),
  localUserId: varchar("local_user_id").references(() => localUsers.id),
  actedByName: text("acted_by_name"),
  performedAt: timestamp("performed_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const localUsers = pgTable("local_users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  name: text("name").notNull(),
  title: text("title"),
  profilePictureUrl: text("profile_picture_url"),
  role: text("role").notNull().default("admin"),
  isActive: boolean("is_active").notNull().default(true),
  // App-level credentials (independent of Google OAuth)
  email: text("email").unique(),
  passwordHash: text("password_hash"),
  // Self-service password reset. We store only a hash of the token (never the
  // raw value) so a DB read alone can't be used to reset someone's password —
  // same reasoning as passwordHash itself. Expires quickly and is cleared the
  // moment it's used or superseded by a newer request.
  resetTokenHash: text("reset_token_hash"),
  resetTokenExpiresAt: timestamp("reset_token_expires_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const inviteCodes = pgTable("invite_codes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  code: text("code").notNull().unique(),
  createdByLocalUserId: varchar("created_by_local_user_id").references(() => localUsers.id),
  usedByLocalUserId: varchar("used_by_local_user_id").references(() => localUsers.id),
  usedAt: timestamp("used_at"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const reviewEmailGroups = pgTable("review_email_groups", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  // Team member who created the schedule. Scheduled sends run unattended, so this
  // is the only way to attribute "review_email_sent" activity to a person instead
  // of falling back to "System". Null for legacy groups created before this field.
  createdByLocalUserId: varchar("created_by_local_user_id").references(() => localUsers.id),
  name: text("name").notNull(),
  recipientEmail: text("recipient_email").notNull(),
  emailDay: text("email_day").notNull().default("1"),
  emailTime: text("email_time").notNull().default("09:00"),
  minStars: integer("min_stars").notNull().default(1),
  maxStars: integer("max_stars").notNull().default(3),
  frequency: text("frequency").notNull().default("weekly"), // "weekly" | "biweekly" | "monthly"
  // How the review window is derived. "rolling" uses lookbackDays/lookbackOffset (N days back
  // from today, excluding today). "last_calendar_month" ignores both and uses the entire
  // previous calendar month in Phoenix time — all of last month, nothing from this month.
  periodMode: text("period_mode").notNull().default("rolling"), // "rolling" | "last_calendar_month"
  lookbackDays: integer("lookback_days").notNull().default(7),
  lookbackOffset: integer("lookback_offset").notNull().default(0), // days to shift window back; 0 = current period, N = prior period (start and end both shift back by N days)
  customMessage: text("custom_message"),
  customSubject: text("custom_subject"),
  ccEmail: text("cc_email"),
  isEnabled: boolean("is_enabled").notNull().default(true),
  startDate: text("start_date"), // YYYY-MM-DD in Phoenix time; emails won't send before this date
  lastEmailSentAt: timestamp("last_email_sent_at"), // advances ONLY after a confirmed send (or deliberate skip) — never at claim time
  lastSendAttemptAt: timestamp("last_send_attempt_at"), // when the most recent send attempt started (claim marker for retry/backoff)
  sendAttemptCount: integer("send_attempt_count").notNull().default(0), // attempts made for the current occurrence; reset on success
  lastSendError: text("last_send_error"), // why the most recent attempt failed (surfaced in health logs)
  outputFormat: text("output_format").notNull().default("email"), // "email" | "sheet"
  sheetBreakout: text("sheet_breakout").notNull().default("region"), // "region" | "location" | "none"
  sheetName: text("sheet_name"), // custom base name for the spreadsheet attachment; date range is appended dynamically. Falls back to group name when empty.
  themes: json("themes").$type<string[]>().default([]), // optional list of theme labels for AI classification (e.g. ["cleanliness", "staff", "prices"])
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const reviewEmailGroupLocations = pgTable("review_email_group_locations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  groupId: varchar("group_id").notNull().references(() => reviewEmailGroups.id, { onDelete: "cascade" }),
  locationId: varchar("location_id").notNull().references(() => clientLocations.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const appleLocations = pgTable("apple_locations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  name: text("name").notNull(),
  address: text("address"),
  city: text("city"),
  phone: text("phone"),
  website: text("website"),
  description: text("description"),
  regularHours: json("regular_hours"),
  lastSyncedAt: timestamp("last_synced_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Relations
export const usersRelations = relations(users, ({ many }) => ({
  clients: many(clients),
  locationFolders: many(locationFolders),
  locationTags: many(locationTags),
  localUsers: many(localUsers),
  reviewEmailGroups: many(reviewEmailGroups),
  appleLocations: many(appleLocations),
}));

export const appleLocationsRelations = relations(appleLocations, ({ one }) => ({
  user: one(users, {
    fields: [appleLocations.userId],
    references: [users.id],
  }),
}));

export const reviewEmailGroupsRelations = relations(reviewEmailGroups, ({ one, many }) => ({
  user: one(users, {
    fields: [reviewEmailGroups.userId],
    references: [users.id],
  }),
  locationAssignments: many(reviewEmailGroupLocations),
}));

export const reviewEmailGroupLocationsRelations = relations(reviewEmailGroupLocations, ({ one }) => ({
  group: one(reviewEmailGroups, {
    fields: [reviewEmailGroupLocations.groupId],
    references: [reviewEmailGroups.id],
  }),
  location: one(clientLocations, {
    fields: [reviewEmailGroupLocations.locationId],
    references: [clientLocations.id],
  }),
}));

export const localUsersRelations = relations(localUsers, ({ one }) => ({
  user: one(users, {
    fields: [localUsers.userId],
    references: [users.id],
  }),
}));

export const clientsRelations = relations(clients, ({ one, many }) => ({
  user: one(users, {
    fields: [clients.userId],
    references: [users.id],
  }),
  parent: one(clients, {
    fields: [clients.parentId],
    references: [clients.id],
    relationName: "parentChildren",
  }),
  children: many(clients, {
    relationName: "parentChildren",
  }),
  settings: one(clientSettings),
  locations: many(clientLocations),
  jobs: many(jobs),
}));

export const clientSettingsRelations = relations(clientSettings, ({ one }) => ({
  client: one(clients, {
    fields: [clientSettings.clientId],
    references: [clients.id],
  }),
}));

export const clientLocationsRelations = relations(clientLocations, ({ one, many }) => ({
  client: one(clients, {
    fields: [clientLocations.clientId],
    references: [clients.id],
  }),
  jobItems: many(jobItems),
  analytics: many(locationAnalytics),
  folderAssignments: many(locationFolderAssignments),
  tagAssignments: many(locationTagAssignments),
}));

export const locationAnalyticsRelations = relations(locationAnalytics, ({ one }) => ({
  location: one(clientLocations, {
    fields: [locationAnalytics.clientLocationId],
    references: [clientLocations.id],
  }),
}));

export const jobsRelations = relations(jobs, ({ one, many }) => ({
  client: one(clients, {
    fields: [jobs.clientId],
    references: [clients.id],
  }),
  items: many(jobItems),
}));

export const jobItemsRelations = relations(jobItems, ({ one, many }) => ({
  job: one(jobs, {
    fields: [jobItems.jobId],
    references: [jobs.id],
  }),
  location: one(clientLocations, {
    fields: [jobItems.clientLocationId],
    references: [clientLocations.id],
  }),
  posts: many(posts),
}));

export const postsRelations = relations(posts, ({ one }) => ({
  job: one(jobs, {
    fields: [posts.jobId],
    references: [jobs.id],
  }),
  jobItem: one(jobItems, {
    fields: [posts.jobItemId],
    references: [jobItems.id],
  }),
  location: one(clientLocations, {
    fields: [posts.clientLocationId],
    references: [clientLocations.id],
  }),
}));

export const locationFoldersRelations = relations(locationFolders, ({ one, many }) => ({
  user: one(users, {
    fields: [locationFolders.userId],
    references: [users.id],
  }),
  assignments: many(locationFolderAssignments),
}));

export const locationFolderAssignmentsRelations = relations(locationFolderAssignments, ({ one }) => ({
  folder: one(locationFolders, {
    fields: [locationFolderAssignments.folderId],
    references: [locationFolders.id],
  }),
  location: one(clientLocations, {
    fields: [locationFolderAssignments.locationId],
    references: [clientLocations.id],
  }),
}));

export const locationTagsRelations = relations(locationTags, ({ one, many }) => ({
  user: one(users, {
    fields: [locationTags.userId],
    references: [users.id],
  }),
  assignments: many(locationTagAssignments),
}));

export const locationTagAssignmentsRelations = relations(locationTagAssignments, ({ one }) => ({
  tag: one(locationTags, {
    fields: [locationTagAssignments.tagId],
    references: [locationTags.id],
  }),
  location: one(clientLocations, {
    fields: [locationTagAssignments.locationId],
    references: [clientLocations.id],
  }),
}));

export const suggestedEditsRelations = relations(suggestedEdits, ({ one }) => ({
  location: one(clientLocations, {
    fields: [suggestedEdits.clientLocationId],
    references: [clientLocations.id],
  }),
}));

// Insert schemas
export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertGoogleConnectionSchema = createInsertSchema(googleConnection).omit({
  updatedAt: true,
});
export type GoogleConnection = typeof googleConnection.$inferSelect;

export const insertClientSchema = createInsertSchema(clients).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertClientSettingsSchema = createInsertSchema(clientSettings).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertClientLocationSchema = createInsertSchema(clientLocations).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertJobSchema = createInsertSchema(jobs).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertJobItemSchema = createInsertSchema(jobItems).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertActivityLogSchema = createInsertSchema(activityLog).omit({
  id: true,
  timestamp: true,
});

export const insertLocationAnalyticsSchema = createInsertSchema(locationAnalytics).omit({
  id: true,
  createdAt: true,
});

export const insertPostSchema = createInsertSchema(posts).omit({
  id: true,
  createdAt: true,
});

export const insertLocationFolderSchema = createInsertSchema(locationFolders).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertLocationFolderAssignmentSchema = createInsertSchema(locationFolderAssignments).omit({
  id: true,
  createdAt: true,
});

export const insertLocationTagSchema = createInsertSchema(locationTags).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertLocationTagAssignmentSchema = createInsertSchema(locationTagAssignments).omit({
  id: true,
  createdAt: true,
});

export const insertSuggestedEditSchema = createInsertSchema(suggestedEdits).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertSuggestedEditActionSchema = createInsertSchema(suggestedEditActions).omit({
  id: true,
  createdAt: true,
});

export const insertLocalUserSchema = createInsertSchema(localUsers).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertInviteCodeSchema = createInsertSchema(inviteCodes).omit({
  id: true,
  createdAt: true,
});

export const insertReviewEmailGroupSchema = createInsertSchema(reviewEmailGroups).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertReviewEmailGroupLocationSchema = createInsertSchema(reviewEmailGroupLocations).omit({
  id: true,
  createdAt: true,
});

export const insertAppleLocationSchema = createInsertSchema(appleLocations).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// Types
export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type Client = typeof clients.$inferSelect;
export type InsertClient = z.infer<typeof insertClientSchema>;
export type ClientSettings = typeof clientSettings.$inferSelect;
export type InsertClientSettings = z.infer<typeof insertClientSettingsSchema>;
export type ClientLocation = typeof clientLocations.$inferSelect;
export type InsertClientLocation = z.infer<typeof insertClientLocationSchema>;
export type Job = typeof jobs.$inferSelect;
export type InsertJob = z.infer<typeof insertJobSchema>;
export type JobItem = typeof jobItems.$inferSelect;
export type InsertJobItem = z.infer<typeof insertJobItemSchema>;
export type ActivityLog = typeof activityLog.$inferSelect;
export type InsertActivityLog = z.infer<typeof insertActivityLogSchema>;
export type LocationAnalytics = typeof locationAnalytics.$inferSelect;
export type InsertLocationAnalytics = z.infer<typeof insertLocationAnalyticsSchema>;
export type Post = typeof posts.$inferSelect;
export type InsertPost = z.infer<typeof insertPostSchema>;
export type LocationFolder = typeof locationFolders.$inferSelect;
export type InsertLocationFolder = z.infer<typeof insertLocationFolderSchema>;
export type LocationFolderAssignment = typeof locationFolderAssignments.$inferSelect;
export type InsertLocationFolderAssignment = z.infer<typeof insertLocationFolderAssignmentSchema>;
export type LocationTag = typeof locationTags.$inferSelect;
export type InsertLocationTag = z.infer<typeof insertLocationTagSchema>;
export type LocationTagAssignment = typeof locationTagAssignments.$inferSelect;
export type InsertLocationTagAssignment = z.infer<typeof insertLocationTagAssignmentSchema>;
export type SuggestedEdit = typeof suggestedEdits.$inferSelect;
export type InsertSuggestedEdit = z.infer<typeof insertSuggestedEditSchema>;
export type SuggestedEditAction = typeof suggestedEditActions.$inferSelect;
export type InsertSuggestedEditAction = z.infer<typeof insertSuggestedEditActionSchema>;
export type LocalUser = typeof localUsers.$inferSelect;
export type InsertLocalUser = z.infer<typeof insertLocalUserSchema>;
export type ReviewEmailGroup = typeof reviewEmailGroups.$inferSelect;
export type InsertReviewEmailGroup = z.infer<typeof insertReviewEmailGroupSchema>;
export type ReviewEmailGroupLocation = typeof reviewEmailGroupLocations.$inferSelect;
export type InsertReviewEmailGroupLocation = z.infer<typeof insertReviewEmailGroupLocationSchema>;
export type AppleLocation = typeof appleLocations.$inferSelect;
export type InviteCode = typeof inviteCodes.$inferSelect;
export type InsertInviteCode = z.infer<typeof insertInviteCodeSchema>;
export type InsertAppleLocation = z.infer<typeof insertAppleLocationSchema>;

// GBP Performance Historical Data
export const locationPerformanceData = pgTable("location_performance_data", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  locationId: varchar("location_id").notNull(),
  date: varchar("date").notNull(), // YYYY-MM-DD
  callClicks: integer("call_clicks").notNull().default(0),
  websiteClicks: integer("website_clicks").notNull().default(0),
  directionRequests: integer("direction_requests").notNull().default(0),
  impressions: integer("impressions").notNull().default(0),
  fetchedAt: timestamp("fetched_at").defaultNow().notNull(),
}, (table) => ({
  locationDateUnique: unique().on(table.locationId, table.date),
}));

export const insertLocationPerformanceDataSchema = createInsertSchema(locationPerformanceData).omit({ id: true, fetchedAt: true });
export type LocationPerformanceData = typeof locationPerformanceData.$inferSelect;
export type InsertLocationPerformanceData = z.infer<typeof insertLocationPerformanceDataSchema>;
