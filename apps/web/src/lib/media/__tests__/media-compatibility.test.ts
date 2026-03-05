import { describe, expect, test } from "bun:test";
import {
	areMediaCompatibilitySnapshotsEqual,
	buildPendingMediaCompatibilitySnapshot,
	buildUnknownMediaCompatibilitySnapshot,
	isMediaCompatibilityResolved,
	isMediaCompatibleForReference,
	probeAssetCompatibility,
} from "@/lib/media/media-compatibility";
import type { MediaAsset } from "@/types/assets";

describe("probeAssetCompatibility", () => {
	test("marks images as compatible without decode probing", async () => {
		const imageAsset = {
			id: "img-1",
			name: "image.png",
			type: "image",
			file: new File(["png"], "image.png", { type: "image/png" }),
		} as MediaAsset;

		const result = await probeAssetCompatibility({
			asset: imageAsset,
		});

		expect(result.status).toBe("compatible");
		expect(result.videoDecode).toBe("not-applicable");
		expect(result.audioDecode).toBe("not-applicable");
		expect(result.version).toBe(1);
	});
});

describe("compatibility helpers", () => {
	test("isMediaCompatibilityResolved only accepts compatible/incompatible", () => {
		expect(
			isMediaCompatibilityResolved(buildUnknownMediaCompatibilitySnapshot()),
		).toBe(false);
		expect(
			isMediaCompatibilityResolved(buildPendingMediaCompatibilitySnapshot()),
		).toBe(false);
		expect(
			isMediaCompatibilityResolved({
				status: "error",
				videoDecode: "unknown",
				audioDecode: "unknown",
				reason: "probe-failed",
				checkedAt: "2026-03-05T15:00:00.000Z",
				version: 1,
			}),
		).toBe(false);
		expect(
			isMediaCompatibilityResolved({
				status: "compatible",
				videoDecode: "supported",
				audioDecode: "supported",
				reason: null,
				checkedAt: "2026-03-05T15:00:00.000Z",
				version: 1,
			}),
		).toBe(true);
	});

	test("isMediaCompatibleForReference enforces only required decode dimensions", () => {
		const audioUnsupportedSnapshot = {
			status: "incompatible",
			videoDecode: "supported",
			audioDecode: "unsupported",
			reason: "audio-decode-unsupported",
			checkedAt: "2026-03-05T15:00:00.000Z",
			version: 1,
		} as const;

		expect(
			isMediaCompatibleForReference({
				snapshot: audioUnsupportedSnapshot,
				requiresVideoDecode: true,
				requiresAudioDecode: false,
			}),
		).toBe(true);

		expect(
			isMediaCompatibleForReference({
				snapshot: audioUnsupportedSnapshot,
				requiresVideoDecode: true,
				requiresAudioDecode: true,
			}),
		).toBe(false);
	});

	test("areMediaCompatibilitySnapshotsEqual compares deterministic fields only", () => {
		const a = {
			status: "compatible",
			videoDecode: "supported",
			audioDecode: "supported",
			reason: null,
			checkedAt: "2026-03-05T15:00:00.000Z",
			version: 1,
		} as const;
		const b = {
			...a,
			checkedAt: "2026-03-05T15:01:00.000Z",
		} as const;
		expect(
			areMediaCompatibilitySnapshotsEqual({
				a,
				b,
			}),
		).toBe(true);
	});
});
