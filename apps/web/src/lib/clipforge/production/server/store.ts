import { and, desc, eq } from "drizzle-orm";
import {
	clipforgeCloudProjects,
	clipforgeJobs,
	clipforgeMediaObjects,
	clipforgeRightsReceipts,
	clipforgeShareLinks,
	db,
} from "@/lib/db";
import { clampJobProgress, canTransitionClipForgeJob } from "@/lib/clipforge/production/jobs";
import type { PublishDestination } from "@/types/export";
import type { TProject } from "@/types/project";
import type {
	ClipForgeJobKind,
	ClipForgeJobRecord,
	ClipForgeJobStatus,
	ClipForgeShareLinkRecord,
	CloudMediaObjectRecord,
	CloudMediaObjectStatus,
	CloudProjectListItem,
	CloudProjectRecord,
	CloudProjectStorageStatus,
	RightsReceiptRecord,
	RightsSourceKind,
	ClipForgeShareRole,
} from "@/types/production";

function createId(prefix: string): string {
	return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
}

class ClipForgeStoreError extends Error {
	constructor(message: string, readonly status: number) {
		super(message);
	}
}

function serializeDate(date: Date | null): string | null {
	return date ? date.toISOString() : null;
}

function serializeProjectRow(
	row: typeof clipforgeCloudProjects.$inferSelect,
): CloudProjectRecord {
	return {
		id: row.id,
		ownerId: row.ownerId,
		name: row.name,
		mode: row.mode,
		projectVersion: row.projectVersion,
		project: row.projectJson ?? null,
		storageStatus: row.storageStatus,
		quotaBytesUsed: row.quotaBytesUsed,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
	};
}

function serializeProjectListRow(
	row: typeof clipforgeCloudProjects.$inferSelect,
): CloudProjectListItem {
	return {
		id: row.id,
		name: row.name,
		mode: row.mode,
		projectVersion: row.projectVersion,
		storageStatus: row.storageStatus,
		quotaBytesUsed: row.quotaBytesUsed,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
	};
}

function serializeJobRow(row: typeof clipforgeJobs.$inferSelect): ClipForgeJobRecord {
	return {
		id: row.id,
		ownerId: row.ownerId,
		projectId: row.projectId,
		kind: row.kind,
		status: row.status,
		provider: row.provider,
		input: row.inputJson,
		result: row.resultJson ?? null,
		errorMessage: row.errorMessage,
		progressPct: row.progressPct,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
		startedAt: serializeDate(row.startedAt),
		completedAt: serializeDate(row.completedAt),
	};
}

function serializeMediaRow(
	row: typeof clipforgeMediaObjects.$inferSelect,
): CloudMediaObjectRecord {
	return {
		id: row.id,
		projectId: row.projectId,
		ownerId: row.ownerId,
		mediaId: row.mediaId,
		storageKey: row.storageKey,
		bytes: row.bytes,
		sha256: row.sha256,
		status: row.status,
		encrypted: row.encrypted,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
	};
}

function serializeShareRow(
	row: typeof clipforgeShareLinks.$inferSelect,
): ClipForgeShareLinkRecord {
	return {
		id: row.id,
		projectId: row.projectId,
		ownerId: row.ownerId,
		token: row.token,
		role: row.role,
		expiresAt: serializeDate(row.expiresAt),
		revokedAt: serializeDate(row.revokedAt),
		createdAt: row.createdAt.toISOString(),
	};
}

function serializeRightsRow(
	row: typeof clipforgeRightsReceipts.$inferSelect,
): RightsReceiptRecord {
	return {
		id: row.id,
		ownerId: row.ownerId,
		projectId: row.projectId,
		assetId: row.assetId,
		sourceKind: row.sourceKind,
		licenseLabel: row.licenseLabel,
		destination: row.destination,
		receipt: row.receiptJson,
		createdAt: row.createdAt.toISOString(),
	};
}

async function requireOwnedCloudProjectId({
	ownerId,
	projectId,
}: {
	ownerId: string;
	projectId?: string | null;
}): Promise<string | null> {
	if (!projectId) return null;

	const [project] = await db
		.select({ id: clipforgeCloudProjects.id })
		.from(clipforgeCloudProjects)
		.where(
			and(
				eq(clipforgeCloudProjects.id, projectId),
				eq(clipforgeCloudProjects.ownerId, ownerId),
			),
		)
		.limit(1);
	if (!project) {
		throw new ClipForgeStoreError("Cloud project not found.", 404);
	}
	return project.id;
}

export async function listCloudProjects({
	ownerId,
}: {
	ownerId: string;
}): Promise<CloudProjectListItem[]> {
	const rows = await db
		.select()
		.from(clipforgeCloudProjects)
		.where(eq(clipforgeCloudProjects.ownerId, ownerId))
		.orderBy(desc(clipforgeCloudProjects.updatedAt))
		.limit(100);
	return rows.map(serializeProjectListRow);
}

export async function createCloudProject({
	ownerId,
	name,
	project,
	storageStatus = "local-only",
}: {
	ownerId: string;
	name: string;
	project: TProject | null;
	storageStatus?: CloudProjectStorageStatus;
}): Promise<CloudProjectRecord> {
	const now = new Date();
	const [row] = await db
		.insert(clipforgeCloudProjects)
		.values({
			id: createId("proj"),
			ownerId,
			name,
			mode: "cloud",
			projectVersion: project?.version ?? 0,
			projectJson: project,
			storageStatus,
			createdAt: now,
			updatedAt: now,
		})
		.returning();
	return serializeProjectRow(row);
}

export async function getCloudProject({
	ownerId,
	projectId,
}: {
	ownerId: string;
	projectId: string;
}): Promise<CloudProjectRecord | null> {
	const [row] = await db
		.select()
		.from(clipforgeCloudProjects)
		.where(
			and(
				eq(clipforgeCloudProjects.id, projectId),
				eq(clipforgeCloudProjects.ownerId, ownerId),
			),
		)
		.limit(1);
	return row ? serializeProjectRow(row) : null;
}

export async function updateCloudProject({
	ownerId,
	projectId,
	name,
	project,
	storageStatus,
}: {
	ownerId: string;
	projectId: string;
	name?: string;
	project?: TProject | null;
	storageStatus?: CloudProjectStorageStatus;
}): Promise<CloudProjectRecord | null> {
	const values: Partial<typeof clipforgeCloudProjects.$inferInsert> = {
		updatedAt: new Date(),
	};
	if (name !== undefined) values.name = name;
	if (project !== undefined) {
		values.projectJson = project;
		values.projectVersion = project?.version ?? 0;
	}
	if (storageStatus !== undefined) values.storageStatus = storageStatus;

	const [row] = await db
		.update(clipforgeCloudProjects)
		.set(values)
		.where(
			and(
				eq(clipforgeCloudProjects.id, projectId),
				eq(clipforgeCloudProjects.ownerId, ownerId),
			),
		)
		.returning();
	return row ? serializeProjectRow(row) : null;
}

export async function createMediaObjectRecord({
	ownerId,
	projectId,
	mediaId,
	storageKey,
	bytes,
	sha256,
	status = "queued",
	encrypted = true,
}: {
	ownerId: string;
	projectId: string;
	mediaId: string;
	storageKey: string;
	bytes: number;
	sha256?: string | null;
	status?: CloudMediaObjectStatus;
	encrypted?: boolean;
}): Promise<CloudMediaObjectRecord> {
	await requireOwnedCloudProjectId({ ownerId, projectId });
	const now = new Date();
	const [row] = await db
		.insert(clipforgeMediaObjects)
		.values({
			id: createId("media"),
			projectId,
			ownerId,
			mediaId,
			storageKey,
			bytes,
			sha256: sha256 ?? null,
			status,
			encrypted,
			createdAt: now,
			updatedAt: now,
		})
		.returning();
	return serializeMediaRow(row);
}

export async function listMediaObjects({
	ownerId,
	projectId,
}: {
	ownerId: string;
	projectId: string;
}): Promise<CloudMediaObjectRecord[]> {
	await requireOwnedCloudProjectId({ ownerId, projectId });
	const rows = await db
		.select()
		.from(clipforgeMediaObjects)
		.where(
			and(
				eq(clipforgeMediaObjects.ownerId, ownerId),
				eq(clipforgeMediaObjects.projectId, projectId),
			),
		)
		.orderBy(desc(clipforgeMediaObjects.createdAt))
		.limit(500);
	return rows.map(serializeMediaRow);
}

export async function getMediaObject({
	ownerId,
	mediaObjectId,
}: {
	ownerId: string;
	mediaObjectId: string;
}): Promise<CloudMediaObjectRecord | null> {
	const [row] = await db
		.select()
		.from(clipforgeMediaObjects)
		.where(
			and(
				eq(clipforgeMediaObjects.id, mediaObjectId),
				eq(clipforgeMediaObjects.ownerId, ownerId),
			),
		)
		.limit(1);
	return row ? serializeMediaRow(row) : null;
}

export async function updateMediaObjectStatus({
	ownerId,
	mediaObjectId,
	status,
	bytes,
	sha256,
}: {
	ownerId: string;
	mediaObjectId: string;
	status: CloudMediaObjectStatus;
	bytes?: number;
	sha256?: string | null;
}): Promise<CloudMediaObjectRecord | null> {
	const values: Partial<typeof clipforgeMediaObjects.$inferInsert> = {
		status,
		updatedAt: new Date(),
	};
	if (bytes !== undefined) values.bytes = Math.max(0, Math.round(bytes));
	if (sha256 !== undefined) values.sha256 = sha256;

	const [row] = await db
		.update(clipforgeMediaObjects)
		.set(values)
		.where(
			and(
				eq(clipforgeMediaObjects.id, mediaObjectId),
				eq(clipforgeMediaObjects.ownerId, ownerId),
			),
		)
		.returning();
	return row ? serializeMediaRow(row) : null;
}

export async function listJobs({
	ownerId,
	projectId,
}: {
	ownerId: string;
	projectId?: string | null;
}): Promise<ClipForgeJobRecord[]> {
	const where = projectId
		? and(eq(clipforgeJobs.ownerId, ownerId), eq(clipforgeJobs.projectId, projectId))
		: eq(clipforgeJobs.ownerId, ownerId);
	const rows = await db
		.select()
		.from(clipforgeJobs)
		.where(where)
		.orderBy(desc(clipforgeJobs.createdAt))
		.limit(100);
	return rows.map(serializeJobRow);
}

export async function createJob({
	ownerId,
	projectId,
	kind,
	provider,
	input,
}: {
	ownerId: string;
	projectId?: string | null;
	kind: ClipForgeJobKind;
	provider?: string | null;
	input: Record<string, unknown>;
}): Promise<ClipForgeJobRecord> {
	const ownedProjectId = await requireOwnedCloudProjectId({ ownerId, projectId });
	const now = new Date();
	const [row] = await db
		.insert(clipforgeJobs)
		.values({
			id: createId("job"),
			ownerId,
			projectId: ownedProjectId,
			kind,
			status: "queued",
			provider: provider ?? null,
			inputJson: input,
			progressPct: 0,
			createdAt: now,
			updatedAt: now,
		})
		.returning();
	return serializeJobRow(row);
}

export async function updateJobStatus({
	ownerId,
	jobId,
	status,
	progressPct,
	result,
	errorMessage,
}: {
	ownerId: string;
	jobId: string;
	status: ClipForgeJobStatus;
	progressPct?: number;
	result?: Record<string, unknown> | null;
	errorMessage?: string | null;
}): Promise<ClipForgeJobRecord | null> {
	const current = await db
		.select()
		.from(clipforgeJobs)
		.where(and(eq(clipforgeJobs.id, jobId), eq(clipforgeJobs.ownerId, ownerId)))
		.limit(1);
	const existing = current[0];
	if (!existing) return null;
	if (!canTransitionClipForgeJob({ from: existing.status, to: status })) {
		throw new ClipForgeStoreError(
			`Cannot transition job from ${existing.status} to ${status}.`,
			409,
		);
	}

	const now = new Date();
	const [row] = await db
		.update(clipforgeJobs)
		.set({
			status,
			progressPct:
				progressPct !== undefined ? clampJobProgress(progressPct) : existing.progressPct,
			resultJson: result !== undefined ? result : existing.resultJson,
			errorMessage:
				errorMessage !== undefined ? errorMessage : existing.errorMessage,
			startedAt:
				status === "processing" && !existing.startedAt ? now : existing.startedAt,
			completedAt:
				status === "completed" || status === "failed" || status === "cancelled"
					? now
					: existing.completedAt,
			updatedAt: now,
		})
		.where(and(eq(clipforgeJobs.id, jobId), eq(clipforgeJobs.ownerId, ownerId)))
		.returning();
	return row ? serializeJobRow(row) : null;
}

export async function listShareLinks({
	ownerId,
	projectId,
}: {
	ownerId: string;
	projectId: string;
}): Promise<ClipForgeShareLinkRecord[]> {
	const rows = await db
		.select()
		.from(clipforgeShareLinks)
		.where(
			and(
				eq(clipforgeShareLinks.ownerId, ownerId),
				eq(clipforgeShareLinks.projectId, projectId),
			),
		)
		.orderBy(desc(clipforgeShareLinks.createdAt));
	return rows.map(serializeShareRow);
}

export async function createShareLink({
	ownerId,
	projectId,
	role,
	expiresAt,
}: {
	ownerId: string;
	projectId: string;
	role: ClipForgeShareRole;
	expiresAt?: Date | null;
}): Promise<ClipForgeShareLinkRecord> {
	await requireOwnedCloudProjectId({ ownerId, projectId });

	const [row] = await db
		.insert(clipforgeShareLinks)
		.values({
			id: createId("share"),
			projectId,
			ownerId,
			token: createId("token"),
			role,
			expiresAt: expiresAt ?? null,
			createdAt: new Date(),
		})
		.returning();
	return serializeShareRow(row);
}

export interface ResolvedShareLink {
	share: ClipForgeShareLinkRecord;
	project: CloudProjectRecord;
}

export async function resolveShareLinkByToken({
	token,
}: {
	token: string;
}): Promise<ResolvedShareLink | null> {
	const [shareRow] = await db
		.select()
		.from(clipforgeShareLinks)
		.where(eq(clipforgeShareLinks.token, token))
		.limit(1);
	if (!shareRow) return null;
	if (shareRow.revokedAt) return null;
	if (shareRow.expiresAt && shareRow.expiresAt.getTime() < Date.now()) return null;

	const [projectRow] = await db
		.select()
		.from(clipforgeCloudProjects)
		.where(eq(clipforgeCloudProjects.id, shareRow.projectId))
		.limit(1);
	if (!projectRow) return null;

	return {
		share: serializeShareRow(shareRow),
		project: serializeProjectRow(projectRow),
	};
}

export async function revokeShareLink({
	ownerId,
	shareLinkId,
}: {
	ownerId: string;
	shareLinkId: string;
}): Promise<ClipForgeShareLinkRecord | null> {
	const [row] = await db
		.update(clipforgeShareLinks)
		.set({ revokedAt: new Date() })
		.where(
			and(
				eq(clipforgeShareLinks.id, shareLinkId),
				eq(clipforgeShareLinks.ownerId, ownerId),
			),
		)
		.returning();
	return row ? serializeShareRow(row) : null;
}

export async function listRightsReceipts({
	ownerId,
	projectId,
}: {
	ownerId: string;
	projectId?: string | null;
}): Promise<RightsReceiptRecord[]> {
	const where = projectId
		? and(
				eq(clipforgeRightsReceipts.ownerId, ownerId),
				eq(clipforgeRightsReceipts.projectId, projectId),
			)
		: eq(clipforgeRightsReceipts.ownerId, ownerId);
	const rows = await db
		.select()
		.from(clipforgeRightsReceipts)
		.where(where)
		.orderBy(desc(clipforgeRightsReceipts.createdAt))
		.limit(100);
	return rows.map(serializeRightsRow);
}

export async function createRightsReceipt({
	ownerId,
	projectId,
	assetId,
	sourceKind,
	licenseLabel,
	destination,
	receipt,
}: {
	ownerId: string;
	projectId?: string | null;
	assetId: string;
	sourceKind: RightsSourceKind;
	licenseLabel: string;
	destination?: PublishDestination | null;
	receipt: Record<string, unknown>;
}): Promise<RightsReceiptRecord> {
	const ownedProjectId = await requireOwnedCloudProjectId({ ownerId, projectId });
	const [row] = await db
		.insert(clipforgeRightsReceipts)
		.values({
			id: createId("rights"),
			ownerId,
			projectId: ownedProjectId,
			assetId,
			sourceKind,
			licenseLabel,
			destination: destination ?? null,
			receiptJson: receipt,
			createdAt: new Date(),
		})
		.returning();
	return serializeRightsRow(row);
}
