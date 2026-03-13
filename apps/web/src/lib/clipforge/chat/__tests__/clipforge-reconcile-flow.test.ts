import { describe, expect, test } from "bun:test";
import {
	buildProjectSegmentSummaryFixture,
	buildProjectSummaryFixture,
} from "@/lib/clipforge/__tests__/fixtures";
import { ClipForgeManager } from "@/core/managers/clipforge-manager";
import type { ChatPlannerContext, ProjectSummary } from "@/lib/clipforge/chat/types";
import type { TimelineDiffOp } from "@/types/clipforge";

const context: ChatPlannerContext = {
	playhead_ms: 1000,
	selected_segment_ids: [],
	active_scene_id: "scene-1",
};

function createProjectSummary(): ProjectSummary {
	return buildProjectSummaryFixture({
		total_duration_s: 12,
		segments: [
			buildProjectSegmentSummaryFixture({
				segment_id: "seg-1",
				element_name: "Clip 1",
				start_ms: 0,
				end_ms: 4000,
				asset_id: "asset-1",
				transcript_snippet: "clipforge one",
			}),
			buildProjectSegmentSummaryFixture({
				segment_id: "seg-2",
				element_name: "Clip 2",
				start_ms: 4000,
				end_ms: 8000,
				ordinal: 2,
				asset_id: "asset-2",
				transcript_snippet: "clipforge two",
			}),
		],
		media_assets: [
			{
				asset_id: "asset-1",
				name: "clip-1.mp4",
				type: "video",
			},
			{
				asset_id: "asset-2",
				name: "clip-2.mp4",
				type: "video",
			},
		],
		timeline_words: [
			{
				text: "clipforge",
				start_ms: 500,
				end_ms: 900,
				segment_id: "seg-1",
				media_id: "asset-1",
			},
			{
				text: "clipforge",
				start_ms: 5000,
				end_ms: 5300,
				segment_id: "seg-2",
				media_id: "asset-2",
			},
		],
	});
}

function createFakeEditor({ activeProject }: { activeProject: any | null }) {
	return {
		project: {
			getActive: () => activeProject,
		},
		media: {
			getAssets: () => [
				{
					id: "asset-1",
					name: "clip-1.mp4",
					type: "video",
					ephemeral: false,
				},
				{
					id: "asset-2",
					name: "clip-2.mp4",
					type: "video",
					ephemeral: false,
				},
			],
		},
	} as any;
}

function createActiveProject(): any {
	return {
		id: "project-1",
		currentSceneId: "scene-1",
		scenes: [
			{
				id: "scene-1",
				name: "Main",
				isMain: true,
				bookmarks: [],
				createdAt: new Date(),
				updatedAt: new Date(),
				tracks: [
					{
						id: "track-video",
						name: "Video",
						type: "video",
						isMain: true,
						muted: false,
						hidden: false,
						elements: [
							{
								id: "seg-1",
								name: "Clip 1",
								type: "video",
								mediaId: "asset-1",
								startTime: 0,
								duration: 4000,
								trimStart: 0,
								trimEnd: 0,
								transform: {
									scale: 1,
									position: { x: 0, y: 0 },
									rotate: 0,
								},
								opacity: 1,
							},
							{
								id: "seg-2",
								name: "Clip 2",
								type: "video",
								mediaId: "asset-2",
								startTime: 4000,
								duration: 4000,
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
			},
		],
	};
}

describe("ClipForgeManager.reconcileAndValidateOps", () => {
	test("repairs validator errors into apply-ready ops", () => {
		const manager = new ClipForgeManager(
			createFakeEditor({ activeProject: createActiveProject() }),
		);
		const summary = createProjectSummary();
		const result = manager.reconcileAndValidateOps({
			userText: "move the first clip to 5s",
			projectSummary: summary,
			context,
			ops: [
				{
					type: "MOVE_SEGMENT",
					segment_id: "missing",
					to_ms: 5000,
				},
			],
		});

		expect(result.blocked).toBe(false);
		expect(result.clarification).toBeNull();
		expect(result.ops).toHaveLength(1);
		expect((result.ops[0] as any).segment_id).toBe("seg-1");
		expect(result.secondPassErrors).toEqual([]);
	});

	test("returns blocked diagnostics when no active project exists", () => {
		const manager = new ClipForgeManager(createFakeEditor({ activeProject: null }));
		const summary = createProjectSummary();
		const result = manager.reconcileAndValidateOps({
			userText: "move the first clip to 5s",
			projectSummary: summary,
			context,
			ops: [
				{
					type: "MOVE_SEGMENT",
					segment_id: "seg-1",
					to_ms: 5000,
				},
			],
		});

		expect(result.blocked).toBe(true);
		expect(result.ops).toEqual([]);
		expect(result.firstPassErrors[0]?.code).toBe("no_active_project");
	});

	test("returns clarification when validator recovery target is ambiguous", () => {
		const manager = new ClipForgeManager(
			createFakeEditor({ activeProject: createActiveProject() }),
		);
		const summary = createProjectSummary();
		const result = manager.reconcileAndValidateOps({
			userText: 'delete the clip where i say "clipforge"',
			projectSummary: summary,
			context,
			ops: [
				{
					type: "DELETE_SEGMENT",
					segment_id: "missing",
				},
			],
		});

		expect(result.blocked).toBe(true);
		expect(result.clarification?.kind).toBe("target");
		expect(result.ops).toEqual([]);
	});
});
