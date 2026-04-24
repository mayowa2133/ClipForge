import type { TProject } from "@/types/project";
import type {
	ClipForgeJobKind,
	ClipForgeJobStatus,
	ClipForgeProjectMode,
	CloudMediaObjectStatus,
	CloudProjectStorageStatus,
	ClipForgeShareRole,
	RightsSourceKind,
} from "@/types/production";
import type { PublishDestination } from "@/types/export";
import {
	boolean,
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
	id: text("id").primaryKey(),

	// todo: implement fully anonymous sign-in for privacy
	// we don't have any auth flows currently so this is fine for now
	name: text("name").notNull(),
	email: text("email").notNull().unique(),
	emailVerified: boolean("email_verified").default(false).notNull(),
	image: text("image"),
	createdAt: timestamp("created_at")
		.$defaultFn(() => /* @__PURE__ */ new Date())
		.notNull(),
	updatedAt: timestamp("updated_at")
		.$defaultFn(() => /* @__PURE__ */ new Date())
		.notNull(),
}).enableRLS();

export const sessions = pgTable("sessions", {
	id: text("id").primaryKey(),
	expiresAt: timestamp("expires_at").notNull(),
	token: text("token").notNull().unique(),
	createdAt: timestamp("created_at").notNull(),
	updatedAt: timestamp("updated_at").notNull(),
	ipAddress: text("ip_address"),
	userAgent: text("user_agent"),
	userId: text("user_id")
		.notNull()
		.references(() => users.id, { onDelete: "cascade" }),
}).enableRLS();

export const accounts = pgTable("accounts", {
	id: text("id").primaryKey(),
	accountId: text("account_id").notNull(),
	providerId: text("provider_id").notNull(),
	userId: text("user_id")
		.notNull()
		.references(() => users.id, { onDelete: "cascade" }),
	accessToken: text("access_token"),
	refreshToken: text("refresh_token"),
	idToken: text("id_token"),
	accessTokenExpiresAt: timestamp("access_token_expires_at"),
	refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
	scope: text("scope"),
	password: text("password"),
	createdAt: timestamp("created_at").notNull(),
	updatedAt: timestamp("updated_at").notNull(),
}).enableRLS();

export const verifications = pgTable("verifications", {
	id: text("id").primaryKey(),
	identifier: text("identifier").notNull(),
	value: text("value").notNull(),
	expiresAt: timestamp("expires_at").notNull(),
	createdAt: timestamp("created_at").$defaultFn(
		() => /* @__PURE__ */ new Date(),
	),
	updatedAt: timestamp("updated_at").$defaultFn(
		() => /* @__PURE__ */ new Date(),
	),
}).enableRLS();

export const waitlist = pgTable("waitlist", {
	id: text("id").primaryKey(),
	email: text("email").notNull().unique(),
	createdAt: timestamp("created_at")
		.$defaultFn(() => /* @__PURE__ */ new Date())
		.notNull(),
}).enableRLS();

export const clipforgeCloudProjects = pgTable(
	"clipforge_cloud_projects",
	{
		id: text("id").primaryKey(),
		ownerId: text("owner_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		mode: text("mode").$type<ClipForgeProjectMode>().notNull().default("cloud"),
		projectVersion: integer("project_version").notNull().default(0),
		projectJson: jsonb("project_json").$type<TProject | null>(),
		storageStatus: text("storage_status")
			.$type<CloudProjectStorageStatus>()
			.notNull()
			.default("local-only"),
		quotaBytesUsed: integer("quota_bytes_used").notNull().default(0),
		createdAt: timestamp("created_at")
			.$defaultFn(() => /* @__PURE__ */ new Date())
			.notNull(),
		updatedAt: timestamp("updated_at")
			.$defaultFn(() => /* @__PURE__ */ new Date())
			.notNull(),
	},
	(table) => [
		index("clipforge_cloud_projects_owner_idx").on(table.ownerId),
		index("clipforge_cloud_projects_updated_idx").on(table.updatedAt),
	],
).enableRLS();

export const clipforgeMediaObjects = pgTable(
	"clipforge_media_objects",
	{
		id: text("id").primaryKey(),
		projectId: text("project_id")
			.notNull()
			.references(() => clipforgeCloudProjects.id, { onDelete: "cascade" }),
		ownerId: text("owner_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		mediaId: text("media_id").notNull(),
		storageKey: text("storage_key").notNull(),
		bytes: integer("bytes").notNull().default(0),
		sha256: text("sha256"),
		status: text("status")
			.$type<CloudMediaObjectStatus>()
			.notNull()
			.default("queued"),
		encrypted: boolean("encrypted").notNull().default(true),
		createdAt: timestamp("created_at")
			.$defaultFn(() => /* @__PURE__ */ new Date())
			.notNull(),
		updatedAt: timestamp("updated_at")
			.$defaultFn(() => /* @__PURE__ */ new Date())
			.notNull(),
	},
	(table) => [
		index("clipforge_media_objects_project_idx").on(table.projectId),
		index("clipforge_media_objects_owner_idx").on(table.ownerId),
	],
).enableRLS();

export const clipforgeJobs = pgTable(
	"clipforge_jobs",
	{
		id: text("id").primaryKey(),
		ownerId: text("owner_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		projectId: text("project_id").references(() => clipforgeCloudProjects.id, {
			onDelete: "set null",
		}),
		kind: text("kind").$type<ClipForgeJobKind>().notNull(),
		status: text("status").$type<ClipForgeJobStatus>().notNull().default("queued"),
		provider: text("provider"),
		inputJson: jsonb("input_json")
			.$type<Record<string, unknown>>()
			.notNull()
			.default({}),
		resultJson: jsonb("result_json").$type<Record<string, unknown> | null>(),
		errorMessage: text("error_message"),
		progressPct: integer("progress_pct").notNull().default(0),
		createdAt: timestamp("created_at")
			.$defaultFn(() => /* @__PURE__ */ new Date())
			.notNull(),
		updatedAt: timestamp("updated_at")
			.$defaultFn(() => /* @__PURE__ */ new Date())
			.notNull(),
		startedAt: timestamp("started_at"),
		completedAt: timestamp("completed_at"),
	},
	(table) => [
		index("clipforge_jobs_owner_idx").on(table.ownerId),
		index("clipforge_jobs_project_idx").on(table.projectId),
		index("clipforge_jobs_status_idx").on(table.status),
	],
).enableRLS();

export const clipforgeShareLinks = pgTable(
	"clipforge_share_links",
	{
		id: text("id").primaryKey(),
		projectId: text("project_id")
			.notNull()
			.references(() => clipforgeCloudProjects.id, { onDelete: "cascade" }),
		ownerId: text("owner_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		token: text("token").notNull().unique(),
		role: text("role").$type<ClipForgeShareRole>().notNull().default("viewer"),
		expiresAt: timestamp("expires_at"),
		revokedAt: timestamp("revoked_at"),
		createdAt: timestamp("created_at")
			.$defaultFn(() => /* @__PURE__ */ new Date())
			.notNull(),
	},
	(table) => [
		index("clipforge_share_links_project_idx").on(table.projectId),
		index("clipforge_share_links_owner_idx").on(table.ownerId),
	],
).enableRLS();

export const clipforgeRightsReceipts = pgTable(
	"clipforge_rights_receipts",
	{
		id: text("id").primaryKey(),
		ownerId: text("owner_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		projectId: text("project_id").references(() => clipforgeCloudProjects.id, {
			onDelete: "set null",
		}),
		assetId: text("asset_id").notNull(),
		sourceKind: text("source_kind").$type<RightsSourceKind>().notNull(),
		licenseLabel: text("license_label").notNull(),
		destination: text("destination").$type<PublishDestination | null>(),
		receiptJson: jsonb("receipt_json")
			.$type<Record<string, unknown>>()
			.notNull()
			.default({}),
		createdAt: timestamp("created_at")
			.$defaultFn(() => /* @__PURE__ */ new Date())
			.notNull(),
	},
	(table) => [
		index("clipforge_rights_receipts_owner_idx").on(table.ownerId),
		index("clipforge_rights_receipts_project_idx").on(table.projectId),
	],
).enableRLS();
