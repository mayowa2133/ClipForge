/**
 * ffprobe wrapper — extracts media metadata from video/audio files.
 */
import { execSync } from "child_process";
import type { MediaInfo } from "./types";

const FFPROBE = "/opt/homebrew/bin/ffprobe";

export function probeMedia(filePath: string): MediaInfo {
  const raw = execSync(
    `${FFPROBE} -v quiet -print_format json -show_format -show_streams "${filePath}"`,
    { encoding: "utf-8" }
  );
  const data = JSON.parse(raw);

  let videoStream: any = null;
  let audioStream: any = null;

  for (const s of data.streams) {
    if (s.codec_type === "video" && !videoStream) videoStream = s;
    if (s.codec_type === "audio" && !audioStream) audioStream = s;
  }

  if (!videoStream) throw new Error(`No video stream found in ${filePath}`);

  const width = Number(videoStream.width);
  const height = Number(videoStream.height);

  // Check for rotation in side_data_list or stream tags
  let rotation = 0;
  if (videoStream.side_data_list) {
    for (const sd of videoStream.side_data_list) {
      if (sd.rotation !== undefined) {
        rotation = Number(sd.rotation);
      }
    }
  }
  if (rotation === 0 && videoStream.tags?.rotate) {
    rotation = Number(videoStream.tags.rotate);
  }

  // Effective display dimensions after rotation
  const isRotated = Math.abs(rotation) === 90 || Math.abs(rotation) === 270;
  const display_width = isRotated ? height : width;
  const display_height = isRotated ? width : height;

  // Parse FPS from r_frame_rate (e.g. "30/1" or "30000/1001")
  let fps = 30;
  if (videoStream.r_frame_rate) {
    const parts = videoStream.r_frame_rate.split("/");
    fps = parts.length === 2 ? Number(parts[0]) / Number(parts[1]) : Number(parts[0]);
  }

  return {
    path: filePath,
    duration_s: Number(data.format.duration),
    width,
    height,
    display_width,
    display_height,
    rotation,
    codec_video: videoStream.codec_name,
    codec_audio: audioStream?.codec_name ?? "none",
    sample_rate: audioStream ? Number(audioStream.sample_rate) : 0,
    channels: audioStream ? Number(audioStream.channels) : 0,
    fps,
  };
}
