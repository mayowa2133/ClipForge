import type { ProjectVersionTarget } from "./project";

export const EXPORT_QUALITY_VALUES = [
	"low",
	"medium",
	"high",
	"very_high",
] as const;

export const EXPORT_FORMAT_VALUES = ["mp4", "webm"] as const;

export type ExportFormat = (typeof EXPORT_FORMAT_VALUES)[number];
export type ExportQuality = (typeof EXPORT_QUALITY_VALUES)[number];
export type ExportFailureCode =
	| "no-active-project"
	| "empty-project"
	| "audio-mix-failed"
	| "render-frame-failed"
	| "encoder-init-failed"
	| "encoder-finalize-failed"
	| "cancelled"
	| "unknown";

export type ExportPreflightSeverity = "error" | "warning";

export type ExportPreflightCode =
	| "no-active-project"
	| "empty-project"
	| "no-supported-video-segments"
	| "missing-media-asset"
	| "unsupported-media-type"
	| "media-compatibility-unverified"
	| "unsupported-media-codec"
	| "unsupported-audio-decode"
	| "invalid-segment-range"
	| "timeline-duration-mismatch"
	| "audio-disabled-warning"
	| "low-quality-warning"
	| "webm-compat-warning"
	| "version-safe-area-warning"
	| "version-text-overflow-warning"
	| "version-hidden-warning"
	| "unknown";

export type ExportPreflightAction =
	| "remove-missing-segments"
	| "remove-invalid-ranges"
	| "normalize-duration"
	| "switch-format-mp4"
	| "switch-quality-medium"
	| "scan-media-compatibility"
	| "disable-export-audio";

export interface ExportPreflightIssue {
	id: string;
	code: ExportPreflightCode;
	severity: ExportPreflightSeverity;
	message: string;
	actionable: boolean;
	action?: ExportPreflightAction | null;
	trackId?: string | null;
	segmentId?: string | null;
	mediaId?: string | null;
	referenceCount?: number;
	allowedReplacementTypes?: Array<"video" | "image" | "audio"> | null;
	compatibilityStatus?:
		| "unknown"
		| "pending"
		| "compatible"
		| "incompatible"
		| "error"
		| null;
	compatibilityReason?: string | null;
	compatibilityCheckedAt?: string | null;
	targetVersionId?: ProjectVersionTarget | null;
}

export interface ExportPreflightResult {
	ready: boolean;
	issues: ExportPreflightIssue[];
	blockingCount: number;
	warningCount: number;
	computedAt: string;
	healthFingerprint: string;
}

export type ExportRetryProfile =
	| "same-settings"
	| "safe-mp4-medium"
	| "safe-mp4-medium-no-audio";

export interface ExportRecoveryRecommendation {
	recommendedProfile: ExportRetryProfile | null;
	reason: string;
	canRetry: boolean;
}

export interface ExportDiagnostics {
	failureCode?: ExportFailureCode;
	failedFrameIndex?: number | null;
	failedTimeSeconds?: number | null;
	backendUsed: "binary-canvas" | "legacy-canvas";
	audioIncluded: boolean;
	format: ExportFormat;
	quality: ExportQuality;
}

export interface ExportIncidentAttempt {
	attemptIndex: number;
	timestamp: string;
	format: ExportFormat;
	quality: ExportQuality;
	includeAudio: boolean;
	result: "success" | "failed" | "cancelled";
	error?: string;
	diagnostics?: ExportDiagnostics;
}

export interface ExportIncidentBundle {
	bundleVersion: 1;
	projectId: string | null;
	projectName: string | null;
	preflightResult?: ExportPreflightResult | null;
	attempts: ExportIncidentAttempt[];
	finalFailure?: {
		error: string;
		diagnostics?: ExportDiagnostics;
	} | null;
	generatedAt: string;
}

export interface ExportOptions {
	format: ExportFormat;
	quality: ExportQuality;
	fps?: number;
	includeAudio?: boolean;
	targetVersionId?: ProjectVersionTarget | null;
	onProgress?: ({ progress }: { progress: number }) => void;
	onCancel?: () => boolean;
}

export interface ExportVersionSummary {
	targetVersionId: ProjectVersionTarget;
	success: boolean;
	error?: string;
}

export interface ExportVersionPackSummary {
	results: ExportVersionSummary[];
}

export interface ExportResult {
	success: boolean;
	buffer?: ArrayBuffer;
	error?: string;
	cancelled?: boolean;
	diagnostics?: ExportDiagnostics;
}
