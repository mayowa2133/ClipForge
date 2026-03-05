import { calculateTotalDuration } from "@/lib/timeline";
import {
	collectIncompatibleMediaReferences,
	collectUnverifiedMediaReferences,
} from "@/lib/clipforge/incompatible-media";
import { collectMissingMediaReferences } from "@/lib/clipforge/missing-media";
import {
	buildExportPreflightIssueId,
	buildProjectHealthFingerprint,
} from "@/lib/clipforge/project-health";
import type { MediaAsset } from "@/types/assets";
import type { TimelineDiffOp } from "@/types/clipforge";
import type { TProject } from "@/types/project";
import type { TimelineElement, TimelineTrack } from "@/types/timeline";
import type {
	ExportFormat,
	ExportPreflightAction,
	ExportPreflightIssue,
	ExportPreflightResult,
	ExportQuality,
} from "@/types/export";

interface SegmentInspection {
	trackId: string;
	segmentId: string;
	elementType: TimelineElement["type"];
	mediaId: string | null;
	hasInvalidRange: boolean;
	hasMissingAsset: boolean;
	hasUnsupportedAssetType: boolean;
	supportsVideoExport: boolean;
}

interface PreflightInspectionResult {
	issues: ExportPreflightIssue[];
	segmentInspections: SegmentInspection[];
	timelineDuration: number;
}

export interface ExportPreflightFixResult {
	applied: number;
	failed: number;
	messages: string[];
}

const DURATION_MISMATCH_TOLERANCE_SECONDS = 0.05;

export function evaluateExportPreflight({
	project,
	mediaAssets,
	format,
	quality,
	includeAudio,
}: {
	project: TProject | null;
	mediaAssets: MediaAsset[];
	format: ExportFormat;
	quality: ExportQuality;
	includeAudio: boolean;
}): ExportPreflightResult {
	const healthFingerprint = buildProjectHealthFingerprint({
		project,
		mediaAssets,
	});

	if (!project) {
		const issues: ExportPreflightIssue[] = [
			createIssue({
				code: "no-active-project",
				severity: "error",
				message: "No active project to export.",
				actionable: false,
				action: null,
			}),
		];
		return buildPreflightResult({ issues, healthFingerprint });
	}

	const inspection = inspectProjectForPreflight({
		project,
		mediaAssets,
		includeAudio,
	});
	const issues = [...inspection.issues];

	if (!includeAudio) {
		issues.push(
			createIssue({
			code: "audio-disabled-warning",
			severity: "warning",
			message: "Audio is disabled for this export.",
			actionable: false,
			action: null,
			}),
		);
	}

	if (quality === "low") {
		issues.push(
			createIssue({
			code: "low-quality-warning",
			severity: "warning",
			message: "Low quality may reduce final output sharpness.",
			actionable: true,
			action: "switch-quality-medium",
			}),
		);
	}

	if (format === "webm") {
		issues.push(
			createIssue({
			code: "webm-compat-warning",
			severity: "warning",
			message: "WebM may have lower compatibility on some sharing platforms.",
			actionable: true,
			action: "switch-format-mp4",
			}),
		);
	}

	return buildPreflightResult({ issues, healthFingerprint });
}

export function applyExportPreflightActions({
	project,
	getProject,
	mediaAssets,
	actions,
	applyOps,
	setProject,
	markDirty,
}: {
	project: TProject;
	getProject: () => TProject | null;
	mediaAssets: MediaAsset[];
	actions: ExportPreflightAction[];
	applyOps: ({
		ops,
	}: {
		ops: TimelineDiffOp[];
	}) => {
		applied: boolean;
		errors: Array<{ code: string; message: string }>;
	};
	setProject: ({ project }: { project: TProject }) => void;
	markDirty: () => void;
}): ExportPreflightFixResult {
	const dedupedActions = [...new Set(actions)];
	const messages: string[] = [];
	let applied = 0;
	let failed = 0;

	for (const action of dedupedActions) {
		switch (action) {
			case "remove-missing-segments": {
				const snapshotProject = getProject() ?? project;
				const inspection = inspectProjectForPreflight({
					project: snapshotProject,
					mediaAssets,
					includeAudio: true,
				});
				const targetIds = inspection.segmentInspections
					.filter((segment) => segment.hasMissingAsset)
					.map((segment) => segment.segmentId);
				if (targetIds.length === 0) {
					failed += 1;
					messages.push("No missing-media segments were found.");
					continue;
				}
				const deletionResult = applyDeletionOps({
					targetIds,
					applyOps,
				});
				if (deletionResult.ok) {
					applied += 1;
					messages.push(
						`Removed ${targetIds.length} segment(s) with missing media references.`,
					);
				} else {
					failed += 1;
					messages.push(deletionResult.message);
				}
				continue;
			}
			case "remove-invalid-ranges": {
				const snapshotProject = getProject() ?? project;
				const inspection = inspectProjectForPreflight({
					project: snapshotProject,
					mediaAssets,
					includeAudio: true,
				});
				const targetIds = inspection.segmentInspections
					.filter((segment) => segment.hasInvalidRange)
					.map((segment) => segment.segmentId);
				if (targetIds.length === 0) {
					failed += 1;
					messages.push("No invalid-range segments were found.");
					continue;
				}
				const deletionResult = applyDeletionOps({
					targetIds,
					applyOps,
				});
				if (deletionResult.ok) {
					applied += 1;
					messages.push(`Removed ${targetIds.length} segment(s) with invalid ranges.`);
				} else {
					failed += 1;
					messages.push(deletionResult.message);
				}
				continue;
			}
			case "normalize-duration": {
				const snapshotProject = getProject() ?? project;
				const activeScene = findActiveScene({ project: snapshotProject });
				const normalizedDuration = activeScene
					? calculateTotalDuration({ tracks: activeScene.tracks })
					: 0;
				setProject({
					project: {
						...snapshotProject,
						metadata: {
							...snapshotProject.metadata,
							duration: normalizedDuration,
							updatedAt: new Date(),
						},
					},
				});
				markDirty();
				applied += 1;
				messages.push("Normalized project duration metadata to timeline duration.");
				continue;
			}
			case "switch-format-mp4":
			case "switch-quality-medium": {
				failed += 1;
				messages.push(`Action "${action}" is UI-only and must be handled in export controls.`);
				continue;
			}
			case "scan-media-compatibility":
			case "disable-export-audio": {
				failed += 1;
				messages.push(`Action "${action}" is UI-only and must be handled in export controls.`);
				continue;
			}
			default: {
				const exhaustiveCheck: never = action;
				failed += 1;
				messages.push(`Unsupported preflight action: ${exhaustiveCheck}`);
			}
		}
	}

	return {
		applied,
		failed,
		messages,
	};
}

export function getActionableBlockingActions({
	result,
}: {
	result: ExportPreflightResult | null;
}): ExportPreflightAction[] {
	if (!result) {
		return [];
	}

	return [
		...new Set(
			result.issues
				.filter(
					(issue) =>
						issue.severity === "error" && issue.actionable && !!issue.action,
				)
				.map((issue) => issue.action as ExportPreflightAction),
		),
	];
}

function buildPreflightResult({
	issues,
	healthFingerprint,
}: {
	issues: ExportPreflightIssue[];
	healthFingerprint: string;
}): ExportPreflightResult {
	const blockingCount = issues.filter((issue) => issue.severity === "error").length;
	const warningCount = issues.filter((issue) => issue.severity === "warning").length;
	return {
		ready: blockingCount === 0,
		issues,
		blockingCount,
		warningCount,
		computedAt: new Date().toISOString(),
		healthFingerprint,
	};
}

function inspectProjectForPreflight({
	project,
	mediaAssets,
	includeAudio,
}: {
	project: TProject;
	mediaAssets: MediaAsset[];
	includeAudio: boolean;
}): PreflightInspectionResult {
	const issues: ExportPreflightIssue[] = [];
	const activeScene = findActiveScene({ project });
	if (!activeScene) {
		issues.push(
			createIssue({
			code: "empty-project",
			severity: "error",
			message: "Active project has no scene to export.",
			actionable: false,
			action: null,
			}),
		);
		return {
			issues,
			segmentInspections: [],
			timelineDuration: 0,
		};
	}

	const timelineDuration = calculateTotalDuration({
		tracks: activeScene.tracks,
	});
	const allSegments = collectSegments({
		tracks: activeScene.tracks,
		mediaAssets,
	});
	const hasTimelineElements = allSegments.length > 0;

	if (!hasTimelineElements || timelineDuration <= 0) {
		issues.push(
			createIssue({
			code: "empty-project",
			severity: "error",
			message: "Timeline is empty. Add clips before exporting.",
			actionable: false,
			action: null,
			}),
		);
	}

	const supportedVideoSegments = allSegments.filter(
		(segment) => segment.supportsVideoExport,
	);
	if (supportedVideoSegments.length === 0) {
		issues.push(
			createIssue({
			code: "no-supported-video-segments",
			severity: "error",
			message:
				"No supported video/image segments are available for export in the active scene.",
			actionable: false,
			action: null,
			}),
		);
	}

	const missingMediaReferences = collectMissingMediaReferences({
		project,
		mediaAssets,
	});
	for (const reference of missingMediaReferences) {
		const firstSegment = reference.segments[0] ?? null;
		issues.push(
			createIssue({
			code: "missing-media-asset",
			severity: "error",
			message: "Segment references a missing media asset.",
			actionable: true,
			action: "remove-missing-segments",
			trackId: firstSegment?.trackId ?? null,
			segmentId: firstSegment?.segmentId ?? null,
			mediaId: reference.mediaId,
			referenceCount: reference.referenceCount,
			allowedReplacementTypes: reference.allowedReplacementTypes,
			}),
		);
	}

	const unverifiedCompatibilityReferences = collectUnverifiedMediaReferences({
		project,
		mediaAssets,
		includeAudio,
	});
	for (const reference of unverifiedCompatibilityReferences) {
		const firstSegment = reference.segments[0] ?? null;
		issues.push(
			createIssue({
				code: "media-compatibility-unverified",
				severity: "error",
				message:
					"Media compatibility has not been verified for a referenced asset. Scan compatibility before export.",
				actionable: true,
				action: "scan-media-compatibility",
				trackId: firstSegment?.trackId ?? null,
				segmentId: firstSegment?.segmentId ?? null,
				mediaId: reference.mediaId,
				referenceCount: reference.referenceCount,
				allowedReplacementTypes: reference.allowedReplacementTypes,
				compatibilityStatus: reference.compatibilityStatus,
				compatibilityReason: reference.compatibilityReason,
				compatibilityCheckedAt: reference.compatibilityCheckedAt,
			}),
		);
	}

	const incompatibleReferences = collectIncompatibleMediaReferences({
		project,
		mediaAssets,
		includeAudio,
	});
	for (const reference of incompatibleReferences) {
		const firstSegment = reference.segments[0] ?? null;
		const hasVideoDecodeFailure =
			reference.requiresVideoDecode &&
			reference.compatibilityVideoDecode !== "supported";
		const code = hasVideoDecodeFailure
			? "unsupported-media-codec"
			: "unsupported-audio-decode";
		issues.push(
			createIssue({
				code,
				severity: "error",
				message: hasVideoDecodeFailure
					? "Referenced visual media codec is not decodable in this environment."
					: "Referenced media audio cannot be decoded for export audio mixing.",
				actionable: !hasVideoDecodeFailure && includeAudio,
				action:
					!hasVideoDecodeFailure && includeAudio
						? "disable-export-audio"
						: null,
				trackId: firstSegment?.trackId ?? null,
				segmentId: firstSegment?.segmentId ?? null,
				mediaId: reference.mediaId,
				referenceCount: reference.referenceCount,
				allowedReplacementTypes: reference.allowedReplacementTypes,
				compatibilityStatus: reference.compatibilityStatus,
				compatibilityReason: reference.compatibilityReason,
				compatibilityCheckedAt: reference.compatibilityCheckedAt,
			}),
		);
	}

	for (const segment of allSegments) {
		if (segment.hasUnsupportedAssetType) {
			issues.push(
				createIssue({
				code: "unsupported-media-type",
				severity: "error",
				message:
					"Segment references an unsupported media type for its track element.",
				actionable: false,
				action: null,
				trackId: segment.trackId,
				segmentId: segment.segmentId,
				}),
			);
		}
		if (segment.hasInvalidRange) {
			issues.push(
				createIssue({
				code: "invalid-segment-range",
				severity: "error",
				message: "Segment has invalid timing data and cannot be exported safely.",
				actionable: true,
				action: "remove-invalid-ranges",
				trackId: segment.trackId,
				segmentId: segment.segmentId,
				}),
			);
		}
	}

	if (
		Number.isFinite(project.metadata.duration) &&
		Math.abs(project.metadata.duration - timelineDuration) >
			DURATION_MISMATCH_TOLERANCE_SECONDS
	) {
		issues.push(
			createIssue({
			code: "timeline-duration-mismatch",
			severity: "error",
			message:
				"Project duration metadata is out of sync with timeline content. Normalize duration before export.",
			actionable: true,
			action: "normalize-duration",
			}),
		);
	}

	return {
		issues,
		segmentInspections: allSegments,
		timelineDuration,
	};
}

function collectSegments({
	tracks,
	mediaAssets,
}: {
	tracks: TimelineTrack[];
	mediaAssets: MediaAsset[];
}): SegmentInspection[] {
	const mediaById = new Map(mediaAssets.map((asset) => [asset.id, asset]));
	const segments: SegmentInspection[] = [];

	for (const track of tracks) {
		for (const element of track.elements) {
			const mediaId =
				"mediaId" in element && typeof element.mediaId === "string"
					? element.mediaId
					: null;
			const mediaAsset = mediaId ? mediaById.get(mediaId) ?? null : null;
			const hasMissingAsset = !!mediaId && !mediaAsset;
			const hasUnsupportedAssetType = !!mediaAsset && !isCompatibleAssetType({
				elementType: element.type,
				assetType: mediaAsset.type,
			});
			const hasInvalidRange = !hasValidElementRange({ element });
			const supportsVideoExport =
				(element.type === "video" || element.type === "image") &&
				!hasMissingAsset &&
				!hasUnsupportedAssetType &&
				!hasInvalidRange;

			segments.push({
				trackId: track.id,
				segmentId: element.id,
				elementType: element.type,
				mediaId,
				hasInvalidRange,
				hasMissingAsset,
				hasUnsupportedAssetType,
				supportsVideoExport,
			});
		}
	}

	return segments;
}

function hasValidElementRange({
	element,
}: {
	element: TimelineElement;
}): boolean {
	if (!Number.isFinite(element.startTime) || element.startTime < 0) {
		return false;
	}
	if (!Number.isFinite(element.duration) || element.duration <= 0) {
		return false;
	}
	if (!Number.isFinite(element.trimStart) || element.trimStart < 0) {
		return false;
	}
	if (!Number.isFinite(element.trimEnd) || element.trimEnd < 0) {
		return false;
	}
	return true;
}

function isCompatibleAssetType({
	elementType,
	assetType,
}: {
	elementType: TimelineElement["type"];
	assetType: MediaAsset["type"];
}): boolean {
	if (elementType === "video") {
		return assetType === "video";
	}
	if (elementType === "image") {
		return assetType === "image";
	}
	if (elementType === "audio") {
		return assetType === "audio" || assetType === "video";
	}
	return true;
}

function findActiveScene({ project }: { project: TProject }) {
	return (
		project.scenes.find((scene) => scene.id === project.currentSceneId) ??
		project.scenes[0] ??
		null
	);
}

function applyDeletionOps({
	targetIds,
	applyOps,
}: {
	targetIds: string[];
	applyOps: ({
		ops,
	}: {
		ops: TimelineDiffOp[];
	}) => {
		applied: boolean;
		errors: Array<{ code: string; message: string }>;
	};
}): { ok: boolean; message: string } {
	const ops: TimelineDiffOp[] = targetIds.map((segmentId) => ({
		type: "DELETE_SEGMENT",
		segment_id: segmentId,
	}));
	const result = applyOps({ ops });
	if (result.applied) {
		return {
			ok: true,
			message: "Segments removed.",
		};
	}
	return {
		ok: false,
		message:
			result.errors[0]?.message ??
			"Failed to remove blocked segments during export preflight repair.",
	};
}

function createIssue({
	code,
	mediaId,
	trackId,
	segmentId,
	...rest
}: Omit<ExportPreflightIssue, "id">): ExportPreflightIssue {
	return {
		id: buildExportPreflightIssueId({
			code,
			mediaId,
			trackId,
			segmentId,
		}),
		code,
		mediaId,
		trackId,
		segmentId,
		...rest,
	};
}
