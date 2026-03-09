import type { MigrationResult, ProjectRecord } from "./types";
import { getProjectId, isRecord } from "./utils";

export function transformProjectV11ToV12({
	project,
}: {
	project: ProjectRecord;
}): MigrationResult<ProjectRecord> {
	const projectId = getProjectId({ project });
	if (!projectId) {
		return { project, skipped: true, reason: "no project id" };
	}
	if (isV12Project({ project })) {
		return { project, skipped: true, reason: "already v12" };
	}

	const withCaptionDefaults = migrateCaptionDefaults({ project });

	return {
		project: {
			...withCaptionDefaults,
			version: 12,
		},
		skipped: false,
	};
}

function migrateCaptionDefaults({ project }: { project: ProjectRecord }): ProjectRecord {
	const scenesValue = project.scenes;
	let changed = false;
	let nextProject: ProjectRecord = project;

	if (Array.isArray(scenesValue)) {
		const scenes = scenesValue.map((scene) => {
			if (!isRecord(scene) || !Array.isArray(scene.tracks)) return scene;
			let sceneChanged = false;
			const tracks = scene.tracks.map((track) => {
				if (!isRecord(track) || !Array.isArray(track.elements)) return track;
				let trackChanged = false;
				const elements = track.elements.map((element) => {
					if (!isRecord(element) || element.type !== "text") return element;
					let elementChanged = false;
					const next = { ...element };
					if (next.role === undefined) {
						next.role = "text";
						elementChanged = true;
					}
					if (next.captionTiming === undefined) {
						next.captionTiming = null;
						elementChanged = true;
					}
					if (elementChanged) {
						trackChanged = true;
					}
					return elementChanged ? next : element;
				});
				if (!trackChanged) return track;
				sceneChanged = true;
				return { ...track, elements };
			});
			if (!sceneChanged) return scene;
			changed = true;
			return { ...scene, tracks };
		});
		if (changed) {
			nextProject = { ...nextProject, scenes };
		}
	}

	const clipforge = isRecord(nextProject.clipforge) ? nextProject.clipforge : null;
	if (clipforge && clipforge.captionTrackIdsBySceneId === undefined) {
		nextProject = {
			...nextProject,
			clipforge: {
				...clipforge,
				captionTrackIdsBySceneId: {},
			},
		};
		changed = true;
	}

	const adopted = adoptLegacyCaptionTracks({ project: nextProject });
	if (adopted !== nextProject) {
		nextProject = adopted;
		changed = true;
	}

	return changed ? nextProject : project;
}

function isV12Project({ project }: { project: ProjectRecord }): boolean {
	return typeof project.version === "number" && project.version >= 12;
}

function adoptLegacyCaptionTracks({
	project,
}: {
	project: ProjectRecord;
}): ProjectRecord {
	if (!Array.isArray(project.scenes) || !isRecord(project.clipforge)) {
		return project;
	}

	let changed = false;
	const captionTrackIdsBySceneId = isRecord(project.clipforge.captionTrackIdsBySceneId)
		? { ...project.clipforge.captionTrackIdsBySceneId }
		: {};

	const scenes = project.scenes.map((scene) => {
		if (!isRecord(scene) || !Array.isArray(scene.tracks) || typeof scene.id !== "string") {
			return scene;
		}

		const existingCaptionTrack = scene.tracks.find(
			(track) =>
				isRecord(track) &&
				track.type === "text" &&
				Array.isArray(track.elements) &&
				track.elements.some(
					(element) => isRecord(element) && element.type === "text" && element.role === "caption",
				),
		);
		if (existingCaptionTrack && typeof existingCaptionTrack.id === "string") {
			captionTrackIdsBySceneId[scene.id] = existingCaptionTrack.id;
			return scene;
		}

		const candidates = scene.tracks.filter(isHighConfidenceLegacyCaptionTrackRecord);
		if (candidates.length !== 1) {
			return scene;
		}

		const candidateId = candidates[0]?.id;
		if (typeof candidateId !== "string") {
			return scene;
		}

		changed = true;
		captionTrackIdsBySceneId[scene.id] = candidateId;
		return {
			...scene,
			tracks: scene.tracks.map((track) => {
				if (!isRecord(track) || track.id !== candidateId || !Array.isArray(track.elements)) {
					return track;
				}
				return {
					...track,
					elements: track.elements.map((element) => {
						if (!isRecord(element) || element.type !== "text") {
							return element;
						}
						return {
							...element,
							role: "caption",
							captionTiming: element.captionTiming ?? null,
						};
					}),
				};
			}),
		};
	});

	if (!changed) {
		return project;
	}

	return {
		...project,
		scenes,
		clipforge: {
			...project.clipforge,
			captionTrackIdsBySceneId,
		},
	};
}

function isHighConfidenceLegacyCaptionTrackRecord(track: unknown): track is Record<string, unknown> {
	if (!isRecord(track) || track.type !== "text" || !Array.isArray(track.elements)) {
		return false;
	}
	const normalizedTrackName = String(track.name ?? "").trim().toLowerCase();
	if (track.elements.length < 2) {
		return false;
	}

	let previousEnd = Number.NEGATIVE_INFINITY;
	let allElementNamesLookLikeCaptions = true;
	for (const element of track.elements) {
		if (!isRecord(element) || element.type !== "text") {
			return false;
		}
		const content = String(element.content ?? "").trim();
		const name = String(element.name ?? "").trim().toLowerCase();
		const duration =
			typeof element.duration === "number" ? element.duration : Number.NaN;
		const startTime =
			typeof element.startTime === "number" ? element.startTime : Number.NaN;
		if (content.length === 0 || content.length > 160) {
			return false;
		}
		if (
			name.includes("overlay") ||
			name.includes("title") ||
			name.includes("cta") ||
			name.includes("lower third")
		) {
			return false;
		}
		if (!name.includes("caption")) {
			allElementNamesLookLikeCaptions = false;
		}
		if (!Number.isFinite(duration) || !Number.isFinite(startTime) || duration <= 0 || duration > 6) {
			return false;
		}
		if (startTime + 0.05 < previousEnd) {
			return false;
		}
		previousEnd = Math.max(previousEnd, startTime + duration);
	}

	const trackNameLooksLikeCaptions =
		normalizedTrackName.includes("caption") ||
		normalizedTrackName.includes("subtitle");

	return trackNameLooksLikeCaptions || allElementNamesLookLikeCaptions;
}
