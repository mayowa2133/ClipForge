import type {
	ClipTranscriptionInput,
	ClipTranscriptionResult,
	Transcriber,
} from "@/lib/clipforge/transcription";
import {
	uploadMediaAssetToCloud,
	type CreateMediaObjectResult,
} from "@/lib/clipforge/production/cloud-projects-client";
import {
	pollTranscriptionJob,
	submitTranscriptionJob,
} from "@/lib/clipforge/production/transcription-jobs-client";
import type {
	TranscriptionGraphResult,
	TranscriptionSegment,
	TranscriptionWord,
} from "@/lib/clipforge/production/transcription-graph";
import type { MediaAsset } from "@/types/assets";
import type { ClipForgeJobRecord } from "@/types/production";
import type { TranscriptSegment, TranscriptWord } from "@/types/clipforge";

export interface ManagedCloudTranscriberArgs {
	resolveCloudProjectId: (
		mediaAsset: MediaAsset,
	) => Promise<string | null>;
	resolveExistingMedia?: (args: {
		cloudProjectId: string;
		mediaAsset: MediaAsset;
	}) => Promise<{ mediaId: string; storageKey: string } | null>;
	pollIntervalMs?: number;
	pollTimeoutMs?: number;
	onProgress?: (job: ClipForgeJobRecord) => void;
	uploader?: typeof uploadMediaAssetToCloud;
}

const CLOUD_PROVIDER_ID = "managed-cloud" as const;

export class ManagedCloudTranscriber implements Transcriber {
	private readonly resolveCloudProjectId: ManagedCloudTranscriberArgs["resolveCloudProjectId"];
	private readonly resolveExistingMedia: ManagedCloudTranscriberArgs["resolveExistingMedia"];
	private readonly pollIntervalMs: number;
	private readonly pollTimeoutMs: number;
	private readonly onProgress?: (job: ClipForgeJobRecord) => void;
	private readonly uploader: typeof uploadMediaAssetToCloud;

	constructor(args: ManagedCloudTranscriberArgs) {
		this.resolveCloudProjectId = args.resolveCloudProjectId;
		this.resolveExistingMedia = args.resolveExistingMedia;
		this.pollIntervalMs = args.pollIntervalMs ?? 2_000;
		this.pollTimeoutMs = args.pollTimeoutMs ?? 5 * 60_000;
		this.onProgress = args.onProgress;
		this.uploader = args.uploader ?? uploadMediaAssetToCloud;
	}

	async transcribe(
		input: ClipTranscriptionInput,
	): Promise<ClipTranscriptionResult> {
		const cloudProjectId = await this.resolveCloudProjectId(input.mediaAsset);
		if (!cloudProjectId) {
			throw new Error(
				"ManagedCloudTranscriber: no cloud project found for this asset; save the project to cloud first.",
			);
		}

		const upload = await this.ensureUploaded({
			cloudProjectId,
			mediaAsset: input.mediaAsset,
		});

		const job = await submitTranscriptionJob({
			cloudProjectId,
			mediaId: upload.mediaId,
			mediaStorageKey: upload.storageKey,
			mediaContentType: input.mediaAsset.file?.type ?? null,
			durationSeconds: input.mediaAsset.duration ?? null,
			languageHint: input.language ?? null,
		});

		const polled = await pollTranscriptionJob({
			jobId: job.id,
			pollIntervalMs: this.pollIntervalMs,
			timeoutMs: this.pollTimeoutMs,
			onProgress: this.onProgress,
		});

		if (polled.job.status === "failed" || polled.job.status === "cancelled") {
			throw new Error(
				polled.job.errorMessage ??
					`Transcription job ended with status ${polled.job.status}`,
			);
		}
		if (!polled.result) {
			throw new Error(
				"Transcription job completed but result payload is missing or invalid.",
			);
		}

		return convertToClipResult({
			result: polled.result,
			fallbackLanguage: input.language ?? null,
		});
	}

	private async ensureUploaded({
		cloudProjectId,
		mediaAsset,
	}: {
		cloudProjectId: string;
		mediaAsset: MediaAsset;
	}): Promise<{ mediaId: string; storageKey: string }> {
		if (this.resolveExistingMedia) {
			const existing = await this.resolveExistingMedia({
				cloudProjectId,
				mediaAsset,
			});
			if (existing) return existing;
		}

		const file = mediaAsset.file;
		if (!file) {
			throw new Error(
				`ManagedCloudTranscriber: media asset ${mediaAsset.id} has no file blob to upload.`,
			);
		}

		const uploaded = await this.uploader({
			projectId: cloudProjectId,
			mediaId: mediaAsset.id,
			file,
			contentType: file.type,
		});
		const summary: Pick<CreateMediaObjectResult["mediaObject"], "mediaId" | "storageKey"> =
			uploaded;
		return { mediaId: summary.mediaId, storageKey: summary.storageKey };
	}
}

function convertToClipResult({
	result,
	fallbackLanguage,
}: {
	result: TranscriptionGraphResult;
	fallbackLanguage: string | null;
}): ClipTranscriptionResult {
	const words: TranscriptWord[] = result.words.map((word: TranscriptionWord) => ({
		text: word.text,
		start_ms: Math.max(0, Math.round(word.start_ms ?? 0)),
		end_ms: Math.max(0, Math.round(word.end_ms ?? 0)),
	}));
	const segments: TranscriptSegment[] = result.segments.map(
		(segment: TranscriptionSegment) => ({
			text: segment.text,
			start_ms: Math.max(0, Math.round(segment.start_ms ?? 0)),
			end_ms: Math.max(0, Math.round(segment.end_ms ?? 0)),
		}),
	);

	const warnings: string[] = [];
	if (result.stub) {
		warnings.push(
			"Transcription returned by stub cloud worker; results are placeholders.",
		);
	}
	if (result.providerId && result.providerId !== "clipforge-modal-transcriber") {
		// Surface the underlying engine in warnings (helpful for debugging).
		warnings.push(`Cloud provider id: ${result.providerId}`);
	}
	return {
		words,
		segments,
		language: result.language ?? fallbackLanguage ?? undefined,
		provider: CLOUD_PROVIDER_ID,
		warnings: warnings.length > 0 ? warnings : undefined,
	};
}
