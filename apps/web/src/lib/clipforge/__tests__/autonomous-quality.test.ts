import { describe, expect, test } from "bun:test";
import { evaluateAutonomousEditQualityGate } from "@/lib/clipforge/autonomous-quality";
import { buildCreatorProfileFromDurations } from "@/lib/clipforge/creator-profile";
import { buildDefaultClipForgeProjectData } from "@/lib/clipforge/project-data";
import type { TProject } from "@/types/project";
import type {
	AudioTrack,
	TextElement,
	TextTrack,
	TimelineTrack,
	VideoTrack,
} from "@/types/timeline";

function buildProject({
	durationS = 36,
	videoSegments = 13,
	captions = 70,
	title = true,
	music = true,
	portrait = true,
}: {
	durationS?: number;
	videoSegments?: number;
	captions?: number;
	title?: boolean;
	music?: boolean;
	portrait?: boolean;
} = {}): TProject {
	const videoDuration = durationS / Math.max(videoSegments, 1);
	const videoTrack: VideoTrack = {
		id: "video",
		name: "Video",
		type: "video",
		isMain: true,
		muted: false,
		hidden: false,
		elements: Array.from({ length: videoSegments }, (_, index) => ({
			id: `video-${index}`,
			type: "video" as const,
			name: `Video ${index}`,
			mediaId: "raw",
			startTime: index * videoDuration,
			duration: videoDuration,
			trimStart: index * videoDuration,
			trimEnd: index * videoDuration + videoDuration,
			transform: {
				scale: 1,
				position: { x: 0, y: 0 },
				rotate: 0,
			},
			opacity: 1,
		})),
	};
	const textElements: TextElement[] = [
		...(title
			? [
					{
						id: "title",
						type: "text" as const,
						name: "Title",
						content: "Operate From Abundance",
						startTime: 0,
						duration: durationS,
						trimStart: 0,
						trimEnd: durationS,
						fontSize: 56,
						fontFamily: "Montserrat",
						color: "#FFFFFF",
						background: { color: "transparent" },
						textAlign: "center" as const,
						fontWeight: "bold" as const,
						fontStyle: "normal" as const,
						textDecoration: "none" as const,
						transform: {
							scale: 1,
							position: { x: 0, y: 0 },
							rotate: 0,
						},
						opacity: 1,
					},
				]
			: []),
		...Array.from({ length: captions }, (_, index) => ({
			id: `caption-${index}`,
			type: "text" as const,
			role: "caption" as const,
			name: `Caption ${index}`,
			content: "WORD",
			startTime: index * 0.35,
			duration: 0.3,
			trimStart: 0,
			trimEnd: 0.3,
			fontSize: 64,
			fontFamily: "Montserrat",
			color: "#FFFFFF",
			background: { color: "transparent" },
			textAlign: "center" as const,
			fontWeight: "bold" as const,
			fontStyle: "normal" as const,
			textDecoration: "none" as const,
			transform: {
				scale: 1,
				position: { x: 0, y: 0 },
				rotate: 0,
			},
			opacity: 1,
		})),
	];
	const textTrack: TextTrack = {
		id: "text",
		name: "Text",
		type: "text",
		hidden: false,
		elements: textElements,
	};
	const audioTrack: AudioTrack = {
		id: "audio",
		name: "Audio",
		type: "audio",
		muted: false,
		elements: music
			? [
					{
						id: "music",
						type: "audio" as const,
						role: "music" as const,
						sourceType: "upload" as const,
						mediaId: "music",
						name: "Music",
						startTime: 0,
						duration: durationS,
						trimStart: 0,
						trimEnd: durationS,
						volume: 0.45,
					},
				]
			: [],
	};
	const tracks: TimelineTrack[] = [videoTrack, textTrack, audioTrack];

	return {
		metadata: {
			id: "project",
			name: "Autonomous",
			duration: durationS,
			createdAt: new Date(),
			updatedAt: new Date(),
		},
		currentSceneId: "scene",
		scenes: [
			{
				id: "scene",
				name: "Scene",
				isMain: true,
				createdAt: new Date(),
				updatedAt: new Date(),
				bookmarks: [],
				tracks,
			},
		],
		settings: {
			fps: 30,
			canvasSize: portrait
				? { width: 1080, height: 1920 }
				: { width: 1920, height: 1080 },
			background: { type: "color", color: "#000000" },
		},
		version: 1,
		clipforge: buildDefaultClipForgeProjectData(),
	};
}

describe("autonomous edit quality gate", () => {
	test("marks raw-only edits ready when they match learned style targets", () => {
		const profile = buildCreatorProfileFromDurations({
			rawDurationS: 120,
			finishedDurationS: 36,
			assetName: "reference.mov",
		});
		profile.cutDensityPerMinute = 20;

		const gate = evaluateAutonomousEditQualityGate({
			project: buildProject({ durationS: 36, videoSegments: 13 }),
			profile,
			rawDurationMs: 120_000,
		});

		expect(gate.readiness).toBe("ready-for-review");
		expect(gate.target_duration_delta_ms).toBe(0);
		expect(gate.video_cut_count).toBe(12);
		expect(gate.caption_count).toBe(70);
		expect(gate.title_present).toBe(true);
		expect(gate.music_present).toBe(true);
		expect(gate.portrait_canvas).toBe(true);
		expect(gate.warnings).toEqual([]);
	});

	test("flags missing production essentials", () => {
		const profile = buildCreatorProfileFromDurations({
			rawDurationS: 120,
			finishedDurationS: 36,
			assetName: "reference.mov",
		});

		const gate = evaluateAutonomousEditQualityGate({
			project: buildProject({
				durationS: 55,
				videoSegments: 2,
				captions: 0,
				title: false,
				music: false,
				portrait: false,
			}),
			profile,
			rawDurationMs: 120_000,
		});

		expect(gate.readiness).toBe("needs-review");
		expect(gate.warnings.join(" ")).toContain("duration");
		expect(gate.warnings.join(" ")).toContain("captions");
		expect(gate.warnings.join(" ")).toContain("title");
		expect(gate.warnings.join(" ")).toContain("music");
		expect(gate.warnings.join(" ")).toContain("portrait");
	});
});
