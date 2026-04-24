import type { PublishDestination } from "./export";
import type { TProject } from "./project";

export type ClipForgeProjectMode = "local" | "cloud";

export type CloudProjectStorageStatus =
	| "local-only"
	| "syncing"
	| "synced"
	| "attention"
	| "blocked";

export type CloudMediaObjectStatus =
	| "queued"
	| "uploading"
	| "stored"
	| "failed"
	| "deleted";

export type ClipForgeJobKind =
	| "transcription"
	| "export"
	| "publish"
	| "media-sync";

export type ClipForgeJobStatus =
	| "queued"
	| "processing"
	| "completed"
	| "failed"
	| "cancelled";

export type ClipForgeShareRole = "viewer" | "commenter" | "editor";

export type RightsSourceKind =
	| "bundled"
	| "licensed"
	| "imported-user-managed"
	| "trend-reference";

export type PlatformConnectionStatus =
	| "not-connected"
	| "connected"
	| "needs-refresh"
	| "disabled";

export type ProductionCapabilityId =
	| "cloud-projects"
	| "media-sync"
	| "managed-transcription"
	| "server-export"
	| "collaboration"
	| "ai-creative-scoring"
	| "publishing"
	| "rights-ledger"
	| "release-gates";

export type ProductionCapabilityStatus =
	| "available"
	| "scaffolded"
	| "needs-provider"
	| "planned";

export interface ProductionCapability {
	id: ProductionCapabilityId;
	label: string;
	status: ProductionCapabilityStatus;
	description: string;
	nextStep: string;
}

export interface CloudProjectRecord {
	id: string;
	ownerId: string;
	name: string;
	mode: ClipForgeProjectMode;
	projectVersion: number;
	project: TProject | null;
	storageStatus: CloudProjectStorageStatus;
	quotaBytesUsed: number;
	createdAt: string;
	updatedAt: string;
}

export interface CloudProjectListItem {
	id: string;
	name: string;
	mode: ClipForgeProjectMode;
	projectVersion: number;
	storageStatus: CloudProjectStorageStatus;
	quotaBytesUsed: number;
	createdAt: string;
	updatedAt: string;
}

export interface CloudMediaObjectRecord {
	id: string;
	projectId: string;
	ownerId: string;
	mediaId: string;
	storageKey: string;
	bytes: number;
	sha256: string | null;
	status: CloudMediaObjectStatus;
	encrypted: boolean;
	createdAt: string;
	updatedAt: string;
}

export interface ClipForgeJobRecord {
	id: string;
	ownerId: string;
	projectId: string | null;
	kind: ClipForgeJobKind;
	status: ClipForgeJobStatus;
	provider: string | null;
	input: Record<string, unknown>;
	result: Record<string, unknown> | null;
	errorMessage: string | null;
	progressPct: number;
	createdAt: string;
	updatedAt: string;
	startedAt: string | null;
	completedAt: string | null;
}

export interface ClipForgeShareLinkRecord {
	id: string;
	projectId: string;
	ownerId: string;
	token: string;
	role: ClipForgeShareRole;
	expiresAt: string | null;
	revokedAt: string | null;
	createdAt: string;
}

export interface RightsReceiptRecord {
	id: string;
	ownerId: string;
	projectId: string | null;
	assetId: string;
	sourceKind: RightsSourceKind;
	licenseLabel: string;
	destination: PublishDestination | null;
	receipt: Record<string, unknown>;
	createdAt: string;
}
