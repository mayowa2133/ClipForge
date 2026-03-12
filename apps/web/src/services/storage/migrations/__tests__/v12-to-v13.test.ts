import { describe, expect, test } from "bun:test";
import { transformProjectV12ToV13 } from "../transformers/v12-to-v13";

const v12Project = {
	id: "project-v12-123",
	version: 12,
	metadata: {
		id: "project-v12-123",
		name: "My V12 Project",
		duration: 8,
		createdAt: "2026-03-09T10:00:00.000Z",
		updatedAt: "2026-03-09T12:00:00.000Z",
	},
	scenes: [
		{
			id: "scene-main",
			name: "Main scene",
			isMain: true,
			bookmarks: [],
			createdAt: "2026-03-09T10:00:00.000Z",
			updatedAt: "2026-03-09T12:00:00.000Z",
			tracks: [
				{
					id: "audio-track",
					type: "audio",
					name: "Audio",
					muted: false,
					elements: [
						{
							id: "audio-1",
							name: "Clip",
							type: "audio",
							sourceType: "upload",
							mediaId: "media-1",
							startTime: 0,
							duration: 2,
							trimStart: 0,
							trimEnd: 0,
							volume: 1,
						},
					],
				},
			],
		},
	],
	settings: {
		fps: 30,
		canvasSize: { width: 1920, height: 1080 },
		background: { type: "color", color: "#000000" },
	},
	clipforge: {
		schemaVersion: 3,
		mediaMetadataById: {},
		captionStylesById: {},
		activeCaptionStyleId: "clean-bottom",
		captionTrackIdsBySceneId: {},
		opsAudit: [],
	},
};

describe("V12 to V13 Migration", () => {
	test("adds audio settings, track volume, and audio defaults", () => {
		const result = transformProjectV12ToV13({ project: v12Project });
		expect(result.skipped).toBe(false);
		expect(result.project.version).toBe(13);
		expect((result.project.settings as any).audio).toEqual({
			masterVolume: 1,
			duckingEnabled: true,
			duckingAmount: 0.45,
			duckingAttackMs: 120,
			duckingReleaseMs: 280,
			audioPolishPresetId: "none",
			softLimiterEnabled: false,
		});
		const track = (result.project.scenes as any)[0].tracks[0];
		expect(track.volume).toBe(1);
		expect(track.elements[0].role).toBe("audio");
		expect(track.elements[0].normalizationGainDb).toBeNull();
	});
});
