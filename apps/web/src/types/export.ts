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

export interface ExportDiagnostics {
	failureCode?: ExportFailureCode;
	failedFrameIndex?: number | null;
	failedTimeSeconds?: number | null;
	backendUsed: "binary-canvas" | "legacy-canvas";
	audioIncluded: boolean;
	format: ExportFormat;
	quality: ExportQuality;
}

export interface ExportOptions {
	format: ExportFormat;
	quality: ExportQuality;
	fps?: number;
	includeAudio?: boolean;
	onProgress?: ({ progress }: { progress: number }) => void;
	onCancel?: () => boolean;
}

export interface ExportResult {
	success: boolean;
	buffer?: ArrayBuffer;
	error?: string;
	cancelled?: boolean;
	diagnostics?: ExportDiagnostics;
}
