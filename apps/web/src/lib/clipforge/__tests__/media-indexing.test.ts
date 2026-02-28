import { describe, expect, test } from "bun:test";
import { buildClipIndex, buildEmptyMediaMetadata } from "@/lib/clipforge";
import type { MediaAsset } from "@/types/assets";

function buildMediaAsset({
	type,
}: {
	type: MediaAsset["type"];
}): MediaAsset {
	return {
		id: `${type}-1`,
		name: `${type}-asset`,
		type,
		duration: 4,
		file: new File(["media"], `${type}.bin`, {
			type: type === "audio" ? "audio/mpeg" : "video/mp4",
		}),
	};
}

describe("buildClipIndex", () => {
	test("indexes a video asset into transcript metadata", async () => {
		const result = await buildClipIndex({
			mediaAsset: buildMediaAsset({ type: "video" }),
			transcriber: {
				transcribe: async () => ({
					words: [{ text: "hello", start_ms: 0, end_ms: 400 }],
					segments: [{ text: "hello", start_ms: 0, end_ms: 400 }],
					provider: "browser-whisper",
					language: "en",
				}),
			},
			extractAudio: async () => ({
				samples: new Float32Array([0, 0, 0, 0]),
				sampleRate: 4,
			}),
		});

		expect(result.transcriptionStatus).toBe("ready");
		expect(result.transcriptionProvider).toBe("browser-whisper");
		expect(result.transcriptionLanguage).toBe("en");
		expect(result.segments).toHaveLength(1);
	});

	test("skips non-indexable assets", async () => {
		const result = await buildClipIndex({
			mediaAsset: buildMediaAsset({ type: "image" }),
			transcriber: {
				transcribe: async () => {
					throw new Error("should not run");
				},
			},
			extractAudio: async () => {
				throw new Error("should not run");
			},
		});

		expect(result).toEqual(buildEmptyMediaMetadata());
	});
});
