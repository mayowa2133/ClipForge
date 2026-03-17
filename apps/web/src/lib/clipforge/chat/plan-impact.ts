import { buildTimelineDiffPatch } from "@/lib/clipforge/timeline-op-engine";
import type { MediaAsset } from "@/types/assets";
import type {
	ClipForgeEditorCommand,
	TimelineDiffOp,
} from "@/types/clipforge";
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
				totalCommands: 0,
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
			totalCommands: ops.length,
			totalOps: ops.length,
			impactCount: cards.length,
			simulatedDurationDeltaMs: Math.round(
				(patch.after.metadata.duration - patch.before.metadata.duration) * 1000,
			),
		},
	};
}

export function buildCommandPlanImpactPreview({
	project,
	mediaAssets = [],
	commands,
}: {
	project: TProject;
	mediaAssets?: MediaAsset[];
	commands: ClipForgeEditorCommand[];
}): ChatPlanPreviewResult {
	const timelineOpCommands = commands.flatMap((command) =>
		command.kind === "timeline-op" ? [command.op] : [],
	);
	const timelinePreview =
		timelineOpCommands.length > 0
			? buildPlanImpactPreview({
					project,
					mediaAssets,
					ops: timelineOpCommands,
			  })
			: {
					cards: [],
					summary: {
						totalCommands: 0,
						totalOps: 0,
						impactCount: 0,
						simulatedDurationDeltaMs: 0,
					},
			  };
	const timelineCards = [...timelinePreview.cards];
	const lookup = buildElementLookupById({ project });
	const summary = buildProjectSummary({ project, mediaAssets });
	const cardByCommandIndex = new Map<number, ChatPlanImpactCard>();
	let timelineOpIndex = 0;

	for (const [commandIndex, command] of commands.entries()) {
		if (command.kind === "timeline-op") {
			const timelineCard = timelineCards[timelineOpIndex];
			if (timelineCard) {
				cardByCommandIndex.set(commandIndex, {
					...timelineCard,
					opIndex: commandIndex,
				});
			}
			timelineOpIndex += 1;
			continue;
		}
		cardByCommandIndex.set(
			commandIndex,
			buildDirectCommandImpactCard({
				command,
				commandIndex,
				lookup,
				summary,
			}),
		);
	}

	return {
		cards: commands
			.map((_, index) => cardByCommandIndex.get(index) ?? null)
			.filter((card): card is ChatPlanImpactCard => card !== null),
		summary: {
			totalCommands: commands.length,
			totalOps: timelinePreview.summary.totalOps,
			impactCount: commands.length,
			simulatedDurationDeltaMs: timelinePreview.summary.simulatedDurationDeltaMs,
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

function buildDirectCommandImpactCard({
	command,
	commandIndex,
	lookup,
	summary,
}: {
	command: Exclude<ClipForgeEditorCommand, { kind: "timeline-op" }>;
	commandIndex: number;
	lookup: Map<string, ElementLookupEntry>;
	summary: ReturnType<typeof buildProjectSummary>;
}): ChatPlanImpactCard {
	switch (command.kind) {
		case "set-clip-speed": {
			const target = lookup.get(command.target_segment_ids[0] ?? "");
			return {
				opIndex: commandIndex,
				opType: command.kind,
				kind: "set-clip-speed",
				title: "Set clip speed",
				detail: `${command.playback_rate.toFixed(2)}x${
					command.ripple ? " · ripple" : ""
				}`,
				beforeRangeMs: target
					? { start: target.startMs, end: target.endMs }
					: null,
				jump: buildJumpTarget({
					primary: target,
					fallbackTimeMs: target?.startMs ?? 0,
				}),
			};
		}
		case "separate-audio": {
			const target = lookup.get(command.target_segment_ids[0] ?? "");
			return {
				opIndex: commandIndex,
				opType: command.kind,
				kind: "separate-audio",
				title: "Separate audio",
				detail: `${command.target_segment_ids.length} clip${
					command.target_segment_ids.length === 1 ? "" : "s"
				}`,
				beforeRangeMs: target
					? { start: target.startMs, end: target.endMs }
					: null,
				jump: buildJumpTarget({
					primary: target,
					fallbackTimeMs: target?.startMs ?? 0,
				}),
			};
		}
		case "insert-freeze-frame":
			return {
				opIndex: commandIndex,
				opType: command.kind,
				kind: "freeze-frame",
				title: "Insert freeze frame",
				detail: `${formatTimeMs(command.at_ms)} · ${formatSeconds(
					command.duration_ms,
				)}${command.ripple ? " · ripple" : ""}`,
				jump: {
					time_ms: command.at_ms,
					track_id: null,
					segment_id: command.target_segment_id,
				},
			};
		case "set-transition-in": {
			const target = lookup.get(command.target_segment_ids[0] ?? "");
			return {
				opIndex: commandIndex,
				opType: command.kind,
				kind: "transition",
				title: "Set transition",
				detail: `${command.preset} · ${formatSeconds(command.duration_ms)}`,
				beforeRangeMs: target
					? { start: target.startMs, end: target.endMs }
					: null,
				jump: buildJumpTarget({
					primary: target,
					fallbackTimeMs: target?.startMs ?? 0,
				}),
			};
		}
		case "apply-finishing-look":
			return {
				opIndex: commandIndex,
				opType: command.kind,
				kind: "finishing-look",
				title: "Apply finishing look",
				detail: `${command.preset_id} · ${command.target_segment_ids.length} target${
					command.target_segment_ids.length === 1 ? "" : "s"
				}`,
				jump: buildJumpTarget({
					primary: lookup.get(command.target_segment_ids[0] ?? ""),
					fallbackTimeMs: 0,
				}),
			};
		case "apply-effect-preset":
			return {
				opIndex: commandIndex,
				opType: command.kind,
				kind: "effect",
				title: "Apply effect",
				detail: `${command.effect_kind} · ${command.target_segment_ids.length} target${
					command.target_segment_ids.length === 1 ? "" : "s"
				}`,
				jump: buildJumpTarget({
					primary: lookup.get(command.target_segment_ids[0] ?? ""),
					fallbackTimeMs: 0,
				}),
			};
		case "insert-overlay-preset":
			return {
				opIndex: commandIndex,
				opType: command.kind,
				kind: "overlay-preset",
				title: "Insert overlay preset",
				detail: `${command.preset_id} · ${formatTimeRangeMs(
					command.start_ms,
					command.start_ms + command.duration_ms,
				)}`,
				jump: {
					time_ms: command.start_ms,
					track_id: null,
					segment_id: null,
				},
			};
		case "apply-overlay-style":
			return {
				opIndex: commandIndex,
				opType: command.kind,
				kind: "overlay-style",
				title: "Apply overlay style",
				detail: `${command.variant_id} · ${command.target_element_ids.length} overlay element${
					command.target_element_ids.length === 1 ? "" : "s"
				}`,
				jump: buildJumpTarget({
					primary: lookup.get(command.target_element_ids[0] ?? ""),
					fallbackTimeMs: 0,
				}),
			};
		case "apply-motion-preset":
			return {
				opIndex: commandIndex,
				opType: command.kind,
				kind: "motion-preset",
				title: "Apply motion preset",
				detail: `${command.motion_preset_id} · ${command.target_element_ids.length} target${
					command.target_element_ids.length === 1 ? "" : "s"
				}`,
				jump: buildJumpTarget({
					primary: lookup.get(command.target_element_ids[0] ?? ""),
					fallbackTimeMs: 0,
				}),
			};
		case "apply-sound-sync":
			return {
				opIndex: commandIndex,
				opType: command.kind,
				kind: "sound-sync",
				title: "Apply sound sync",
				detail: `${command.pairing_id} · ${command.target_element_ids.length} target${
					command.target_element_ids.length === 1 ? "" : "s"
				}`,
				jump: buildJumpTarget({
					primary: lookup.get(command.target_element_ids[0] ?? ""),
					fallbackTimeMs: 0,
				}),
			};
		case "set-audio-mix": {
			const parts = Object.entries(command.settings).map(
				([key, value]) => `${key}=${String(value)}`,
			);
			return {
				opIndex: commandIndex,
				opType: command.kind,
				kind: "audio-mix",
				title: "Update audio mix",
				detail: parts.join(" · "),
				jump: null,
			};
		}
		case "apply-music-track":
		case "replace-music-track": {
			const track = summary.available_music_assets.find(
				(item) => item.asset_id === command.music_asset_id,
			);
			return {
				opIndex: commandIndex,
				opType: command.kind,
				kind: "music-track",
				title:
					command.kind === "replace-music-track"
						? "Replace music track"
						: "Apply music track",
				detail: `${track?.label ?? command.music_asset_id}${
					command.loop_to_project_end === false ? "" : " · cover project"
				}`,
				jump: {
					time_ms: command.start_ms ?? 0,
					track_id: null,
					segment_id: null,
				},
			};
		}
		case "insert-sfx-preset": {
			const item = summary.available_sfx_assets.find(
				(asset) => asset.asset_id === command.sfx_asset_id,
			);
			return {
				opIndex: commandIndex,
				opType: command.kind,
				kind: "sfx-preset",
				title: "Insert sound effect",
				detail: `${item?.label ?? command.sfx_asset_id} · ${formatTimeMs(command.start_ms)}`,
				jump: {
					time_ms: command.start_ms,
					track_id: null,
					segment_id: null,
				},
			};
		}
		case "apply-polish-profile":
			return {
				opIndex: commandIndex,
				opType: command.kind,
				kind: "polish-profile",
				title: "Apply polish profile",
				detail: command.profile_id,
				jump: null,
			};
		case "apply-caption-reveal":
			return {
				opIndex: commandIndex,
				opType: command.kind,
				kind: "caption-reveal",
				title: "Apply caption reveal",
				detail: command.preset_id,
				jump: null,
			};
		case "apply-project-kit":
			return {
				opIndex: commandIndex,
				opType: command.kind,
				kind: "project-kit",
				title: "Apply project kit",
				detail:
					summary.available_project_kits.find((kit) => kit.id === command.kit_id)?.name ??
					command.kit_id,
				jump: null,
			};
		case "set-version-pack":
			return {
				opIndex: commandIndex,
				opType: command.kind,
				kind: "version-pack",
				title: "Update version pack",
				detail: `${command.target_ids.join(", ")}${
					command.active_target_id ? ` · active ${command.active_target_id}` : ""
				}`,
				jump: null,
			};
		case "auto-reframe-selection":
			return {
				opIndex: commandIndex,
				opType: command.kind,
				kind: "auto-reframe",
				title: "Auto reframe selection",
				detail: `Target ${command.target_version_id}`,
				jump: null,
			};
		case "set-publish-destination":
			return {
				opIndex: commandIndex,
				opType: command.kind,
				kind: "publish-destination",
				title: "Set publish destination",
				detail: command.publish_destination,
				jump: null,
			};
		case "run-export-preflight-fixes":
			return {
				opIndex: commandIndex,
				opType: command.kind,
				kind: "export-preflight-fixes",
				title: "Run export preflight fixes",
				detail: `${command.format}/${command.quality} · ${
					command.publish_destination ?? summary.publish_destination ?? "generic-export"
				}`,
				jump: null,
			};
		case "set-active-reference-video": {
			const asset = summary.media_assets.find(
				(item) => item.asset_id === command.asset_id,
			);
			return {
				opIndex: commandIndex,
				opType: command.kind,
				kind: "reference-video",
				title: "Set reference video",
				detail: asset?.name ?? command.asset_id,
				jump: null,
			};
		}
		case "set-assembly-source-pool":
			return {
				opIndex: commandIndex,
				opType: command.kind,
				kind: "reference-assembly-pool",
				title: "Set assembly source pool",
				detail: `${command.asset_ids.length} source clip${
					command.asset_ids.length === 1 ? "" : "s"
				}`,
				jump: null,
			};
		case "clear-active-reference-video":
			return {
				opIndex: commandIndex,
				opType: command.kind,
				kind: "reference-video",
				title: "Clear reference video",
				detail: "Remove the active creative reference",
				jump: null,
			};
		case "apply-reference-finish-pass":
			return {
				opIndex: commandIndex,
				opType: command.kind,
				kind: "reference-finish",
				title: "Apply reference finish pass",
				detail:
					summary.active_reference_video?.name ?? command.reference_asset_id ?? "active reference",
				jump: null,
			};
		case "build-reference-draft":
			return {
				opIndex: commandIndex,
				opType: command.kind,
				kind: "reference-draft",
				title: "Build reference-guided draft",
				detail:
					command.matches.length > 0
						? command.matches
								.slice(0, 3)
								.map((match) => `${match.section_label}: ${match.selected_asset_name}`)
								.join(" · ")
						: summary.candidate_source_matches
								.slice(0, 3)
								.map((match) => `${match.section_label}: ${match.selected_asset_name}`)
								.join(" · "),
				jump: null,
			};
		case "replace-with-source-match":
			return {
				opIndex: commandIndex,
				opType: command.kind,
				kind: "reference-draft-swap",
				title: "Swap matched source clip",
				detail: `${command.match_id} -> ${command.asset_id}`,
				jump: null,
			};
		case "lock-reference-match":
			return {
				opIndex: commandIndex,
				opType: command.kind,
				kind: "reference-draft-lock",
				title: "Lock matched section",
				detail: command.match_id,
				jump: null,
			};
		case "clear-reference-match-locks":
			return {
				opIndex: commandIndex,
				opType: command.kind,
				kind: "reference-draft-lock",
				title: "Clear draft section locks",
				detail: "Allow all matched sections to be rebuilt",
				jump: null,
			};
		case "match-reference-captions":
			return {
				opIndex: commandIndex,
				opType: command.kind,
				kind: "reference-captions",
				title: "Match reference captions",
				detail:
					summary.active_reference_video?.name ?? command.reference_asset_id ?? "active reference",
				jump: null,
			};
		case "match-reference-audio-profile":
			return {
				opIndex: commandIndex,
				opType: command.kind,
				kind: "reference-audio",
				title: "Match reference audio",
				detail:
					summary.active_reference_video?.name ?? command.reference_asset_id ?? "active reference",
				jump: null,
			};
		case "match-reference-packaging":
			return {
				opIndex: commandIndex,
				opType: command.kind,
				kind: "reference-packaging",
				title: "Match reference packaging",
				detail:
					summary.active_reference_video?.name ?? command.reference_asset_id ?? "active reference",
				jump: null,
			};
		case "match-reference-pacing":
			return {
				opIndex: commandIndex,
				opType: command.kind,
				kind: "reference-pacing",
				title: "Match reference pacing",
				detail:
					summary.active_reference_video?.name ?? command.reference_asset_id ?? "active reference",
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
