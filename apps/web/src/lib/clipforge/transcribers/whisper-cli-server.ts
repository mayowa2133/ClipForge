import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
	buildWordsFromSegments,
	type ClipTranscriptionResult,
} from "@/lib/clipforge/transcription";
import type { TranscriptSegment, TranscriptWord } from "@/types/clipforge";

const execFileAsync = promisify(execFile);

interface WhisperCliJsonWord {
	word?: string;
	text?: string;
	start?: number;
	end?: number;
}

interface WhisperCliJsonSegment {
	text?: string;
	start?: number;
	end?: number;
	words?: WhisperCliJsonWord[];
}

interface WhisperCliJsonPayload {
	language?: string;
	segments?: WhisperCliJsonSegment[];
}

export async function runWhisperCliTranscription({
	file,
	language,
}: {
	file: File;
	language?: string;
}): Promise<ClipTranscriptionResult> {
	const cliEnabled = process.env.CLIPFORGE_WHISPER_CLI_ENABLED === "true";
	if (!cliEnabled) {
		throw new Error("Whisper CLI is disabled.");
	}

	const tempDir = await mkdtemp(join(tmpdir(), "clipforge-whisper-"));
	// basename() strips any path components — a caller-controlled file.name like
	// "../../etc/x" would otherwise escape tempDir via join() (path traversal write).
	const safeName = basename(file.name || "input-media") || "input-media";
	const filePath = join(tempDir, safeName);

	try {
		await writeFile(filePath, Buffer.from(await file.arrayBuffer()));
		return await runWhisperOnPath({ filePath, language });
	} finally {
		await rm(tempDir, { recursive: true, force: true });
	}
}

/**
 * Run Whisper CLI on a file that already exists on disk.
 * Shared by both the API route (via runWhisperCliTranscription) and the
 * WhisperCliTranscriptionEngine worker.
 */
export async function runWhisperOnPath({
	filePath,
	language,
	model,
}: {
	filePath: string;
	language?: string;
	model?: string;
}): Promise<ClipTranscriptionResult> {
	const outputDir = await mkdtemp(join(tmpdir(), "clipforge-whisper-out-"));

	try {
		await mkdir(outputDir, { recursive: true });

		const cliBin = process.env.CLIPFORGE_WHISPER_CLI_BIN || "whisper";
		const whisperModel =
			model || process.env.CLIPFORGE_WHISPER_CLI_MODEL || "small";
		const extraArgs = (process.env.CLIPFORGE_WHISPER_CLI_ARGS || "")
			.split(/\s+/)
			.map((value) => value.trim())
			.filter(Boolean);
		const args = [
			filePath,
			"--model",
			whisperModel,
			"--output_format",
			"json",
			"--output_dir",
			outputDir,
			"--word_timestamps",
			"True",
			...extraArgs,
		];
		if (language) {
			args.push("--language", language);
		}

		try {
			await execFileAsync(cliBin, args);
		} catch (error) {
			const errorWithCode = error as NodeJS.ErrnoException;
			if (errorWithCode.code === "ENOENT") {
				throw new Error("Whisper CLI binary was not found.");
			}
			const stderrValue = (error as { stderr?: string }).stderr;
			const stderr = typeof stderrValue === "string" ? stderrValue : "";
			throw new Error(stderr.trim() || "Whisper CLI transcription failed.");
		}

		const outputFilePath = join(
			outputDir,
			`${basename(filePath).replace(/\.[^.]+$/, "")}.json`,
		);
		const raw = await readFile(outputFilePath, "utf8");
		return parseWhisperCliJson({ raw });
	} finally {
		await rm(outputDir, { recursive: true, force: true });
	}
}

export function parseWhisperCliJson({
	raw,
}: {
	raw: string;
}): ClipTranscriptionResult {
	let payload: WhisperCliJsonPayload;
	try {
		payload = JSON.parse(raw) as WhisperCliJsonPayload;
	} catch {
		throw new Error("Whisper CLI returned invalid JSON.");
	}

	const segments = normalizeWhisperSegments({
		segments: payload.segments ?? [],
	});
	const words = normalizeWhisperWords({
		segments: payload.segments ?? [],
		normalizedSegments: segments,
	});

	return {
		words,
		segments,
		language: payload.language,
		provider: "whisper-cli",
	};
}

function normalizeWhisperSegments({
	segments,
}: {
	segments: WhisperCliJsonSegment[];
}): TranscriptSegment[] {
	return segments
		.map((segment) => ({
			text: (segment.text ?? "").trim(),
			start_ms: Math.round((segment.start ?? 0) * 1000),
			end_ms: Math.round((segment.end ?? 0) * 1000),
		}))
		.filter(
			(segment) =>
				segment.text.length > 0 &&
				Number.isFinite(segment.start_ms) &&
				Number.isFinite(segment.end_ms) &&
				segment.end_ms > segment.start_ms,
		);
}

function normalizeWhisperWords({
	segments,
	normalizedSegments,
}: {
	segments: WhisperCliJsonSegment[];
	normalizedSegments: TranscriptSegment[];
}): TranscriptWord[] {
	const words: TranscriptWord[] = [];

	for (const segment of segments) {
		for (const word of segment.words ?? []) {
			const text = (word.word ?? word.text ?? "").trim();
			const start_ms = Math.round((word.start ?? 0) * 1000);
			const end_ms = Math.round((word.end ?? 0) * 1000);
			if (
				text.length === 0 ||
				!Number.isFinite(start_ms) ||
				!Number.isFinite(end_ms) ||
				end_ms <= start_ms
			) {
				continue;
			}
			words.push({
				text,
				start_ms,
				end_ms,
			});
		}
	}

	if (words.length > 0) {
		return words;
	}

	return buildWordsFromSegments({
		segments: normalizedSegments,
	});
}
