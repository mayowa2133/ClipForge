import type { TranscriptionEngine } from "./transcription-worker";
import type {
	TranscriptionGraphInput,
	TranscriptionSegment,
	TranscriptionWord,
} from "@/lib/clipforge/production/transcription-graph";

export interface ModalTranscriptionEngineArgs {
	endpoint: string;
	apiKey?: string | null;
	id?: string;
	fetchImpl?: typeof fetch;
	timeoutMs?: number;
}

interface ModalTranscriptionResponse {
	language?: string;
	words?: Array<{
		text: string;
		start_ms?: number;
		end_ms?: number;
		start?: number;
		end?: number;
		speaker?: string | null;
		confidence?: number | null;
	}>;
	segments?: Array<{
		text: string;
		start_ms?: number;
		end_ms?: number;
		start?: number;
		end?: number;
		speaker?: string | null;
	}>;
}

function toMs(value: number | undefined, fallbackSeconds: number | undefined): number {
	if (typeof value === "number" && Number.isFinite(value)) return Math.round(value);
	if (typeof fallbackSeconds === "number" && Number.isFinite(fallbackSeconds)) {
		return Math.round(fallbackSeconds * 1000);
	}
	return 0;
}

export class ModalTranscriptionEngine implements TranscriptionEngine {
	readonly id: string;
	private readonly endpoint: string;
	private readonly apiKey: string | null;
	private readonly fetchImpl: typeof fetch;
	private readonly timeoutMs: number;

	constructor({
		endpoint,
		apiKey = null,
		id = "clipforge-modal-transcriber",
		fetchImpl,
		timeoutMs = 5 * 60_000,
	}: ModalTranscriptionEngineArgs) {
		this.endpoint = endpoint;
		this.apiKey = apiKey;
		this.id = id;
		this.fetchImpl = fetchImpl ?? fetch;
		this.timeoutMs = timeoutMs;
	}

	async transcribe({
		input,
		mediaDownloadUrl,
		onProgress,
	}: {
		input: TranscriptionGraphInput;
		mediaDownloadUrl: string;
		onProgress: (pct: number) => Promise<void>;
	}): Promise<{
		words: TranscriptionWord[];
		segments: TranscriptionSegment[];
		language: string;
		stub: boolean;
	}> {
		await onProgress(15);
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

		const headers: Record<string, string> = { "content-type": "application/json" };
		if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;

		try {
			const response = await this.fetchImpl(this.endpoint, {
				method: "POST",
				headers,
				body: JSON.stringify({
					mediaUrl: mediaDownloadUrl,
					mediaId: input.mediaId,
					languageHint: input.languageHint ?? null,
					diarization: input.diarization ?? false,
					contentType: input.mediaContentType ?? null,
				}),
				signal: controller.signal,
			});

			if (!response.ok) {
				const errorText = await response.text().catch(() => "");
				throw new Error(
					`Modal transcription endpoint returned ${response.status}: ${errorText.slice(0, 200)}`,
				);
			}

			const body = (await response.json()) as ModalTranscriptionResponse;
			await onProgress(85);

			const segments: TranscriptionSegment[] = (body.segments ?? []).map((segment) => ({
				text: segment.text,
				start_ms: toMs(segment.start_ms, segment.start),
				end_ms: toMs(segment.end_ms, segment.end),
				speaker: segment.speaker ?? null,
			}));

			const words: TranscriptionWord[] = (body.words ?? []).map((word) => ({
				text: word.text,
				start_ms: toMs(word.start_ms, word.start),
				end_ms: toMs(word.end_ms, word.end),
				speaker: word.speaker ?? null,
				confidence: word.confidence ?? null,
			}));

			return {
				words,
				segments,
				language: body.language ?? input.languageHint ?? "en",
				stub: false,
			};
		} finally {
			clearTimeout(timeout);
		}
	}
}
