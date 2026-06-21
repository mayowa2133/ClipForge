import type {
	AutonomousEditQualityGate,
	CreatorStyleProfile,
} from "@/types/clipforge";
import type { TProject } from "@/types/project";
import type { AudioElement, TextElement, VideoElement } from "@/types/timeline";
import { resolveCreatorProfileTargetDurationMs } from "./creator-profile";
import type { DEFAULT_CREATOR_PROFILE } from "./creator-profile";

export function evaluateAutonomousEditQualityGate({
	project,
	profile,
	rawDurationMs,
}: {
	project: TProject;
	profile: typeof DEFAULT_CREATOR_PROFILE & Partial<CreatorStyleProfile>;
	rawDurationMs: number;
}): AutonomousEditQualityGate {
	const scene =
		project.scenes.find(
			(candidate) => candidate.id === project.currentSceneId,
		) ??
		project.scenes[0] ??
		null;
	const videoElements =
		scene?.tracks
			.filter((track) => track.type === "video")
			.flatMap((track) =>
				track.elements.filter(
					(element): element is VideoElement => element.type === "video",
				),
			) ?? [];
	const textElements =
		scene?.tracks
			.filter((track) => track.type === "text")
			.flatMap((track) => track.elements as TextElement[]) ?? [];
	const audioElements =
		scene?.tracks
			.filter((track) => track.type === "audio")
			.flatMap((track) => track.elements as AudioElement[]) ?? [];

	const actualDurationMs = Math.round(
		Math.max(
			project.metadata.duration > 0 ? project.metadata.duration * 1000 : 0,
			...videoElements.map((element) =>
				Math.round((element.startTime + element.duration) * 1000),
			),
			0,
		),
	);
	const targetDurationMs = resolveCreatorProfileTargetDurationMs({
		profile,
		rawDurationMs,
	});
	const videoCutCount = Math.max(0, videoElements.length - 1);
	const actualMinutes = Math.max(actualDurationMs / 60_000, 0.01);
	const actualCutDensity = round2(videoCutCount / actualMinutes);
	const targetCutDensity =
		typeof profile.cutDensityPerMinute === "number" &&
		profile.cutDensityPerMinute > 0
			? profile.cutDensityPerMinute
			: null;
	const captionCount = textElements.filter(
		(element) => element.role === "caption" || Boolean(element.captionTiming),
	).length;
	const titlePresent = textElements.some(
		(element) =>
			element.role !== "caption" &&
			!element.captionTiming &&
			element.duration * 1000 >= Math.max(2000, actualDurationMs * 0.75),
	);
	const musicPresent = audioElements.some(
		(element) =>
			element.role === "music" || element.name.toLowerCase().includes("music"),
	);
	const canvas = project.settings.canvasSize;
	const portraitCanvas = Boolean(canvas && canvas.height > canvas.width);

	const warnings: string[] = [];
	const durationDeltaMs = Math.abs(actualDurationMs - targetDurationMs);
	const durationToleranceMs = Math.max(2500, targetDurationMs * 0.1);
	if (actualDurationMs <= 0)
		warnings.push("No finished timeline duration was found.");
	if (durationDeltaMs > durationToleranceMs) {
		warnings.push(
			`Finished duration is ${Math.round(durationDeltaMs / 1000)}s away from the learned target.`,
		);
	}
	const cutDensityDelta =
		targetCutDensity === null
			? null
			: round2(Math.abs(actualCutDensity - targetCutDensity));
	if (targetCutDensity !== null && cutDensityDelta !== null) {
		const cutTolerance = Math.max(4, targetCutDensity * 0.45);
		if (cutDensityDelta > cutTolerance) {
			warnings.push("Cut density does not match the learned creator pacing.");
		}
	}
	if (captionCount === 0) warnings.push("No generated captions were found.");
	if (!titlePresent && profile.titleEnabled !== false) {
		warnings.push("No persistent title overlay was found.");
	}
	if (!musicPresent) warnings.push("No background music track was found.");
	if (!portraitCanvas) warnings.push("Canvas is not set to a portrait format.");

	const readiness =
		actualDurationMs <= 0
			? "blocked"
			: warnings.length === 0
				? "ready-for-review"
				: warnings.some((warning) =>
							/No generated captions|No background music|Canvas is not/.test(
								warning,
							),
						)
					? "needs-review"
					: "needs-review";

	return {
		evaluatedAt: new Date().toISOString(),
		target_duration_ms: targetDurationMs,
		actual_duration_ms: actualDurationMs,
		target_duration_delta_ms: durationDeltaMs,
		target_cut_density_per_minute: targetCutDensity,
		actual_cut_density_per_minute: actualCutDensity,
		cut_density_delta_per_minute: cutDensityDelta,
		video_cut_count: videoCutCount,
		caption_count: captionCount,
		title_present: titlePresent,
		music_present: musicPresent,
		portrait_canvas: portraitCanvas,
		readiness,
		warnings,
	};
}

function round2(value: number): number {
	return Math.round(value * 100) / 100;
}
