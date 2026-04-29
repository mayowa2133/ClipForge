import type { ExportFormat, ExportQuality, PublishDestination } from "@/types/export";
import type { TProject } from "@/types/project";

export interface RenderGraphMediaRef {
	mediaId: string;
	cloudStorageKey: string | null;
	bytes?: number;
	contentType?: string | null;
	durationSeconds?: number | null;
}

export interface RenderGraphInput {
	contractVersion: 1;
	projectId: string;
	projectName: string;
	projectVersion: number;
	format: ExportFormat;
	quality: ExportQuality;
	includeAudio: boolean;
	publishDestination: PublishDestination;
	canvasSize: { width: number; height: number };
	durationSeconds: number;
	sceneCount: number;
	mediaRefs: RenderGraphMediaRef[];
	project: TProject;
}

export interface BuildRenderGraphArgs {
	project: TProject;
	format: ExportFormat;
	quality: ExportQuality;
	includeAudio: boolean;
	publishDestination: PublishDestination;
	mediaRefs?: RenderGraphMediaRef[];
}

export function buildRenderGraphInput({
	project,
	format,
	quality,
	includeAudio,
	publishDestination,
	mediaRefs = [],
}: BuildRenderGraphArgs): RenderGraphInput {
	return {
		contractVersion: 1,
		projectId: project.metadata.id,
		projectName: project.metadata.name,
		projectVersion: project.version,
		format,
		quality,
		includeAudio,
		publishDestination,
		canvasSize: {
			width: project.settings.canvasSize.width,
			height: project.settings.canvasSize.height,
		},
		durationSeconds: project.metadata.duration,
		sceneCount: project.scenes.length,
		mediaRefs,
		project,
	};
}

export function isRenderGraphInput(value: unknown): value is RenderGraphInput {
	if (!value || typeof value !== "object") return false;
	const candidate = value as Partial<RenderGraphInput>;
	return (
		candidate.contractVersion === 1 &&
		typeof candidate.projectId === "string" &&
		typeof candidate.projectVersion === "number" &&
		typeof candidate.format === "string" &&
		typeof candidate.quality === "string" &&
		typeof candidate.includeAudio === "boolean"
	);
}

export interface RenderArtifactSummary {
	storageKey: string;
	contentType: string;
	fileName: string;
	bytes: number;
	durationSeconds: number;
	contractVersion: 1;
	stub: boolean;
	rendererId: string;
	completedAt: string;
}

export function defaultArtifactFileName({
	input,
}: {
	input: RenderGraphInput;
}): string {
	const safeName = input.projectName
		.replace(/[^a-zA-Z0-9_-]+/g, "_")
		.replace(/^_+|_+$/g, "")
		.slice(0, 60);
	const ext = input.format === "webm" ? "webm" : "mp4";
	return `${safeName || "clipforge-export"}.${ext}`;
}
