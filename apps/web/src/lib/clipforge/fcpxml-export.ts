import type { TProject } from "@/types/project";
import type { MediaAsset } from "@/types/assets";
import type {
	VideoElement,
	ImageElement,
	AudioElement,
	TextElement,
	VideoTrack,
	AudioTrack,
	TextTrack,
	TimelineTrack,
} from "@/types/timeline";

export interface FcpxmlExportOptions {
	project: TProject;
	mediaAssets: MediaAsset[];
	fps?: number;
}

export interface FcpxmlExportResult {
	xml: string;
	fileName: string;
	warnings: string[];
}

function rationalTime(seconds: number, fps: number): string {
	if (seconds === 0) return "0s";
	const frames = Math.round(seconds * fps);
	if (fps === 30 || fps === 60) {
		const denom = fps * 1000;
		return `${frames * 1001}/${denom}s`;
	}
	if (fps === 24) {
		return `${frames * 1001}/24000s`;
	}
	return `${frames}/${fps}s`;
}

function escapeXml(str: string): string {
	return str
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}

function computeSequenceDuration(tracks: TimelineTrack[]): number {
	let maxEnd = 0;
	for (const track of tracks) {
		for (const el of track.elements) {
			const end = el.startTime + el.duration;
			if (end > maxEnd) maxEnd = end;
		}
	}
	return maxEnd;
}

function mediaIdToAssetRef(
	mediaId: string,
	assetRefMap: Map<string, string>,
): string {
	return assetRefMap.get(mediaId) ?? `r_${mediaId}`;
}

function buildFormatElement(
	id: string,
	fps: number,
	width: number,
	height: number,
): string {
	const frameDuration = rationalTime(1 / fps, fps);
	return `    <format id="${id}" name="FFVideoFormat${height}p${fps}" frameDuration="${frameDuration}" width="${width}" height="${height}"/>`;
}

function buildAssetElement(
	refId: string,
	asset: MediaAsset,
	fps: number,
): string {
	const duration = asset.duration ? rationalTime(asset.duration, fps) : "0s";
	const hasVideo = asset.type === "video" || asset.type === "image" ? "1" : "0";
	const hasAudio = asset.type === "video" || asset.type === "audio" ? "1" : "0";
	const src = asset.url ?? asset.name;
	return `    <asset id="${refId}" name="${escapeXml(asset.name)}" src="${escapeXml(src)}" start="0s" duration="${duration}" hasVideo="${hasVideo}" hasAudio="${hasAudio}"/>`;
}

function buildVideoClipElement(
	el: VideoElement | ImageElement,
	fps: number,
	assetRefMap: Map<string, string>,
	formatRef: string,
): string {
	const offset = rationalTime(el.startTime, fps);
	const duration = rationalTime(el.duration, fps);
	const start = rationalTime(el.trimStart, fps);
	const ref = mediaIdToAssetRef(el.mediaId, assetRefMap);
	const name = escapeXml(el.name);
	return `        <asset-clip ref="${ref}" offset="${offset}" name="${name}" duration="${duration}" start="${start}" format="${formatRef}" tcFormat="NDF"/>`;
}

function buildAudioClipElement(
	el: AudioElement,
	fps: number,
	assetRefMap: Map<string, string>,
): string {
	const offset = rationalTime(el.startTime, fps);
	const duration = rationalTime(el.duration, fps);
	const start = rationalTime(el.trimStart, fps);
	const mediaId = el.sourceType === "upload" ? el.mediaId : "";
	const ref = mediaIdToAssetRef(mediaId, assetRefMap);
	const name = escapeXml(el.name);
	return `        <audio ref="${ref}" offset="${offset}" name="${name}" duration="${duration}" start="${start}" role="dialogue"/>`;
}

function buildTitleElement(
	el: TextElement,
	fps: number,
): string {
	const offset = rationalTime(el.startTime, fps);
	const duration = rationalTime(el.duration, fps);
	const name = escapeXml(el.name);
	const text = escapeXml(el.content);
	return [
		`        <title offset="${offset}" name="${name}" duration="${duration}">`,
		`          <text>${text}</text>`,
		`        </title>`,
	].join("\n");
}

export function exportProjectToFcpxml({
	project,
	mediaAssets,
	fps: fpsOverride,
}: FcpxmlExportOptions): FcpxmlExportResult {
	const warnings: string[] = [];
	const fps = fpsOverride ?? project.settings.fps ?? 30;
	const scene = project.scenes.find((s) => s.isMain) ?? project.scenes[0];

	if (!scene) {
		return {
			xml: "",
			fileName: "",
			warnings: ["No scenes found in project."],
		};
	}

	const assetMap = new Map<string, MediaAsset>();
	for (const asset of mediaAssets) {
		assetMap.set(asset.id, asset);
	}

	const referencedMediaIds = new Set<string>();
	for (const track of scene.tracks) {
		for (const el of track.elements) {
			if ("mediaId" in el && typeof el.mediaId === "string") {
				referencedMediaIds.add(el.mediaId);
			}
			if ("sourceType" in el && el.sourceType === "upload" && "mediaId" in el) {
				referencedMediaIds.add((el as { mediaId: string }).mediaId);
			}
		}
	}

	const assetRefMap = new Map<string, string>();
	let refCounter = 2;
	for (const mediaId of referencedMediaIds) {
		assetRefMap.set(mediaId, `r${refCounter++}`);
	}

	const formatRef = "r1";
	const sampleAsset = mediaAssets.find((a) => a.type === "video");
	const width = sampleAsset?.width ?? 1920;
	const height = sampleAsset?.height ?? 1080;

	const resourceLines: string[] = [];
	resourceLines.push(buildFormatElement(formatRef, fps, width, height));

	for (const mediaId of referencedMediaIds) {
		const asset = assetMap.get(mediaId);
		if (!asset) {
			warnings.push(`Media asset ${mediaId} not found — placeholder asset reference used.`);
			resourceLines.push(
				`    <asset id="${assetRefMap.get(mediaId)}" name="missing_${mediaId}" src="" start="0s" duration="0s" hasVideo="1" hasAudio="1"/>`,
			);
			continue;
		}
		resourceLines.push(
			buildAssetElement(assetRefMap.get(mediaId)!, asset, fps),
		);
	}

	const sequenceDuration = rationalTime(
		computeSequenceDuration(scene.tracks),
		fps,
	);

	const spineLines: string[] = [];
	const laneLines: string[] = [];

	const mainVideoTrack = scene.tracks.find(
		(t): t is VideoTrack => t.type === "video" && t.isMain,
	);
	const overlayVideoTracks = scene.tracks.filter(
		(t): t is VideoTrack => t.type === "video" && !t.isMain,
	);
	const audioTracks = scene.tracks.filter(
		(t): t is AudioTrack => t.type === "audio",
	);
	const textTracks = scene.tracks.filter(
		(t): t is TextTrack => t.type === "text",
	);

	if (mainVideoTrack) {
		for (const el of mainVideoTrack.elements) {
			spineLines.push(
				buildVideoClipElement(el, fps, assetRefMap, formatRef),
			);
		}
	}

	let laneIndex = 1;
	for (const track of overlayVideoTracks) {
		for (const el of track.elements) {
			const clip = buildVideoClipElement(el, fps, assetRefMap, formatRef);
			laneLines.push(clip.replace("/>", ` lane="${laneIndex}"/>`));
		}
		laneIndex++;
	}

	for (const track of audioTracks) {
		for (const el of track.elements) {
			const clip = buildAudioClipElement(el, fps, assetRefMap);
			laneLines.push(clip.replace("/>", ` lane="${laneIndex}"/>`));
		}
		laneIndex++;
	}

	for (const track of textTracks) {
		for (const el of track.elements) {
			const title = buildTitleElement(el, fps);
			laneLines.push(title);
		}
	}

	if (spineLines.length === 0 && laneLines.length > 0) {
		spineLines.push(
			`        <gap offset="0s" name="Gap" duration="${sequenceDuration}"/>`,
		);
	}

	const projectName = escapeXml(project.metadata.name);

	const xml = [
		`<?xml version="1.0" encoding="UTF-8"?>`,
		`<!DOCTYPE fcpxml>`,
		`<fcpxml version="1.11">`,
		`  <resources>`,
		...resourceLines,
		`  </resources>`,
		`  <library>`,
		`    <event name="ClipForge Export">`,
		`      <project name="${projectName}">`,
		`        <sequence format="${formatRef}" duration="${sequenceDuration}" tcStart="0s" tcFormat="NDF">`,
		`          <spine>`,
		...spineLines,
		...laneLines,
		`          </spine>`,
		`        </sequence>`,
		`      </project>`,
		`    </event>`,
		`  </library>`,
		`</fcpxml>`,
	].join("\n");

	const fileName = `${project.metadata.name.replace(/[^a-zA-Z0-9_-]/g, "_")}_export.fcpxml`;

	return { xml, fileName, warnings };
}

export function downloadFcpxml(result: FcpxmlExportResult): void {
	const blob = new Blob([result.xml], { type: "application/xml" });
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = result.fileName;
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
	URL.revokeObjectURL(url);
}
