import { describe, expect, test } from "bun:test";
import {
	applyTimelineDiffOpsToProject,
	buildAutoEditTikTokDraft,
	buildDefaultClipForgeProjectData,
	buildProjectSummary,
	HeuristicChatOpsProvider,
} from "@/lib/clipforge";
import type { MediaAsset } from "@/types/assets";
import type { TProject } from "@/types/project";

function buildProjectFixture(): TProject {
	return {
		metadata: {
			id: "project-int-1",
			name: "ClipForge Integration",
			duration: 0,
			createdAt: new Date("2026-01-01T00:00:00.000Z"),
			updatedAt: new Date("2026-01-01T00:00:00.000Z"),
		},
		scenes: [
			{
				id: "scene-main",
				name: "Main",
				isMain: true,
				bookmarks: [],
				createdAt: new Date("2026-01-01T00:00:00.000Z"),
				updatedAt: new Date("2026-01-01T00:00:00.000Z"),
				tracks: [
					{
						id: "video-main",
						type: "video",
						name: "Main video",
						isMain: true,
						muted: false,
						hidden: false,
						elements: [],
					},
				],
			},
		],
		currentSceneId: "scene-main",
		settings: {
			fps: 30,
			canvasSize: { width: 1920, height: 1080 },
			background: { type: "color", color: "#000000" },
		},
		version: 8,
		clipforge: buildDefaultClipForgeProjectData(),
	};
}

function buildMediaFixtures(): MediaAsset[] {
	const make = ({
		id,
		name,
		duration,
	}: {
		id: string;
		name: string;
		duration: number;
	}): MediaAsset => ({
		id,
		name,
		type: "video",
		duration,
		file: new File(["video"], `${name}.mp4`, { type: "video/mp4" }),
	});

	return [
		make({ id: "clip-001", name: "clip-001", duration: 2.8 }),
		make({ id: "clip-002", name: "clip-002", duration: 3.2 }),
		make({ id: "clip-003", name: "clip-003", duration: 2.4 }),
	];
}

function sanitizeProject(project: TProject) {
	return {
		canvas: project.settings.canvasSize,
		duration: Number(project.metadata.duration.toFixed(2)),
		clipforge: {
			activeCaptionStyleId: project.clipforge?.activeCaptionStyleId ?? null,
			opsAuditTypes:
				project.clipforge?.opsAudit.map((entry) =>
					entry.ops.map((op) => op.type),
				) ?? [],
		},
		tracks:
			project.scenes.find((scene) => scene.id === project.currentSceneId)?.tracks.map(
				(track) => ({
					type: track.type,
					segments: track.elements.map((segment) => ({
						type: segment.type,
						start: Number(segment.startTime.toFixed(2)),
						duration: Number(segment.duration.toFixed(2)),
						mediaId:
							"mediaId" in segment && typeof segment.mediaId === "string"
								? segment.mediaId
								: null,
						content:
							segment.type === "text" ? segment.content.slice(0, 40) : null,
					})),
				}),
			) ?? [],
	};
}

describe("ClipForge integration flow", () => {
	test("ingest 3 clips -> auto edit -> apply chat ops -> stable snapshot", async () => {
		const project = buildProjectFixture();
		const mediaAssets = buildMediaFixtures();
		const autoDraft = buildAutoEditTikTokDraft({
			project,
			mediaAssets,
		});

		const provider = new HeuristicChatOpsProvider();
		const summary = buildProjectSummary({ project: autoDraft });
		const chatOps = await provider.proposeEdits({
			userText: "make it faster and use clean bottom subtitles",
			projectSummary: summary,
		});

		const finalProject = applyTimelineDiffOpsToProject({
			project: autoDraft,
			ops: chatOps,
			source: "chat",
			now: new Date("2026-02-27T10:00:00.000Z"),
		});

		expect(sanitizeProject(finalProject)).toMatchSnapshot();
	});
});
