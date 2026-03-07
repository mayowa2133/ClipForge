import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { EditorCore } from "@/core";
import { CommandManager } from "@/core/managers/commands";
import { SelectionManager } from "@/core/managers/selection-manager";
import { TimelineManager } from "@/core/managers/timeline-manager";
import type { MediaAsset } from "@/types/assets";
import type { TProject } from "@/types/project";
import type { AudioTrack, TimelineTrack, VideoElement, VideoTrack } from "@/types/timeline";

type FakeEditor = {
	command: CommandManager;
	timeline: TimelineManager;
	selection: SelectionManager;
	scenes: {
		getActiveScene: () => TProject["scenes"][number] | undefined;
		updateSceneTracks: ({ tracks }: { tracks: TimelineTrack[] }) => void;
	};
	project: {
		getActive: () => TProject;
		setActiveProject: ({ project }: { project: TProject }) => void;
	};
	media: {
		getAssets: () => MediaAsset[];
		createDerivedFreezeFrameAsset: ReturnType<typeof mock>;
	};
	save: {
		markDirty: () => void;
	};
};

const originalGetInstance = EditorCore.getInstance;

function createProjectFixture(): TProject {
	return {
		metadata: {
			id: "project-manual-editing",
			name: "Manual Editing",
			duration: 4,
			createdAt: new Date("2026-03-07T00:00:00.000Z"),
			updatedAt: new Date("2026-03-07T00:00:00.000Z"),
		},
		scenes: [
			{
				id: "scene-main",
				name: "Main scene",
				isMain: true,
				bookmarks: [],
				createdAt: new Date("2026-03-07T00:00:00.000Z"),
				updatedAt: new Date("2026-03-07T00:00:00.000Z"),
				tracks: [
					{
						id: "video-main",
						type: "video",
						name: "Main video",
						isMain: true,
						muted: false,
						hidden: false,
						elements: [
							{
								id: "video-1",
								type: "video",
								name: "Clip 1",
								mediaId: "media-video-1",
								startTime: 0,
								duration: 2,
								trimStart: 0,
								trimEnd: 0,
								muted: false,
								hidden: false,
								playbackRate: 1,
								linkedGroupId: null,
								transform: {
									scale: 1,
									position: { x: 0, y: 0 },
									rotate: 0,
								},
								opacity: 1,
							},
						],
					} satisfies VideoTrack,
				],
			},
		],
		currentSceneId: "scene-main",
		settings: {
			fps: 30,
			canvasSize: { width: 1080, height: 1920 },
			background: { type: "color", color: "#000000" },
		},
		version: 9,
	};
}

function createVideoAsset({
	id,
	name,
	duration,
}: {
	id: string;
	name: string;
	duration: number;
}): MediaAsset {
	return {
		id,
		name,
		type: "video",
		duration,
		file: new File(["video"], `${name}.mp4`, { type: "video/mp4" }),
	};
}

function createFakeEditor({
	project = createProjectFixture(),
	mediaAssets = [
		createVideoAsset({ id: "media-video-1", name: "clip-1", duration: 2 }),
		createVideoAsset({ id: "media-video-2", name: "clip-2", duration: 3 }),
	],
}: {
	project?: TProject;
	mediaAssets?: MediaAsset[];
}) {
	let activeProject = project;
	let assets = mediaAssets;

	const editor = {} as FakeEditor;

	editor.command = new CommandManager();
	editor.scenes = {
		getActiveScene: () =>
			activeProject.scenes.find((scene) => scene.id === activeProject.currentSceneId),
		updateSceneTracks: ({ tracks }) => {
			activeProject = {
				...activeProject,
				scenes: activeProject.scenes.map((scene) =>
					scene.id === activeProject.currentSceneId
						? { ...scene, tracks, updatedAt: new Date("2026-03-07T00:00:00.000Z") }
						: scene,
				),
			};
		},
	};
	editor.project = {
		getActive: () => activeProject,
		setActiveProject: ({ project: nextProject }) => {
			activeProject = nextProject;
		},
	};
	editor.media = {
		getAssets: () => assets,
		createDerivedFreezeFrameAsset: mock(
			async ({
				sourceMediaId,
				sourceTime,
			}: {
				sourceMediaId: string;
				sourceTime: number;
			}) => ({
				id: "freeze-asset",
				name: `freeze-${Math.round(sourceTime * 1000)}.png`,
				type: "image" as const,
				file: new File(["image"], "freeze.png", { type: "image/png" }),
				url: "blob:freeze",
				derived: {
					kind: "freeze-frame" as const,
					sourceMediaId,
					sourceTime,
				},
			}),
		),
	};
	editor.save = {
		markDirty: () => {},
	};
	editor.timeline = new TimelineManager(editor as never);
	editor.selection = new SelectionManager(editor as never);

	return {
		editor,
		getProject: () => activeProject,
		getAssets: () => assets,
		setAssets: (nextAssets: MediaAsset[]) => {
			assets = nextAssets;
		},
	};
}

beforeEach(() => {
	(EditorCore as unknown as { getInstance: () => unknown }).getInstance = () => currentEditor!;
});

afterEach(() => {
	(EditorCore as unknown as { getInstance: typeof originalGetInstance }).getInstance =
		originalGetInstance;
	currentEditor = null;
});

let currentEditor: FakeEditor | null = null;

describe("manual editing flow", () => {
	test("replaceElementMedia preserves timing and swaps the media source when replacement is valid", () => {
		const harness = createFakeEditor({});
		currentEditor = harness.editor;

		harness.editor.timeline.replaceElementMedia({
			trackId: "video-main",
			elementId: "video-1",
			mediaId: "media-video-2",
		});

		const updatedTrack = harness.getProject().scenes[0]?.tracks[0] as VideoTrack;
		const updatedElement = updatedTrack.elements[0];

		expect(updatedElement).toMatchObject({
			id: "video-1",
			mediaId: "media-video-2",
			name: "clip-2",
			startTime: 0,
			duration: 2,
			trimStart: 0,
			trimEnd: 0,
		});
	});

	test("replaceElementMedia rejects replacements that cannot preserve the visible source span", () => {
		const project = createProjectFixture();
		const track = project.scenes[0]?.tracks[0] as VideoTrack;
		track.elements[0] = {
			...track.elements[0],
			duration: 3,
			trimStart: 1,
			trimEnd: 0,
		};

		const harness = createFakeEditor({
			project,
			mediaAssets: [
				createVideoAsset({ id: "media-video-1", name: "clip-1", duration: 5 }),
				createVideoAsset({ id: "media-video-short", name: "short", duration: 3.5 }),
			],
		});
		currentEditor = harness.editor;

		expect(() =>
			harness.editor.timeline.replaceElementMedia({
				trackId: "video-main",
				elementId: "video-1",
				mediaId: "media-video-short",
			}),
		).toThrow("Replacement media is too short to preserve the existing trim and duration.");

		const unchangedElement = ((harness.getProject().scenes[0]?.tracks[0] as VideoTrack)
			.elements[0]);
		expect(unchangedElement.mediaId).toBe("media-video-1");
		expect(unchangedElement.name).toBe("Clip 1");
	});

	test("insertFreezeFrame creates a derived asset and splits the selected clip around the playhead", async () => {
		const harness = createFakeEditor({});
		currentEditor = harness.editor;

		await harness.editor.timeline.insertFreezeFrame({
			trackId: "video-main",
			elementId: "video-1",
			atTime: 1,
			duration: 1,
			ripple: false,
		});

		expect(harness.editor.media.createDerivedFreezeFrameAsset).toHaveBeenCalledWith({
			sourceMediaId: "media-video-1",
			sourceTime: 1,
		});

		const updatedElements = ((harness.getProject().scenes[0]?.tracks[0] as VideoTrack)
			.elements);
		expect(updatedElements).toHaveLength(3);
		expect(updatedElements[0]).toMatchObject({
			type: "video",
			name: "Clip 1 (left)",
			startTime: 0,
			duration: 1,
		});
		expect(updatedElements[1]).toMatchObject({
			type: "image",
			mediaId: "freeze-asset",
			startTime: 1,
			duration: 1,
		});
		expect(updatedElements[2]).toMatchObject({
			type: "video",
			name: "Clip 1 (right)",
			startTime: 2,
			duration: 1,
		});
	});

	test("insertFreezeFrame rejects playhead positions outside the selected clip", async () => {
		const harness = createFakeEditor({});
		currentEditor = harness.editor;

		await expect(
			harness.editor.timeline.insertFreezeFrame({
				trackId: "video-main",
				elementId: "video-1",
				atTime: 3,
				duration: 1,
				ripple: false,
			}),
		).rejects.toThrow(
			"Playhead must be inside the selected clip to create a freeze frame.",
		);

		expect(harness.editor.media.createDerivedFreezeFrameAsset).not.toHaveBeenCalled();
		const elements = ((harness.getProject().scenes[0]?.tracks[0] as VideoTrack).elements);
		expect(elements).toHaveLength(1);
	});

	test("separateAudio creates linked elements and linked selection expands from either side", () => {
		const harness = createFakeEditor({});
		currentEditor = harness.editor;

		harness.editor.timeline.separateAudio({
			trackId: "video-main",
			elementId: "video-1",
		});

		const scene = harness.getProject().scenes[0]!;
		const videoTrack = scene.tracks.find((track) => track.id === "video-main") as VideoTrack;
		const audioTrack = scene.tracks.find((track) => track.type === "audio") as AudioTrack;
		const videoElement = videoTrack.elements[0] as VideoElement;
		const audioElement = audioTrack.elements[0];

		expect(videoElement.muted).toBe(true);
		expect(videoElement.linkedGroupId).toBeTruthy();
		expect(audioElement).toMatchObject({
			type: "audio",
			mediaId: "media-video-1",
			startTime: 0,
			duration: 2,
			linkedGroupId: videoElement.linkedGroupId,
		});

		harness.editor.selection.clearSelection();
		harness.editor.selection.setSelectedElements({
			elements: [{ trackId: audioTrack.id, elementId: audioElement.id }],
		});

		expect(harness.editor.selection.getSelectedElements()).toEqual(
			expect.arrayContaining([
				{ trackId: "video-main", elementId: "video-1" },
				{ trackId: audioTrack.id, elementId: audioElement.id },
			]),
		);
	});
});
