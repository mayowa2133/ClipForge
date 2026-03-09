import type { EditorCore } from "@/core";
import { processMediaAssets, type ProcessedMediaAsset } from "@/lib/media/processing";
import type { MediaAsset } from "@/types/assets";
import type { TProject } from "@/types/project";
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
		| "initializeMediaMetadata"
		| "seedMediaMetadata"
		| "autoEditTikTokDraft"
		| "generateSceneCaptions"
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
	editor.clipforge.generateSceneCaptions({
		template: CLIPFORGE_DEMO_MANIFEST.defaultCaptionStyle,
		overwriteExisting: true,
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
