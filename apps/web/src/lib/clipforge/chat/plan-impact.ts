import { buildTimelineDiffPatch } from "@/lib/clipforge/timeline-op-engine";
import type { MediaAsset } from "@/types/assets";
import type { TimelineDiffOp } from "@/types/clipforge";
import type { TProject } from "@/types/project";
import type { TimelineElement } from "@/types/timeline";
import { buildProjectSummary } from "./project-summarizer";
import type {
	ChatPlanImpactCard,
	ChatPlanImpactJumpTarget,
	ChatPlanPreviewResult,
	ProjectSegmentSummary,
} from "./types";

interface ElementLookupEntry {
	trackId: string;
	segmentId: string;
	startMs: number;
	endMs: number;
	textContent: string | null;
}

export function buildPlanImpactPreview({
	project,
	mediaAssets = [],
	ops,
}: {
	project: TProject;
	mediaAssets?: MediaAsset[];
	ops: TimelineDiffOp[];
}): ChatPlanPreviewResult {
	if (ops.length === 0) {
		return {
			cards: [],
			summary: {
				totalOps: 0,
				impactCount: 0,
				simulatedDurationDeltaMs: 0,
			},
		};
	}

	const patch = buildTimelineDiffPatch({
		project,
		mediaAssets,
		ops,
		source: "chat",
	});
	const beforeSummary = buildProjectSummary({
		project: patch.before,
		mediaAssets,
	});
	const afterSummary = buildProjectSummary({
		project: patch.after,
		mediaAssets,
	});
	const beforeSegmentsById = new Map(
		beforeSummary.segments.map((segment) => [segment.segment_id, segment]),
	);
	const afterSegmentsById = new Map(
		afterSummary.segments.map((segment) => [segment.segment_id, segment]),
	);
	const beforeLookupById = buildElementLookupById({ project: patch.before });
	const afterLookupById = buildElementLookupById({ project: patch.after });
	const beforeIds = new Set(beforeSummary.segments.map((segment) => segment.segment_id));
	const insertedAfterSegments = afterSummary.segments.filter(
		(segment) => !beforeIds.has(segment.segment_id),
	);
	const mediaNameById = new Map(mediaAssets.map((asset) => [asset.id, asset.name]));

	const cards = ops.map((op, opIndex) =>
		buildImpactCard({
			op,
			opIndex,
			beforeSegmentsById,
			afterSegmentsById,
			beforeLookupById,
			afterLookupById,
			insertedAfterSegments,
			mediaNameById,
		}),
	);

	return {
		cards,
		summary: {
			totalOps: ops.length,
			impactCount: cards.length,
			simulatedDurationDeltaMs: Math.round(
				(patch.after.metadata.duration - patch.before.metadata.duration) * 1000,
			),
		},
	};
}

function buildImpactCard({
	op,
	opIndex,
	beforeSegmentsById,
	afterSegmentsById,
	beforeLookupById,
	afterLookupById,
	insertedAfterSegments,
	mediaNameById,
}: {
	op: TimelineDiffOp;
	opIndex: number;
	beforeSegmentsById: Map<string, ProjectSegmentSummary>;
	afterSegmentsById: Map<string, ProjectSegmentSummary>;
	beforeLookupById: Map<string, ElementLookupEntry>;
	afterLookupById: Map<string, ElementLookupEntry>;
	insertedAfterSegments: ProjectSegmentSummary[];
	mediaNameById: Map<string, string>;
}): ChatPlanImpactCard {
	switch (op.type) {
		case "TRIM_CLIP": {
			const beforeSegment = beforeSegmentsById.get(op.clip_id) ?? null;
			const afterSegment = afterSegmentsById.get(op.clip_id) ?? null;
			const jump = buildJumpTarget({
				primary: beforeLookupById.get(op.clip_id),
				fallbackTimeMs: beforeSegment?.start_ms ?? 0,
			});
			const detailParts: string[] = [];
			if (op.in_ms > 0) {
				detailParts.push(`Start trim +${Math.round(op.in_ms)}ms`);
			}
			if (op.out_ms > 0) {
				detailParts.push(`End trim +${Math.round(op.out_ms)}ms`);
			}
			return {
				opIndex,
				opType: op.type,
				kind: "trim",
				title: "Trim clip",
				detail: detailParts.length > 0 ? detailParts.join(" · ") : "Trim clip",
				beforeRangeMs: toRange(beforeSegment),
				afterRangeMs: toRange(afterSegment),
				jump,
			};
		}
		case "MOVE_SEGMENT": {
			const beforeSegment = beforeSegmentsById.get(op.segment_id) ?? null;
			const afterSegment = afterSegmentsById.get(op.segment_id) ?? null;
			const fromMs = beforeSegment?.start_ms ?? op.to_ms;
			const toMs = afterSegment?.start_ms ?? op.to_ms;
			const deltaMs = toMs - fromMs;
			return {
				opIndex,
				opType: op.type,
				kind: "move",
				title: "Move segment",
				detail: `${formatTimeMs(fromMs)} -> ${formatTimeMs(toMs)} (${formatSignedSeconds(
					deltaMs,
				)})`,
				beforeRangeMs: toRange(beforeSegment),
				afterRangeMs: toRange(afterSegment),
				jump: buildJumpTarget({
					primary: afterLookupById.get(op.segment_id),
					fallbackTimeMs: toMs,
				}),
			};
		}
		case "SWAP_SEGMENTS": {
			const beforeA = beforeSegmentsById.get(op.a_id) ?? null;
			const beforeB = beforeSegmentsById.get(op.b_id) ?? null;
			const afterA = afterSegmentsById.get(op.a_id) ?? null;
			const afterB = afterSegmentsById.get(op.b_id) ?? null;
			return {
				opIndex,
				opType: op.type,
				kind: "swap",
				title: "Swap two segments",
				detail: `A ${formatRange(beforeA)} -> ${formatRange(afterA)} · B ${formatRange(
					beforeB,
				)} -> ${formatRange(afterB)}`,
				beforeRangeMs: toRange(beforeA),
				afterRangeMs: toRange(afterA),
				jump: buildJumpTarget({
					primary: afterLookupById.get(op.a_id) ?? beforeLookupById.get(op.a_id),
					fallbackTimeMs: afterA?.start_ms ?? beforeA?.start_ms ?? 0,
				}),
			};
		}
		case "DELETE_SEGMENT": {
			const beforeSegment = beforeSegmentsById.get(op.segment_id) ?? null;
			return {
				opIndex,
				opType: op.type,
				kind: "delete",
				title: "Delete segment",
				detail: `${describeSegmentKind(
					beforeSegment?.segment_kind,
				)} removed at ${formatRange(beforeSegment)}`,
				beforeRangeMs: toRange(beforeSegment),
				jump: buildJumpTarget({
					primary: beforeLookupById.get(op.segment_id),
					fallbackTimeMs: beforeSegment?.start_ms ?? 0,
				}),
			};
		}
		case "DUPLICATE_SEGMENT": {
			const sourceSegment = beforeSegmentsById.get(op.segment_id) ?? null;
			const insertedSegment = findInsertedDuplicateSegment({
				insertedSegments: insertedAfterSegments,
				sourceSegment,
				toMs: op.to_ms,
			});
			return {
				opIndex,
				opType: op.type,
				kind: "duplicate",
				title: "Duplicate segment",
				detail: `Source ${formatRange(sourceSegment)} -> Inserted ${formatRange(
					insertedSegment,
				)}`,
				beforeRangeMs: toRange(sourceSegment),
				afterRangeMs: toRange(insertedSegment),
				jump: buildJumpTarget({
					primary:
						(insertedSegment &&
							afterLookupById.get(insertedSegment.segment_id)) ??
						null,
					fallbackTimeMs: insertedSegment?.start_ms ?? op.to_ms,
				}),
			};
		}
		case "FIX_CAPTION_TEXT": {
			const beforeSegment = beforeSegmentsById.get(op.segment_id) ?? null;
			const afterSegment = afterSegmentsById.get(op.segment_id) ?? null;
			const beforeText =
				beforeLookupById.get(op.segment_id)?.textContent ??
				beforeSegment?.text_content ??
				null;
			const afterText =
				afterLookupById.get(op.segment_id)?.textContent ??
				afterSegment?.text_content ??
				beforeText;
			return {
				opIndex,
				opType: op.type,
				kind: "fix-caption",
				title: "Fix caption text",
				detail: `Replace "${op.from}" -> "${op.to}"`,
				beforeText,
				afterText,
				beforeRangeMs: toRange(beforeSegment),
				afterRangeMs: toRange(afterSegment),
				jump: buildJumpTarget({
					primary: beforeLookupById.get(op.segment_id),
					fallbackTimeMs: beforeSegment?.start_ms ?? 0,
				}),
			};
		}
		case "ADD_TEXT_OVERLAY": {
			const insertedSegment = findInsertedTextOverlay({
				insertedSegments: insertedAfterSegments,
				startMs: op.start_ms,
				text: op.text,
			});
			return {
				opIndex,
				opType: op.type,
				kind: "add-text",
				title: "Add text overlay",
				detail: `"${truncateText(op.text, 48)}" · ${formatTimeRangeMs(
					op.start_ms,
					op.end_ms,
				)} · ${op.position}`,
				afterText: op.text,
				afterRangeMs: insertedSegment
					? toRange(insertedSegment)
					: { start: op.start_ms, end: op.end_ms },
				jump: buildJumpTarget({
					primary:
						(insertedSegment &&
							afterLookupById.get(insertedSegment.segment_id)) ??
						null,
					fallbackTimeMs: op.start_ms,
				}),
			};
		}
		case "CUT_RANGE":
			return {
				opIndex,
				opType: op.type,
				kind: "cut-range",
				title: "Cut timeline range",
				detail: `${formatTimeRangeMs(op.start_ms, op.end_ms)} removed (${formatSeconds(
					op.end_ms - op.start_ms,
				)})`,
				beforeRangeMs: { start: op.start_ms, end: op.end_ms },
				jump: {
					time_ms: op.start_ms,
					track_id: null,
					segment_id: null,
				},
			};
		case "INSERT_BROLL": {
			const mediaName = mediaNameById.get(op.media_id) ?? op.media_id;
			const insertedSegment = findInsertedBrollSegment({
				insertedSegments: insertedAfterSegments,
				assetId: op.media_id,
				startMs: op.start_ms,
			});
			return {
				opIndex,
				opType: op.type,
				kind: "insert-broll",
				title: "Insert B-roll",
				detail: `${mediaName} · ${formatTimeRangeMs(op.start_ms, op.end_ms)} · ${
					op.fit_mode
				}/${op.lane}`,
				afterRangeMs: insertedSegment
					? toRange(insertedSegment)
					: { start: op.start_ms, end: op.end_ms },
				jump: buildJumpTarget({
					primary:
						(insertedSegment &&
							afterLookupById.get(insertedSegment.segment_id)) ??
						null,
					fallbackTimeMs: op.start_ms,
				}),
			};
		}
		case "SET_CAPTION_STYLE":
			return {
				opIndex,
				opType: op.type,
				kind: "caption-style",
				title: "Update caption style",
				detail: `${op.style_id} · ${op.position} · ${Math.round(op.size)}px`,
				jump: null,
			};
		case "SET_ASPECT_RATIO":
			return {
				opIndex,
				opType: op.type,
				kind: "aspect-ratio",
				title: "Set aspect ratio",
				detail: `Preset ${op.preset}`,
				jump: null,
			};
		case "MAKE_VERSION":
			return {
				opIndex,
				opType: op.type,
				kind: "make-version",
				title: "Make shorter version",
				detail: `Target ${formatSeconds(
					op.duration_target_s * 1000,
				)} · aggressiveness ${op.aggressiveness.toFixed(2)}`,
				jump: null,
			};
		case "REMOVE_SILENCE":
			return {
				opIndex,
				opType: op.type,
				kind: "remove-silence",
				title: "Remove silence",
				detail: `threshold ${op.threshold_ms}ms · pad ${op.pad_ms}ms · min keep ${op.min_keep_ms}ms`,
				jump: null,
			};
		default:
			return {
				opIndex,
				opType: (op as TimelineDiffOp).type,
				kind: "unknown",
				title: "Timeline change",
				detail: "Deterministic timeline operation",
				jump: null,
			};
	}
}

function buildElementLookupById({
	project,
}: {
	project: TProject;
}): Map<string, ElementLookupEntry> {
	const lookup = new Map<string, ElementLookupEntry>();
	const activeScene =
		project.scenes.find((scene) => scene.id === project.currentSceneId) ??
		project.scenes[0];
	if (!activeScene) {
		return lookup;
	}

	for (const track of activeScene.tracks) {
		for (const element of track.elements) {
			lookup.set(element.id, {
				trackId: track.id,
				segmentId: element.id,
				startMs: Math.round(element.startTime * 1000),
				endMs: Math.round((element.startTime + element.duration) * 1000),
				textContent: getElementTextContent(element),
			});
		}
	}

	return lookup;
}

function findInsertedDuplicateSegment({
	insertedSegments,
	sourceSegment,
	toMs,
}: {
	insertedSegments: ProjectSegmentSummary[];
	sourceSegment: ProjectSegmentSummary | null;
	toMs: number;
}): ProjectSegmentSummary | null {
	if (insertedSegments.length === 0) {
		return null;
	}

	const compatible = insertedSegments.filter((segment) => {
		if (!sourceSegment) {
			return true;
		}
		return (
			segment.segment_kind === sourceSegment.segment_kind &&
			segment.asset_id === sourceSegment.asset_id
		);
	});
	if (compatible.length === 0) {
		return null;
	}

	return [...compatible].sort((a, b) => {
		const distance = Math.abs(a.start_ms - toMs) - Math.abs(b.start_ms - toMs);
		if (distance !== 0) {
			return distance;
		}
		return a.start_ms - b.start_ms;
	})[0];
}

function findInsertedTextOverlay({
	insertedSegments,
	startMs,
	text,
}: {
	insertedSegments: ProjectSegmentSummary[];
	startMs: number;
	text: string;
}): ProjectSegmentSummary | null {
	const candidates = insertedSegments.filter(
		(segment) =>
			segment.segment_kind === "text-overlay" || segment.segment_kind === "caption",
	);
	if (candidates.length === 0) {
		return null;
	}
	const normalizedText = text.trim().toLowerCase();
	return [...candidates].sort((a, b) => {
		const textScoreA = a.text_content.toLowerCase().includes(normalizedText) ? 0 : 1;
		const textScoreB = b.text_content.toLowerCase().includes(normalizedText) ? 0 : 1;
		if (textScoreA !== textScoreB) {
			return textScoreA - textScoreB;
		}
		const distance = Math.abs(a.start_ms - startMs) - Math.abs(b.start_ms - startMs);
		if (distance !== 0) {
			return distance;
		}
		return a.start_ms - b.start_ms;
	})[0];
}

function findInsertedBrollSegment({
	insertedSegments,
	assetId,
	startMs,
}: {
	insertedSegments: ProjectSegmentSummary[];
	assetId: string;
	startMs: number;
}): ProjectSegmentSummary | null {
	const candidates = insertedSegments.filter(
		(segment) => segment.segment_kind === "video" && segment.asset_id === assetId,
	);
	if (candidates.length === 0) {
		return null;
	}
	return [...candidates].sort((a, b) => {
		const distance = Math.abs(a.start_ms - startMs) - Math.abs(b.start_ms - startMs);
		if (distance !== 0) {
			return distance;
		}
		return a.start_ms - b.start_ms;
	})[0];
}

function buildJumpTarget({
	primary,
	fallbackTimeMs,
}: {
	primary: ElementLookupEntry | null | undefined;
	fallbackTimeMs: number;
}): ChatPlanImpactJumpTarget {
	if (!primary) {
		return {
			time_ms: Math.max(0, Math.round(fallbackTimeMs)),
			track_id: null,
			segment_id: null,
		};
	}
	return {
		time_ms: Math.max(0, Math.round(primary.startMs)),
		track_id: primary.trackId,
		segment_id: primary.segmentId,
	};
}

function toRange(
	segment: Pick<ProjectSegmentSummary, "start_ms" | "end_ms"> | null | undefined,
): { start: number; end: number } | null {
	if (!segment) {
		return null;
	}
	return {
		start: Math.round(segment.start_ms),
		end: Math.round(segment.end_ms),
	};
}

function getElementTextContent(element: TimelineElement): string | null {
	if (element.type !== "text") {
		return null;
	}
	return element.content;
}

function describeSegmentKind(kind: ProjectSegmentSummary["segment_kind"] | undefined): string {
	switch (kind) {
		case "caption":
			return "Caption";
		case "text-overlay":
			return "Text overlay";
		case "audio":
			return "Audio segment";
		case "video":
			return "Clip";
		default:
			return "Segment";
	}
}

function formatRange(
	segment: Pick<ProjectSegmentSummary, "start_ms" | "end_ms"> | null | undefined,
): string {
	if (!segment) {
		return "unknown";
	}
	return formatTimeRangeMs(segment.start_ms, segment.end_ms);
}

function formatTimeRangeMs(startMs: number, endMs: number): string {
	return `${formatTimeMs(startMs)}–${formatTimeMs(endMs)}`;
}

function formatTimeMs(valueMs: number): string {
	const clamped = Math.max(0, Math.round(valueMs));
	const totalSeconds = clamped / 1000;
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return `${String(minutes).padStart(2, "0")}:${seconds.toFixed(2).padStart(5, "0")}`;
}

function formatSignedSeconds(valueMs: number): string {
	const valueSeconds = valueMs / 1000;
	const sign = valueSeconds >= 0 ? "+" : "-";
	return `${sign}${Math.abs(valueSeconds).toFixed(2)}s`;
}

function formatSeconds(valueMs: number): string {
	return `${Math.max(0, valueMs / 1000).toFixed(2)}s`;
}

function truncateText(value: string, maxLength: number): string {
	if (value.length <= maxLength) {
		return value;
	}
	return `${value.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}
