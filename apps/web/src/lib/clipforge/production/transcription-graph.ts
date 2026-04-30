export interface TranscriptionGraphInput {
	contractVersion: 1;
	projectId: string | null;
	mediaId: string;
	mediaStorageKey: string;
	mediaContentType?: string | null;
	durationSeconds?: number | null;
	languageHint?: string | null;
	diarization?: boolean;
}

export interface TranscriptionWord {
	text: string;
	start_ms: number;
	end_ms: number;
	speaker?: string | null;
	confidence?: number | null;
}

export interface TranscriptionSegment {
	text: string;
	start_ms: number;
	end_ms: number;
	speaker?: string | null;
}

export interface TranscriptionGraphResult {
	contractVersion: 1;
	mediaId: string;
	language: string;
	words: TranscriptionWord[];
	segments: TranscriptionSegment[];
	providerId: string;
	stub: boolean;
	transcribedAt: string;
}

export interface BuildTranscriptionGraphArgs {
	projectId: string | null;
	mediaId: string;
	mediaStorageKey: string;
	mediaContentType?: string | null;
	durationSeconds?: number | null;
	languageHint?: string | null;
	diarization?: boolean;
}

export function buildTranscriptionGraphInput(
	args: BuildTranscriptionGraphArgs,
): TranscriptionGraphInput {
	return {
		contractVersion: 1,
		projectId: args.projectId,
		mediaId: args.mediaId,
		mediaStorageKey: args.mediaStorageKey,
		mediaContentType: args.mediaContentType ?? null,
		durationSeconds: args.durationSeconds ?? null,
		languageHint: args.languageHint ?? null,
		diarization: args.diarization ?? false,
	};
}

export function isTranscriptionGraphInput(
	value: unknown,
): value is TranscriptionGraphInput {
	if (!value || typeof value !== "object") return false;
	const candidate = value as Partial<TranscriptionGraphInput>;
	return (
		candidate.contractVersion === 1 &&
		typeof candidate.mediaId === "string" &&
		typeof candidate.mediaStorageKey === "string"
	);
}
