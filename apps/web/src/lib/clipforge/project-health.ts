import { hasMediaId } from "@/lib/timeline/element-utils";
import { buildProjectAssembly } from "@/lib/scenes";
import type { MediaAsset } from "@/types/assets";
import type { TProject } from "@/types/project";
import type { ExportPreflightCode } from "@/types/export";

const HEALTH_SCHEMA_VERSION = "health-v1";
const ISSUE_SCHEMA_VERSION = "issue-v1";

export function buildProjectHealthFingerprint({
	project,
	mediaAssets,
}: {
	project: TProject | null;
	mediaAssets: MediaAsset[];
}): string {
	if (!project) {
		return `${HEALTH_SCHEMA_VERSION}|no-project`;
	}

	const mediaTuple = buildMediaTuple({ mediaAssets });
	const assembly = buildProjectAssembly({ scenes: project.scenes });

	if (project.scenes.length === 0) {
		return [
			HEALTH_SCHEMA_VERSION,
			`project:${project.metadata.id}`,
			"scene:none",
			`duration:${formatNumber(project.metadata.duration)}`,
			`media:${mediaTuple}`,
		].join("|");
	}

	const elementTuple = project.scenes
		.flatMap((scene) => {
			const sceneAssembly =
				assembly.find((entry) => entry.sceneId === scene.id) ?? null;
			const sceneOffset = sceneAssembly?.projectStartTime ?? 0;
			const sceneIndex = project.scenes.findIndex((entry) => entry.id === scene.id);
			return scene.tracks.flatMap((track) =>
				track.elements.map((element) => ({
					sceneIndex,
					sceneId: scene.id,
					trackId: track.id,
					segmentId: element.id,
					type: element.type,
					mediaId: hasMediaId(element) ? element.mediaId : null,
					start: element.startTime + sceneOffset,
					duration: element.duration,
					trimStart: element.trimStart,
					trimEnd: element.trimEnd,
				})),
			);
		})
		.sort((a, b) => {
			if (a.sceneIndex !== b.sceneIndex) return a.sceneIndex - b.sceneIndex;
			if (a.start !== b.start) return a.start - b.start;
			if (a.trackId !== b.trackId) return a.trackId.localeCompare(b.trackId);
			return a.segmentId.localeCompare(b.segmentId);
		})
		.map((entry) =>
			[
				entry.sceneIndex,
				entry.sceneId,
				entry.trackId,
				entry.segmentId,
				entry.type,
				entry.mediaId ?? "none",
				formatNumber(entry.start),
				formatNumber(entry.duration),
				formatNumber(entry.trimStart),
				formatNumber(entry.trimEnd),
			].join(":"),
		)
		.join(",");

	return [
		HEALTH_SCHEMA_VERSION,
		`project:${project.metadata.id}`,
		`sceneCount:${project.scenes.length}`,
		`duration:${formatNumber(project.metadata.duration)}`,
		`elements:${elementTuple}`,
		`media:${mediaTuple}`,
	].join("|");
}

export function buildExportPreflightIssueId({
	code,
	mediaId,
	trackId,
	segmentId,
}: {
	code: ExportPreflightCode;
	mediaId?: string | null;
	trackId?: string | null;
	segmentId?: string | null;
}): string {
	return [
		ISSUE_SCHEMA_VERSION,
		code,
		mediaId ?? "none",
		trackId ?? "none",
		segmentId ?? "none",
	].join("|");
}

function buildMediaTuple({ mediaAssets }: { mediaAssets: MediaAsset[] }): string {
	return mediaAssets
		.map((asset) => ({
			id: asset.id,
			type: asset.type,
			duration: asset.duration ?? 0,
			mimeType: asset.mimeType ?? "",
			compatibilityStatus: asset.compatibility?.status ?? "unknown",
			videoDecode: asset.compatibility?.videoDecode ?? "unknown",
			audioDecode: asset.compatibility?.audioDecode ?? "unknown",
			compatibilityReason: asset.compatibility?.reason ?? "",
		}))
		.sort((a, b) => a.id.localeCompare(b.id))
		.map((asset) =>
			[
				asset.id,
				asset.type,
				formatNumber(asset.duration),
				asset.mimeType || "none",
				asset.compatibilityStatus,
				asset.videoDecode,
				asset.audioDecode,
				asset.compatibilityReason || "none",
			].join(":"),
		)
		.join(",");
}

function formatNumber(value: number): string {
	if (!Number.isFinite(value)) {
		return "nan";
	}
	return value.toFixed(4);
}
