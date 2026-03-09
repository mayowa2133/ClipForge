import { DEFAULT_PROJECT_AUDIO_SETTINGS } from "@/constants/project-constants";
import type { MigrationResult, ProjectRecord } from "./types";
import { getProjectId, isRecord } from "./utils";

export function transformProjectV12ToV13({
	project,
}: {
	project: ProjectRecord;
}): MigrationResult<ProjectRecord> {
	const projectId = getProjectId({ project });
	if (!projectId) {
		return { project, skipped: true, reason: "no project id" };
	}
	if (typeof project.version === "number" && project.version >= 13) {
		return { project, skipped: true, reason: "already v13" };
	}

	let changed = false;
	let nextProject: ProjectRecord = project;

	if (isRecord(project.settings)) {
		const audioSettings = isRecord(project.settings.audio)
			? project.settings.audio
			: null;
		const nextAudioSettings = {
			...DEFAULT_PROJECT_AUDIO_SETTINGS,
			...(audioSettings ?? {}),
		};
		if (audioSettings !== nextAudioSettings) {
			nextProject = {
				...nextProject,
				settings: {
					...project.settings,
					audio: nextAudioSettings,
				},
			};
			changed = true;
		}
	}

	if (Array.isArray(nextProject.scenes)) {
		const scenes = nextProject.scenes.map((scene) => {
			if (!isRecord(scene) || !Array.isArray(scene.tracks)) return scene;
			let sceneChanged = false;
			const tracks = scene.tracks.map((track) => {
				if (!isRecord(track) || !Array.isArray(track.elements)) {
					return track;
				}
				let trackChanged = false;
				let nextTrack: Record<string, unknown> = track;
				if (track.type === "audio" && typeof track.volume !== "number") {
					nextTrack = { ...nextTrack, volume: 1 };
					trackChanged = true;
				}
				const elements = track.elements.map((element) => {
					if (!isRecord(element) || element.type !== "audio") return element;
					let elementChanged = false;
					const nextElement = { ...element };
					if (nextElement.role === undefined) {
						nextElement.role = "audio";
						elementChanged = true;
					}
					if (nextElement.normalizationGainDb === undefined) {
						nextElement.normalizationGainDb = null;
						elementChanged = true;
					}
					if (elementChanged) {
						trackChanged = true;
					}
					return elementChanged ? nextElement : element;
				});
				if (!trackChanged) {
					return track;
				}
				sceneChanged = true;
				return { ...nextTrack, elements };
			});
			if (!sceneChanged) return scene;
			changed = true;
			return { ...scene, tracks };
		});
		if (scenes !== nextProject.scenes) {
			nextProject = { ...nextProject, scenes };
		}
	}

	return {
		project: {
			...nextProject,
			version: 13,
		},
		skipped: false,
	};
}
