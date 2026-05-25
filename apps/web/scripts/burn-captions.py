#!/usr/bin/env python3
"""
Burn word-by-word captions onto a video using Pillow + ffmpeg.

Strategy:
1. Decode the video frame-by-frame with ffmpeg
2. For each frame, check if a caption word should be shown
3. Render the word as bold white text with black outline using Pillow
4. Re-encode the frames with ffmpeg

Usage:
  python3 burn-captions.py <input.mp4> <captions.json> <output.mp4>
"""
import json
import subprocess
import sys
import struct
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

def load_captions(path: str) -> list:
    with open(path) as f:
        return json.load(f)

def get_video_info(path: str) -> dict:
    cmd = [
        "ffprobe", "-v", "quiet", "-print_format", "json",
        "-show_format", "-show_streams", path
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    data = json.loads(result.stdout)

    video_stream = next(s for s in data["streams"] if s["codec_type"] == "video")

    # Parse FPS
    fps_parts = video_stream["r_frame_rate"].split("/")
    fps = float(fps_parts[0]) / float(fps_parts[1]) if len(fps_parts) == 2 else float(fps_parts[0])

    return {
        "width": int(video_stream["width"]),
        "height": int(video_stream["height"]),
        "fps": fps,
        "duration": float(data["format"]["duration"]),
        # Preserve colorspace metadata so the output is tagged correctly
        "color_space": video_stream.get("color_space", ""),
        "color_transfer": video_stream.get("color_transfer", ""),
        "color_primaries": video_stream.get("color_primaries", ""),
        "color_range": video_stream.get("color_range", ""),
    }

def find_font() -> ImageFont.FreeTypeFont:
    """Find a bold system font."""
    size = 130
    font_paths = [
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
        "/System/Library/Fonts/SFCompact.ttf",
        "/Library/Fonts/Arial Bold.ttf",
    ]
    for fp in font_paths:
        if Path(fp).exists():
            try:
                return ImageFont.truetype(fp, size)
            except:
                continue
    # Fallback to default
    return ImageFont.load_default()

def draw_caption(img: Image.Image, text: str, font: ImageFont.FreeTypeFont) -> Image.Image:
    """Draw a single word centered at the bottom quarter of the frame."""
    draw = ImageDraw.Draw(img)
    text = text.upper()

    # Get text bounding box
    bbox = draw.textbbox((0, 0), text, font=font)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]

    # Position: centered horizontally, bottom quarter vertically
    x = (img.width - tw) // 2
    y = img.height - img.height // 4

    # Draw black outline (border)
    border = 7
    for dx in range(-border, border + 1):
        for dy in range(-border, border + 1):
            if dx == 0 and dy == 0:
                continue
            draw.text((x + dx, y + dy), text, font=font, fill="black")

    # Draw white text
    draw.text((x, y), text, font=font, fill="white")

    return img

def main():
    if len(sys.argv) < 4:
        print("Usage: python3 burn-captions.py <input.mp4> <captions.json> <output.mp4>")
        sys.exit(1)

    input_path = sys.argv[1]
    captions_path = sys.argv[2]
    output_path = sys.argv[3]

    captions = load_captions(captions_path)
    info = get_video_info(input_path)
    width, height = info["width"], info["height"]
    fps = info["fps"]

    print(f"  Input: {width}x{height} @ {fps:.1f}fps, {info['duration']:.1f}s")
    print(f"  Captions: {len(captions)} words")

    font = find_font()

    # Decode input with ffmpeg (rgb24 for Pillow processing)
    decode_cmd = [
        "ffmpeg", "-i", input_path,
        "-f", "rawvideo", "-pix_fmt", "rgb24",
        "-v", "quiet", "-"
    ]

    # Build x264-params string to carry source colorspace metadata into the output.
    # When encoding from raw RGB24 pipe, the standard ffmpeg -color_trc / -color_primaries
    # flags are silently ignored by libx264; using -x264-params directly sets the VUI
    # parameters in the bitstream and is reliably preserved in the output container.
    #
    # x264 naming matches what ffprobe reports, e.g.:
    #   colormatrix=bt2020nc  (ffprobe: color_space)
    #   colorprim=bt2020      (ffprobe: color_primaries)
    #   transfer=arib-std-b67 (ffprobe: color_transfer, HLG)
    x264_vui = []
    if info.get("color_space"):
        x264_vui.append(f"colormatrix={info['color_space']}")
    if info.get("color_primaries"):
        x264_vui.append(f"colorprim={info['color_primaries']}")
    if info.get("color_transfer"):
        x264_vui.append(f"transfer={info['color_transfer']}")

    color_flags = []
    if x264_vui:
        color_flags += ["-x264-params", ":".join(x264_vui)]
    if info.get("color_range") and info["color_range"] not in ("", "unknown"):
        color_flags += ["-color_range", info["color_range"]]

    # Encode output with ffmpeg (take raw video + copy audio from input).
    # Force yuv420p (not yuv444p) so the output is compatible with all players
    # and social media platforms.
    encode_cmd = [
        "ffmpeg", "-y",
        "-f", "rawvideo", "-pix_fmt", "rgb24",
        "-s", f"{width}x{height}", "-r", str(fps),
        "-i", "-",         # raw video from stdin
        "-i", input_path,  # original for audio
        "-map", "0:v", "-map", "1:a",
        "-c:v", "libx264", "-crf", "18", "-preset", "fast",
        "-pix_fmt", "yuv420p",
        *color_flags,
        "-c:a", "copy",
        "-movflags", "+faststart",
        output_path
    ]

    decoder = subprocess.Popen(decode_cmd, stdout=subprocess.PIPE)
    encoder = subprocess.Popen(encode_cmd, stdin=subprocess.PIPE,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE)

    frame_size = width * height * 3
    frame_num = 0
    total_frames = int(info["duration"] * fps)

    try:
        while True:
            raw_frame = decoder.stdout.read(frame_size)
            if len(raw_frame) < frame_size:
                break

            t = frame_num / fps

            # Find active caption at this time
            active_caption = None
            for cap in captions:
                if cap["start_s"] <= t < cap["end_s"]:
                    active_caption = cap["text"]
                    break

            if active_caption:
                # Convert raw bytes to PIL Image, draw caption, convert back
                img = Image.frombytes("RGB", (width, height), raw_frame)
                img = draw_caption(img, active_caption, font)
                encoder.stdin.write(img.tobytes())
            else:
                # Pass through unchanged
                encoder.stdin.write(raw_frame)

            frame_num += 1
            if frame_num % (int(fps) * 5) == 0:
                pct = (frame_num / total_frames * 100) if total_frames > 0 else 0
                print(f"    Frame {frame_num}/{total_frames} ({pct:.0f}%)")

    except BrokenPipeError:
        pass
    finally:
        if encoder.stdin:
            encoder.stdin.close()
        decoder.wait()
        encoder.wait()

    print(f"  Caption burn complete: {frame_num} frames processed")

    if encoder.returncode != 0:
        stderr = encoder.stderr.read().decode() if encoder.stderr else ""
        print(f"  Encoder error: {stderr[:500]}")
        sys.exit(1)

if __name__ == "__main__":
    main()
