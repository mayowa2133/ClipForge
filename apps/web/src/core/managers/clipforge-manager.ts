import type { EditorCore } from "@/core";
import {
	DEFAULT_PROJECT_AUDIO_SETTINGS,
	DEFAULT_PROJECT_LIBRARY_DEFAULTS,
} from "@/constants/project-constants";
import {
	BestEffortExportIntegration,
	buildClipIndex,
	buildSceneCaptionSegments,
	buildEmptyMediaMetadata,
	buildCreativeBriefFromPrompt,
	buildDraftImpactSummary,
	buildRetentionShapePlan,
	buildSceneFootageIntelligenceReport,
	buildCaptionRevealKeyframes,
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
	resolvePolishProfileFromBrief,
	SrtImportTranscriber,
	updateSceneCaptionTrack,
	validateTimelineDiffOps,
	isCreativeDraftIntent,
	planDraftRecipe as planCreativeDraftRecipe,
	getAudioPolishPresetById,
	getCaptionRevealSoundSyncPreset,
	getPolishProfileById,
} from "@/lib/clipforge";
import {
	buildCommandPlanImpactPreview,
	buildPlanImpactPreview,
} from "@/lib/clipforge/chat/plan-impact";
import { reconcileValidatorErrors } from "@/lib/clipforge/chat/validator-reconciliation";
import { ensureBundledAudioAsset } from "@/lib/library/bundled-media";
import { BUNDLED_MUSIC, BUNDLED_SFX } from "@/lib/library/content-packs";
import { extractMediaAssetAudioToFloat32 } from "@/lib/media/audio";
import {
	ApplyTimelineDiffOpsCommand,
	AutoEditTikTokDraftCommand,
	CaptionProjectSnapshotCommand,
} from "@/lib/commands";
import { buildUploadAudioElement } from "@/lib/timeline";
import {
	findAdjacentVisualIncomingTransitionTarget,
	getAnimationSfxPairingById,
	getSocialOverlayPresetById,
} from "@/lib/timeline";
import { useClipForgeChatDraftStore } from "@/stores/clipforge-chat-draft-store";
import type { MediaAsset } from "@/types/assets";
import type {
	ClipForgeAppliedCommandSummary,
	ClipForgeChatMemory,
	ClipForgeEditorCommand,
	ClipForgeRecentAssetChoice,
	ClipMediaMetadata,
	CaptionSegmentView,
	CreativeBrief,
	DraftImpactSummary,
	DraftRecipe,
	FootageIntelligenceReport,
	PolishProfile,
	RetentionShapePlan,
	TrendSoundReference,
	TimelineDiffOp,
	CutRangeOp,
	TimelineDiffOpSource,
} from "@/types/clipforge";
import type {
	ExportFormat,
	PublishDestination,
	ExportPreflightAction,
	ExportPreflightResult,
	ExportQuality,
} from "@/types/export";
import type { ProjectVersionTarget } from "@/types/project";
import type { TProject } from "@/types/project";
import type { AudioLibraryItem } from "@/types/library";
import type { TimelineElement, TextElement } from "@/types/timeline";
import type {
	ChatClarificationRequest,
	ChatPlannerContext,
	ChatPlannerOverrides,
	ChatPlanPreviewResult,
	ChatPlanSafetySummary,
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
		this.invalidateSceneFootageIntelligence();
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

	validateCommands({
		commands,
	}: {
		commands: ClipForgeEditorCommand[];
	}): {
		valid: boolean;
		commands: ClipForgeEditorCommand[];
		errors: ReturnType<typeof validateTimelineDiffOps>["errors"];
	} {
		if (!this.editor.project.getActiveOrNull()) {
			return {
				valid: false,
				commands: [],
				errors: [
					{
						opIndex: -1,
						code: "no_active_project",
						message: "No active project.",
					},
				],
			};
		}

		const validatedCommands: ClipForgeEditorCommand[] = [];
		const errors: ReturnType<typeof validateTimelineDiffOps>["errors"] = [];

		for (const [commandIndex, command] of commands.entries()) {
			if (command.kind === "timeline-op") {
				const validation = this.validateOps({ ops: [command.op] });
				if (!validation.valid) {
					errors.push(
						...validation.errors.map((error) => ({
							...error,
							opIndex: commandIndex,
						})),
					);
					continue;
				}
				const validatedOp = validation.ops[0];
				if (validatedOp) {
					validatedCommands.push({
						kind: "timeline-op",
						op: validatedOp,
					});
				}
				continue;
			}

			const directErrors = this.validateDirectCommand({
				command,
				commandIndex,
			});
			if (directErrors.length > 0) {
				errors.push(...directErrors);
				continue;
			}
			validatedCommands.push(command);
		}

		return {
			valid: errors.length === 0,
			commands: validatedCommands,
			errors,
		};
	}

	reconcileAndValidateCommands({
		userText,
		projectSummary,
		context,
		overrides,
		commands,
	}: {
		userText: string;
		projectSummary: ProjectSummary;
		context: ChatPlannerContext;
		overrides?: ChatPlannerOverrides;
		commands: ClipForgeEditorCommand[];
	}): {
		commands: ClipForgeEditorCommand[];
		clarification: ChatClarificationRequest | null;
		safety: ChatPlanSafetySummary;
		firstPassErrors: ReturnType<typeof validateTimelineDiffOps>["errors"];
		secondPassErrors: ReturnType<typeof validateTimelineDiffOps>["errors"];
		blocked: boolean;
	} {
		const activeProject = this.editor.project.getActiveOrNull();
		if (!activeProject) {
			return {
				commands: [],
				clarification: null,
				safety: buildEmptyPlanSafetySummary({
					blocked: true,
					message: "No active project.",
				}),
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

		const timelineOps: TimelineDiffOp[] = [];
		for (const command of commands) {
			if (command.kind === "timeline-op") {
				timelineOps.push(command.op);
			}
		}

		if (timelineOps.length === 0) {
			const validation = this.validateCommands({ commands });
			return {
				commands: validation.commands,
				clarification: null,
				safety: buildEmptyPlanSafetySummary({
					blocked: !validation.valid,
					message: validation.valid
						? "Direct commands validated."
						: validation.errors[0]?.message ?? "Command validation failed.",
				}),
				firstPassErrors: validation.valid ? [] : validation.errors,
				secondPassErrors: validation.valid ? [] : validation.errors,
				blocked: !validation.valid,
			};
		}

		const reconciliation = this.reconcileAndValidateOps({
			userText,
			projectSummary,
			context,
			overrides,
			ops: timelineOps,
		});
		if (reconciliation.clarification) {
			return {
				commands: [],
				clarification: reconciliation.clarification,
				safety: reconciliation.safety,
				firstPassErrors: reconciliation.firstPassErrors,
				secondPassErrors: reconciliation.secondPassErrors,
				blocked: reconciliation.blocked,
			};
		}

		const reconciledTimelineOps = reconciliation.ops;
		let timelineOpIndex = 0;
		const reconciledCommands: ClipForgeEditorCommand[] = [];
		for (const command of commands) {
			if (command.kind !== "timeline-op") {
				reconciledCommands.push(command);
				continue;
			}
			const reconciledOp = reconciledTimelineOps[timelineOpIndex];
			timelineOpIndex += 1;
			if (reconciledOp) {
				reconciledCommands.push({
					kind: "timeline-op",
					op: reconciledOp,
				});
			}
		}

		const validation = this.validateCommands({
			commands: reconciledCommands,
		});
		return {
			commands: validation.commands,
			clarification: null,
			safety: reconciliation.safety,
			firstPassErrors: reconciliation.firstPassErrors,
			secondPassErrors: validation.valid
				? reconciliation.secondPassErrors
				: [...reconciliation.secondPassErrors, ...validation.errors],
			blocked: reconciliation.blocked || !validation.valid,
		};
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
					totalCommands: ops.length,
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

	previewCommandsImpact({
		commands,
	}: {
		commands: ClipForgeEditorCommand[];
	}): ChatPlanPreviewResult {
		const activeProject = this.editor.project.getActiveOrNull();
		if (!activeProject) {
			return {
				cards: [],
				summary: {
					totalCommands: commands.length,
					totalOps: commands.filter((command) => command.kind === "timeline-op").length,
					impactCount: 0,
					simulatedDurationDeltaMs: 0,
				},
			};
		}

		return buildCommandPlanImpactPreview({
			project: activeProject,
			mediaAssets: this.editor.media.getAssets(),
			commands,
		});
	}

	async applyCommands({
		commands,
		source = "manual",
		prompt = null,
	}: {
		commands: ClipForgeEditorCommand[];
		source?: TimelineDiffOpSource;
		prompt?: string | null;
	}): Promise<{
		applied: boolean;
		commands: ClipForgeEditorCommand[];
		errors: ReturnType<typeof validateTimelineDiffOps>["errors"];
	}> {
		const validation = this.validateCommands({ commands });
		if (!validation.valid) {
			return {
				applied: false,
				commands: [],
				errors: validation.errors,
			};
		}

		const appliedCommands: ClipForgeEditorCommand[] = [];
		let pendingTimelineCommands: ClipForgeEditorCommand[] = [];
		const flushTimelineCommands = () => {
			if (pendingTimelineCommands.length === 0) {
				return;
			}
			const result = this.applyOps({
				ops: pendingTimelineCommands.flatMap((command) =>
					command.kind === "timeline-op" ? [command.op] : [],
				),
				source,
			});
			if (!result.applied) {
				throw new Error(result.errors[0]?.message ?? "Failed to apply timeline ops.");
			}
			appliedCommands.push(...pendingTimelineCommands);
			pendingTimelineCommands = [];
		};

		for (const command of validation.commands) {
			if (command.kind === "timeline-op") {
				pendingTimelineCommands.push(command);
				continue;
			}
			flushTimelineCommands();
			await this.executeDirectCommand({ command });
			appliedCommands.push(command);
		}

		flushTimelineCommands();

		if (source === "chat" && appliedCommands.length > 0) {
			this.rememberAppliedChatPlan({
				prompt,
				commands: appliedCommands,
			});
		}

		return {
			applied: true,
			commands: appliedCommands,
			errors: [],
		};
	}

	isDraftBuildIntent({
		prompt,
	}: {
		prompt: string;
	}): boolean {
		return isCreativeDraftIntent({ prompt });
	}

	buildCreativeBrief({
		prompt,
	}: {
		prompt: string;
		context?: ChatPlannerContext;
	}): CreativeBrief {
		const activeProject = this.editor.project.getActive();
		return buildCreativeBriefFromPrompt({
			prompt,
			project: activeProject,
		});
	}

	getTrendSoundReferences(): TrendSoundReference[] {
		const activeProject = this.editor.project.getActive();
		if (!activeProject) {
			return [];
		}

		return ensureClipForgeProjectData({ project: activeProject }).clipforge
			.trendSoundReferences;
	}

	saveTrendSoundReference({
		label,
		platform,
		creator,
		sourceUrl,
		notes,
	}: {
		label: string;
		platform: TrendSoundReference["platform"];
		creator?: string | null;
		sourceUrl?: string | null;
		notes?: string | null;
	}): TrendSoundReference {
		const activeProject = this.editor.project.getActive();
		if (!activeProject) {
			throw new Error("No active project.");
		}

		const normalizedLabel = label.trim();
		if (!normalizedLabel) {
			throw new Error("Trend sound label is required.");
		}

		const nextProject = ensureClipForgeProjectData({ project: activeProject });
		const nextReference: TrendSoundReference = {
			id: crypto.randomUUID(),
			label: normalizedLabel,
			platform,
			creator: creator?.trim() ? creator.trim() : null,
			sourceUrl: sourceUrl?.trim() ? sourceUrl.trim() : null,
			notes: notes?.trim() ? notes.trim() : null,
			createdAt: new Date().toISOString(),
		};

		this.editor.project.setActiveProject({
			project: {
				...nextProject,
				metadata: {
					...nextProject.metadata,
					updatedAt: new Date(),
				},
				clipforge: {
					...nextProject.clipforge,
					trendSoundReferences: [
						nextReference,
						...nextProject.clipforge.trendSoundReferences,
					],
				},
			},
		});
		this.editor.save.markDirty();
		return nextReference;
	}

	removeTrendSoundReference({
		referenceId,
	}: {
		referenceId: string;
	}): void {
		const activeProject = this.editor.project.getActive();
		if (!activeProject) {
			throw new Error("No active project.");
		}

		const nextProject = ensureClipForgeProjectData({ project: activeProject });
		this.editor.project.setActiveProject({
			project: {
				...nextProject,
				metadata: {
					...nextProject.metadata,
					updatedAt: new Date(),
				},
				clipforge: {
					...nextProject.clipforge,
					trendSoundReferences: nextProject.clipforge.trendSoundReferences.filter(
						(reference) => reference.id !== referenceId,
					),
				},
			},
		});
		this.editor.save.markDirty();
	}

	async analyzeSceneFootageIntelligence(): Promise<FootageIntelligenceReport> {
		const activeProject = this.editor.project.getActive();
		if (!activeProject) {
			throw new Error("No active project.");
		}
		const nextProject = ensureClipForgeProjectData({ project: activeProject });
		const activeScene =
			nextProject.scenes.find((scene) => scene.id === nextProject.currentSceneId) ??
			nextProject.scenes[0] ??
			null;
		if (!activeScene) {
			throw new Error("No active scene.");
		}

		const sceneVideoMediaIds = activeScene.tracks
			.filter((track) => track.type === "video")
			.flatMap((track) =>
				track.elements
					.filter((element): element is Extract<typeof track.elements[number], { type: "video" }> => element.type === "video")
					.map((element) => element.mediaId),
			);
		for (const mediaId of [...new Set(sceneVideoMediaIds)]) {
			const asset = this.editor.media.getAssets().find((candidate) => candidate.id === mediaId);
			if (asset?.type === "video" && !asset.visualAnalysis) {
				await this.editor.media.analyzeVisualActivity({ mediaId });
			}
		}

		const beatState = this.editor.audio.getSceneBeatMarkers();
		const report = buildSceneFootageIntelligenceReport({
			project: {
				...nextProject,
				clipforge: ensureClipForgeProjectData({ project: nextProject }).clipforge,
			},
			mediaAssets: this.editor.media.getAssets(),
			beatMarkers: beatState.markers,
		});

		this.editor.project.setActiveProject({
			project: {
				...nextProject,
				metadata: {
					...nextProject.metadata,
					updatedAt: new Date(),
				},
				clipforge: {
					...nextProject.clipforge,
					sceneFootageIntelligenceBySceneId: {
						...nextProject.clipforge.sceneFootageIntelligenceBySceneId,
						[activeScene.id]: report,
					},
				},
			},
		});
		this.editor.save.markDirty();

		return report;
	}

	getSceneFootageIntelligence(): FootageIntelligenceReport | null {
		const activeProject = this.editor.project.getActive();
		if (!activeProject) return null;
		const project = ensureClipForgeProjectData({ project: activeProject });
		return project.clipforge.sceneFootageIntelligenceBySceneId[project.currentSceneId] ?? null;
	}

	planDraftRecipe({
		brief,
	}: {
		brief: CreativeBrief;
	}): DraftRecipe {
		const activeProject = this.editor.project.getActive();
		return planCreativeDraftRecipe({
			brief,
			project: activeProject,
			mediaAssets: this.editor.media.getAssets(),
			beatSourceMediaId: this.editor.audio.getSceneBeatMarkers().sourceMediaId,
			beatMarkerCount: this.editor.audio.getSceneBeatMarkers().markers.length,
			projectKitTemplates: this.editor.project.getProjectKitTemplates(),
			footageIntelligenceReport: this.getSceneFootageIntelligence(),
		});
	}

	planRetentionShape({
		brief,
		footageReport,
	}: {
		brief: CreativeBrief;
		footageReport: FootageIntelligenceReport | null;
	}): RetentionShapePlan {
		return buildRetentionShapePlan({
			brief,
			footageReport,
			project: this.editor.project.getActive(),
			beatMarkerCount: this.editor.audio.getSceneBeatMarkers().markers.length,
		});
	}

	planPolishProfile({
		brief,
		project,
	}: {
		brief: CreativeBrief;
		project?: TProject | null;
	}): PolishProfile {
		return resolvePolishProfileFromBrief({
			brief,
			project: project ?? this.editor.project.getActive(),
		});
	}

	previewDraftRecipe({
		recipe,
	}: {
		recipe: DraftRecipe;
	}): DraftImpactSummary {
		return buildDraftImpactSummary({ recipe });
	}

	previewRetentionShape({
		plan,
	}: {
		plan: RetentionShapePlan;
	}): DraftImpactSummary {
		const activeProject = this.editor.project.getActive();
		const activeTarget =
			activeProject?.settings.versionPack?.activeTargetId ??
			activeProject?.settings.versionPack?.targets.find((target) => target.enabled)?.id ??
			null;
		return {
			totalSteps: plan.steps.length,
			overlayCount: plan.steps.filter(
				(step) => step.kind === "insert-payoff" || step.kind === "reserve-cta",
			).length,
			versionTargets: activeTarget ? [activeTarget] : [],
			willRebuildAssembly: false,
			willGenerateCaptions: false,
			usesBeatMontage: plan.beats.some((beat) => beat.strategy === "montage"),
		};
	}

	previewPolishProfile({
		profile,
	}: {
		profile: PolishProfile;
	}): DraftImpactSummary {
		const activeProject = this.editor.project.getActive();
		const activeTarget =
			activeProject?.settings.versionPack?.activeTargetId ??
			activeProject?.settings.versionPack?.targets.find((target) => target.enabled)?.id ??
			null;
		return {
			totalSteps: 1,
			overlayCount: this.getSceneOverlayGroups().length,
			versionTargets: activeTarget ? [activeTarget] : [],
			willRebuildAssembly: false,
			willGenerateCaptions: false,
			usesBeatMontage: profile.audioPolishPresetId === "bold-social",
		};
	}

	async applyRetentionShape({
		plan,
	}: {
		plan: RetentionShapePlan;
	}): Promise<{ appliedSteps: number; skippedSteps: number; messages: string[] }> {
		const messages: string[] = [];
		let appliedSteps = 0;
		let skippedSteps = 0;

		for (const step of plan.steps) {
			try {
				switch (step.kind) {
					case "promote-hook": {
						const candidateId = readStringParam({
							params: step.params,
							key: "candidateId",
						});
						if (!candidateId) {
							throw new Error("Missing hook candidate id.");
						}
						this.applyHookCandidate({ candidateId });
						appliedSteps += 1;
						messages.push("Promoted the recommended opener.");
						break;
					}
					case "trim-setup":
					case "compress-body": {
						const recommendationIds = readStringArrayParam({
							params: step.params,
							key: "recommendationIds",
						});
						if (recommendationIds.length === 0) {
							throw new Error("No keep/cut recommendations were attached to this step.");
						}
						const result = this.applyKeepCutRecommendations({
							recommendationIds,
						});
						if (result.applied === 0) {
							skippedSteps += 1;
							messages.push(
								`Skipped ${step.kind}: no eligible trims or cuts remained after rescoring.`,
							);
							break;
						}
						appliedSteps += 1;
						messages.push(...result.messages);
						break;
					}
					case "delay-context": {
						appliedSteps += 1;
						messages.push("Delayed slower context until after the opener lands.");
						break;
					}
					case "insert-payoff": {
						appliedSteps += 1;
						messages.push("Reserved a later payoff beat for overlays and caption emphasis.");
						break;
					}
					case "reserve-cta": {
						appliedSteps += 1;
						messages.push("Reserved the ending beat for CTA content.");
						break;
					}
				}
			} catch (error) {
				skippedSteps += 1;
				messages.push(
					error instanceof Error
						? `Skipped ${step.kind}: ${error.message}`
						: `Skipped ${step.kind}.`,
				);
			}
		}

		return {
			appliedSteps,
			skippedSteps,
			messages,
		};
	}

	async applyDraftRecipe({
		recipe,
	}: {
		recipe: DraftRecipe;
	}): Promise<{ appliedSteps: number; skippedSteps: number; messages: string[] }> {
		const messages: string[] = [];
		let appliedSteps = 0;
		let skippedSteps = 0;
		let workingFootageReport = this.getSceneFootageIntelligence();

		if (recipe.retentionShape) {
			const retentionResult = await this.applyRetentionShape({
				plan: recipe.retentionShape,
			});
			appliedSteps += retentionResult.appliedSteps;
			skippedSteps += retentionResult.skippedSteps;
			messages.push(...retentionResult.messages);
			if (retentionResult.appliedSteps > 0) {
				try {
					workingFootageReport = await this.analyzeSceneFootageIntelligence();
				} catch {
					workingFootageReport = null;
					messages.push(
						"Retention shaping applied, but footage intelligence could not be refreshed before follow-up tightening.",
					);
				}
			}
		}

		for (const step of recipe.operations) {
			try {
				if (
					!recipe.retentionShape &&
					appliedSteps === 0 &&
					recipe.hookCandidateId &&
					!recipe.operations.some((candidate) => candidate.kind === "auto-edit")
				) {
					this.applyHookCandidate({ candidateId: recipe.hookCandidateId });
					messages.push("Promoted the recommended opener.");
					appliedSteps += 1;
					try {
						workingFootageReport = await this.analyzeSceneFootageIntelligence();
					} catch {
						workingFootageReport = null;
						messages.push(
							"Hook scoring could not be refreshed after promoting the opener, so follow-up trims may be reduced.",
						);
					}
				}
				switch (step.kind) {
					case "apply-project-kit": {
						const kitId = readStringParam({ params: step.params, key: "kitId" });
						if (!kitId) {
							throw new Error("Missing project kit id.");
						}
						await this.editor.project.applyProjectKit({ kitId });
						appliedSteps += 1;
						messages.push(`Applied project kit.`);
						break;
					}
					case "auto-edit": {
						this.autoEditTikTokDraft();
						appliedSteps += 1;
						messages.push("Built initial TikTok assembly.");
						break;
					}
					case "make-version": {
						if (!recipe.retentionShape && (recipe.keepCutRecommendationIds?.length ?? 0) > 0) {
							const refreshedRecommendationIds =
								workingFootageReport?.keepCutRecommendations
									.filter((recommendation) => recommendation.action !== "keep")
									.slice(0, recipe.keepCutRecommendationIds?.length ?? 0)
									.map((recommendation) => recommendation.id) ?? [];
							if (refreshedRecommendationIds.length > 0) {
								const keepCutResult = this.applyKeepCutRecommendations({
									recommendationIds: refreshedRecommendationIds,
								});
								if (keepCutResult.applied > 0) {
									appliedSteps += 1;
									messages.push(`Applied ${keepCutResult.applied} keep/cut recommendations.`);
								}
							} else if (!workingFootageReport) {
								skippedSteps += 1;
								messages.push(
									"Skipped keep/cut recommendations because footage intelligence was unavailable.",
								);
							}
						}
						const durationTargetS = readNumberParam({
							params: step.params,
							key: "durationTargetS",
						});
						if (!durationTargetS) {
							throw new Error("Missing draft duration target.");
						}
						const aggressiveness =
							readNumberParam({
								params: step.params,
								key: "aggressiveness",
							}) ?? 0.75;
						const result = this.applyOps({
							source: "chat",
							ops: [
								{
									type: "MAKE_VERSION",
									duration_target_s: durationTargetS,
									aggressiveness,
								},
							],
						});
						if (!result.applied) {
							throw new Error(result.errors[0]?.message ?? "MAKE_VERSION failed.");
						}
						appliedSteps += 1;
						messages.push(`Tightened draft to ${durationTargetS}s.`);
						break;
					}
					case "generate-captions": {
						if (this.getSceneCaptions().length > 0) {
							skippedSteps += 1;
							messages.push("Skipped caption generation because scene captions already exist.");
							break;
						}
						const template = readStringParam({
							params: step.params,
							key: "template",
						});
						this.generateSceneCaptions({
							language: "auto",
							template:
								template === "clean-bottom" ? "clean-bottom" : "bold-center",
							overwriteExisting: false,
						});
						appliedSteps += 1;
						messages.push("Generated scene captions.");
						break;
					}
					case "apply-caption-style": {
						const styleId = readStringParam({
							params: step.params,
							key: "styleId",
						});
						if (!styleId) {
							throw new Error("Missing caption style id.");
						}
						await this.applySceneCaptionStyle({ styleId });
						appliedSteps += 1;
						messages.push(`Applied caption style ${styleId}.`);
						break;
					}
					case "apply-polish-profile": {
						const profileId = readStringParam({
							params: step.params,
							key: "profileId",
						});
						if (!profileId) {
							throw new Error("Missing polish profile id.");
						}
						const result = await this.applyPolishProfile({
							profileId: profileId as PolishProfile["id"],
						});
						appliedSteps += Math.max(1, result.appliedSteps);
						messages.push(...result.messages);
						break;
					}
					case "auto-montage": {
						const musicMediaId = readStringParam({
							params: step.params,
							key: "musicMediaId",
						});
						if (!musicMediaId) {
							skippedSteps += 1;
							messages.push("Skipped auto montage because no beat source is active.");
							break;
						}
						const visuals = this.getVisualSelectionsForDraft();
						if (visuals.length === 0) {
							skippedSteps += 1;
							messages.push("Skipped auto montage because no visual clips are available.");
							break;
						}
						this.editor.selection.setSelectedElements({ elements: visuals });
						this.editor.timeline.buildAutoMontageFromSelection({
							musicMediaId,
							strategy:
								readStringParam({ params: step.params, key: "strategy" }) ===
								"one-cut-per-beat"
									? "one-cut-per-beat"
									: "one-cut-per-two-beats",
							beatDivision:
								readNumberParam({ params: step.params, key: "beatDivision" }) ?? 2,
						});
						appliedSteps += 1;
						messages.push("Applied beat-paced auto montage.");
						break;
					}
					case "insert-overlay": {
						this.editor.timeline.insertSocialOverlayPreset({
							presetId:
								(readStringParam({ params: step.params, key: "presetId" }) as Parameters<
									typeof this.editor.timeline.insertSocialOverlayPreset
								>[0]["presetId"]) ?? "routine-label",
							variantId:
								(readStringParam({
									params: step.params,
									key: "variantId",
								}) as Parameters<
									typeof this.editor.timeline.insertSocialOverlayPreset
								>[0]["variantId"]) ?? undefined,
							motionPresetId:
								(readStringParam({
									params: step.params,
									key: "motionPresetId",
								}) as Parameters<
									typeof this.editor.timeline.insertSocialOverlayPreset
								>[0]["motionPresetId"]) ?? undefined,
							startTime:
								readNumberParam({ params: step.params, key: "startTime" }) ?? 0.3,
							duration:
								readNumberParam({ params: step.params, key: "duration" }) ?? 2,
						});
						appliedSteps += 1;
						messages.push("Inserted social overlay.");
						break;
					}
					case "insert-scene-recipe": {
						const recipeId = readStringParam({
							params: step.params,
							key: "recipeId",
						});
						if (!recipeId) {
							throw new Error("Missing scene recipe id.");
						}
						await this.editor.scenes.insertSceneRecipe({
							recipeId,
							startTime:
								readNumberParam({ params: step.params, key: "startTime" }) ??
								this.editor.playback.getCurrentTime(),
						});
						appliedSteps += 1;
						messages.push(`Inserted ${recipeId} scene recipe.`);
						break;
					}
					case "apply-version-pack": {
						const targets = readStringArrayParam({
							params: step.params,
							key: "targets",
						}).filter(isProjectVersionTarget);
						if (targets.length === 0) {
							skippedSteps += 1;
							messages.push("Skipped version pack update because no targets were requested.");
							break;
						}
						const activeProject = this.editor.project.getActive();
						const currentPack = activeProject.settings.versionPack;
						if (!currentPack) {
							throw new Error("Project version pack is unavailable.");
						}
						await this.editor.project.updateVersionPack({
							versionPack: {
								...currentPack,
								targets: currentPack.targets.map((target) => ({
									...target,
									enabled: targets.includes(target.id),
								})),
								activeTargetId:
									targets[0] ?? currentPack.activeTargetId ?? null,
							},
						});
						appliedSteps += 1;
						messages.push(`Enabled ${targets.join(", ")} publish targets.`);
						break;
					}
					case "apply-safe-layout": {
						const targetVersionIds = readStringArrayParam({
							params: step.params,
							key: "targetVersionIds",
						}).filter(isProjectVersionTarget);
						if (targetVersionIds.length === 0) {
							skippedSteps += 1;
							messages.push("Skipped safe layout because no target versions were queued.");
							break;
						}
						for (const targetVersionId of targetVersionIds) {
							this.editor.timeline.applySafeLayoutToScene({ targetVersionId });
						}
						appliedSteps += 1;
						messages.push(`Applied safe layout for ${targetVersionIds.join(", ")}.`);
						break;
					}
				}
			} catch (error) {
				if (step.kind === "auto-edit") {
					throw error;
				}
				skippedSteps += 1;
				messages.push(
					error instanceof Error
						? `Skipped ${step.kind}: ${error.message}`
						: `Skipped ${step.kind}.`,
				);
			}
		}

		this.stabilizePreview();
		return {
			appliedSteps,
			skippedSteps,
			messages,
		};
	}

	applyHookCandidate({
		candidateId,
	}: {
		candidateId: string;
	}): void {
		const report = this.getSceneFootageIntelligence();
		const candidate = report?.hookCandidates.find((item) => item.id === candidateId) ?? null;
		if (!candidate) {
			throw new Error("Hook candidate not found.");
		}
		if (candidate.startTime <= 0.05) {
			return;
		}
		const result = this.applyOps({
			source: "manual",
			ops: [
				{
					type: "CUT_RANGE",
					start_ms: 0,
					end_ms: Math.round(candidate.startTime * 1000),
				},
			],
		});
		if (!result.applied) {
			throw new Error(result.errors[0]?.message ?? "Unable to apply hook candidate.");
		}
	}

	applyKeepCutRecommendations({
		recommendationIds,
		mode = "explicit",
	}: {
		recommendationIds?: string[];
		mode?: "explicit" | "all-non-keep";
	}): { applied: number; messages: string[] } {
		const report = this.getSceneFootageIntelligence();
		if (!report) {
			throw new Error("No footage intelligence report is available.");
		}
		const activeProject = this.editor.project.getActive();
		if (!activeProject) {
			throw new Error("No active project.");
		}
		const activeScene =
			activeProject.scenes.find((scene) => scene.id === activeProject.currentSceneId) ??
			activeProject.scenes[0] ??
			null;
		if (!activeScene) {
			throw new Error("No active scene.");
		}

		const selectedIds =
			mode === "all-non-keep"
				? new Set(
						report.keepCutRecommendations
							.filter((recommendation) => recommendation.action !== "keep")
							.map((recommendation) => recommendation.id),
					)
				: new Set(recommendationIds ?? []);
		const recommendations = report.keepCutRecommendations.filter((recommendation) =>
			selectedIds.has(recommendation.id),
		);
		if (recommendations.length === 0) {
			return { applied: 0, messages: ["No keep/cut recommendations were selected."] };
		}

		const trackByElementId = new Map(
			activeScene.tracks.flatMap((track) =>
				track.elements.map((element) => [element.id, { track, element }] as const),
			),
		);
		const ops: CutRangeOp[] = [];
		for (const recommendation of recommendations) {
			const resolved = trackByElementId.get(recommendation.elementId);
			if (!resolved || resolved.element.type !== "video") continue;
			const elementStart = resolved.element.startTime;
			const elementEnd = resolved.element.startTime + resolved.element.duration;
			if (recommendation.action === "cut") {
				ops.push({
					type: "CUT_RANGE",
					start_ms: Math.round(elementStart * 1000),
					end_ms: Math.round(elementEnd * 1000),
				});
				continue;
			}
			if (recommendation.action === "trim") {
				if (recommendation.endTime < elementEnd - 0.05) {
					ops.push({
						type: "CUT_RANGE",
						start_ms: Math.round(recommendation.endTime * 1000),
						end_ms: Math.round(elementEnd * 1000),
					});
				}
				if (recommendation.startTime > elementStart + 0.05) {
					ops.push({
						type: "CUT_RANGE",
						start_ms: Math.round(elementStart * 1000),
						end_ms: Math.round(recommendation.startTime * 1000),
					});
				}
			}
		}

		const dedupedOps = [...new Map(
			ops
				.sort((left, right) => right.start_ms - left.start_ms)
				.map((op) => [`${op.type}:${op.start_ms}:${op.end_ms}`, op] as const),
		).values()];
		if (dedupedOps.length === 0) {
			return { applied: 0, messages: ["No trim or cut operations were needed."] };
		}
		const result = this.applyOps({
			source: "manual",
			ops: dedupedOps,
		});
		if (!result.applied) {
			throw new Error(result.errors[0]?.message ?? "Unable to apply keep/cut recommendations.");
		}
		return {
			applied: recommendations.length,
			messages: recommendations.map((recommendation) =>
				`${recommendation.action.toUpperCase()}: ${recommendation.reasons[0] ?? "Updated weak footage span."}`,
			),
		};
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
		this.invalidateSceneFootageIntelligence();
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
		template: string;
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

	async applySceneCaptionStyle({
		styleId,
		revealPresetId,
		soundSyncPresetId,
	}: {
		styleId: string;
		revealPresetId?: import("@/types/clipforge").CaptionRevealPresetId | null;
		soundSyncPresetId?: import("@/types/timeline").AnimationSfxPresetId | null;
	}): Promise<void> {
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

		const sceneCaptions = this.getSceneCaptions();
		if (sceneCaptions.length === 0) {
			return;
		}

		const effectiveRevealPresetId = revealPresetId ?? style.reveal_preset_id ?? "none";
		const updates = sceneCaptions.flatMap((segment) => {
			const track = this.editor.timeline.getTrackById({ trackId: segment.trackId });
			const element =
				track?.type === "text"
					? track.elements.find(
							(candidate) =>
								candidate.type === "text" && candidate.id === segment.elementId,
					  ) ?? null
					: null;
			if (!element || element.type !== "text") {
				return [];
			}
			return [
				{
					trackId: segment.trackId,
					elementId: segment.elementId,
					updates: {
						keyframes: buildCaptionRevealKeyframes({
							element,
							presetId: effectiveRevealPresetId,
						}),
					},
				},
			];
		});
		if (updates.length > 0) {
			this.editor.timeline.updateElements({ updates });
		}

		const captionIds = sceneCaptions.map((segment) => segment.elementId);
		this.editor.timeline.clearAnimationSfxPairing({
			targetElementIds: captionIds,
			expectedKind: "caption",
		});
		const effectiveSoundSyncPresetId =
			soundSyncPresetId ??
			style.sound_sync_preset_id ??
			getCaptionRevealSoundSyncPreset({ presetId: effectiveRevealPresetId });
		if (effectiveSoundSyncPresetId) {
			await this.editor.timeline.applyAnimationSfxPairing({
				pairingId: effectiveSoundSyncPresetId,
				targetElementIds: captionIds,
			});
		}
	}

	async applySceneCaptionRevealPreset({
		presetId,
		soundSyncPresetId,
	}: {
		presetId: import("@/types/clipforge").CaptionRevealPresetId;
		soundSyncPresetId?: import("@/types/timeline").AnimationSfxPresetId | null;
	}): Promise<void> {
		const sceneCaptions = this.getSceneCaptions();
		if (sceneCaptions.length === 0) {
			throw new Error("Generate captions before applying a reveal preset.");
		}

		const updates = sceneCaptions.flatMap((segment) => {
			const track = this.editor.timeline.getTrackById({ trackId: segment.trackId });
			const element =
				track?.type === "text"
					? track.elements.find(
							(candidate) =>
								candidate.type === "text" && candidate.id === segment.elementId,
					  ) ?? null
					: null;
			if (!element || element.type !== "text") {
				return [];
			}
			return [
				{
					trackId: segment.trackId,
					elementId: segment.elementId,
					updates: {
						keyframes: buildCaptionRevealKeyframes({
							element,
							presetId,
						}),
					},
				},
			];
		});
		if (updates.length > 0) {
			this.editor.timeline.updateElements({ updates });
		}

		const captionIds = sceneCaptions.map((segment) => segment.elementId);
		if (captionIds.length > 0) {
			this.editor.timeline.clearAnimationSfxPairing({
				targetElementIds: captionIds,
				expectedKind: "caption",
			});
			const effectiveSoundSyncPresetId =
				soundSyncPresetId ?? getCaptionRevealSoundSyncPreset({ presetId });
			if (effectiveSoundSyncPresetId) {
				await this.editor.timeline.applyAnimationSfxPairing({
					pairingId: effectiveSoundSyncPresetId,
					targetElementIds: captionIds,
				});
			}
		}
	}

	async applyPolishProfile({
		profileId,
	}: {
		profileId: import("@/types/clipforge").PolishProfileId;
	}): Promise<{ appliedSteps: number; messages: string[] }> {
		const profile = getPolishProfileById({ profileId });
		if (!profile) {
			throw new Error("Polish profile not found.");
		}

		const activeProject = this.editor.project.getActive();
		if (!activeProject) {
			throw new Error("No active project.");
		}

		const messages: string[] = [];
		let appliedSteps = 0;
		const animationSfxPairing = profile.animationSfxPresetId
			? getAnimationSfxPairingById({ pairingId: profile.animationSfxPresetId })
			: null;

		await this.applySceneCaptionStyle({
			styleId: profile.captionStyleId,
			revealPresetId: profile.captionRevealPresetId,
			soundSyncPresetId:
				animationSfxPairing?.targetKind === "caption"
					? animationSfxPairing.id
					: undefined,
		});
		appliedSteps += 1;
		messages.push(`Styled captions with ${profile.label}.`);

		const audioPreset = getAudioPolishPresetById({
			id: profile.audioPolishPresetId,
		});
		await this.editor.project.updateSettings({
			settings: {
				polishProfileId: profile.id,
				audio: {
					...DEFAULT_PROJECT_AUDIO_SETTINGS,
					...(activeProject.settings.audio ?? {}),
					audioPolishPresetId: profile.audioPolishPresetId,
					softLimiterEnabled: audioPreset.softLimiterEnabled,
				},
				libraryDefaults: {
					...DEFAULT_PROJECT_LIBRARY_DEFAULTS,
					...(activeProject.settings.libraryDefaults ?? {}),
					captionStyleId: profile.captionStyleId,
				},
				overlayDefaults: {
					...(activeProject.settings.overlayDefaults ?? {}),
					variantId: profile.overlayStyleVariantId,
					motionPresetId: profile.motionPresetId,
				},
			},
		});
		appliedSteps += 1;
		messages.push(`Updated scene defaults to ${profile.label}.`);

		const overlayGroups = this.getSceneOverlayGroups();
		for (const group of overlayGroups) {
			this.editor.timeline.applyOverlayStyleVariant({
				trackId: group.trackId,
				elementIds: group.elementIds,
				variantId: profile.overlayStyleVariantId,
			});
			for (const elementId of group.elementIds) {
				this.editor.timeline.applyGraphicsMotionPreset({
					trackId: group.trackId,
					elementId,
					motionPresetId: profile.motionPresetId,
				});
			}
			if (animationSfxPairing?.targetKind === "graphics") {
				await this.editor.timeline.applyAnimationSfxPairing({
					pairingId: animationSfxPairing.id,
					targetElementIds: group.elementIds,
				});
			}
		}
		if (overlayGroups.length > 0) {
			appliedSteps += 1;
			messages.push(`Updated ${overlayGroups.length} overlay group${overlayGroups.length === 1 ? "" : "s"} to the ${profile.label} polish.`);
		}

		const visualTargets = this.getSelectedOrPrimaryVisualTargets();
		if (visualTargets.length > 0) {
			for (const target of visualTargets) {
				this.editor.timeline.applyElementFilterPreset({
					trackId: target.trackId,
					elementId: target.elementId,
					presetId: profile.finishingLookId,
				});
			}
			appliedSteps += 1;
			messages.push(`Applied the ${profile.finishingLookId} finishing look.`);
		} else {
			messages.push(`Skipped finishing look because no visual clip was available to polish.`);
		}

		return { appliedSteps, messages };
	}

	private getSceneOverlayGroups(): Array<{ trackId: string; elementIds: string[] }> {
		const groups = new Map<string, { trackId: string; elementIds: string[] }>();
		for (const track of this.editor.timeline.getTracks()) {
			if (track.type !== "text") continue;
			for (const element of track.elements) {
				if (element.type !== "text" || !element.overlayMeta) continue;
				const groupKey = `${track.id}:${element.linkedGroupId ?? element.id}`;
				const existing = groups.get(groupKey);
				if (existing) {
					existing.elementIds.push(element.id);
					continue;
				}
				groups.set(groupKey, { trackId: track.id, elementIds: [element.id] });
			}
		}
		return [...groups.values()].map((group) => ({
			...group,
			elementIds: [...new Set(group.elementIds)],
		}));
	}

	private getSelectedOrPrimaryVisualTargets(): Array<{ trackId: string; elementId: string }> {
		const selected = this.editor.selection
			.getSelectedElements()
			.flatMap(({ trackId, elementId }) => {
				const track = this.editor.timeline.getTrackById({ trackId });
				const element =
					track?.elements.find((candidate) => candidate.id === elementId) ?? null;
				if (
					!track ||
					!element ||
					(element.type !== "video" && element.type !== "image")
				) {
					return [];
				}
				return [{ trackId, elementId }];
			});
		if (selected.length > 0) {
			return selected;
		}

		for (const track of this.editor.timeline.getTracks()) {
			const primary = track.elements.find(
				(element) => element.type === "video" || element.type === "image",
			);
			if (primary) {
				return [{ trackId: track.id, elementId: primary.id }];
			}
		}

		return [];
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
		publishDestination = "generic-export",
	}: {
		format: ExportFormat;
		quality: ExportQuality;
		includeAudio: boolean;
		targetVersionId?: ProjectVersionTarget | null;
		publishDestination?: PublishDestination;
	}): ExportPreflightResult {
		return evaluateExportPreflight({
			project: this.editor.project.getActive(),
			mediaAssets: this.editor.media.getAssets(),
			format,
			quality,
			includeAudio,
			targetVersionId,
			publishDestination,
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

	private validateDirectCommand({
		command,
		commandIndex,
	}: {
		command: Exclude<ClipForgeEditorCommand, { kind: "timeline-op" }>;
		commandIndex: number;
	}): ReturnType<typeof validateTimelineDiffOps>["errors"] {
		const activeProject = this.editor.project.getActiveOrNull();
		if (!activeProject) {
			return [
				{
					opIndex: commandIndex,
					code: "no_active_project",
					message: "No active project.",
				},
			];
		}

		switch (command.kind) {
			case "set-clip-speed": {
				if (!Number.isFinite(command.playback_rate) || command.playback_rate <= 0) {
					return [
						buildCommandValidationError({
							commandIndex,
							code: "invalid_playback_rate",
							message: "Clip speed must be greater than zero.",
						}),
					];
				}
				return validateTargetSegments({
					commandIndex,
					targetIds: command.target_segment_ids,
					resolveTarget: (segmentId) => {
						const target = this.resolveCurrentSceneElement({ elementId: segmentId });
						return target &&
							(target.element.type === "video" || target.element.type === "audio")
							? null
							: "Clip speed targets must be video or audio elements.";
					},
				});
			}
			case "separate-audio":
				return validateTargetSegments({
					commandIndex,
					targetIds: command.target_segment_ids,
					resolveTarget: (segmentId) => {
						const target = this.resolveCurrentSceneElement({ elementId: segmentId });
						return target?.element.type === "video"
							? null
							: "Separate Audio requires video clip targets.";
					},
				});
			case "insert-freeze-frame": {
				if (command.duration_ms <= 0) {
					return [
						buildCommandValidationError({
							commandIndex,
							code: "invalid_freeze_duration",
							message: "Freeze-frame duration must be greater than zero.",
						}),
					];
				}
				const target = this.resolveCurrentSceneElement({
					elementId: command.target_segment_id,
				});
				if (!target || target.element.type !== "video") {
					return [
						buildCommandValidationError({
							commandIndex,
							code: "freeze_target_invalid",
							message: "Freeze Frame requires a video clip target.",
						}),
					];
				}
				const startMs = Math.round(target.element.startTime * 1000);
				const endMs = Math.round(
					(target.element.startTime + target.element.duration) * 1000,
				);
				if (command.at_ms < startMs || command.at_ms > endMs) {
					return [
						buildCommandValidationError({
							commandIndex,
							code: "freeze_time_out_of_range",
							message: "Freeze-frame insertion time must be inside the target clip.",
						}),
					];
				}
				return [];
			}
			case "set-transition-in":
				if (command.duration_ms <= 0) {
					return [
						buildCommandValidationError({
							commandIndex,
							code: "invalid_transition_duration",
							message: "Transition duration must be greater than zero.",
						}),
					];
				}
				return validateTargetSegments({
					commandIndex,
					targetIds: command.target_segment_ids,
					resolveTarget: (segmentId) => {
						const target = this.resolveCurrentSceneElement({ elementId: segmentId });
						if (
							!target ||
							(target.element.type !== "video" && target.element.type !== "image")
						) {
							return "Transition targets must be visual clips.";
						}
						const track = this.editor.timeline.getTrackById({ trackId: target.trackId });
						const fps = activeProject.settings.fps ?? 30;
						return track &&
							findAdjacentVisualIncomingTransitionTarget({
								track,
								elementId: segmentId,
								fps,
							})
							? null
							: "Transition targets require an adjacent visual clip immediately before them.";
					},
				});
			case "apply-finishing-look":
				return validateTargetSegments({
					commandIndex,
					targetIds: command.target_segment_ids,
					resolveTarget: (segmentId) => {
						const target = this.resolveCurrentSceneElement({ elementId: segmentId });
						return target &&
							(target.element.type === "video" || target.element.type === "image")
							? null
							: "Finishing looks only apply to video and image clips.";
					},
				});
			case "apply-effect-preset":
				return validateTargetSegments({
					commandIndex,
					targetIds: command.target_segment_ids,
					resolveTarget: (segmentId) => {
						const target = this.resolveCurrentSceneElement({ elementId: segmentId });
						if (
							!target ||
							(target.element.type !== "video" && target.element.type !== "image")
						) {
							return "Effect presets only apply to video and image clips.";
						}
						const effects = target.element.effects ?? [];
						if (effects.some((effect) => effect.kind === command.effect_kind)) {
							return "The requested effect is already applied to one of the targets.";
						}
						if (effects.length >= 3) {
							return "A clip can have at most three effects.";
						}
						return null;
					},
				});
			case "insert-overlay-preset":
				if (!getSocialOverlayPresetById({ presetId: command.preset_id })) {
					return [
						buildCommandValidationError({
							commandIndex,
							code: "unknown_overlay_preset",
							message: "The requested overlay preset does not exist.",
						}),
					];
				}
				if (command.duration_ms <= 0) {
					return [
						buildCommandValidationError({
							commandIndex,
							code: "invalid_overlay_duration",
							message: "Overlay duration must be greater than zero.",
						}),
					];
				}
				return [];
			case "apply-overlay-style":
				return validateTargetSegments({
						commandIndex,
						targetIds: command.target_element_ids,
						resolveTarget: (elementId) => {
							const target = this.resolveCurrentSceneElement({ elementId });
							return target &&
								"overlayMeta" in target.element &&
								target.element.overlayMeta
								? null
								: "Overlay style targets must be overlay elements.";
						},
					});
			case "apply-motion-preset":
				return validateTargetSegments({
					commandIndex,
					targetIds: command.target_element_ids,
					resolveTarget: (elementId) => {
						const target = this.resolveCurrentSceneElement({ elementId });
						return target &&
							(target.element.type === "text" || target.element.type === "sticker")
							? null
							: "Motion presets only apply to text and sticker elements.";
					},
				});
			case "apply-sound-sync": {
				const pairing = getAnimationSfxPairingById({
					pairingId: command.pairing_id,
				});
				if (!pairing) {
					return [
						buildCommandValidationError({
							commandIndex,
							code: "unknown_sound_sync_preset",
							message: "The requested sound sync preset does not exist.",
						}),
					];
				}
				return validateTargetSegments({
					commandIndex,
					targetIds: command.target_element_ids,
					resolveTarget: (elementId) => {
						const target = this.resolveCurrentSceneElement({ elementId });
						if (!target) {
							return "Sound sync targets must exist in the active scene.";
						}
						if (pairing.targetKind === "caption") {
							return target.element.type === "text" && target.element.role === "caption"
								? null
								: "This sound sync preset only applies to caption elements.";
						}
						return target.element.type === "text" || target.element.type === "sticker"
							? null
							: "This sound sync preset only applies to graphics targets.";
					},
				});
			}
			case "apply-music-track":
			case "replace-music-track": {
				const musicItem = this.resolveBundledMusicItem({
					itemId: command.music_asset_id,
				});
				if (!musicItem) {
					return [
						buildCommandValidationError({
							commandIndex,
							code: "unknown_music_asset",
							message: "The requested bundled music track does not exist.",
						}),
					];
				}
				if ((command.start_ms ?? 0) < 0) {
					return [
						buildCommandValidationError({
							commandIndex,
							code: "invalid_music_start",
							message: "Music start time must be zero or greater.",
						}),
					];
				}
				const publishDestination = this.getPreferredPublishDestination();
				if (
					publishDestination &&
					!this.isBundledAudioDestinationSafe({
						item: musicItem,
						publishDestination,
					})
				) {
					return [
						buildCommandValidationError({
							commandIndex,
							code: "music_destination_incompatible",
							message: "The selected music track is not safe for the current publish destination.",
						}),
					];
				}
				return [];
			}
			case "insert-sfx-preset":
				if (!this.resolveBundledSfxItem({ itemId: command.sfx_asset_id })) {
					return [
						buildCommandValidationError({
							commandIndex,
							code: "unknown_sfx_asset",
							message: "The requested bundled sound effect does not exist.",
						}),
					];
				}
				return command.start_ms >= 0
					? []
					: [
							buildCommandValidationError({
								commandIndex,
								code: "invalid_sfx_start",
								message: "Sound effect start time must be zero or greater.",
							}),
					  ];
			case "apply-polish-profile":
				return getPolishProfileById({ profileId: command.profile_id })
					? []
					: [
							buildCommandValidationError({
								commandIndex,
								code: "unknown_polish_profile",
								message: "The requested polish profile could not be found.",
							}),
					  ];
			case "apply-caption-reveal":
				return this.getCaptionRevealTargets({ scope: command.scope }).length > 0
					? []
					: [
							buildCommandValidationError({
								commandIndex,
								code: "caption_reveal_requires_captions",
								message: "Generate or select captions before applying a reveal preset.",
							}),
					  ];
			case "set-audio-mix":
				return [];
			case "apply-project-kit":
				return this.editor.project.findTemplateById({
					templateId: command.kit_id,
				})
					? []
					: [
							buildCommandValidationError({
								commandIndex,
								code: "project_kit_not_found",
								message: "The requested project kit could not be found.",
							}),
					  ];
			case "set-version-pack": {
				const versionPack = activeProject.settings.versionPack;
				if (!versionPack) {
					return [
						buildCommandValidationError({
							commandIndex,
							code: "version_pack_unavailable",
							message: "Project version pack settings are unavailable.",
						}),
					];
				}
				if (command.target_ids.length === 0) {
					return [
						buildCommandValidationError({
							commandIndex,
							code: "version_targets_required",
							message: "Choose at least one version target.",
						}),
					];
				}
				const knownTargets = new Set(versionPack.targets.map((target) => target.id));
				return command.target_ids.every((targetId) => knownTargets.has(targetId))
					? []
					: [
							buildCommandValidationError({
								commandIndex,
								code: "unknown_version_target",
								message: "One or more requested version targets are unavailable.",
							}),
					  ];
			}
			case "auto-reframe-selection": {
				const resolvedTargets = this.resolveAutoReframeTargets();
				if (resolvedTargets.length === 0) {
					return [
						buildCommandValidationError({
							commandIndex,
							code: "auto_reframe_requires_selection",
							message: "Select or previously target at least one visual clip to auto reframe.",
						}),
					];
				}
				return [];
			}
			case "set-publish-destination":
				return [];
			case "run-export-preflight-fixes": {
				const preflight = this.runExportPreflight({
					format: command.format,
					quality: command.quality,
					includeAudio: command.include_audio,
					targetVersionId: command.target_version_id ?? null,
					publishDestination:
						command.publish_destination ?? this.getPreferredPublishDestination() ?? "generic-export",
				});
				const actions =
					command.actions && command.actions.length > 0
						? command.actions
						: this.extractPreflightActions({ preflight });
				return actions.length > 0
					? []
					: [
							buildCommandValidationError({
								commandIndex,
								code: "no_preflight_actions",
								message: "No safe export preflight fixes are currently available.",
							}),
					  ];
			}
		}
	}

	private async executeDirectCommand({
		command,
	}: {
		command: Exclude<ClipForgeEditorCommand, { kind: "timeline-op" }>;
	}): Promise<void> {
		switch (command.kind) {
			case "set-clip-speed": {
				for (const segmentId of command.target_segment_ids) {
					const target = this.resolveCurrentSceneElement({ elementId: segmentId });
					if (!target) continue;
					this.editor.timeline.updateElementPlaybackRate({
						trackId: target.trackId,
						elementId: segmentId,
						playbackRate: command.playback_rate,
						ripple: command.ripple,
					});
				}
				break;
			}
			case "separate-audio": {
				for (const segmentId of command.target_segment_ids) {
					const target = this.resolveCurrentSceneElement({ elementId: segmentId });
					if (!target) continue;
					this.editor.timeline.separateAudio({
						trackId: target.trackId,
						elementId: segmentId,
					});
				}
				break;
			}
			case "insert-freeze-frame": {
				const target = this.resolveCurrentSceneElement({
					elementId: command.target_segment_id,
				});
				if (!target) {
					break;
				}
				await this.editor.timeline.insertFreezeFrame({
					trackId: target.trackId,
					elementId: command.target_segment_id,
					atTime: command.at_ms / 1000,
					duration: command.duration_ms / 1000,
					ripple: command.ripple,
				});
				break;
			}
			case "set-transition-in": {
				for (const segmentId of command.target_segment_ids) {
					const target = this.resolveCurrentSceneElement({ elementId: segmentId });
					if (!target) continue;
					this.editor.timeline.setElementTransitionIn({
						trackId: target.trackId,
						elementId: segmentId,
						preset: command.preset,
						duration: command.duration_ms / 1000,
					});
				}
				break;
			}
			case "apply-finishing-look": {
				for (const segmentId of command.target_segment_ids) {
					const target = this.resolveCurrentSceneElement({ elementId: segmentId });
					if (!target) continue;
					this.editor.timeline.applyElementFilterPreset({
						trackId: target.trackId,
						elementId: segmentId,
						presetId: command.preset_id,
					});
				}
				break;
			}
			case "apply-effect-preset": {
				for (const segmentId of command.target_segment_ids) {
					const target = this.resolveCurrentSceneElement({ elementId: segmentId });
					if (!target) continue;
					this.editor.timeline.addElementEffect({
						trackId: target.trackId,
						elementId: segmentId,
						kind: command.effect_kind,
					});
				}
				break;
			}
			case "insert-overlay-preset":
				this.editor.timeline.insertSocialOverlayPreset({
					presetId: command.preset_id,
					variantId: command.variant_id ?? undefined,
					motionPresetId: command.motion_preset_id ?? undefined,
					startTime: command.start_ms / 1000,
					duration: command.duration_ms / 1000,
					values: command.values ?? undefined,
				});
				break;
			case "apply-overlay-style": {
				const targetsByTrack = new Map<string, string[]>();
				for (const elementId of command.target_element_ids) {
					const target = this.resolveCurrentSceneElement({ elementId });
					if (!target) continue;
					const existing = targetsByTrack.get(target.trackId);
					if (existing) {
						existing.push(elementId);
						continue;
					}
					targetsByTrack.set(target.trackId, [elementId]);
				}
				for (const [trackId, elementIds] of targetsByTrack.entries()) {
					this.editor.timeline.applyOverlayStyleVariant({
						trackId,
						elementIds,
						variantId: command.variant_id,
					});
				}
				break;
			}
			case "apply-motion-preset": {
				for (const elementId of command.target_element_ids) {
					const target = this.resolveCurrentSceneElement({ elementId });
					if (!target) continue;
					this.editor.timeline.applyGraphicsMotionPreset({
						trackId: target.trackId,
						elementId,
						motionPresetId: command.motion_preset_id,
					});
				}
				break;
			}
			case "apply-sound-sync":
				await this.editor.timeline.applyAnimationSfxPairing({
					pairingId: command.pairing_id,
					targetElementIds: command.target_element_ids,
				});
				break;
			case "apply-music-track":
				await this.insertBundledMusicTrack({
					itemId: command.music_asset_id,
					startMs: command.start_ms ?? 0,
					volume: command.volume ?? null,
					loopToProjectEnd: command.loop_to_project_end ?? true,
					replaceExisting: false,
				});
				break;
			case "replace-music-track":
				await this.insertBundledMusicTrack({
					itemId: command.music_asset_id,
					startMs: command.start_ms ?? 0,
					volume: command.volume ?? null,
					loopToProjectEnd: command.loop_to_project_end ?? true,
					replaceExisting: true,
				});
				break;
			case "insert-sfx-preset":
				await this.insertBundledSfx({
					itemId: command.sfx_asset_id,
					startMs: command.start_ms,
					durationMs: command.duration_ms ?? null,
					volume: command.volume ?? null,
				});
				break;
			case "apply-polish-profile":
				await this.applyPolishProfile({
					profileId: command.profile_id,
				});
				break;
			case "apply-caption-reveal":
				await this.applyCaptionRevealByScope({
					presetId: command.preset_id,
					scope: command.scope,
				});
				break;
			case "set-audio-mix": {
				const activeProject = this.editor.project.getActive();
				await this.editor.project.updateSettings({
					settings: {
						audio: {
							...DEFAULT_PROJECT_AUDIO_SETTINGS,
							...(activeProject.settings.audio ?? {}),
							...command.settings,
						},
					},
				});
				break;
			}
			case "apply-project-kit":
				await this.editor.project.applyProjectKit({ kitId: command.kit_id });
				break;
			case "set-version-pack": {
				const activeProject = this.editor.project.getActive();
				const currentPack = activeProject.settings.versionPack;
				if (!currentPack) {
					throw new Error("Project version pack is unavailable.");
				}
				await this.editor.project.updateVersionPack({
					versionPack: {
						...currentPack,
						targets: currentPack.targets.map((target) => ({
							...target,
							enabled: command.target_ids.includes(target.id),
						})),
						activeTargetId:
							command.active_target_id ??
							command.target_ids[0] ??
							currentPack.activeTargetId,
					},
				});
				break;
			}
			case "auto-reframe-selection": {
				const targets = this.resolveAutoReframeTargets();
				if (targets.length === 0) {
					throw new Error("Select one or more visual clips to auto reframe.");
				}
				this.editor.selection.setSelectedElements({ elements: targets });
				this.editor.timeline.applyAutoReframeToSelection({
					targetVersionId: command.target_version_id,
				});
				break;
			}
			case "set-publish-destination":
				this.updateChatMemoryDestination({
					publishDestination: command.publish_destination,
				});
				break;
			case "run-export-preflight-fixes": {
				const preflight = this.runExportPreflight({
					format: command.format,
					quality: command.quality,
					includeAudio: command.include_audio,
					targetVersionId: command.target_version_id ?? null,
					publishDestination:
						command.publish_destination ?? this.getPreferredPublishDestination() ?? "generic-export",
				});
				const actions =
					command.actions && command.actions.length > 0
						? command.actions
						: this.extractPreflightActions({ preflight });
				if (actions.length > 0) {
					this.applyExportPreflightFixes({ actions });
				}
				break;
			}
		}

		this.invalidateSceneFootageIntelligence();
		this.stabilizePreview();
	}

	private resolveBundledMusicItem({
		itemId,
	}: {
		itemId: string;
	}): AudioLibraryItem | null {
		return BUNDLED_MUSIC.find((item) => item.id === itemId) ?? null;
	}

	private resolveBundledSfxItem({
		itemId,
	}: {
		itemId: string;
	}): AudioLibraryItem | null {
		return BUNDLED_SFX.find((item) => item.id === itemId) ?? null;
	}

	private isBundledAudioDestinationSafe({
		item,
		publishDestination,
	}: {
		item: AudioLibraryItem;
		publishDestination: PublishDestination;
	}): boolean {
		return (
			item.kind === "music" &&
			["generic-export", "tiktok", "instagram", "youtube"].includes(
				publishDestination,
			)
		);
	}

	private getPreferredPublishDestination(): PublishDestination | null {
		return (
			this.editor.project.getActiveOrNull()?.clipforge?.chatMemory?.destinationIntent
				?.publishDestination ?? null
		);
	}

	private updateChatMemoryDestination({
		publishDestination,
	}: {
		publishDestination: PublishDestination;
	}): void {
		const activeProject = this.editor.project.getActiveOrNull();
		if (!activeProject) {
			return;
		}
		const project = ensureClipForgeProjectData({ project: activeProject });
		this.editor.project.setActiveProject({
			project: {
				...project,
				metadata: {
					...project.metadata,
					updatedAt: new Date(),
				},
				clipforge: {
					...project.clipforge,
					chatMemory: {
						...project.clipforge.chatMemory,
						destinationIntent: {
							publishDestination,
						},
					},
				},
			},
		});
		this.editor.save.markDirty();
	}

	private extractPreflightActions({
		preflight,
	}: {
		preflight: ExportPreflightResult;
	}): ExportPreflightAction[] {
		return [
			...new Set(
				preflight.issues.flatMap((issue) =>
					issue.actionable && issue.action ? [issue.action] : [],
				),
			),
		];
	}

	private getOrCreateAudioTrackId(): string {
		return (
			this.editor.timeline.getTracks().find((track) => track.type === "audio")?.id ??
			this.editor.timeline.addTrack({ type: "audio" })
		);
	}

	private getSceneAudioElementsByRole({
		role,
	}: {
		role: "music" | "sfx" | "audio" | "voiceover";
	}): Array<{ trackId: string; elementId: string }> {
		return this.editor.timeline
			.getTracks()
			.filter((track): track is Extract<typeof track, { type: "audio" }> => track.type === "audio")
			.flatMap((track) =>
				track.elements.flatMap((element) =>
					element.type === "audio" && (element.role ?? "audio") === role
						? [{ trackId: track.id, elementId: element.id }]
						: [],
				),
			);
	}

	private async insertBundledMusicTrack({
		itemId,
		startMs,
		volume,
		loopToProjectEnd,
		replaceExisting,
	}: {
		itemId: string;
		startMs: number;
		volume: number | null;
		loopToProjectEnd: boolean;
		replaceExisting: boolean;
	}): Promise<void> {
		const item = this.resolveBundledMusicItem({ itemId });
		if (!item) {
			throw new Error("Bundled music track not found.");
		}
		if (replaceExisting) {
			const existingMusic = this.getSceneAudioElementsByRole({ role: "music" });
			if (existingMusic.length > 0) {
				this.editor.timeline.deleteElements({ elements: existingMusic });
			}
		}

		const asset = await ensureBundledAudioAsset({
			editor: this.editor,
			item,
		});
		const projectDurationMs = Math.max(
			Math.round(this.editor.timeline.getTotalDuration() * 1000),
			Math.round(item.duration * 1000),
		);
		const desiredEndMs = loopToProjectEnd ? projectDurationMs : startMs + Math.round(item.duration * 1000);
		const trackId = this.getOrCreateAudioTrackId();
		let cursorMs = Math.max(0, startMs);

		while (cursorMs < desiredEndMs) {
			const element = buildUploadAudioElement({
				mediaId: asset.id,
				name: asset.name,
				duration: asset.duration ?? item.duration,
				startTime: cursorMs / 1000,
			});
			element.role = "music";
			if (typeof volume === "number") {
				element.volume = Number(Math.max(0, Math.min(2, volume)).toFixed(3));
			}
			this.editor.timeline.insertElement({
				placement: { mode: "explicit", trackId },
				element,
			});
			cursorMs += Math.max(1, Math.round((asset.duration ?? item.duration) * 1000));
			if (!loopToProjectEnd) {
				break;
			}
		}
	}

	private async insertBundledSfx({
		itemId,
		startMs,
		durationMs,
		volume,
	}: {
		itemId: string;
		startMs: number;
		durationMs: number | null;
		volume: number | null;
	}): Promise<void> {
		const item = this.resolveBundledSfxItem({ itemId });
		if (!item) {
			throw new Error("Bundled sound effect not found.");
		}
		const asset = await ensureBundledAudioAsset({
			editor: this.editor,
			item,
		});
		const element = buildUploadAudioElement({
			mediaId: asset.id,
			name: asset.name,
			duration:
				Math.max(1, durationMs ?? item.defaultDurationMs ?? Math.round(item.duration * 1000)) /
				1000,
			startTime: Math.max(0, startMs) / 1000,
		});
		element.role = "sfx";
		if (typeof volume === "number") {
			element.volume = Number(Math.max(0, Math.min(2, volume)).toFixed(3));
		}
		this.editor.timeline.insertElement({
			placement: {
				mode: "explicit",
				trackId: this.getOrCreateAudioTrackId(),
			},
			element,
		});
	}

	private getCaptionRevealTargets({
		scope,
	}: {
		scope?: import("@/types/clipforge").ClipForgeCommandScope;
	}): Array<{ trackId: string; element: TextElement }> {
		if (scope === "selection") {
			const selectedIds = new Set(
				this.editor.selection.getSelectedElements().map((selection) => selection.elementId),
			);
			const selectedCaptions = this.editor.timeline
				.getTracks()
				.filter((track): track is Extract<typeof track, { type: "text" }> => track.type === "text")
				.flatMap((track) =>
					track.elements.flatMap((element) =>
						element.type === "text" &&
						element.role === "caption" &&
						selectedIds.has(element.id)
							? [{ trackId: track.id, element }]
							: [],
					),
				);
			if (selectedCaptions.length > 0) {
				return selectedCaptions;
			}
		}

		return this.getSceneCaptions().flatMap((segment) => {
			const track = this.editor.timeline.getTrackById({ trackId: segment.trackId });
			const element =
				track?.type === "text"
					? (track.elements.find(
							(candidate) =>
								candidate.type === "text" && candidate.id === segment.elementId,
					  ) as TextElement | undefined)
					: undefined;
			return element ? [{ trackId: segment.trackId, element }] : [];
		});
	}

	private async applyCaptionRevealByScope({
		presetId,
		scope,
	}: {
		presetId: import("@/types/clipforge").CaptionRevealPresetId;
		scope?: import("@/types/clipforge").ClipForgeCommandScope;
	}): Promise<void> {
		const targets = this.getCaptionRevealTargets({ scope });
		if (targets.length === 0) {
			throw new Error("Generate or select captions before applying a reveal preset.");
		}
		const updates = targets.map(({ trackId, element }) => ({
			trackId,
			elementId: element.id,
			updates: {
				keyframes: buildCaptionRevealKeyframes({
					element,
					presetId,
				}),
			},
		}));
		this.editor.timeline.updateElements({ updates });
		const captionIds = targets.map(({ element }) => element.id);
		this.editor.timeline.clearAnimationSfxPairing({
			targetElementIds: captionIds,
			expectedKind: "caption",
		});
		const soundSyncPresetId = getCaptionRevealSoundSyncPreset({ presetId });
		if (soundSyncPresetId) {
			await this.editor.timeline.applyAnimationSfxPairing({
				pairingId: soundSyncPresetId,
				targetElementIds: captionIds,
			});
		}
	}

	private resolveCurrentSceneElement({
		elementId,
	}: {
		elementId: string;
	}): { trackId: string; element: TimelineElement } | null {
		const trackId = this.editor.timeline.findTrackIdForElement({ elementId });
		if (!trackId) {
			return null;
		}
		const track = this.editor.timeline.getTrackById({ trackId });
		const element = track?.elements.find((candidate) => candidate.id === elementId) ?? null;
		if (!track || !element) {
			return null;
		}
		return { trackId, element };
	}

	private resolveAutoReframeTargets(): Array<{ trackId: string; elementId: string }> {
		const selectedVisuals = this.editor.selection
			.getSelectedElements()
			.flatMap((selection) => {
				const target = this.resolveCurrentSceneElement({
					elementId: selection.elementId,
				});
				if (
					!target ||
					(target.element.type !== "video" && target.element.type !== "image")
				) {
					return [];
				}
				return [{ trackId: target.trackId, elementId: selection.elementId }];
			});
		if (selectedVisuals.length > 0) {
			return selectedVisuals;
		}

		const activeTargets =
			this.editor.project.getActiveOrNull()?.clipforge?.chatMemory?.activeTargets ?? [];
		return activeTargets.flatMap((elementId) => {
			const target = this.resolveCurrentSceneElement({ elementId });
			if (
				!target ||
				(target.element.type !== "video" && target.element.type !== "image")
			) {
				return [];
			}
			return [{ trackId: target.trackId, elementId }];
		});
	}

	private rememberAppliedChatPlan({
		prompt,
		commands,
	}: {
		prompt: string | null;
		commands: ClipForgeEditorCommand[];
	}): void {
		const activeProject = this.editor.project.getActiveOrNull();
		if (!activeProject) {
			return;
		}

		const project = ensureClipForgeProjectData({ project: activeProject });
		const existingMemory = project.clipforge.chatMemory;
		const nextAppliedSummaries = commands.map((command) =>
			buildAppliedCommandSummary({
				command,
				sceneId: project.currentSceneId ?? null,
			}),
		);
		const selectedTargets = this.editor.selection
			.getSelectedElements()
			.map((selection) => selection.elementId);
		const nextActiveTargets =
			selectedTargets.length > 0
				? selectedTargets
				: nextAppliedSummaries.flatMap((summary) => [
						...summary.targetSegmentIds,
						...summary.targetElementIds,
				  ]);

		const nextTurnSummaries =
			prompt && prompt.trim().length > 0
				? [
						...existingMemory.recentTurnSummaries,
						{
							prompt,
							summary: `${prompt.trim()} -> ${summarizeCommands(commands)}`,
							commandKinds: [...new Set(commands.map((command) => command.kind))],
							createdAt: new Date().toISOString(),
						},
				  ]
				: existingMemory.recentTurnSummaries;

		const styleIntent = shouldRefreshStyleIntent({ commands })
			? {
					captionStyleId: project.clipforge.activeCaptionStyleId,
					overlayStyleVariantId:
						project.settings.overlayDefaults?.variantId ??
						existingMemory.styleIntent?.overlayStyleVariantId ??
						null,
					motionPresetId:
						project.settings.overlayDefaults?.motionPresetId ??
						existingMemory.styleIntent?.motionPresetId ??
						null,
					finishingLookId:
						findLatestFinishingLookId({ commands }) ??
						existingMemory.styleIntent?.finishingLookId ??
						null,
					audioPolishPresetId:
						project.settings.audio?.audioPolishPresetId ??
						existingMemory.styleIntent?.audioPolishPresetId ??
						null,
			  }
			: existingMemory.styleIntent;

		const publishIntent = shouldRefreshPublishIntent({ commands })
			? {
					versionTargets:
						project.settings.versionPack?.targets
							.filter((target) => target.enabled)
							.map((target) => target.id) ?? [],
					activeTargetId: project.settings.versionPack?.activeTargetId ?? null,
			  }
			: existingMemory.publishIntent;
		const finishIntent = shouldRefreshFinishIntent({ commands })
			? {
					polishProfileId:
						findLatestPolishProfileId({ commands }) ??
						project.settings.polishProfileId ??
						existingMemory.finishIntent?.polishProfileId ??
						null,
					captionRevealPresetId:
						findLatestCaptionRevealPresetId({ commands }) ??
						existingMemory.finishIntent?.captionRevealPresetId ??
						null,
					includeMusic:
						commands.some(
							(command) =>
								command.kind === "apply-music-track" ||
								command.kind === "replace-music-track",
						)
							? true
							: existingMemory.finishIntent?.includeMusic ?? null,
					includeSfx:
						commands.some((command) => command.kind === "insert-sfx-preset")
							? true
							: existingMemory.finishIntent?.includeSfx ?? null,
					mood:
						findLatestMusicMood({ commands }) ??
						project.settings.libraryDefaults?.musicMood ??
						existingMemory.finishIntent?.mood ??
						null,
			  }
			: existingMemory.finishIntent;
		const destinationIntent = shouldRefreshDestinationIntent({ commands })
			? {
					publishDestination:
						findLatestPublishDestination({ commands }) ??
						existingMemory.destinationIntent?.publishDestination ??
						null,
			  }
			: existingMemory.destinationIntent;
		const recentAssetChoices = [
			...existingMemory.recentAssetChoices,
			...commands
				.map((command) => buildRecentAssetChoice({ command }))
				.filter((choice): choice is ClipForgeRecentAssetChoice => choice !== null),
		].slice(-12);

		const nextMemory: ClipForgeChatMemory = {
			activeTargets:
				nextActiveTargets.length > 0
					? [...new Set(nextActiveTargets)]
					: existingMemory.activeTargets,
			styleIntent,
			publishIntent,
			finishIntent,
			destinationIntent,
			recentTurnSummaries: nextTurnSummaries.slice(-12),
			recentAppliedCommandSummaries: [
				...existingMemory.recentAppliedCommandSummaries,
				...nextAppliedSummaries,
			].slice(-20),
			recentAssetChoices,
		};

		this.editor.project.setActiveProject({
			project: {
				...project,
				metadata: {
					...project.metadata,
					updatedAt: new Date(),
				},
				clipforge: {
					...project.clipforge,
					chatMemory: nextMemory,
				},
			},
		});
		this.editor.save.markDirty();
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

	private getVisualSelectionsForDraft(): Array<{ trackId: string; elementId: string }> {
		return this.editor.timeline
			.getTracks()
			.flatMap((track) =>
				track.elements
					.filter((element) => element.type === "video" || element.type === "image")
					.map((element) => ({
						trackId: track.id,
						elementId: element.id,
						startTime: element.startTime,
					})),
			)
			.sort((a, b) => a.startTime - b.startTime)
			.map(({ trackId, elementId }) => ({ trackId, elementId }));
	}

	private invalidateSceneFootageIntelligence(): void {
		const activeProject = this.editor.project.getActive();
		if (!activeProject) return;
		const project = ensureClipForgeProjectData({ project: activeProject });
		const sceneId = project.currentSceneId;
		if (!(sceneId in project.clipforge.sceneFootageIntelligenceBySceneId)) {
			return;
		}
		this.editor.project.setActiveProject({
			project: {
				...project,
				metadata: {
					...project.metadata,
					updatedAt: new Date(),
				},
				clipforge: {
					...project.clipforge,
					sceneFootageIntelligenceBySceneId: {
						...project.clipforge.sceneFootageIntelligenceBySceneId,
						[sceneId]: null,
					},
				},
			},
		});
		this.editor.save.markDirty();
	}
}

function readStringParam({
	params,
	key,
}: {
	params: Record<string, unknown>;
	key: string;
}): string | null {
	const value = params[key];
	return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function readNumberParam({
	params,
	key,
}: {
	params: Record<string, unknown>;
	key: string;
}): number | null {
	const value = params[key];
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readStringArrayParam({
	params,
	key,
}: {
	params: Record<string, unknown>;
	key: string;
}): string[] {
	const value = params[key];
	return Array.isArray(value)
		? value.filter((candidate): candidate is string => typeof candidate === "string")
		: [];
}

function isProjectVersionTarget(value: string): value is ProjectVersionTarget {
	return value === "9:16" || value === "1:1" || value === "16:9";
}

function buildEmptyPlanSafetySummary({
	blocked,
	message,
}: {
	blocked: boolean;
	message: string;
}): ChatPlanSafetySummary {
	return {
		repairedCount: 0,
		droppedCount: 0,
		blocked,
		notices: blocked
			? [
					{
						code: "blocked_validator_reconcile_failed",
						severity: "error",
						source: "validator",
						message,
					},
			  ]
			: [],
	};
}

function buildCommandValidationError({
	commandIndex,
	code,
	message,
}: {
	commandIndex: number;
	code: string;
	message: string;
}) {
	return {
		opIndex: commandIndex,
		code,
		message,
	};
}

function validateTargetSegments({
	commandIndex,
	targetIds,
	resolveTarget,
}: {
	commandIndex: number;
	targetIds: string[];
	resolveTarget: (segmentId: string) => string | null;
}) {
	if (targetIds.length === 0) {
		return [
			buildCommandValidationError({
				commandIndex,
				code: "missing_command_targets",
				message: "The command requires at least one target.",
			}),
		];
	}

	const errors: Array<{
		opIndex: number;
		code: string;
		message: string;
	}> = [];
	for (const targetId of targetIds) {
		const failureMessage = resolveTarget(targetId);
		if (!failureMessage) continue;
		errors.push(
			buildCommandValidationError({
				commandIndex,
				code: "invalid_command_target",
				message: failureMessage,
			}),
		);
	}
	return errors;
}

function buildAppliedCommandSummary({
	command,
	sceneId,
}: {
	command: ClipForgeEditorCommand;
	sceneId: string | null;
}): ClipForgeAppliedCommandSummary {
	return {
		kind: command.kind,
		summary: summarizeSingleCommand(command),
		targetSegmentIds: extractCommandTargetSegmentIds(command),
		targetElementIds: extractCommandTargetElementIds(command),
		sceneId,
		scope: command.kind === "timeline-op" ? "selection" : command.scope ?? "selection",
		createdAt: new Date().toISOString(),
	};
}

function extractCommandTargetSegmentIds(command: ClipForgeEditorCommand): string[] {
	if (command.kind === "timeline-op") {
		switch (command.op.type) {
			case "TRIM_CLIP":
				return [command.op.clip_id];
			case "MOVE_SEGMENT":
			case "DELETE_SEGMENT":
			case "DUPLICATE_SEGMENT":
			case "FIX_CAPTION_TEXT":
				return [command.op.segment_id];
			case "SWAP_SEGMENTS":
				return [command.op.a_id, command.op.b_id];
			default:
				return [];
		}
	}

	switch (command.kind) {
		case "set-clip-speed":
		case "separate-audio":
		case "set-transition-in":
		case "apply-finishing-look":
		case "apply-effect-preset":
			return command.target_segment_ids;
		case "insert-freeze-frame":
			return [command.target_segment_id];
		default:
			return [];
	}
}

function extractCommandTargetElementIds(command: ClipForgeEditorCommand): string[] {
	switch (command.kind) {
		case "apply-overlay-style":
		case "apply-motion-preset":
		case "apply-sound-sync":
			return command.target_element_ids;
		default:
			return [];
	}
}

function summarizeSingleCommand(command: ClipForgeEditorCommand): string {
	switch (command.kind) {
		case "timeline-op":
			return command.op.type.replaceAll("_", " ").toLowerCase();
		case "set-clip-speed":
			return `Set clip speed to ${Math.round(command.playback_rate * 100)}%.`;
		case "separate-audio":
			return "Separated clip audio.";
		case "insert-freeze-frame":
			return `Inserted a ${Math.round(command.duration_ms)}ms freeze frame.`;
		case "set-transition-in":
			return `Applied ${command.preset} transitions at ${Math.round(command.duration_ms)}ms.`;
		case "apply-finishing-look":
			return `Applied the ${command.preset_id} finishing look.`;
		case "apply-effect-preset":
			return `Applied the ${command.effect_kind} effect.`;
		case "insert-overlay-preset":
			return `Inserted the ${command.preset_id} overlay preset.`;
		case "apply-overlay-style":
			return `Applied the ${command.variant_id} overlay style.`;
		case "apply-motion-preset":
			return `Applied the ${command.motion_preset_id} motion preset.`;
		case "apply-sound-sync":
			return `Applied the ${command.pairing_id} sound sync preset.`;
		case "set-audio-mix":
			return `Updated project audio mix settings (${Object.keys(command.settings).join(", ") || "defaults"}).`;
		case "apply-music-track":
			return `Added bundled music ${command.music_asset_id}.`;
		case "replace-music-track":
			return `Replaced the music bed with ${command.music_asset_id}.`;
		case "insert-sfx-preset":
			return `Inserted SFX ${command.sfx_asset_id}.`;
		case "apply-polish-profile":
			return `Applied polish profile ${command.profile_id}.`;
		case "apply-caption-reveal":
			return `Applied the ${command.preset_id} caption reveal.`;
		case "apply-project-kit":
			return `Applied project kit ${command.kit_id}.`;
		case "set-version-pack":
			return `Updated publish targets to ${command.target_ids.join(", ")}.`;
		case "auto-reframe-selection":
			return `Auto reframed the selection for ${command.target_version_id}.`;
		case "set-publish-destination":
			return `Set the publish destination to ${command.publish_destination}.`;
		case "run-export-preflight-fixes":
			return "Applied safe export preflight fixes.";
	}
}

function summarizeCommands(commands: ClipForgeEditorCommand[]): string {
	if (commands.length === 0) {
		return "Applied an empty plan.";
	}
	if (commands.length === 1) {
		return summarizeSingleCommand(commands[0] as ClipForgeEditorCommand);
	}
	return `${commands.length} AI editing commands applied: ${commands
		.slice(0, 3)
		.map((command) => summarizeSingleCommand(command))
		.join(" ")}`;
}

function shouldRefreshStyleIntent({
	commands,
}: {
	commands: ClipForgeEditorCommand[];
}): boolean {
	return commands.some((command) => {
		if (command.kind === "timeline-op") {
			return command.op.type === "SET_CAPTION_STYLE";
		}
		return (
			command.kind === "apply-finishing-look" ||
			command.kind === "apply-overlay-style" ||
			command.kind === "apply-motion-preset" ||
			command.kind === "set-audio-mix" ||
			command.kind === "apply-polish-profile" ||
			command.kind === "apply-caption-reveal" ||
			command.kind === "apply-project-kit"
		);
	});
}

function findLatestFinishingLookId({
	commands,
}: {
	commands: ClipForgeEditorCommand[];
}) {
	for (let index = commands.length - 1; index >= 0; index -= 1) {
		const command = commands[index];
		if (command?.kind === "apply-finishing-look") {
			return command.preset_id;
		}
	}
	return null;
}

function findLatestPolishProfileId({
	commands,
}: {
	commands: ClipForgeEditorCommand[];
}) {
	for (let index = commands.length - 1; index >= 0; index -= 1) {
		const command = commands[index];
		if (command?.kind === "apply-polish-profile") {
			return command.profile_id;
		}
	}
	return null;
}

function findLatestCaptionRevealPresetId({
	commands,
}: {
	commands: ClipForgeEditorCommand[];
}) {
	for (let index = commands.length - 1; index >= 0; index -= 1) {
		const command = commands[index];
		if (command?.kind === "apply-caption-reveal") {
			return command.preset_id;
		}
	}
	return null;
}

function findLatestPublishDestination({
	commands,
}: {
	commands: ClipForgeEditorCommand[];
}) {
	for (let index = commands.length - 1; index >= 0; index -= 1) {
		const command = commands[index];
		if (command?.kind === "set-publish-destination") {
			return command.publish_destination;
		}
	}
	return null;
}

function findLatestMusicMood({
	commands,
}: {
	commands: ClipForgeEditorCommand[];
}) {
	for (let index = commands.length - 1; index >= 0; index -= 1) {
		const command = commands[index];
		if (
			command?.kind === "apply-music-track" ||
			command?.kind === "replace-music-track"
		) {
			const item = BUNDLED_MUSIC.find((candidate) => candidate.id === command.music_asset_id);
			if (item?.mood) {
				return item.mood;
			}
		}
	}
	return null;
}

function shouldRefreshPublishIntent({
	commands,
}: {
	commands: ClipForgeEditorCommand[];
}): boolean {
	return commands.some(
		(command) =>
			command.kind === "set-version-pack" ||
			command.kind === "auto-reframe-selection" ||
			command.kind === "apply-project-kit",
	);
}

function shouldRefreshFinishIntent({
	commands,
}: {
	commands: ClipForgeEditorCommand[];
}): boolean {
	return commands.some(
		(command) =>
			command.kind === "apply-polish-profile" ||
			command.kind === "apply-caption-reveal" ||
			command.kind === "apply-music-track" ||
			command.kind === "replace-music-track" ||
			command.kind === "insert-sfx-preset",
	);
}

function shouldRefreshDestinationIntent({
	commands,
}: {
	commands: ClipForgeEditorCommand[];
}): boolean {
	return commands.some((command) => command.kind === "set-publish-destination");
}

function buildRecentAssetChoice({
	command,
}: {
	command: ClipForgeEditorCommand;
}): ClipForgeRecentAssetChoice | null {
	switch (command.kind) {
		case "apply-music-track":
		case "replace-music-track": {
			const item = BUNDLED_MUSIC.find((candidate) => candidate.id === command.music_asset_id);
			return item
				? {
						assetId: item.id,
						assetKind: "music",
						label: item.label,
						commandKind: command.kind,
						createdAt: new Date().toISOString(),
				  }
				: null;
		}
		case "insert-sfx-preset": {
			const item = BUNDLED_SFX.find((candidate) => candidate.id === command.sfx_asset_id);
			return item
				? {
						assetId: item.id,
						assetKind: "sfx",
						label: item.label,
						commandKind: command.kind,
						createdAt: new Date().toISOString(),
				  }
				: null;
		}
		case "apply-project-kit":
			return {
				assetId: command.kit_id,
				assetKind: "trend-reference",
				label: command.kit_id,
				commandKind: command.kind,
				createdAt: new Date().toISOString(),
			};
		default:
			return null;
	}
}
