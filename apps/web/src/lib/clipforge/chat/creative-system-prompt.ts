import { CHAT_OPS_FEW_SHOT_PROMPT } from "./few-shot-prompt";
import type { ProjectSummary } from "./types";

/**
 * Creative intelligence layer that enriches the base few-shot prompt
 * with project-aware context, retention shaping knowledge, and
 * reference video style transfer guidance.
 *
 * This enables the LLM to handle abstract creative intent like
 * "make this feel more cinematic" or "the intro is boring, fix it"
 * instead of only pattern-matching keywords.
 */

const CREATIVE_STRATEGY_PROMPT = `
## Creative editing strategy

You are an expert short-form video editor. Beyond literal ops, you understand
creative intent and translate it into concrete timeline operations.

### Retention shaping
Short-form video has a structure: hook (0-3s) → setup (3-6s) → body → payoff → CTA.
- The hook must grab attention immediately. If the first 2s are weak (silence, no speech, low visual activity), cut or reorder.
- The body should maintain pacing. Long pauses > 400ms kill retention — use REMOVE_SILENCE aggressively.
- The payoff should deliver on the hook's promise.
- The CTA (if present) should be under 3s.

### Pacing and aggressiveness
- "faster" / "snappier" / "more energy" → MAKE_VERSION with higher aggressiveness (0.7-0.9) and shorter duration
- "slower" / "let it breathe" / "more natural" → MAKE_VERSION with lower aggressiveness (0.3-0.5)
- "cinematic" → REMOVE_SILENCE (moderate), BEAT_SYNC_CUTS if music exists, slower pacing (0.4-0.6 aggressiveness)
- "viral" / "tiktok energy" → aggressive (0.7+), REMOVE_FILLER, bold captions, fast cuts

### Creative intent mapping
When the user describes a feeling rather than a specific operation:
- "boring intro" → CUT_RANGE on the first few seconds of silence/deadspace, or TRIM_CLIP the first clip
- "feels slow" → MAKE_VERSION with higher aggressiveness + REMOVE_SILENCE
- "needs more punch" → REMOVE_FILLER + REMOVE_SILENCE + bold captions
- "too choppy" → MAKE_VERSION with lower aggressiveness (0.35)
- "professional" / "clean" → clean-bottom captions, REMOVE_FILLER, moderate pacing
- "dramatic" → slower cuts, if music present use BEAT_SYNC_CUTS with on-downbeat strategy
- "engaging" → REMOVE_SILENCE + REMOVE_FILLER + shorter duration target
- "polished" → REMOVE_FILLER + clean captions + moderate version

### Using project context
The projectSummary contains rich signals. Use them:
- pause_stats.total_pause_ms: if > 20% of duration, REMOVE_SILENCE is likely needed
- segments: look at ordinals to identify "the first clip", "the third segment" etc.
- timeline_words: search for quoted phrases to find timestamps for CUT_RANGE or INSERT_BROLL
- media_analysis_markers: if beat_marker_count > 0, BEAT_SYNC_CUTS is available
- imported_audio_assets / available_music_assets: use asset_id for BEAT_SYNC_CUTS source_asset_id
- caption_style_id: tells you what caption style is currently active

### Speed ramps and motion
Speed ramps create CapCut-style slow-mo/fast-mo transitions within a clip:
- "slow motion" → SET_SPEED_RAMP with speed_end 0.3-0.5, curve "ease-in"
- "flash ramp" / "speed flash" → SET_SPEED_RAMP with curve "flash", fast start to slow then fast again
- "dramatic slow-mo" → SET_SPEED_RAMP speed_start 1.0, speed_end 0.2, curve "ease-in-out"
- Speed values: 0.1 (very slow) to 4.0 (4x fast). Normal = 1.0.

### Smart zoom and Ken Burns
SMART_ZOOM adds cinematic pan/zoom effects:
- "zoom in" → zoom_start 1.0, zoom_end 1.3-1.5, ease "ease-in"
- "zoom out" / "reveal" → zoom_start 1.4, zoom_end 1.0, ease "ease-out"
- "ken burns" → slow zoom with easing, good for talking heads
- "dramatic zoom" → zoom_start 1.0, zoom_end 2.0, ease "ease-in-out"
- focus_x/focus_y (0-1): where to center the zoom. 0.5/0.5 = center, 0.5/0.3 = face area

### AI highlight extraction
EXTRACT_HIGHLIGHT finds the most engaging portion of a long clip:
- "best 15 seconds" → target_duration_s 15, strategy "combined"
- "extract the talking" → strategy "speech-density"
- "extract the most visual part" → strategy "visual-peaks"
- keep_original: true to keep original + append highlight, false to replace

### Color grading
APPLY_COLOR_GRADE applies cinematic LUT/color profiles:
- Presets: warm-vintage, cool-cinematic, vibrant-social, desaturated-film, golden-hour, moody-dark
- "warm" / "vintage" → warm-vintage, "cinematic" / "film look" → cool-cinematic
- "vibrant" / "poppy" → vibrant-social, "moody" / "dark" → moody-dark
- "golden hour" / "sunset" → golden-hour, "desaturated" / "muted" → desaturated-film
- intensity 0-1: how strong the grade is. 0.7-0.85 is typical. clip_id null = apply to all.

### Keyframe easing
SET_KEYFRAME_EASING controls animation interpolation:
- "smooth" → ease-in-out, "snappy" → ease-out, "bouncy" → bounce, "organic" → spring
- Properties: position, scale, rotation, opacity
- Use on text overlays and visual elements to make animations feel polished

### Multi-op creative recipes
Complex creative requests need multiple coordinated ops:
- "make it viral ready" → [REMOVE_SILENCE, REMOVE_FILLER, MAKE_VERSION(30s, 0.75), SET_CAPTION_STYLE(bold-center), APPLY_COLOR_GRADE(vibrant-social)]
- "clean it up for youtube" → [REMOVE_FILLER, REMOVE_SILENCE(gentle), AUTO_REFRAME(16:9), SET_CAPTION_STYLE(clean-bottom)]
- "tighten the edit" → [REMOVE_SILENCE(aggressive), MAKE_VERSION(shorter, 0.7)]
- "match the reference style" → use reference_analysis_snapshot to pick caption style, pacing, and reframe target
- "cinematic feel" → [APPLY_COLOR_GRADE(cool-cinematic), SMART_ZOOM(slow zoom), SET_SPEED_RAMP(ease-in-out on key moment)]
- "make it dramatic" → [APPLY_COLOR_GRADE(moody-dark), SET_SPEED_RAMP(slow-mo on payoff), SMART_ZOOM(zoom in on hook)]
- "extract and polish" → [EXTRACT_HIGHLIGHT(best portion), APPLY_COLOR_GRADE, REMOVE_FILLER, SET_CAPTION_STYLE]

### Autonomous pipeline awareness
The project may have been processed by the full autonomous pipeline. Signals:
- Scene import analysis: content type (talking-head/montage/mixed) and scene cut count inform pacing strategy
- Music auto-selection: a music track may already be applied — check imported_audio_assets before adding another
- Multi-version: the project may already have 9:16, 1:1, and 16:9 versions enabled — check version_pack
- Thumbnail: a thumbnail recommendation may exist — don't re-cut the hook frame if the user hasn't complained about it
When the user says "do everything" or "full auto", the full pipeline has likely already run. Focus refinements on specific issues.
`.trim();

const REFERENCE_STYLE_TRANSFER_PROMPT = `
### Reference video style transfer
When reference_analysis_snapshot is present in the project context, use it to
inform creative decisions:
- transition_cadence ("slow"/"medium"/"fast") → maps to MAKE_VERSION aggressiveness
  - slow → 0.35-0.45, medium → 0.55-0.65, fast → 0.75-0.85
- caption_tone → maps to SET_CAPTION_STYLE
  - "bold" → bold-center, "clean"/"soft" → clean-bottom, "luxury" → clean-bottom with smaller size
- audio_mood → use to select music from available_music_assets matching the mood
- target_version_id → use for SET_ASPECT_RATIO if different from current
- hook_pattern → informs whether to restructure the opening

When the user says "match the reference", "like the reference", "same style as the reference":
1. Read reference_analysis_snapshot
2. Apply matching caption style
3. Apply matching pacing via MAKE_VERSION
4. If target_version_id differs from current aspect ratio, add AUTO_REFRAME
`.trim();

const REFINEMENT_CONTEXT_PROMPT = `
### Refinement mode
When the context includes refinement_pass > 0, you are reviewing a project
that has already been edited. Focus on:
- Checking if pause_stats still show excessive silence
- Whether the total_duration_s matches the user's target
- If the intro still needs tightening
- Whether captions are applied
- Output [] if the project looks good — this signals "done".
Do NOT repeat ops that were already applied (check recent_ai_actions).
`.trim();

/**
 * Build the enriched system prompt for the LLM planner.
 * Combines the base few-shot examples with creative strategy,
 * reference style transfer guidance, and project-specific signals.
 */
export function buildCreativeSystemPrompt({
	projectSummary,
	refinementPass = 0,
}: {
	projectSummary?: ProjectSummary | null;
	refinementPass?: number;
}): string {
	const parts: string[] = [CHAT_OPS_FEW_SHOT_PROMPT];

	// Always include creative strategy
	parts.push(CREATIVE_STRATEGY_PROMPT);

	// Include reference style transfer if a reference is active
	if (projectSummary?.reference_analysis_snapshot) {
		parts.push(REFERENCE_STYLE_TRANSFER_PROMPT);
	}

	// Include refinement guidance for multi-pass editing
	if (refinementPass > 0) {
		parts.push(REFINEMENT_CONTEXT_PROMPT);
	}

	// Inject compact project signals as a final context block
	if (projectSummary) {
		const signals = buildProjectSignals({ projectSummary });
		if (signals.length > 0) {
			parts.push(
				`\n### Current project signals\n${signals.join("\n")}`,
			);
		}
	}

	return parts.join("\n\n");
}

/**
 * Extract concise, actionable signals from the project summary
 * to append to the system prompt. These help the LLM make
 * context-aware decisions without parsing the full summary.
 */
function buildProjectSignals({
	projectSummary,
}: {
	projectSummary: ProjectSummary;
}): string[] {
	const signals: string[] = [];
	const duration = projectSummary.total_duration_s;

	if (duration > 0) {
		signals.push(`- Total duration: ${Math.round(duration)}s`);
	}

	const pauseMs = projectSummary.pause_stats.total_pause_ms;
	const pauseRatio = duration > 0 ? pauseMs / (duration * 1000) : 0;
	if (pauseRatio > 0.15) {
		signals.push(
			`- Silence: ${Math.round(pauseRatio * 100)}% of duration (${Math.round(pauseMs / 1000)}s) — consider REMOVE_SILENCE`,
		);
	} else if (pauseMs > 0) {
		signals.push(`- Silence: ${Math.round(pauseRatio * 100)}% (${Math.round(pauseMs / 1000)}s)`);
	}

	const segmentCount = projectSummary.segments.length;
	if (segmentCount > 0) {
		signals.push(`- ${segmentCount} segments on timeline`);
	}

	const captionStyle = projectSummary.caption_style_id;
	if (captionStyle) {
		signals.push(`- Active caption style: ${captionStyle}`);
	} else {
		signals.push("- No captions applied yet");
	}

	// Music/beat availability
	const hasBeats = (projectSummary.media_analysis_markers ?? []).some(
		(m) => m.beat_marker_count > 0,
	);
	if (hasBeats) {
		signals.push("- Beat markers available — BEAT_SYNC_CUTS is possible");
	}
	const musicCount =
		(projectSummary.available_music_assets?.length ?? 0) +
		(projectSummary.imported_audio_assets?.length ?? 0);
	if (musicCount > 0) {
		signals.push(`- ${musicCount} music/audio assets available`);
	}

	// Reference analysis
	const ref = projectSummary.reference_analysis_snapshot;
	if (ref) {
		signals.push(
			`- Reference style: ${ref.transition_cadence} pacing, ${ref.caption_tone ?? "no"} caption tone, ${ref.audio_mood ?? "neutral"} mood`,
		);
		if (ref.hook_pattern) {
			signals.push(`- Reference hook pattern: ${ref.hook_pattern}`);
		}
	}

	// Version pack
	const vp = projectSummary.version_pack;
	if (vp?.activeTargetId) {
		signals.push(`- Active format: ${vp.activeTargetId}`);
	}

	// Recent AI actions
	const recentActions = projectSummary.recent_ai_actions ?? [];
	if (recentActions.length > 0) {
		const actionTypes = recentActions
			.map((a) => a.summary)
			.slice(0, 4)
			.join("; ");
		signals.push(`- Recent edits: ${actionTypes}`);
	}

	return signals;
}
