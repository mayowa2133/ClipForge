/**
 * Local transcription using OpenAI Whisper CLI.
 *
 * Extracts audio from the video, runs Whisper for word-level timestamps,
 * and returns structured TranscriptWord objects.
 */
import { execSync } from "child_process";
import { existsSync, readFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import type { TranscriptWord } from "./types";

const FFMPEG = "/opt/homebrew/bin/ffmpeg";

/**
 * Transcribe a video/audio file and return word-level timestamps.
 */
export function transcribe(
  filePath: string,
  model: string = "base",
  language: string = "en"
): TranscriptWord[] {
  const tmpDir = join(dirname(filePath), ".whisper-tmp");
  mkdirSync(tmpDir, { recursive: true });

  const wavPath = join(tmpDir, "audio.wav");

  // Step 1: Extract audio as 16kHz mono WAV (what Whisper expects)
  console.log("  Extracting audio for transcription...");
  execSync(
    `${FFMPEG} -y -i "${filePath}" -ar 16000 -ac 1 -c:a pcm_s16le "${wavPath}"`,
    { stdio: ["pipe", "pipe", "pipe"] }
  );

  // Step 2: Run Whisper with word-level timestamps
  console.log(`  Running Whisper (model=${model})...`);
  const whisperCmd = [
    "whisper",
    `"${wavPath}"`,
    "--model", model,
    "--language", language,
    "--word_timestamps", "True",
    "--output_format", "json",
    "--output_dir", `"${tmpDir}"`,
  ].join(" ");

  try {
    execSync(whisperCmd, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 300_000, // 5 min max
    });
  } catch (e: any) {
    console.error("  Whisper stderr:", e.stderr?.slice(0, 500));
    throw new Error(`Whisper failed: ${e.message}`);
  }

  // Step 3: Parse the JSON output
  const jsonPath = join(tmpDir, "audio.json");
  if (!existsSync(jsonPath)) {
    throw new Error(`Whisper output not found at ${jsonPath}`);
  }

  const whisperOutput = JSON.parse(readFileSync(jsonPath, "utf-8"));
  return parseWhisperJson(whisperOutput);
}

/**
 * Parse Whisper's JSON output into TranscriptWord array.
 * Whisper JSON has { segments: [{ words: [{ word, start, end }] }] }
 */
export function parseWhisperJson(data: any): TranscriptWord[] {
  const words: TranscriptWord[] = [];

  if (!data.segments) return words;

  for (const segment of data.segments) {
    if (!segment.words) continue;

    for (const w of segment.words) {
      words.push({
        word: w.word?.trim() ?? "",
        start_s: Number(w.start),
        end_s: Number(w.end),
      });
    }
  }

  return words;
}

/**
 * Fallback: if Whisper is not available, try using ffmpeg's subtitle extraction
 * or return empty (captions will be skipped).
 */
export function transcribeFallback(filePath: string): TranscriptWord[] {
  console.warn("  WARNING: Whisper not available, attempting subtitle extraction...");

  try {
    // Try extracting embedded subtitles
    const tmpDir = join(dirname(filePath), ".whisper-tmp");
    mkdirSync(tmpDir, { recursive: true });
    const srtPath = join(tmpDir, "subs.srt");

    execSync(
      `${FFMPEG} -y -i "${filePath}" -map 0:s:0 "${srtPath}" 2>/dev/null`,
      { encoding: "utf-8" }
    );

    if (existsSync(srtPath)) {
      return parseSrt(readFileSync(srtPath, "utf-8"));
    }
  } catch {
    // No subtitles available
  }

  console.warn("  No transcription available — captions will be skipped.");
  return [];
}

function parseSrt(srt: string): TranscriptWord[] {
  const words: TranscriptWord[] = [];
  const blocks = srt.split(/\n\n+/);

  for (const block of blocks) {
    const lines = block.trim().split("\n");
    if (lines.length < 3) continue;

    const timeMatch = lines[1].match(
      /(\d{2}):(\d{2}):(\d{2}),(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2}),(\d{3})/
    );
    if (!timeMatch) continue;

    const start =
      Number(timeMatch[1]) * 3600 +
      Number(timeMatch[2]) * 60 +
      Number(timeMatch[3]) +
      Number(timeMatch[4]) / 1000;
    const end =
      Number(timeMatch[5]) * 3600 +
      Number(timeMatch[6]) * 60 +
      Number(timeMatch[7]) +
      Number(timeMatch[8]) / 1000;

    const text = lines.slice(2).join(" ").trim();
    // Split into words and distribute time evenly
    const textWords = text.split(/\s+/);
    const wordDur = (end - start) / textWords.length;

    for (let i = 0; i < textWords.length; i++) {
      words.push({
        word: textWords[i],
        start_s: start + i * wordDur,
        end_s: start + (i + 1) * wordDur,
      });
    }
  }

  return words;
}
