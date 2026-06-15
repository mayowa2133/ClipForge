/**
 * Shared types for the ClipForge CLI smoke-test pipeline.
 *
 * This pipeline takes raw footage + background music and produces
 * a finished video with silence removal, word-level captions, and
 * music mixing — matching the reference output.
 */

// ── Media probing ──────────────────────────────────────────────

export interface MediaInfo {
  path: string;
  duration_s: number;
  width: number;
  height: number;
  /** Effective width after rotation (portrait vs landscape) */
  display_width: number;
  /** Effective height after rotation */
  display_height: number;
  rotation: number;
  codec_video: string;
  codec_audio: string;
  sample_rate: number;
  channels: number;
  fps: number;
}

// ── Silence detection ──────────────────────────────────────────

export interface SilenceRegion {
  /** Start of silence in seconds */
  start_s: number;
  /** End of silence in seconds */
  end_s: number;
  /** Duration of silence in seconds */
  duration_s: number;
}

// ── Cut planning ───────────────────────────────────────────────

export interface KeptSegment {
  /** Index in the final timeline (0-based) */
  index: number;
  /** Start time in original footage (seconds) */
  src_start_s: number;
  /** End time in original footage (seconds) */
  src_end_s: number;
  /** Duration of this segment (seconds) */
  duration_s: number;
  /** Cumulative start in the output timeline (seconds) */
  out_start_s: number;
}

// ── Transcription ──────────────────────────────────────────────

export interface TranscriptWord {
  /** The word text */
  word: string;
  /** Start time in original footage (seconds) */
  start_s: number;
  /** End time in original footage (seconds) */
  end_s: number;
}

export interface CaptionEvent {
  /** The word or phrase to display */
  text: string;
  /** Start time in the OUTPUT timeline (seconds) */
  start_s: number;
  /** End time in the OUTPUT timeline (seconds) */
  end_s: number;
}

// ── Pipeline configuration ─────────────────────────────────────

export interface PipelineConfig {
  /** Path to raw footage */
  raw_path: string;
  /** Path to background music */
  music_path: string;
  /** Path to output video */
  output_path: string;
  /** Path to reference video (for comparison) */
  reference_path: string;

  // Silence detection
  /** Minimum silence duration to detect (seconds) */
  silence_min_duration_s: number;
  /** Audio level threshold for silence (dB, negative) */
  silence_threshold_db: number;

  // Padding
  /** Padding before speech starts (seconds) */
  pad_before_s: number;
  /** Padding after speech ends (seconds) */
  pad_after_s: number;

  // Output format
  /** Output width */
  out_width: number;
  /** Output height */
  out_height: number;
  /** Output FPS */
  out_fps: number;
  /** Video codec for output */
  out_codec: string;
  /** CRF quality (lower = better) */
  out_crf: number;

  // Audio mixing
  /** Volume level for speech (1.0 = original) */
  speech_volume: number;
  /** Volume level for background music (0.0 - 1.0) */
  music_volume: number;
  /** Optional final output duration target. When set, the concat pass is paced to match it. */
  target_duration_s?: number;

  // Captions
  /** Font size for captions */
  caption_font_size: number;
  /** Font family */
  caption_font: string;
  /** Border width for text outline */
  caption_border_w: number;

  // Whisper
  /** Whisper model size */
  whisper_model: string;
  /** Language hint for Whisper */
  whisper_language: string;
}

export const DEFAULT_CONFIG: PipelineConfig = {
  raw_path: "",
  music_path: "",
  output_path: "",
  reference_path: "",

  silence_min_duration_s: 0.4,
  silence_threshold_db: -30,

  pad_before_s: 0.05,
  pad_after_s: 0.05,

  out_width: 1080,
  out_height: 1920,
  out_fps: 30,
  out_codec: "libx264",
  out_crf: 18,

  speech_volume: 1.0,
  music_volume: 0.15,
  target_duration_s: undefined,

  caption_font_size: 82,
  caption_font: "Arial-Bold",
  caption_border_w: 5,

  whisper_model: "base",
  whisper_language: "en",
};
