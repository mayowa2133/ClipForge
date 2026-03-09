import { describe, expect, test } from "bun:test";
import {
	buildDefaultScene,
	buildProjectAssembly,
	buildProjectAssemblyTracks,
	duplicateSceneWithFreshIds,
	getProjectDurationFromScenes,
} from "@/lib/scenes";
import type { TScene } from "@/types/timeline";

function buildScene({
	id,
	name,
	startTime = 0,
	duration = 2,
}: {
	id: string;
	name: string;
	startTime?: number;
	duration?: number;
}): TScene {
	const scene = buildDefaultScene({ name, isMain: id === "scene-1" });
	return {
		...scene,
		id,
		tracks: [
			{
				id: `${id}-track`,
				name: "Main",
				type: "video",
				isMain: true,
				muted: false,
				hidden: false,
				elements: [
					{
						id: `${id}-element`,
						type: "video",
						name: `${name} Clip`,
						mediaId: `${id}-media`,
						startTime,
						duration,
						trimStart: 0,
						trimEnd: 0,
						transform: {
							scale: 1,
							position: { x: 0, y: 0 },
							rotate: 0,
						},
						opacity: 1,
					},
				],
			},
		],
	};
}

describe("scene assembly helpers", () => {
	test("buildProjectAssembly computes deterministic offsets", () => {
		const scenes = [
			buildScene({ id: "scene-1", name: "Intro", duration: 2 }),
			buildScene({ id: "scene-2", name: "Body", duration: 3 }),
		];

		expect(buildProjectAssembly({ scenes })).toEqual([
			{
				sceneId: "scene-1",
				name: "Intro",
				projectStartTime: 0,
				duration: 2,
				projectEndTime: 2,
			},
			{
				sceneId: "scene-2",
				name: "Body",
				projectStartTime: 2,
				duration: 3,
				projectEndTime: 5,
			},
		]);
		expect(getProjectDurationFromScenes({ scenes })).toBe(5);
	});

	test("buildProjectAssemblyTracks offsets later scenes into project time", () => {
		const tracks = buildProjectAssemblyTracks({
			scenes: [
				buildScene({ id: "scene-1", name: "Intro", duration: 2 }),
				buildScene({ id: "scene-2", name: "Body", startTime: 0.5, duration: 3 }),
			],
		});

		expect(tracks).toHaveLength(2);
		expect(tracks[0]?.elements[0]?.startTime).toBe(0);
		expect(tracks[1]?.elements[0]?.startTime).toBe(2.5);
	});

	test("duplicateSceneWithFreshIds preserves content but regenerates scene and track ids", () => {
		const original = buildScene({ id: "scene-1", name: "Intro", duration: 2 });
		const duplicate = duplicateSceneWithFreshIds({ scene: original });

		expect(duplicate.id).not.toBe(original.id);
		expect(duplicate.name).toBe("Intro Copy");
		expect(duplicate.tracks[0]?.id).not.toBe(original.tracks[0]?.id);
		expect(duplicate.tracks[0]?.elements[0]?.id).not.toBe(
			original.tracks[0]?.elements[0]?.id,
		);
		const duplicateElement = duplicate.tracks[0]?.elements[0];
		const originalElement = original.tracks[0]?.elements[0];
		if (
			duplicateElement?.type === "video" &&
			originalElement?.type === "video"
		) {
			expect(duplicateElement.mediaId).toBe(originalElement.mediaId);
		}
	});
});
