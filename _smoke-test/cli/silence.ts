/**
 * Silence detection using ffmpeg's silencedetect filter.
 *
 * Parses ffmpeg stderr output for silence_start / silence_end markers
 * and returns structured SilenceRegion objects.
 */
import { execSync } from "child_process";
import type { SilenceRegion } from "./types";

const FFMPEG = "/opt/homebrew/bin/ffmpeg";

export function detectSilence(
  filePath: string,
  thresholdDb: number = -30,
  minDurationS: number = 0.4
): SilenceRegion[] {
  // Run silencedetect — output goes to stderr
  const cmd = [
    FFMPEG,
    "-i",
    `"${filePath}"`,
    "-af",
    `silencedetect=noise=${thresholdDb}dB:d=${minDurationS}`,
    "-f",
    "null",
    "-",
  ].join(" ");

  let stderr: string;
  try {
    execSync(cmd, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
    stderr = "";
  } catch (e: any) {
    // ffmpeg exits non-zero sometimes but still produces valid output
    stderr = e.stderr ?? "";
  }

  // Also try capturing stderr properly
  if (!stderr) {
    try {
      const result = execSync(cmd + " 2>&1", { encoding: "utf-8" });
      stderr = result;
    } catch (e: any) {
      stderr = e.stdout ?? e.stderr ?? "";
    }
  }

  return parseSilenceOutput(stderr);
}

export function parseSilenceOutput(stderr: string): SilenceRegion[] {
  const regions: SilenceRegion[] = [];

  // Match pairs: silence_start: X and silence_end: X | silence_duration: X
  const lines = stderr.split("\n");
  let currentStart: number | null = null;

  for (const line of lines) {
    const startMatch = line.match(/silence_start:\s*([\d.]+)/);
    if (startMatch) {
      currentStart = parseFloat(startMatch[1]);
      continue;
    }

    const endMatch = line.match(/silence_end:\s*([\d.]+)\s*\|\s*silence_duration:\s*([\d.]+)/);
    if (endMatch && currentStart !== null) {
      const end = parseFloat(endMatch[1]);
      const duration = parseFloat(endMatch[2]);
      regions.push({
        start_s: currentStart,
        end_s: end,
        duration_s: duration,
      });
      currentStart = null;
    }
  }

  return regions;
}
