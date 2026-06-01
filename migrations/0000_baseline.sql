CREATE TABLE "activity_log" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar,
	"local_user_id" varchar,
	"client_id" varchar,
	"client_location_id" varchar,
	"action" text NOT NULL,
	"payload_json" json,
	"timestamp" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "apple_locations" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"name" text NOT NULL,
	"address" text,
	"city" text,
	"phone" text,
	"website" text,
	"description" text,
	"regular_hours" json,
	"last_synced_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "client_locations" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" varchar NOT NULL,
	"gbp_location_id" text NOT NULL,
	"name" text NOT NULL,
	"address" text,
	"city" text,
	"phone" text,
	"website" text,
	"description" text,
	"regular_hours" json,
	"social_media" json,
	"status" text DEFAULT 'active' NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL,
	"latitude" numeric(10, 7),
	"longitude" numeric(10, 7),
	"edit_pending" boolean DEFAULT false NOT NULL,
	"average_rating" numeric(2, 1),
	"total_reviews" integer DEFAULT 0,
	"last_post_at" timestamp,
	"last_hours_update_at" timestamp,
	"last_photo_at" timestamp,
	"target_posts" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "client_locations_gbp_location_id_unique" UNIQUE("gbp_location_id")
);
--> statement-breakpoint
CREATE TABLE "client_settings" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" varchar NOT NULL,
	"timezone" text DEFAULT 'America/Phoenix' NOT NULL,
	"enable_scheduled_posts" boolean DEFAULT false NOT NULL,
	"posts_cron" text DEFAULT '0 9 1,15 * *' NOT NULL,
	"enable_scheduled_hours" boolean DEFAULT false NOT NULL,
	"hours_cron" text DEFAULT '0 9 1 */2 *' NOT NULL,
	"enable_review_emails" boolean DEFAULT false NOT NULL,
	"review_email_cron" text DEFAULT '0 9 * * 1' NOT NULL,
	"review_email_recipient" text,
	"review_email_min_stars" integer DEFAULT 1 NOT NULL,
	"review_email_max_stars" integer DEFAULT 2 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clients" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"parent_id" varchar,
	"name" text NOT NULL,
	"type" text DEFAULT 'PERSONAL',
	"account_number" text,
	"logo" text,
	"brand_color" text,
	"account_state" text DEFAULT 'verified' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dismissed_dashboard_items" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_type" text NOT NULL,
	"item_id" varchar NOT NULL,
	"dismissed_by_user_id" varchar,
	"dismissed_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "dismissed_dashboard_items_item_type_item_id_unique" UNIQUE("item_type","item_id")
);
--> statement-breakpoint
CREATE TABLE "job_items" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" varchar NOT NULL,
	"client_location_id" varchar NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"error_text" text,
	"payload" json,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" varchar NOT NULL,
	"local_user_id" varchar,
	"type" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"is_dry_run" boolean DEFAULT true NOT NULL,
	"is_scheduled" boolean DEFAULT false NOT NULL,
	"scheduled_date" timestamp,
	"scheduled_time" text,
	"total_items" integer DEFAULT 0 NOT NULL,
	"success_count" integer DEFAULT 0 NOT NULL,
	"error_count" integer DEFAULT 0 NOT NULL,
	"processed_count" integer DEFAULT 0 NOT NULL,
	"payload" json,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"started_at" timestamp,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "local_users" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"name" text NOT NULL,
	"title" text,
	"profile_picture_url" text,
	"role" text DEFAULT 'admin' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "location_analytics" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_location_id" varchar NOT NULL,
	"date" timestamp NOT NULL,
	"profile_views" integer DEFAULT 0 NOT NULL,
	"rating" numeric(2, 1),
	"posts_count" integer DEFAULT 0 NOT NULL,
	"photos_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "location_folder_assignments" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"folder_id" varchar NOT NULL,
	"location_id" varchar NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "location_folders" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"color" text,
	"target_posts" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "location_performance_data" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" varchar NOT NULL,
	"date" varchar NOT NULL,
	"call_clicks" integer DEFAULT 0 NOT NULL,
	"website_clicks" integer DEFAULT 0 NOT NULL,
	"direction_requests" integer DEFAULT 0 NOT NULL,
	"impressions" integer DEFAULT 0 NOT NULL,
	"fetched_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "location_performance_data_location_id_date_unique" UNIQUE("location_id","date")
);
--> statement-breakpoint
CREATE TABLE "location_tag_assignments" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tag_id" varchar NOT NULL,
	"location_id" varchar NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "location_tags" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT '#6366f1',
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "posts" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" varchar NOT NULL,
	"job_item_id" varchar NOT NULL,
	"client_location_id" varchar NOT NULL,
	"gbp_post_name" text NOT NULL,
	"summary" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"deleted_by" varchar
);
--> statement-breakpoint
CREATE TABLE "review_email_group_locations" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" varchar NOT NULL,
	"location_id" varchar NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_email_groups" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"name" text NOT NULL,
	"recipient_email" text NOT NULL,
	"email_day" text DEFAULT '1' NOT NULL,
	"email_time" text DEFAULT '09:00' NOT NULL,
	"min_stars" integer DEFAULT 1 NOT NULL,
	"max_stars" integer DEFAULT 3 NOT NULL,
	"frequency" text DEFAULT 'weekly' NOT NULL,
	"lookback_days" integer DEFAULT 7 NOT NULL,
	"custom_message" text,
	"custom_subject" text,
	"cc_email" text,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"start_date" text,
	"last_email_sent_at" timestamp,
	"output_format" text DEFAULT 'email' NOT NULL,
	"sheet_breakout" text DEFAULT 'region' NOT NULL,
	"sheet_name" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"sid" varchar PRIMARY KEY NOT NULL,
	"sess" json NOT NULL,
	"expire" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suggested_edit_actions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_location_id" varchar,
	"gbp_location_name" text NOT NULL,
	"location_name" text NOT NULL,
	"location_address" text,
	"action_type" text NOT NULL,
	"diff_mask" text,
	"changes" json,
	"local_user_id" varchar,
	"acted_by_name" text,
	"performed_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suggested_edits" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_location_id" varchar NOT NULL,
	"gbp_location_name" text NOT NULL,
	"diff_mask" text NOT NULL,
	"field_name" text NOT NULL,
	"original_value" text,
	"suggested_value" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"detected_at" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"google_id" text NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"timezone" text DEFAULT 'America/Phoenix',
	"notification_email" text,
	"notify_on_job_completion" boolean DEFAULT true,
	"notify_on_errors" boolean DEFAULT true,
	"notify_weekly_report" boolean DEFAULT false,
	"last_location_sync_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_google_id_unique" UNIQUE("google_id"),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_local_user_id_local_users_id_fk" FOREIGN KEY ("local_user_id") REFERENCES "public"."local_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_client_location_id_client_locations_id_fk" FOREIGN KEY ("client_location_id") REFERENCES "public"."client_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apple_locations" ADD CONSTRAINT "apple_locations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_locations" ADD CONSTRAINT "client_locations_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_settings" ADD CONSTRAINT "client_settings_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_parent_id_clients_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dismissed_dashboard_items" ADD CONSTRAINT "dismissed_dashboard_items_dismissed_by_user_id_users_id_fk" FOREIGN KEY ("dismissed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_items" ADD CONSTRAINT "job_items_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_items" ADD CONSTRAINT "job_items_client_location_id_client_locations_id_fk" FOREIGN KEY ("client_location_id") REFERENCES "public"."client_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_local_user_id_local_users_id_fk" FOREIGN KEY ("local_user_id") REFERENCES "public"."local_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "local_users" ADD CONSTRAINT "local_users_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_analytics" ADD CONSTRAINT "location_analytics_client_location_id_client_locations_id_fk" FOREIGN KEY ("client_location_id") REFERENCES "public"."client_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_folder_assignments" ADD CONSTRAINT "location_folder_assignments_folder_id_location_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."location_folders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_folder_assignments" ADD CONSTRAINT "location_folder_assignments_location_id_client_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."client_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_folders" ADD CONSTRAINT "location_folders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_tag_assignments" ADD CONSTRAINT "location_tag_assignments_tag_id_location_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."location_tags"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_tag_assignments" ADD CONSTRAINT "location_tag_assignments_location_id_client_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."client_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_tags" ADD CONSTRAINT "location_tags_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_job_item_id_job_items_id_fk" FOREIGN KEY ("job_item_id") REFERENCES "public"."job_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_client_location_id_client_locations_id_fk" FOREIGN KEY ("client_location_id") REFERENCES "public"."client_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_email_group_locations" ADD CONSTRAINT "review_email_group_locations_group_id_review_email_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."review_email_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_email_group_locations" ADD CONSTRAINT "review_email_group_locations_location_id_client_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."client_locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_email_groups" ADD CONSTRAINT "review_email_groups_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suggested_edit_actions" ADD CONSTRAINT "suggested_edit_actions_client_location_id_client_locations_id_fk" FOREIGN KEY ("client_location_id") REFERENCES "public"."client_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suggested_edit_actions" ADD CONSTRAINT "suggested_edit_actions_local_user_id_local_users_id_fk" FOREIGN KEY ("local_user_id") REFERENCES "public"."local_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suggested_edits" ADD CONSTRAINT "suggested_edits_client_location_id_client_locations_id_fk" FOREIGN KEY ("client_location_id") REFERENCES "public"."client_locations"("id") ON DELETE no action ON UPDATE no action;