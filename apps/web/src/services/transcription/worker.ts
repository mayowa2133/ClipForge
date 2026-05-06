import {
	pipeline,
	type AutomaticSpeechRecognitionPipeline,
	type AutomaticSpeechRecognitionOutput,
} from "@huggingface/transformers";
import type {
	TranscriptionSegment,
	TranscriptionWord,
} from "@/types/transcription";
import {
	DEFAULT_CHUNK_LENGTH_SECONDS,
	DEFAULT_STRIDE_SECONDS,
} from "@/constants/transcription-constants";

export type WorkerMessage =
	| { type: "init"; modelId: string }
	| { type: "transcribe"; audio: Float32Array; language: string }
	| { type: "cancel" };

export type WorkerResponse =
	| { type: "init-progress"; progress: number }
	| { type: "init-complete" }
	| { type: "init-error"; error: string }
	| { type: "transcribe-progress"; progress: number }
	| {
			type: "transcribe-complete";
			text: string;
			segments: TranscriptionSegment[];
			words: TranscriptionWord[];
	  }
	| { type: "transcribe-error"; error: string }
	| { type: "cancelled" };

let transcriber: AutomaticSpeechRecognitionPipeline | null = null;
let cancelled = false;
let lastReportedProgress = -1;
const fileBytes = new Map<string, { loaded: number; total: number }>();

self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
	const message = event.data;

	switch (message.type) {
		case "init":
			await handleInit({ modelId: message.modelId });
			break;
		case "transcribe":
			await handleTranscribe({
				audio: message.audio,
				language: message.language,
			});
			break;
		case "cancel":
			cancelled = true;
			self.postMessage({ type: "cancelled" } satisfies WorkerResponse);
			break;
	}
};

async function handleInit({ modelId }: { modelId: string }) {
	lastReportedProgress = -1;
	fileBytes.clear();

	try {
		transcriber = (await pipeline("automatic-speech-recognition", modelId, {
			dtype: "q4",
			device: "auto",
			progress_callback: (progressInfo: {
				status?: string;
				file?: string;
				loaded?: number;
				total?: number;
			}) => {
				const file = progressInfo.file;
				if (!file) return;

				const loaded = progressInfo.loaded ?? 0;
				const total = progressInfo.total ?? 0;

				if (progressInfo.status === "progress" && total > 0) {
					fileBytes.set(file, { loaded, total });
				} else if (progressInfo.status === "done") {
					const existing = fileBytes.get(file);
					if (existing) {
						fileBytes.set(file, {
							loaded: existing.total,
							total: existing.total,
						});
					}
				}

				// sum all bytes
				let totalLoaded = 0;
				let totalSize = 0;
				for (const { loaded, total } of fileBytes.values()) {
					totalLoaded += loaded;
					totalSize += total;
				}

				if (totalSize === 0) return;

				const overallProgress = (totalLoaded / totalSize) * 100;
				const roundedProgress = Math.floor(overallProgress);

				if (roundedProgress !== lastReportedProgress) {
					lastReportedProgress = roundedProgress;
					self.postMessage({
						type: "init-progress",
						progress: roundedProgress,
					} satisfies WorkerResponse);
				}
			},
		})) as unknown as AutomaticSpeechRecognitionPipeline;

		self.postMessage({ type: "init-complete" } satisfies WorkerResponse);
	} catch (error) {
		self.postMessage({
			type: "init-error",
			error: error instanceof Error ? error.message : "Failed to load model",
		} satisfies WorkerResponse);
	}
}

async function handleTranscribe({
	audio,
	language,
}: {
	audio: Float32Array;
	language: string;
}) {
	if (!transcriber) {
		self.postMessage({
			type: "transcribe-error",
			error: "Model not initialized",
		} satisfies WorkerResponse);
		return;
	}

	cancelled = false;

	try {
		const rawResult = await transcriber(audio, {
			chunk_length_s: DEFAULT_CHUNK_LENGTH_SECONDS,
			stride_length_s: DEFAULT_STRIDE_SECONDS,
			language: language === "auto" ? undefined : language,
			return_timestamps: "word",
		});

		if (cancelled) return;

		const result: AutomaticSpeechRecognitionOutput = Array.isArray(rawResult)
			? rawResult[0]
			: rawResult;

		const words = buildWordsFromChunks({ chunks: result.chunks ?? [] });
		const segments =
			words.length > 0
				? buildSegmentsFromWords({ words })
				: buildSegmentsFromChunks({ chunks: result.chunks ?? [] });

		self.postMessage({
			type: "transcribe-complete",
			text: result.text,
			segments,
			words,
		} satisfies WorkerResponse);
	} catch (error) {
		if (cancelled) return;
		self.postMessage({
			type: "transcribe-error",
			error: error instanceof Error ? error.message : "Transcription failed",
		} satisfies WorkerResponse);
	}
}

type TimestampChunk = NonNullable<
	AutomaticSpeechRecognitionOutput["chunks"]
>[number];

function buildWordsFromChunks({
	chunks,
}: {
	chunks: TimestampChunk[];
}): TranscriptionWord[] {
	const words: TranscriptionWord[] = [];

	for (const chunk of chunks) {
		const timestamp = chunk.timestamp ?? [];
		const start = timestamp[0];
		const end = timestamp[1];
		if (
			typeof start !== "number" ||
			typeof end !== "number" ||
			!Number.isFinite(start) ||
			!Number.isFinite(end) ||
			end <= start
		) {
			continue;
		}

		const tokens = tokenizeCaptionText({ text: chunk.text });
		if (tokens.length === 0) continue;
		const duration = end - start;
		for (let index = 0; index < tokens.length; index++) {
			const wordStart = start + (duration * index) / tokens.length;
			const wordEnd =
				index === tokens.length - 1
					? end
					: start + (duration * (index + 1)) / tokens.length;
			if (wordEnd <= wordStart) continue;
			words.push({
				text: tokens[index] as string,
				start: wordStart,
				end: wordEnd,
			});
		}
	}

	return words.sort((left, right) => left.start - right.start);
}

function buildSegmentsFromWords({
	words,
}: {
	words: TranscriptionWord[];
}): TranscriptionSegment[] {
	const segments: TranscriptionSegment[] = [];
	let current: TranscriptionWord[] = [];

	const flush = () => {
		const first = current[0];
		const last = current[current.length - 1];
		if (!first || !last) {
			current = [];
			return;
		}
		segments.push({
			text: current.map((word) => word.text).join(" "),
			start: first.start,
			end: last.end,
		});
		current = [];
	};

	for (const word of words) {
		const previous = current[current.length - 1];
		const currentText = current.map((candidate) => candidate.text).join(" ");
		if (
			previous &&
			(word.start - previous.end > 0.85 ||
				/[.!?]$/.test(previous.text) ||
				currentText.length + word.text.length > 78)
		) {
			flush();
		}
		current.push(word);
	}
	flush();

	return segments;
}

function buildSegmentsFromChunks({
	chunks,
}: {
	chunks: TimestampChunk[];
}): TranscriptionSegment[] {
	return chunks
		.map((chunk) => {
			const timestamp = chunk.timestamp ?? [];
			const start = timestamp[0];
			const end = timestamp[1];
			if (
				typeof start !== "number" ||
				typeof end !== "number" ||
				!Number.isFinite(start) ||
				!Number.isFinite(end) ||
				end <= start
			) {
				return null;
			}
			const text = chunk.text.trim();
			return text ? { text, start, end } : null;
		})
		.filter((segment): segment is TranscriptionSegment => segment !== null);
}

function tokenizeCaptionText({ text }: { text: string }): string[] {
	return text
		.trim()
		.split(/\s+/)
		.map((token) => token.trim())
		.filter(Boolean);
}
