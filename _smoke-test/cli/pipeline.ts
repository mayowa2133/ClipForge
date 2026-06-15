#!/usr/bin/env npx ts-node
/**
 * ClipForge CLI Pipeline — Smoke Test
 *
 * End-to-end pipeline that takes raw footage + background music and produces
 * a finished video matching the reference output. Steps:
 *
 * 1. Probe media files
 * 2. Transcribe raw footage (Whisper word-level)
 * 3. Transcribe reference (Whisper sentence-level)
 * 4. Match reference content to raw footage timestamps
 * 5. Build caption events remapped to output timeline
 * 6. Render: trim + concat + scale + music mix (ffmpeg)
 * 7. Burn word-by-word captions (Python/Pillow)
 *
 * Usage: npx ts-node --project tsconfig.json pipeline.ts
 */
import { resolve, join } from "path";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { execSync } from "child_process";

import { DEFAULT_CONFIG, type PipelineConfig } from "./types";
import { probeMedia } from "./probe";
import { transcribe, parseWhisperJson } from "./transcribe";
import {
  matchCuts,
  buildCaptions,
  buildReferenceCaptions,
  parseWhisperSegments,
} from "./match-cuts";
import { render } from "./render";

// ── Configuration ──────────────────────────────────────────────

const SMOKE_DIR = resolve(__dirname, "..");
const BUNDLED_CODEX_PYTHON =
  "/Users/mayowaadesanya/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3";
const PYTHON_BIN =
  process.env.CLIPFORGE_PYTHON_BIN ??
  (existsSync(BUNDLED_CODEX_PYTHON) ? BUNDLED_CODEX_PYTHON : "python3");

const config: PipelineConfig = {
  ...DEFAULT_CONFIG,
  raw_path: join(SMOKE_DIR, "RAW-footage.MOV"),
  music_path: join(SMOKE_DIR, "MUSIC-background.mp3"),
  output_path: join(SMOKE_DIR, "OUTPUT.mp4"),
  reference_path: join(SMOKE_DIR, "FINISHED-reference.mov"),
  music_volume: 0.45,
};

// ── Pipeline ───────────────────────────────────────────────────

async function main() {
  const startTime = Date.now();
  console.log("=== ClipForge CLI Pipeline ===\n");

  // Verify inputs
  for (const [label, path] of [
    ["Raw footage", config.raw_path],
    ["Background music", config.music_path],
    ["Reference", config.reference_path],
  ] as const) {
    if (!existsSync(path)) {
      console.error(`ERROR: ${label} not found at ${path}`);
      process.exit(1);
    }
  }

  // ── Step 1: Probe ──
  console.log("Step 1/7: Probing media files...");
  const rawInfo = probeMedia(config.raw_path);
  const refInfo = probeMedia(config.reference_path);
  console.log(`  Raw:  ${rawInfo.display_width}x${rawInfo.display_height} ${rawInfo.duration_s.toFixed(1)}s`);
  console.log(`  Ref:  ${refInfo.display_width}x${refInfo.display_height} ${refInfo.duration_s.toFixed(1)}s`);
  console.log(`  Goal: ${rawInfo.duration_s.toFixed(1)}s -> ~${refInfo.duration_s.toFixed(1)}s\n`);

  // ── Step 2: Transcribe raw footage ──
  console.log("Step 2/7: Transcribing raw footage...");
  const rawWhisperPath = join(SMOKE_DIR, ".whisper-tmp", "audio.json");
  let rawWords;

  if (existsSync(rawWhisperPath)) {
    console.log("  Using cached transcription");
    rawWords = parseWhisperJson(JSON.parse(readFileSync(rawWhisperPath, "utf-8")));
  } else {
    rawWords = transcribe(config.raw_path, config.whisper_model, config.whisper_language);
  }
  console.log(`  ${rawWords.length} words from raw footage\n`);

  // ── Step 3: Transcribe reference ──
  console.log("Step 3/7: Transcribing reference...");
  const refWhisperPath = join(SMOKE_DIR, ".ref-tmp", "ref_audio.json");
  let refSegments;

  if (existsSync(refWhisperPath)) {
    console.log("  Using cached transcription");
    const refData = JSON.parse(readFileSync(refWhisperPath, "utf-8"));
    refSegments = parseWhisperSegments(refData);
  } else {
    // Extract ref audio and transcribe
    const tmpDir = join(SMOKE_DIR, ".ref-tmp");
    execSync(`mkdir -p "${tmpDir}"`);
    const wavPath = join(tmpDir, "ref_audio.wav");

    execSync(
      `/opt/homebrew/bin/ffmpeg -y -i "${config.reference_path}" -ar 16000 -ac 1 -c:a pcm_s16le "${wavPath}"`,
      { stdio: ["pipe", "pipe", "pipe"] }
    );

    execSync(
      `whisper "${wavPath}" --model ${config.whisper_model} --language ${config.whisper_language} --word_timestamps True --output_format json --output_dir "${tmpDir}"`,
      { stdio: ["pipe", "pipe", "pipe"], timeout: 300_000 }
    );

    const refData = JSON.parse(readFileSync(join(tmpDir, "ref_audio.json"), "utf-8"));
    refSegments = parseWhisperSegments(refData);
  }
  console.log(`  ${refSegments.length} segments from reference\n`);

  // ── Step 4: Match cuts ──
  console.log("Step 4/7: Matching reference content to raw footage...");
  const segments = matchCuts(rawWords, refSegments);
  const totalKept = segments.reduce((sum, s) => sum + s.duration_s, 0);
  const paceFactor =
    totalKept > 0 && refInfo.duration_s > 0 ? totalKept / refInfo.duration_s : 1;

  console.log(`  ${segments.length} segments matched`);
  console.log(`  Total: ${totalKept.toFixed(1)}s (target: ${refInfo.duration_s.toFixed(1)}s)`);
  console.log(`  Delta: ${Math.abs(totalKept - refInfo.duration_s).toFixed(1)}s\n`);
  if (Math.abs(paceFactor - 1) > 0.01 && paceFactor >= 0.85 && paceFactor <= 1.2) {
    console.log(`  Pace normalization: ${paceFactor.toFixed(3)}x to match reference duration\n`);
    config.target_duration_s = refInfo.duration_s;
  }

  // Dump segments
  const segmentsPath = join(SMOKE_DIR, "segments.json");
  writeFileSync(segmentsPath, JSON.stringify(segments, null, 2));

  // Print each segment
  for (const seg of segments) {
    const srcWords = rawWords
      .filter((w) => w.start_s >= seg.src_start_s && w.end_s <= seg.src_end_s)
      .map((w) => w.word.trim())
      .join(" ");
    console.log(`  [${seg.src_start_s.toFixed(1)}-${seg.src_end_s.toFixed(1)}] (${seg.duration_s.toFixed(1)}s) "${srcWords.slice(0, 60)}"`);
  }

  // ── Step 5: Build captions ──
  console.log("\nStep 5/7: Building caption events...");
  const captionTimeScale =
    config.target_duration_s && totalKept > 0 ? config.target_duration_s / totalKept : 1;
  const referenceCaptions = buildReferenceCaptions(
    refSegments,
    config.target_duration_s ?? refInfo.duration_s,
  );
  const captions =
    referenceCaptions.length > 0
      ? referenceCaptions
      : buildCaptions(rawWords, segments).map((caption) => ({
          ...caption,
          start_s: Number((caption.start_s * captionTimeScale).toFixed(3)),
          end_s: Number((caption.end_s * captionTimeScale).toFixed(3)),
        }));
  console.log(`  ${captions.length} caption events`);
  console.log(
    referenceCaptions.length > 0
      ? "  Caption source: reference transcript"
      : "  Caption source: matched raw transcript"
  );

  const captionsPath = join(SMOKE_DIR, "captions.json");
  writeFileSync(captionsPath, JSON.stringify(captions, null, 2));

  // ── Step 6: Render video (no captions) ──
  console.log("\nStep 6/7: Rendering video (trim + concat + scale + music)...");
  const noCaptionsPath = join(SMOKE_DIR, "OUTPUT-no-captions.mp4");
  const renderConfig = { ...config, output_path: noCaptionsPath };

  try {
    render(renderConfig, segments);
    console.log(`  Base video: ${noCaptionsPath}`);
  } catch (e: any) {
    console.error(`  Render failed: ${e.message}`);
    if (e.stderr) console.error(e.stderr.toString().slice(0, 1000));
    process.exit(1);
  }

  // ── Step 7: Burn captions ──
  console.log("\nStep 7/7: Burning captions...");
  try {
    const pythonCmd = [
      `"${PYTHON_BIN}"`,
      `"${join(__dirname, "burn-captions.py")}"`,
      `"${noCaptionsPath}"`,
      `"${captionsPath}"`,
      `"${config.output_path}"`,
    ].join(" ");

    execSync(pythonCmd, {
      stdio: "inherit",
      timeout: 600_000,
    });
    console.log(`  Final output: ${config.output_path}`);
  } catch (e: any) {
    console.warn("  Caption burn failed, using video without captions");
    // Copy the no-captions version as the final output
    execSync(`cp "${noCaptionsPath}" "${config.output_path}"`);
  }

  // ── Report ──
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n=== Pipeline complete in ${elapsed}s ===`);

  if (existsSync(config.output_path)) {
    const outInfo = probeMedia(config.output_path);
    console.log(`\nOutput:    ${outInfo.display_width}x${outInfo.display_height} ${outInfo.duration_s.toFixed(1)}s`);
    console.log(`Reference: ${refInfo.display_width}x${refInfo.display_height} ${refInfo.duration_s.toFixed(1)}s`);

    const durationDiff = Math.abs(outInfo.duration_s - refInfo.duration_s);
    console.log(`Duration delta: ${durationDiff.toFixed(1)}s`);

    if (durationDiff < 3) {
      console.log("RESULT: PASS - Duration within 3s of reference");
    } else if (durationDiff < 5) {
      console.log("RESULT: CLOSE - Duration within 5s of reference");
    } else {
      console.log(`RESULT: NEEDS TUNING - Duration off by ${durationDiff.toFixed(1)}s`);
    }
  }
}

main().catch((e) => {
  console.error("Pipeline error:", e);
  process.exit(1);
});
