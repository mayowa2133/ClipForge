/**
 * ASS subtitle generator for word-by-word captions.
 *
 * Generates an ASS (Advanced SubStation Alpha) subtitle file that renders
 * bold white text with black outline at bottom-center, one word at a time.
 * This approach works with any ffmpeg build (even without drawtext/libfreetype).
 */
import { writeFileSync } from "fs";
import type { CaptionEvent, PipelineConfig } from "./types";

/**
 * Generate an ASS subtitle file from caption events.
 */
export function generateAssSubtitles(
  captions: CaptionEvent[],
  outputPath: string,
  config: PipelineConfig
): void {
  const header = buildAssHeader(config);
  const events = captions.map((cap) => buildAssDialogue(cap)).join("\n");

  const ass = `${header}\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n${events}\n`;

  writeFileSync(outputPath, ass);
}

function buildAssHeader(config: PipelineConfig): string {
  return `[Script Info]
Title: ClipForge Captions
ScriptType: v4.00+
PlayResX: ${config.out_width}
PlayResY: ${config.out_height}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Word,Arial,${config.caption_font_size},&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,${config.caption_border_w},0,2,10,10,${Math.round(config.out_height / 4)},1
`;
}

function buildAssDialogue(cap: CaptionEvent): string {
  const start = formatAssTime(cap.start_s);
  const end = formatAssTime(cap.end_s);
  const text = cap.text.toUpperCase().replace(/\\/g, "\\\\");

  return `Dialogue: 0,${start},${end},Word,,0,0,0,,${text}`;
}

/**
 * Format seconds to ASS time format: H:MM:SS.CC
 */
function formatAssTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const cs = Math.round((seconds % 1) * 100);

  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}
