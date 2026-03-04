import type { EditorCore } from "@/core";
import { DEFAULT_TEXT_ELEMENT } from "@/constants/text-constants";
import { processMediaAssets, type ProcessedMediaAsset } from "@/lib/media/processing";
import type { MediaAsset } from "@/types/assets";
import type { TProject } from "@/types/project";
import {
	generateCaptionChunks,
	getCaptionTemplate,
} from "../caption-generator";
import { buildTimelineTranscriptSegments } from "../timeline-transcript";
import { CLIPFORGE_DEMO_MANIFEST, type ClipForgeDemoAssetSpec } from "./manifest";

interface DemoProjectEditor {
	project: Pick<
		EditorCore["project"],
		"createNewProject" | "getActive" | "saveCurrentProject"
	>;
	media: Pick<EditorCore["media"], "addMediaAsset">;
	timeline: Pick<EditorCore["timeline"], "addTrack" | "insertElement">;
	clipforge: Pick<
		EditorCore["clipforge"],
		"initializeMediaMetadata" | "seedMediaMetadata" | "autoEditTikTokDraft" | "applyOps"
	>;
}

type FetchLike = typeof fetch;

export class DemoProjectCreationError extends Error {
	constructor(
		message: string,
		public readonly projectId: string | null = null,
	) {
		super(message);
		this.name = "DemoProjectCreationError";
	}
}

const DEMO_VIDEO_MIME_TYPE = "video/mp4";

async function fetchDemoFile({
	spec,
	fetchImpl,
}: {
	spec: ClipForgeDemoAssetSpec;
	fetchImpl: FetchLike;
}): Promise<File> {
	const response = await fetchImpl(`/clipforge-demo/${spec.fileName}`);
	if (!response.ok) {
		throw new Error(`Failed to load demo asset: ${spec.fileName}`);
	}

	const blob = await response.blob();
	return new File([blob], spec.fileName, {
		type: blob.type || DEMO_VIDEO_MIME_TYPE,
	});
}

async function importDemoAssets({
	editor,
	projectId,
	specs,
	fetchImpl,
	processFiles,
}: {
	editor: DemoProjectEditor;
	projectId: string;
	specs: ClipForgeDemoAssetSpec[];
	fetchImpl: FetchLike;
	processFiles: (args: {
		files: File[];
	}) => Promise<ProcessedMediaAsset[]>;
}): Promise<MediaAsset[]> {
	const files = await Promise.all(
		specs.map((spec) => fetchDemoFile({ spec, fetchImpl })),
	);
	const processedAssets = await processFiles({ files });
	const importedAssets: MediaAsset[] = [];

	for (const asset of processedAssets) {
		const importedAsset = await editor.media.addMediaAsset({
			projectId,
			asset,
		});
		if (!importedAsset) {
			throw new Error(`Failed to import demo asset: ${asset.name}`);
		}
		importedAssets.push(importedAsset);
	}

	editor.clipforge.initializeMediaMetadata({ mediaAssets: importedAssets });

	for (const spec of specs) {
		const importedAsset = importedAssets.find((asset) => asset.name === spec.fileName);
		if (!importedAsset) {
			throw new Error(`Imported demo asset missing: ${spec.fileName}`);
		}
		editor.clipforge.seedMediaMetadata({
			mediaId: importedAsset.id,
			metadata: spec.metadata,
		});
	}

	return importedAssets;
}

function generateDemoCaptions({
	editor,
}: {
	editor: DemoProjectEditor;
}): void {
	const activeProject = editor.project.getActive();
	const captionSegments = buildTimelineTranscriptSegments({
		project: activeProject,
	});
	if (captionSegments.length === 0) {
		return;
	}

	const styleId = CLIPFORGE_DEMO_MANIFEST.defaultCaptionStyle;
	const template = getCaptionTemplate({ styleId });
	const canvasHeight = activeProject.settings.canvasSize.height;
	const positionY =
		template.position === "bottom" ? Math.round(canvasHeight * 0.35) : 0;
	const captionChunks = generateCaptionChunks({
		segments: captionSegments,
		options: {
			maxCharsPerLine: template.style_id === "bold-center" ? 22 : 30,
			maxLines: 2,
			minDisplaySeconds: 0.85,
			maxWordsPerChunk: 10,
		},
	});
	const captionTrackId = editor.timeline.addTrack({
		type: "text",
		index: 0,
	});

	for (const [index, caption] of captionChunks.entries()) {
		editor.timeline.insertElement({
			placement: { mode: "explicit", trackId: captionTrackId },
			element: {
				...DEFAULT_TEXT_ELEMENT,
				name: `Caption ${index + 1}`,
				content: caption.text,
				duration: caption.duration,
				startTime: caption.startTime,
				fontFamily: template.font,
				fontSize: template.size,
				fontWeight: template.style_id === "bold-center" ? "bold" : "normal",
				textAlign: "center",
				background: {
					...DEFAULT_TEXT_ELEMENT.background,
					color: template.outline ? "#000000" : "transparent",
					paddingX: template.outline ? 24 : 0,
					paddingY: template.outline ? 12 : 0,
				},
				transform: {
					...DEFAULT_TEXT_ELEMENT.transform,
					position: {
						...DEFAULT_TEXT_ELEMENT.transform.position,
						y: positionY,
					},
				},
			},
		});
	}

	editor.clipforge.applyOps({
		source: "manual",
		ops: [
			{
				type: "SET_CAPTION_STYLE",
				style_id: template.style_id,
				font: template.font,
				size: template.size,
				position: template.position,
				outline: template.outline,
				highlight_mode: template.highlight_mode,
			},
		],
	});
}

export async function createClipForgeDemoProject({
	editor,
	fetchImpl = fetch,
	processFiles = processMediaAssets,
}: {
	editor: DemoProjectEditor;
	fetchImpl?: FetchLike;
	processFiles?: (args: {
		files: File[];
	}) => Promise<ProcessedMediaAsset[]>;
}): Promise<{ projectId: string; mediaIds: string[] }> {
	let projectId: string | null = null;

	try {
		projectId = await editor.project.createNewProject({
			name: CLIPFORGE_DEMO_MANIFEST.projectName,
		});

		const primarySpecs = CLIPFORGE_DEMO_MANIFEST.assets.filter(
			(asset) => asset.usedFor === "primary",
		);
		const primaryAssets = await importDemoAssets({
			editor,
			projectId,
			specs: primarySpecs,
			fetchImpl,
			processFiles,
		});

		editor.clipforge.autoEditTikTokDraft();
		generateDemoCaptions({ editor });

		const brollSpecs = CLIPFORGE_DEMO_MANIFEST.assets.filter(
			(asset) => asset.usedFor === "broll",
		);
		const brollAssets = await importDemoAssets({
			editor,
			projectId,
			specs: brollSpecs,
			fetchImpl,
			processFiles,
		});

		await editor.project.saveCurrentProject();

		return {
			projectId,
			mediaIds: [...primaryAssets, ...brollAssets].map((asset) => asset.id),
		};
	} catch (error) {
		throw new DemoProjectCreationError(
			error instanceof Error ? error.message : "Failed to create demo project.",
			projectId,
		);
	}
}
