import type { EditorCore } from "@/core";
import {
	BestEffortExportIntegration,
	buildClipIndex,
	buildSceneCaptionSegments,
	buildEmptyMediaMetadata,
	collectIncompatibleMediaReferences,
	collectMissingMediaReferences,
	collectUnverifiedMediaReferences,
	clearSceneCaptionsFromProject,
	createCaptionTextElements,
	createClipForgeDemoProject,
	type ClipForgeExportArtifact,
	applyExportPreflightActions,
	detectSilenceRegions,
	evaluateExportPreflight,
	ensureClipForgeProjectData,
	isReplacementTypeAllowed,
	mergeCaptionElements,
	retimeCaptionElement,
	splitCaptionElement,
	type IncompatibleMediaReference,
	type MissingMediaReference,
	resolveClipForgeTranscriber,
	resolveMediaAssetByName,
	SrtImportTranscriber,
	updateSceneCaptionTrack,
	validateTimelineDiffOps,
} from "@/lib/clipforge";
import { buildPlanImpactPreview } from "@/lib/clipforge/chat/plan-impact";
import { reconcileValidatorErrors } from "@/lib/clipforge/chat/validator-reconciliation";
import { extractMediaAssetAudioToFloat32 } from "@/lib/media/audio";
import {
	ApplyTimelineDiffOpsCommand,
	AutoEditTikTokDraftCommand,
	CaptionProjectSnapshotCommand,
} from "@/lib/commands";
import { useClipForgeChatDraftStore } from "@/stores/clipforge-chat-draft-store";
import type { MediaAsset } from "@/types/assets";
import type {
	ClipMediaMetadata,
	CaptionSegmentView,
	TimelineDiffOp,
	TimelineDiffOpSource,
} from "@/types/clipforge";
import type {
	ExportFormat,
	ExportPreflightAction,
	ExportPreflightResult,
	ExportQuality,
} from "@/types/export";
import type { ProjectVersionTarget } from "@/types/project";
import type { TProject } from "@/types/project";
import type {
	ChatPlannerContext,
	ChatPlannerOverrides,
	ChatPlanPreviewResult,
	ChatValidatorReconciliationResult,
	ProjectSummary,
} from "@/lib/clipforge/chat/types";

export class ClipForgeManager {
	private exportIntegration = new BestEffortExportIntegration();

	constructor(private editor: EditorCore) {}

	autoEditTikTokDraft(): void {
		const videoAssets = this.editor.media
			.getAssets()
			.filter((asset) => asset.type === "video" && !asset.ephemeral);

		if (videoAssets.length === 0) {
			throw new Error("Import at least one video clip before auto editing.");
		}

		const command = new AutoEditTikTokDraftCommand(videoAssets);
		this.editor.command.execute({ command });
		this.stabilizePreview();
	}

	initializeMediaMetadata({
		mediaAssets,
	}: {
		mediaAssets: MediaAsset[];
	}): void {
		if (mediaAssets.length === 0) return;

		const activeProject = this.editor.project.getActive();
		if (!activeProject) return;

		const projectWithClipForge = ensureClipForgeProjectData({
			project: activeProject,
		});
		const nextMediaMetadataById = {
			...projectWithClipForge.clipforge.mediaMetadataById,
		};

		let didChange = false;
		for (const mediaAsset of mediaAssets) {
			if (nextMediaMetadataById[mediaAsset.id]) continue;
			nextMediaMetadataById[mediaAsset.id] = buildEmptyMediaMetadata();
			didChange = true;
		}

		if (!didChange) return;

		this.editor.project.setActiveProject({
			project: {
				...projectWithClipForge,
				metadata: {
					...projectWithClipForge.metadata,
					updatedAt: new Date(),
				},
				clipforge: {
					...projectWithClipForge.clipforge,
					mediaMetadataById: nextMediaMetadataById,
				},
			},
		});
		this.editor.save.markDirty();
	}

	upsertMediaMetadata({
		mediaId,
		metadata,
	}: {
		mediaId: string;
		metadata: ClipMediaMetadata;
	}): void {
		const activeProject = this.editor.project.getActive();
		if (!activeProject) return;

		const projectWithClipForge = ensureClipForgeProjectData({
			project: activeProject,
		});

		this.editor.project.setActiveProject({
			project: {
				...projectWithClipForge,
				metadata: {
					...projectWithClipForge.metadata,
					updatedAt: new Date(),
				},
				clipforge: {
					...projectWithClipForge.clipforge,
					mediaMetadataById: {
						...projectWithClipForge.clipforge.mediaMetadataById,
						[mediaId]: metadata,
					},
				},
			},
		});
		this.editor.save.markDirty();
	}

	seedMediaMetadata({
		mediaId,
		metadata,
	}: {
		mediaId: string;
		metadata: ClipMediaMetadata;
	}): void {
		this.upsertMediaMetadata({ mediaId, metadata });
	}

	getMediaMetadata({ mediaId }: { mediaId: string }): ClipMediaMetadata | null {
		const activeProject = this.editor.project.getActive();
		if (!activeProject) return null;

		const projectWithClipForge = ensureClipForgeProjectData({
			project: activeProject,
		});

		return projectWithClipForge.clipforge.mediaMetadataById[mediaId] ?? null;
	}

	async indexMediaAsset({
		mediaId,
		language,
	}: {
		mediaId: string;
		language?: string;
	}): Promise<ClipMediaMetadata> {
		const mediaAsset = this.editor.media.getAssets().find((asset) => asset.id === mediaId);
		if (!mediaAsset) {
			throw new Error("Media asset not found.");
		}

		const existing = this.getMediaMetadata({ mediaId }) ?? buildEmptyMediaMetadata();
		if (mediaAsset.type !== "video" && mediaAsset.type !== "audio") {
			return existing;
		}

		this.upsertMediaMetadata({
			mediaId,
			metadata: {
				...existing,
				transcriptionStatus: "processing",
				transcriptionError: null,
			},
		});

		try {
			const transcriber = resolveClipForgeTranscriber();
			const indexed = await buildClipIndex({
				mediaAsset,
				language,
				transcriber,
				extractAudio: extractMediaAssetAudioToFloat32,
			});

			this.upsertMediaMetadata({
				mediaId,
				metadata: indexed,
			});
			return indexed;
		} catch (error) {
			const failedMetadata: ClipMediaMetadata = {
				...existing,
				transcriptionStatus: "error",
				transcriptionError:
					error instanceof Error ? error.message : "Clip indexing failed.",
			};
			this.upsertMediaMetadata({
				mediaId,
				metadata: failedMetadata,
			});
			return failedMetadata;
		}
	}

	async indexMediaAssets({
		mediaIds,
		language,
	}: {
		mediaIds?: string[];
		language?: string;
	} = {}): Promise<{ completed: string[]; failed: string[] }> {
		const targetIds = new Set(mediaIds ?? []);
		const selectedAssets = this.editor.media
			.getAssets()
			.filter((asset) => !asset.ephemeral)
			.filter((asset) =>
				targetIds.size === 0 ? true : targetIds.has(asset.id),
			)
			.filter((asset) => asset.type === "video" || asset.type === "audio");

		const completed: string[] = [];
		const failed: string[] = [];

		for (const asset of selectedAssets) {
			const existing = this.getMediaMetadata({ mediaId: asset.id });
			if (existing?.transcriptionStatus === "ready") {
				completed.push(asset.id);
				continue;
			}

			const metadata = await this.indexMediaAsset({
				mediaId: asset.id,
				language,
			});
			if (metadata.transcriptionStatus === "ready") {
				completed.push(asset.id);
			} else {
				failed.push(asset.id);
			}
		}

		return { completed, failed };
	}

	async importSrtForMedia({
		mediaId,
		srtText,
		language,
	}: {
		mediaId: string;
		srtText: string;
		language?: string;
	}): Promise<ClipMediaMetadata> {
		const mediaAsset = this.editor.media.getAssets().find((asset) => asset.id === mediaId);
		if (!mediaAsset) {
			throw new Error("Media asset not found.");
		}

		const existing = this.getMediaMetadata({ mediaId }) ?? buildEmptyMediaMetadata();
		const transcriber = new SrtImportTranscriber();
		const transcript = await transcriber.transcribe({
			mediaAsset,
			language,
			srtText,
		});

		const metadata: ClipMediaMetadata = {
			...existing,
			words: transcript.words,
			segments: transcript.segments,
			transcriptionStatus: "ready",
			transcriptionProvider: transcript.provider,
			transcriptionLanguage: transcript.language ?? language ?? null,
			transcriptionError: null,
			indexedAt: new Date().toISOString(),
		};

		this.upsertMediaMetadata({
			mediaId,
			metadata,
		});

		return metadata;
	}

	detectAndStoreSilenceMap({
		mediaId,
		samples,
		sampleRate,
	}: {
		mediaId: string;
		samples: Float32Array;
		sampleRate: number;
	}): void {
		const activeProject = this.editor.project.getActive();
		if (!activeProject) return;

		const projectWithClipForge = ensureClipForgeProjectData({
			project: activeProject,
		});

		const existing =
			projectWithClipForge.clipforge.mediaMetadataById[mediaId] ??
			buildEmptyMediaMetadata();
		const silenceRegions = detectSilenceRegions({
			samples,
			sampleRate,
		});

		this.upsertMediaMetadata({
			mediaId,
			metadata: {
				...existing,
				silenceRegions,
			},
		});
	}

	validateOps({
		ops,
	}: {
		ops: unknown[];
	}): ReturnType<typeof validateTimelineDiffOps> {
		const activeProject = this.editor.project.getActive();
		if (!activeProject) {
			return {
				valid: false,
				ops: [],
				errors: [
					{
						opIndex: -1,
						code: "no_active_project",
						message: "No active project.",
					},
				],
			};
		}

		return validateTimelineDiffOps({
			project: activeProject,
			ops,
			mediaAssets: this.editor.media.getAssets(),
		});
	}

	reconcileAndValidateOps({
		userText,
		projectSummary,
		context,
		overrides,
		ops,
	}: {
		userText: string;
		projectSummary: ProjectSummary;
		context: ChatPlannerContext;
		overrides?: ChatPlannerOverrides;
		ops: TimelineDiffOp[];
	}): ChatValidatorReconciliationResult {
		const activeProject = this.editor.project.getActive();
		if (!activeProject) {
			return {
				ops: [],
				clarification: null,
				safety: {
					repairedCount: 0,
					droppedCount: 0,
					blocked: true,
					notices: [
						{
							code: "blocked_validator_reconcile_failed",
							severity: "error",
							source: "validator",
							message: "No active project.",
							validatorCode: "no_active_project",
						},
					],
				},
				firstPassErrors: [
					{
						opIndex: -1,
						code: "no_active_project",
						message: "No active project.",
					},
				],
				secondPassErrors: [],
				blocked: true,
			};
		}

		return reconcileValidatorErrors({
			userText,
			projectSummary,
			context,
			overrides,
			ops,
			validateOps: ({ ops: candidateOps }) => this.validateOps({ ops: candidateOps }),
		});
	}

	previewOpsImpact({
		ops,
	}: {
		ops: TimelineDiffOp[];
	}): ChatPlanPreviewResult {
		const activeProject = this.editor.project.getActive();
		if (!activeProject) {
			return {
				cards: [],
				summary: {
					totalOps: ops.length,
					impactCount: 0,
					simulatedDurationDeltaMs: 0,
				},
			};
		}

		return buildPlanImpactPreview({
			project: activeProject,
			mediaAssets: this.editor.media.getAssets(),
			ops,
		});
	}

	applyOps({
		ops,
		source = "manual",
	}: {
		ops: unknown[];
		source?: TimelineDiffOpSource;
	}): {
		applied: boolean;
		ops: TimelineDiffOp[];
		errors: ReturnType<typeof validateTimelineDiffOps>["errors"];
	} {
		const validation = this.validateOps({ ops });
		if (!validation.valid) {
			return {
				applied: false,
				ops: [],
				errors: validation.errors,
			};
		}

		const command = new ApplyTimelineDiffOpsCommand(validation.ops, source);
		this.editor.command.execute({ command });
		this.stabilizePreview();

		return {
			applied: true,
			ops: validation.ops,
			errors: [],
		};
	}

	getSceneCaptions(): CaptionSegmentView[] {
		const activeProject = this.editor.project.getActive();
		if (!activeProject) return [];
		return buildSceneCaptionSegments({ project: activeProject });
	}

	generateSceneCaptions({
		language,
		template,
		overwriteExisting,
	}: {
		language?: string;
		template: "clean-bottom" | "bold-center";
		overwriteExisting: boolean;
	}): { generated: number; trackId: string | null } {
		const activeProject = this.editor.project.getActive();
		if (!activeProject) {
			throw new Error("No active project.");
		}

		if (!overwriteExisting && this.getSceneCaptions().length > 0) {
			throw new Error("Captions already exist in this scene. Use regenerate to replace them.");
		}

		const sceneId = activeProject.currentSceneId;
		let nextProject = ensureClipForgeProjectData({ project: activeProject });
		nextProject = clearSceneCaptionsFromProject({
			project: nextProject,
			sceneId,
		}) as typeof nextProject;

		const captionElements = createCaptionTextElements({
			project: nextProject,
			styleId: template,
		});
		if (captionElements.length === 0) {
			throw new Error(
				"No indexed transcript was found for this scene. Index clips or use the demo project captions first.",
			);
		}

		nextProject = updateSceneCaptionTrack({
			project: nextProject,
			sceneId,
			updateElements: () => captionElements,
		}) as typeof nextProject;
		nextProject = {
			...nextProject,
			metadata: {
				...nextProject.metadata,
				updatedAt: new Date(),
			},
			clipforge: {
				...nextProject.clipforge,
				activeCaptionStyleId: template,
			},
		};

		this.applyCaptionProjectSnapshot({
			before: activeProject,
			after: nextProject,
		});

		return {
			generated: captionElements.length,
			trackId: nextProject.clipforge.captionTrackIdsBySceneId[sceneId] ?? null,
		};
	}

	updateCaptionText({
		elementId,
		text,
	}: {
		elementId: string;
		text: string;
	}): void {
		const activeProject = this.editor.project.getActive();
		if (!activeProject) {
			throw new Error("No active project.");
		}
		const sceneId = activeProject.currentSceneId;
		const nextProject = updateSceneCaptionTrack({
			project: ensureClipForgeProjectData({ project: activeProject }),
			sceneId,
			updateElements: (elements) => {
				const target = elements.find((element) => element.id === elementId);
				if (!target) {
					throw new Error("Caption segment not found.");
				}
				return elements.map((element) =>
					element.id === elementId
						? {
								...element,
								content: text,
							}
						: element,
				);
			},
		});
		this.applyCaptionProjectSnapshot({ before: activeProject, after: nextProject });
	}

	retimeCaption({
		elementId,
		startTime,
		duration,
	}: {
		elementId: string;
		startTime: number;
		duration: number;
	}): void {
		const activeProject = this.editor.project.getActive();
		if (!activeProject) {
			throw new Error("No active project.");
		}
		const sceneId = activeProject.currentSceneId;
		const nextProject = updateSceneCaptionTrack({
			project: ensureClipForgeProjectData({ project: activeProject }),
			sceneId,
			updateElements: (elements) => {
				const target = elements.find((element) => element.id === elementId);
				if (!target) {
					throw new Error("Caption segment not found.");
				}
				return elements.map((element) =>
					element.id === elementId
						? retimeCaptionElement({
								element,
								startTime,
								duration,
							})
						: element,
				);
			},
		});
		this.applyCaptionProjectSnapshot({ before: activeProject, after: nextProject });
	}

	splitCaption({
		elementId,
		splitWordIndex,
	}: {
		elementId: string;
		splitWordIndex: number;
	}): void {
		const activeProject = this.editor.project.getActive();
		if (!activeProject) {
			throw new Error("No active project.");
		}
		const sceneId = activeProject.currentSceneId;
		const nextProject = updateSceneCaptionTrack({
			project: ensureClipForgeProjectData({ project: activeProject }),
			sceneId,
			updateElements: (elements) => {
				const target = elements.find((element) => element.id === elementId);
				if (!target) {
					throw new Error("Caption segment not found.");
				}
				const { first, second } = splitCaptionElement({
					element: target,
					splitWordIndex,
				});
				return elements.flatMap((element) =>
					element.id === elementId ? [first, second] : [element],
				);
			},
		});
		this.applyCaptionProjectSnapshot({ before: activeProject, after: nextProject });
	}

	mergeCaptions({
		firstElementId,
		secondElementId,
	}: {
		firstElementId: string;
		secondElementId: string;
	}): void {
		const activeProject = this.editor.project.getActive();
		if (!activeProject) {
			throw new Error("No active project.");
		}
		const sceneId = activeProject.currentSceneId;
		const nextProject = updateSceneCaptionTrack({
			project: ensureClipForgeProjectData({ project: activeProject }),
			sceneId,
			updateElements: (elements) => {
				const ordered = [...elements].sort(
					(a, b) => a.startTime - b.startTime || a.id.localeCompare(b.id),
				);
				const firstIndex = ordered.findIndex((element) => element.id === firstElementId);
				const secondIndex = ordered.findIndex((element) => element.id === secondElementId);
				const first = firstIndex >= 0 ? ordered[firstIndex] : null;
				const second = secondIndex >= 0 ? ordered[secondIndex] : null;
				if (!first || !second) {
					throw new Error("Adjacent caption segments could not be found.");
				}
				if (secondIndex !== firstIndex + 1) {
					throw new Error("Only adjacent caption segments can be merged.");
				}
				const merged = mergeCaptionElements({ first, second });
				return elements
					.filter(
						(element) =>
							element.id !== firstElementId && element.id !== secondElementId,
					)
					.concat(merged);
			},
		});
		this.applyCaptionProjectSnapshot({ before: activeProject, after: nextProject });
	}

	applySceneCaptionStyle({
		styleId,
	}: {
		styleId: string;
	}): void {
		const activeProject = this.editor.project.getActive();
		if (!activeProject) {
			throw new Error("No active project.");
		}
		const clipforgeProject = ensureClipForgeProjectData({ project: activeProject });
		const style = clipforgeProject.clipforge.captionStylesById[styleId];
		if (!style) {
			throw new Error("Caption style not found.");
		}

		const result = this.applyOps({
			source: "manual",
			ops: [
				{
					type: "SET_CAPTION_STYLE",
					style_id: style.style_id,
					font: style.font,
					size: style.size,
					position: style.position,
					outline: style.outline,
					highlight_mode: style.highlight_mode,
				},
			],
		});
		if (!result.applied) {
			throw new Error(result.errors[0]?.message ?? "Failed to apply caption style.");
		}
	}

	clearSceneCaptions(): { cleared: number } {
		const activeProject = this.editor.project.getActive();
		if (!activeProject) {
			throw new Error("No active project.");
		}
		const existing = buildSceneCaptionSegments({ project: activeProject });
		const nextProject = clearSceneCaptionsFromProject({
			project: ensureClipForgeProjectData({ project: activeProject }),
			sceneId: activeProject.currentSceneId,
		});
		this.applyCaptionProjectSnapshot({ before: activeProject, after: nextProject });
		return { cleared: existing.length };
	}

	async exportBestEffort(): Promise<ClipForgeExportArtifact> {
		return this.exportIntegration.exportBestEffort({
			editor: this.editor,
		});
	}

	runExportPreflight({
		format,
		quality,
		includeAudio,
		targetVersionId = null,
	}: {
		format: ExportFormat;
		quality: ExportQuality;
		includeAudio: boolean;
		targetVersionId?: ProjectVersionTarget | null;
	}): ExportPreflightResult {
		return evaluateExportPreflight({
			project: this.editor.project.getActive(),
			mediaAssets: this.editor.media.getAssets(),
			format,
			quality,
			includeAudio,
			targetVersionId,
		});
	}

	applyExportPreflightFixes({
		actions,
	}: {
		actions: ExportPreflightAction[];
	}): { applied: number; failed: number; messages: string[] } {
		const activeProject = this.editor.project.getActive();
		if (!activeProject) {
			return {
				applied: 0,
				failed: actions.length,
				messages: ["No active project to repair."],
			};
		}

		return applyExportPreflightActions({
			project: activeProject,
			getProject: () => this.editor.project.getActive(),
			mediaAssets: this.editor.media.getAssets(),
			actions,
			setProject: ({ project }) => {
				this.editor.project.setActiveProject({ project });
				this.editor.scenes.initializeScenes({
					scenes: project.scenes,
					currentSceneId: project.currentSceneId,
				});
			},
			markDirty: () => this.editor.save.markDirty(),
		});
	}

	listMissingMediaReferences(): MissingMediaReference[] {
		return collectMissingMediaReferences({
			project: this.editor.project.getActive(),
			mediaAssets: this.editor.media.getAssets(),
		});
	}

	listIncompatibleMediaReferences({
		includeAudio,
	}: {
		includeAudio: boolean;
	}): IncompatibleMediaReference[] {
		const project = this.editor.project.getActive();
		const mediaAssets = this.editor.media.getAssets();
		const unverified = collectUnverifiedMediaReferences({
			project,
			mediaAssets,
			includeAudio,
		});
		const incompatible = collectIncompatibleMediaReferences({
			project,
			mediaAssets,
			includeAudio,
		});
		return [...unverified, ...incompatible].sort((a, b) => {
			const aStart = a.segments[0]?.startMs ?? Number.POSITIVE_INFINITY;
			const bStart = b.segments[0]?.startMs ?? Number.POSITIVE_INFINITY;
			if (aStart !== bStart) return aStart - bStart;
			return a.mediaId.localeCompare(b.mediaId);
		});
	}

	async scanReferencedMediaCompatibility({
		includeAudio,
	}: {
		includeAudio: boolean;
	}): Promise<{ scanned: number; updated: number; failed: number }> {
		const references = this.listIncompatibleMediaReferences({
			includeAudio,
		});
		const mediaIds = [...new Set(references.map((reference) => reference.mediaId))];
		return this.editor.media.probeMediaCompatibility({
			ids: mediaIds,
		});
	}

	async relinkMissingMediaReference({
		mediaId,
		replacementAsset,
	}: {
		mediaId: string;
		replacementAsset: Omit<MediaAsset, "id">;
	}): Promise<{ mediaId: string; restoredReferences: number }> {
		const activeProject = this.editor.project.getActive();
		if (!activeProject) {
			throw new Error("No active project.");
		}

		const missingReference = this.listMissingMediaReferences().find(
			(reference) => reference.mediaId === mediaId,
		);
		const incompatibleReference = this.listIncompatibleMediaReferences({
			includeAudio: true,
		}).find((reference) => reference.mediaId === mediaId);
		const targetReference = missingReference ?? incompatibleReference ?? null;
		if (!targetReference) {
			throw new Error("Missing media reference not found.");
		}
		if (
			!isReplacementTypeAllowed({
				allowedReplacementTypes: targetReference.allowedReplacementTypes,
				replacementType: replacementAsset.type,
			})
		) {
			const allowedTypes =
				targetReference.allowedReplacementTypes.join(", ") || "none";
			throw new Error(
				`Replacement type "${replacementAsset.type}" is incompatible. Allowed types: ${allowedTypes}.`,
			);
		}

		const relinked = await this.editor.media.relinkMediaAsset({
			projectId: activeProject.metadata.id,
			id: mediaId,
			asset: replacementAsset,
		});
		if (!relinked) {
			throw new Error("Failed to relink missing media.");
		}

		this.upsertMediaMetadata({
			mediaId,
			metadata: buildEmptyMediaMetadata(),
		});

		return {
			mediaId,
			restoredReferences: targetReference.referenceCount,
		};
	}

	removeSegmentsReferencingMedia({
		mediaId,
	}: {
		mediaId: string;
	}): {
		applied: boolean;
		removed: number;
		errors: Array<{ code: string; message: string }>;
	} {
		const activeProject = this.editor.project.getActive();
		if (!activeProject) {
			return {
				applied: false,
				removed: 0,
				errors: [{ code: "no_active_project", message: "No active project." }],
			};
		}

		const activeScene =
			activeProject.scenes.find((scene) => scene.id === activeProject.currentSceneId) ??
			activeProject.scenes[0] ??
			null;
		if (!activeScene) {
			return {
				applied: false,
				removed: 0,
				errors: [{ code: "empty_project", message: "No active scene to repair." }],
			};
		}

		const segmentIds = activeScene.tracks.flatMap((track) =>
			track.elements
				.filter(
					(element) =>
						"mediaId" in element &&
						typeof element.mediaId === "string" &&
						element.mediaId === mediaId,
				)
				.map((element) => element.id),
		);
		if (segmentIds.length === 0) {
			return {
				applied: true,
				removed: 0,
				errors: [],
			};
		}

		const result = this.applyOps({
			ops: segmentIds.map((segmentId) => ({
				type: "DELETE_SEGMENT",
				segment_id: segmentId,
			})),
			source: "manual",
		});

		return {
			applied: result.applied,
			removed: result.applied ? segmentIds.length : 0,
			errors: result.errors.map((error) => ({
				code: error.code,
				message: error.message,
			})),
		};
	}

	async createDemoProject(): Promise<{ projectId: string; mediaIds: string[] }> {
		return createClipForgeDemoProject({
			editor: this.editor,
		});
	}

	populateChatDraft(text: string): void {
		useClipForgeChatDraftStore.getState().setDraft(text);
	}

	resolveMediaAssetByName(
		query: string,
	): { assetId: string; matchedName: string } | null {
		return resolveMediaAssetByName({
			query,
			mediaAssets: this.editor.media.getAssets(),
		});
	}

	private stabilizePreview(): void {
		const currentTime = this.editor.playback.getCurrentTime();
		const totalDuration = this.editor.timeline.getTotalDuration();
		this.editor.playback.seek({
			time: Math.min(Math.max(currentTime, 0), totalDuration),
		});
	}

	private applyCaptionProjectSnapshot({
		before,
		after,
	}: {
		before: TProject;
		after: TProject;
	}): void {
		const command = new CaptionProjectSnapshotCommand(before, after);
		this.editor.command.execute({ command });
		this.stabilizePreview();
	}
}
