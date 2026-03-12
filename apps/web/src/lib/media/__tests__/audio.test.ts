import { describe, expect, test } from "bun:test";
import {
	buildAudioDuckingProfile,
	buildProjectMixSummary,
	getDuckingGainAtTime,
	getProjectAudioSettings,
} from "@/lib/media/audio";
import type { TProject } from "@/types/project";
import type { TimelineTrack } from "@/types/timeline";

function buildProject(overrides?: Partial<TProject>): TProject {
	return {
		metadata: {
			id: "project-1",
			name: "Project",
			duration: 6,
			createdAt: new Date("2026-03-09T10:00:00.000Z"),
			updatedAt: new Date("2026-03-09T10:00:00.000Z"),
		},
		scenes: [],
		currentSceneId: "scene-1",
		settings: {
			fps: 30,
			canvasSize: { width: 1920, height: 1080 },
			background: { type: "color", color: "#000000" },
			audio: {
				masterVolume: 1,
				duckingEnabled: true,
				duckingAmount: 0.5,
				duckingAttackMs: 100,
				duckingReleaseMs: 300,
				audioPolishPresetId: "none",
				softLimiterEnabled: false,
			},
		},
		version: 13,
		...overrides,
	};
}

describe("audio mix helpers", () => {
	test("defaults project audio settings when missing", () => {
		const project = buildProject({
			settings: {
				fps: 30,
				canvasSize: { width: 1920, height: 1080 },
				background: { type: "color", color: "#000000" },
			},
		});
		const settings = getProjectAudioSettings({ project });
		expect(settings.masterVolume).toBe(1);
		expect(settings.duckingEnabled).toBe(true);
	});

	test("builds ducking windows from voiceover and transcript-backed clips only", () => {
		const tracks: TimelineTrack[] = [
			{
				id: "audio-1",
				name: "Audio",
				type: "audio",
				muted: false,
				volume: 1,
				elements: [
					{
						id: "music-1",
						name: "Music",
						type: "audio",
						sourceType: "upload",
						mediaId: "music-media",
						startTime: 0,
						duration: 5,
						trimStart: 0,
						trimEnd: 0,
						volume: 1,
						role: "music",
					},
					{
						id: "vo-1",
						name: "Voiceover",
						type: "audio",
						sourceType: "upload",
						mediaId: "voice-media",
						startTime: 1,
						duration: 1.5,
						trimStart: 0,
						trimEnd: 0,
						volume: 1,
						role: "voiceover",
					},
				],
			},
			{
				id: "video-1",
				name: "Video",
				type: "video",
				muted: false,
				hidden: false,
				isMain: true,
				elements: [
					{
						id: "video-el",
						name: "Clip",
						type: "video",
						mediaId: "spoken-media",
						startTime: 3,
						duration: 1,
						trimStart: 0,
						trimEnd: 0,
						transform: { scale: 1, position: { x: 0, y: 0 }, rotate: 0 },
						opacity: 1,
					},
				],
			},
		];
		const project = buildProject({
			clipforge: {
				schemaVersion: 4,
				mediaMetadataById: {
					"spoken-media": {
						words: [
							{ text: "hello", start_ms: 100, end_ms: 400 },
							{ text: "world", start_ms: 500, end_ms: 900 },
						],
						segments: [],
						silenceRegions: [],
						transcriptionStatus: "ready",
						transcriptionProvider: "browser-whisper",
						transcriptionLanguage: "en",
						transcriptionError: null,
						indexedAt: null,
					},
				},
				captionStylesById: {},
				activeCaptionStyleId: "clean-bottom",
				captionTrackIdsBySceneId: {},
				sceneFootageIntelligenceBySceneId: {},
				trendSoundReferences: [],
				opsAudit: [],
			},
		} as Partial<TProject>);
		const profile = buildAudioDuckingProfile({
			tracks,
			project,
			mixSettings: project.settings.audio!,
		});
		expect(profile).not.toBeNull();
		expect(profile?.dialogueWindows.length).toBe(3);
		expect(profile?.dialogueWindows[0]).toEqual({ startTime: 1, endTime: 2.5 });
	});

	test("ducking gain ramps down and up around dialogue windows", () => {
		const gainBefore = getDuckingGainAtTime({
			time: 0.95,
			ducking: {
				enabled: true,
				amount: 0.5,
				attackMs: 100,
				releaseMs: 200,
				dialogueWindows: [{ startTime: 1, endTime: 2 }],
			},
		});
		const gainDuring = getDuckingGainAtTime({
			time: 1.5,
			ducking: {
				enabled: true,
				amount: 0.5,
				attackMs: 100,
				releaseMs: 200,
				dialogueWindows: [{ startTime: 1, endTime: 2 }],
			},
		});
		const gainAfter = getDuckingGainAtTime({
			time: 2.1,
			ducking: {
				enabled: true,
				amount: 0.5,
				attackMs: 100,
				releaseMs: 200,
				dialogueWindows: [{ startTime: 1, endTime: 2 }],
			},
		});
		expect(gainBefore).toBeLessThan(1);
		expect(gainDuring).toBe(0.5);
		expect(gainAfter).toBeGreaterThan(0.5);
	});

	test("summarizes project mix from roles and dialogue", () => {
		const tracks: TimelineTrack[] = [
			{
				id: "audio-track",
				name: "Audio",
				type: "audio",
				muted: false,
				volume: 1,
				elements: [
					{
						id: "music-1",
						name: "Music",
						type: "audio",
						sourceType: "upload",
						mediaId: "music-media",
						startTime: 0,
						duration: 5,
						trimStart: 0,
						trimEnd: 0,
						volume: 1,
						role: "music",
					},
					{
						id: "vo-1",
						name: "VO",
						type: "audio",
						sourceType: "upload",
						mediaId: "voice-media",
						startTime: 1,
						duration: 2,
						trimStart: 0,
						trimEnd: 0,
						volume: 1,
						role: "voiceover",
					},
				],
			},
		];
		const summary = buildProjectMixSummary({ tracks, project: buildProject() });
		expect(summary.musicClipCount).toBe(1);
		expect(summary.voiceoverClipCount).toBe(1);
		expect(summary.masterVolume).toBe(1);
		expect(summary.audioPolishPresetId).toBe("none");
		expect(summary.softLimiterEnabled).toBe(false);
	});
});
