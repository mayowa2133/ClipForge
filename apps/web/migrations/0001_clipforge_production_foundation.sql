CREATE TABLE "clipforge_cloud_projects" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"name" text NOT NULL,
	"mode" text DEFAULT 'cloud' NOT NULL,
	"project_version" integer DEFAULT 0 NOT NULL,
	"project_json" jsonb,
	"storage_status" text DEFAULT 'local-only' NOT NULL,
	"quota_bytes_used" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "clipforge_cloud_projects" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "clipforge_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"project_id" text,
	"kind" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"provider" text,
	"input_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"result_json" jsonb,
	"error_message" text,
	"progress_pct" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	"started_at" timestamp,
	"completed_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "clipforge_jobs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "clipforge_media_objects" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"media_id" text NOT NULL,
	"storage_key" text NOT NULL,
	"bytes" integer DEFAULT 0 NOT NULL,
	"sha256" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"encrypted" boolean DEFAULT true NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "clipforge_media_objects" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "clipforge_rights_receipts" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"project_id" text,
	"asset_id" text NOT NULL,
	"source_kind" text NOT NULL,
	"license_label" text NOT NULL,
	"destination" text,
	"receipt_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "clipforge_rights_receipts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "clipforge_share_links" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"token" text NOT NULL,
	"role" text DEFAULT 'viewer' NOT NULL,
	"expires_at" timestamp,
	"revoked_at" timestamp,
	"created_at" timestamp NOT NULL,
	CONSTRAINT "clipforge_share_links_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "clipforge_share_links" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "email_verified" SET DEFAULT false;--> statement-breakpoint
ALTER TABLE "clipforge_cloud_projects" ADD CONSTRAINT "clipforge_cloud_projects_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clipforge_jobs" ADD CONSTRAINT "clipforge_jobs_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clipforge_jobs" ADD CONSTRAINT "clipforge_jobs_project_id_clipforge_cloud_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."clipforge_cloud_projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clipforge_media_objects" ADD CONSTRAINT "clipforge_media_objects_project_id_clipforge_cloud_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."clipforge_cloud_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clipforge_media_objects" ADD CONSTRAINT "clipforge_media_objects_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clipforge_rights_receipts" ADD CONSTRAINT "clipforge_rights_receipts_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clipforge_rights_receipts" ADD CONSTRAINT "clipforge_rights_receipts_project_id_clipforge_cloud_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."clipforge_cloud_projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clipforge_share_links" ADD CONSTRAINT "clipforge_share_links_project_id_clipforge_cloud_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."clipforge_cloud_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clipforge_share_links" ADD CONSTRAINT "clipforge_share_links_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "clipforge_cloud_projects_owner_idx" ON "clipforge_cloud_projects" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "clipforge_cloud_projects_updated_idx" ON "clipforge_cloud_projects" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "clipforge_jobs_owner_idx" ON "clipforge_jobs" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "clipforge_jobs_project_idx" ON "clipforge_jobs" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "clipforge_jobs_status_idx" ON "clipforge_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "clipforge_media_objects_project_idx" ON "clipforge_media_objects" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "clipforge_media_objects_owner_idx" ON "clipforge_media_objects" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "clipforge_rights_receipts_owner_idx" ON "clipforge_rights_receipts" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "clipforge_rights_receipts_project_idx" ON "clipforge_rights_receipts" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "clipforge_share_links_project_idx" ON "clipforge_share_links" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "clipforge_share_links_owner_idx" ON "clipforge_share_links" USING btree ("owner_id");