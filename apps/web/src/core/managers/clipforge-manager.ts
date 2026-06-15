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
	buildProjectSummary,
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
	buildReferenceVideoAnalysis,
	buildReferenceShotPlan,
	buildFootageDescriptor,
	buildReferenceCandidateMatches,
	chooseReferenceMusicVolume,
	getReferenceVideoAnalysisStatus,
	inferReferenceCaptionRevealPreset,
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
	buildReferenceGuidedDraft,
	buildReferenceRecreationDraft,
	selectBestMusicTrack,
	selectBestThumbnail,
	analyzeImportedClips,
	planMultiVersionDraft,
	buildPipelineSummary,
	buildCreatorProfileFromDurations,
	DEFAULT_CREATOR_PROFILE,
	extractSpeechSegments,
	scoreSpeechSegments,
	selectBestSegments,
	buildCutOpsFromKeptSegments,
} from "@/lib/clipforge";
import type {
	MusicSelectionResult,
} from "@/lib/clipforge/music-auto-select";
import type {
	ThumbnailRecommendation,
} from "@/lib/clipforge/thumbnail-optimizer";
import type {
	FullPipelineResult,
} from "@/lib/clipforge/multi-version-generator";
import {
	buildCommandPlanImpactPreview,
	buildPlanImpactPreview,
} from "@/lib/clipforge/chat/plan-impact";
import { reconcileValidatorErrors } from "@/lib/clipforge/chat/validator-reconciliation";
import { buildTimelineTranscriptWords } from "@/lib/clipforge/timeline-transcript";
import type { TimelineTranscriptWord } from "@/lib/clipforge/timeline-transcript";
import { ensureBundledAudioAsset } from "@/lib/library/bundled-media";
import { BUNDLED_MUSIC, BUNDLED_SFX } from "@/lib/library/content-packs";
import { extractMediaAssetAudioToFloat32 } from "@/lib/media/audio";
import { buildEditorManagedCloudConfig } from "@/lib/clipforge/production/editor-cloud-transcriber-config";
import { useClipForgeTranscriptionSettingsStore } from "@/stores/clipforge-transcription-settings-store";
import {
	ApplyTimelineDiffOpsCommand,
	AutoEditTikTokDraftCommand,
	BuildReferenceGuidedDraftCommand,
	CaptionProjectSnapshotCommand,
} from "@/lib/commands";
import { buildUploadAudioElement, buildVideoElement } from "@/lib/timeline";
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
	ClipForgeRecentReferenceAssemblyChoice,
	ClipMediaMetadata,
	CaptionSegmentView,
	CreativeBrief,
	DraftImpactSummary,
	DraftRecipe,
	FootageDescriptor,
	FootageIntelligenceReport,
	PolishProfile,
	ReferenceDraftSectionMatch,
	ReferenceVideoAnalysis,
	RetentionShapePlan,
	TrendSoundReference,
	TimelineDiffOp,
	CutRangeOp,
	TimelineDiffOpSource,
	CreatorStyleProfile,
} from "@/types/clipforge";
import type { CaptionLineBreakOptions } from "@/lib/clipforge/caption-generator";
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
	ChatPlannerMode,
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
		const mediaAsset = this.editor.media
			.getAssets()
			.find((asset) => asset.id === mediaId);
		if (!mediaAsset) {
			throw new Error("Media asset not found.");
		}

		const existing =
			this.getMediaMetadata({ mediaId }) ?? buildEmptyMediaMetadata();
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
			const transcriber = resolveClipForgeTranscriber({
				useManagedCloud:
					useClipForgeTranscriptionSettingsStore.getState().useManagedCloud,
				managedCloud: buildEditorManagedCloudConfig({
					getActiveProject: () => this.editor.project.getActive(),
				}),
			});
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

	private hasUsableMediaTranscript({
		metadata,
	}: {
		metadata?: ClipMediaMetadata | null;
	}): boolean {
		return Boolean(
			metadata && (metadata.words.length > 0 || metadata.segments.length > 0),
		);
	}

	private async ensureReferenceRecreationSourceTranscripts({
		sourceAssetIds,
		requireTranscript,
	}: {
		sourceAssetIds: string[];
		requireTranscript: boolean;
	}): Promise<void> {
		if (!requireTranscript) {
			return;
		}

		const failures: string[] = [];
		for (const assetId of sourceAssetIds) {
			const existing = this.getMediaMetadata({ mediaId: assetId });
			if (this.hasUsableMediaTranscript({ metadata: existing })) {
				continue;
			}

			const indexed = await this.indexMediaAsset({ mediaId: assetId });
			if (this.hasUsableMediaTranscript({ metadata: indexed })) {
				continue;
			}

			const asset = this.editor.media
				.getAssets()
				.find((candidate) => candidate.id === assetId);
			const label = asset?.name ?? assetId;
			const reason =
				indexed.transcriptionError ??
				(indexed.transcriptionStatus === "ready"
					? "transcription completed without usable words or segments"
					: `transcription status is ${indexed.transcriptionStatus}`);
			failures.push(`${label}: ${reason}`);
		}

		if (failures.length === 0 || !requireTranscript) {
			return;
		}

		throw new Error(
			`Reference recreation needs a working transcript for the raw source audio before it can generate CapCut-style auto captions. ${failures.join(" | ")}. Configure browser Whisper/managed transcription or import an SRT for the raw source, then run the recreation again.`,
		);
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
		const mediaAsset = this.editor.media
			.getAssets()
			.find((asset) => asset.id === mediaId);
		if (!mediaAsset) {
			throw new Error("Media asset not found.");
		}

		const existing =
			this.getMediaMetadata({ mediaId }) ?? buildEmptyMediaMetadata();
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

	validateCommands({ commands }: { commands: ClipForgeEditorCommand[] }): {
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
						: (validation.errors[0]?.message ?? "Command validation failed."),
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
			validateOps: ({ ops: candidateOps }) =>
				this.validateOps({ ops: candidateOps }),
		});
	}

	previewOpsImpact({ ops }: { ops: TimelineDiffOp[] }): ChatPlanPreviewResult {
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
					totalOps: commands.filter((command) => command.kind === "timeline-op")
						.length,
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
				throw new Error(
					result.errors[0]?.message ?? "Failed to apply timeline ops.",
				);
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

	isDraftBuildIntent({ prompt }: { prompt: string }): boolean {
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

	async buildCreativeBriefWithPlanner({
		prompt,
		context,
		projectSummary,
		plannerMode,
	}: {
		prompt: string;
		context?: ChatPlannerContext;
		projectSummary: ProjectSummary;
		plannerMode: ChatPlannerMode;
	}): Promise<{
		brief: CreativeBrief;
		provider: "heuristic" | "openai";
		fallbackUsed: boolean;
		warnings: string[];
	}> {
		const heuristicBrief = this.buildCreativeBrief({ prompt, context });
		if (plannerMode === "heuristic") {
			return {
				brief: heuristicBrief,
				provider: "heuristic",
				fallbackUsed: false,
				warnings: [],
			};
		}

		try {
			const response = await fetch("/api/clipforge/creative-brief", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					userText: prompt,
					heuristicBrief,
					projectSummary,
					provider: plannerMode === "anthropic" || plannerMode === "openai" ? plannerMode : undefined,
				}),
			});
			const payload = (await response.json().catch(() => null)) as
				| {
						brief?: CreativeBrief;
						warnings?: string[];
				  }
				| {
						error?: string;
						warnings?: string[];
				  }
				| null;

			if (!response.ok) {
				const message =
					payload && "error" in payload && typeof payload.error === "string"
						? payload.error
						: `Creative brief planner failed with status ${response.status}.`;
				throw new Error(message);
			}

			if (!payload || !("brief" in payload) || !payload.brief) {
				throw new Error("Creative brief planner returned an invalid payload.");
			}

			return {
				brief: payload.brief,
				provider: "openai",
				fallbackUsed: false,
				warnings: Array.isArray(payload.warnings)
					? payload.warnings.filter(
							(warning): warning is string => typeof warning === "string",
						)
					: [],
			};
		} catch (error) {
			return {
				brief: heuristicBrief,
				provider: "heuristic",
				fallbackUsed: true,
				warnings: [
					`Creative brief model fallback: ${
						error instanceof Error ? error.message : "Unknown error."
					}`,
				],
			};
		}
	}

	/**
	 * Single-trigger autonomous draft pipeline.
	 * Chains: footage analysis → creative brief → recipe plan → recipe execution.
	 * This is the "AI edits the video for me" entry point.
	 */
	async generateAutoDraft({
		prompt = "make a viral tiktok",
	}: {
		prompt?: string;
	} = {}): Promise<{
		appliedSteps: number;
		skippedSteps: number;
		messages: string[];
		warnings: string[];
	}> {
		const warnings: string[] = [];

		// 1. Auto-transcribe any un-transcribed video/audio clips
		const assets = this.editor.media.getAssets();
		const activeProject = this.editor.project.getActive();
		const metadataById = activeProject.clipforge?.mediaMetadataById ?? {};
		const untranscribed = assets.filter(
			(asset) =>
				(asset.type === "video" || asset.type === "audio") &&
				!asset.ephemeral &&
				(!metadataById[asset.id] ||
					metadataById[asset.id].transcriptionStatus === "idle"),
		);
		if (untranscribed.length > 0) {
			try {
				await this.indexMediaAssets({
					mediaIds: untranscribed.map((asset) => asset.id),
				});
			} catch {
				warnings.push(
					"Some clips could not be auto-transcribed; the draft will use available metadata.",
				);
			}
		}

		// 2. Run footage intelligence analysis
		try {
			await this.analyzeSceneFootageIntelligence();
		} catch {
			warnings.push(
				"Footage intelligence analysis was unavailable; clip ranking falls back to metadata scoring.",
			);
		}

		// 3. Build creative brief from prompt (heuristic — no server call needed)
		const brief = this.buildCreativeBrief({ prompt });

		// 4. Plan the full draft recipe
		const recipe = this.planDraftRecipe({ brief });

		// 5. Execute the recipe
		const result = await this.applyDraftRecipe({ recipe });

		return {
			appliedSteps: result.appliedSteps,
			skippedSteps: result.skippedSteps,
			messages: result.messages,
			warnings: [...warnings, ...recipe.warnings],
		};
	}

	/**
	 * Iterative refinement loop: call the LLM planner up to maxPasses times.
	 * After each pass, the project is re-summarized and the LLM decides
	 * whether more edits are needed. Returns [] on a pass to signal "done".
	 */
	async refineWithLLM({
		prompt,
		maxPasses = 3,
	}: {
		prompt: string;
		maxPasses?: number;
	}): Promise<{
		totalOpsApplied: number;
		passesUsed: number;
		messages: string[];
		warnings: string[];
	}> {
		const messages: string[] = [];
		const warnings: string[] = [];
		let totalOpsApplied = 0;
		let passesUsed = 0;

		for (let pass = 0; pass < maxPasses; pass++) {
			passesUsed = pass + 1;
			const activeProject = this.editor.project.getActive();
			const projectSummary = buildProjectSummary({
				project: activeProject,
				mediaAssets: this.editor.media.getAssets(),
				playheadMs: Math.round(this.editor.playback.getCurrentTime() * 1000),
				selectedSegmentIds: this.editor.selection
					.getSelectedElements()
					.map((s) => s.elementId),
				projectKitTemplates: this.editor.project.getProjectKitTemplates(),
				sceneRecipeTemplates: this.editor.project.getSceneRecipeTemplates(),
			});
			const context = {
				playhead_ms: Math.round(this.editor.playback.getCurrentTime() * 1000),
				selected_segment_ids: this.editor.selection
					.getSelectedElements()
					.map((s) => s.elementId),
				active_scene_id: activeProject.currentSceneId,
			};

			let ops: unknown[];
			try {
				const response = await fetch("/api/clipforge/chat/plan", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						userText: pass === 0 ? prompt : `Continue refining: ${prompt}`,
						projectSummary,
						context,
						refinementPass: pass,
					}),
				});
				if (!response.ok) {
					warnings.push(`Refinement pass ${pass + 1} failed (HTTP ${response.status}).`);
					break;
				}
				const payload = (await response.json()) as {
					ops?: unknown[];
					warnings?: string[];
				};
				ops = Array.isArray(payload.ops) ? payload.ops : [];
				if (Array.isArray(payload.warnings)) {
					for (const w of payload.warnings) {
						if (typeof w === "string") warnings.push(w);
					}
				}
			} catch {
				warnings.push(`Refinement pass ${pass + 1} failed (network error).`);
				break;
			}

			// Empty ops array = LLM says we're done
			if (ops.length === 0) {
				messages.push(
					pass === 0
						? "No changes needed."
						: `Refinement complete after ${pass + 1} passes.`,
				);
				break;
			}

			// Apply the ops
			const result = this.applyOps({
				source: "chat",
				ops: ops as Parameters<typeof this.applyOps>[0]["ops"],
			});
			if (result.applied) {
				totalOpsApplied += ops.length;
				messages.push(
					`Pass ${pass + 1}: applied ${ops.length} operation${ops.length > 1 ? "s" : ""}.`,
				);
			} else {
				warnings.push(
					`Pass ${pass + 1}: ops failed — ${result.errors[0]?.message ?? "unknown error"}.`,
				);
				break;
			}
		}

		return {
			totalOpsApplied,
			passesUsed,
			messages,
			warnings,
		};
	}

	/**
	 * Full autonomous pipeline — Tier 3.
	 *
	 * Chains every subsystem in one call:
	 * 1. Auto-transcribe untranscribed clips
	 * 2. Scene detection & import analysis
	 * 3. Footage intelligence analysis
	 * 4. Creative brief generation
	 * 5. Music auto-selection from bundled library
	 * 6. Draft recipe planning & execution
	 * 7. Multi-version generation (9:16, 1:1, 16:9)
	 * 8. Thumbnail/hook optimization
	 * 9. LLM refinement pass
	 */
	async generateFullPipeline({
		prompt = "make a viral tiktok",
		enableAllFormats = true,
		maxRefinementPasses = 2,
	}: {
		prompt?: string;
		enableAllFormats?: boolean;
		maxRefinementPasses?: number;
	} = {}): Promise<FullPipelineResult> {
		const warnings: string[] = [];
		const messages: string[] = [];
		let sceneAnalysisPerformed = false;

		// --- 1. Auto-transcribe untranscribed clips ---
		const assets = this.editor.media.getAssets();
		const activeProject = this.editor.project.getActive();
		const metadataById = activeProject.clipforge?.mediaMetadataById ?? {};
		const untranscribed = assets.filter(
			(asset) =>
				(asset.type === "video" || asset.type === "audio") &&
				!asset.ephemeral &&
				(!metadataById[asset.id] ||
					metadataById[asset.id].transcriptionStatus === "idle"),
		);
		if (untranscribed.length > 0) {
			try {
				const indexResult = await this.indexMediaAssets({
					mediaIds: untranscribed.map((asset) => asset.id),
				});
				messages.push(
					`Transcribed ${indexResult.completed.length} clip${indexResult.completed.length !== 1 ? "s" : ""}.`,
				);
				if (indexResult.failed.length > 0) {
					warnings.push(
						`${indexResult.failed.length} clip${indexResult.failed.length !== 1 ? "s" : ""} could not be transcribed.`,
					);
				}
			} catch {
				warnings.push(
					"Auto-transcription failed; pipeline continues with available metadata.",
				);
			}
		}

		// --- 2. Scene detection & import analysis ---
		try {
			const videoAssets = this.editor.media
				.getAssets()
				.filter((a) => a.type === "video" && !a.ephemeral);

			// Run visual and gaze analysis on any clips that lack it
			for (const asset of videoAssets) {
				if (!asset.visualAnalysis) {
					try {
						await this.editor.media.analyzeVisualActivity({
							mediaId: asset.id,
						});
					} catch {
						// Individual asset analysis failure is non-fatal
					}
				}
				if (!asset.gazeAnalysis) {
					try {
						await this.editor.media.analyzeGazePatterns({
							mediaId: asset.id,
						});
					} catch {
						// Individual asset gaze analysis failure is non-fatal
					}
				}
			}

			const refreshedAssets = this.editor.media
				.getAssets()
				.filter((a) => a.type === "video" && !a.ephemeral);
			const refreshedProject = this.editor.project.getActive();
			const refreshedMetadata =
				refreshedProject.clipforge?.mediaMetadataById ?? {};

			const importResults = analyzeImportedClips({
				assets: refreshedAssets,
				metadataById: refreshedMetadata,
			});

			// Store import analysis snapshots
			const projectWithData = ensureClipForgeProjectData({
				project: refreshedProject,
			});
			const importAnalysis: Record<string, import("@/types/clipforge").ImportAnalysisSnapshot> = {
				...(projectWithData.clipforge.importAnalysisByAssetId ?? {}),
			};
			for (const result of importResults) {
				importAnalysis[result.assetId] = {
					analyzedAt: new Date().toISOString(),
					sceneCutCount: result.sceneCutCount,
					activityLevel: result.activityLevel,
					contentType: result.contentType,
					hasSpeech: result.hasSpeech,
					segmentCount: result.segments.length,
				};
			}
			this.editor.project.setActiveProject({
				project: {
					...projectWithData,
					metadata: { ...projectWithData.metadata, updatedAt: new Date() },
					clipforge: {
						...projectWithData.clipforge,
						importAnalysisByAssetId: importAnalysis,
					},
				},
			});
			this.editor.save.markDirty();

			const totalCuts = importResults.reduce(
				(sum, r) => sum + r.sceneCutCount,
				0,
			);
			const contentTypes = [
				...new Set(importResults.map((r) => r.contentType).filter((t) => t !== "unknown")),
			];
			messages.push(
				`Scene analysis: ${totalCuts} cut${totalCuts !== 1 ? "s" : ""} across ${importResults.length} clip${importResults.length !== 1 ? "s" : ""}` +
					(contentTypes.length > 0 ? ` (${contentTypes.join(", ")})` : "") +
					".",
			);
			sceneAnalysisPerformed = true;
		} catch {
			warnings.push(
				"Scene import analysis failed; the pipeline continues without it.",
			);
		}

		// --- 3. Footage intelligence analysis ---
		try {
			await this.analyzeSceneFootageIntelligence();
			messages.push("Footage intelligence analysis completed.");
		} catch {
			warnings.push(
				"Footage intelligence was unavailable; clip ranking falls back to metadata.",
			);
		}

		// --- 4. Creative brief ---
		const brief = this.buildCreativeBrief({ prompt });

		// --- 5. Music auto-selection ---
		let musicSelection: MusicSelectionResult | null = null;
		try {
			musicSelection = selectBestMusicTrack({
				musicLibrary: BUNDLED_MUSIC,
				brief,
			});
			if (musicSelection) {
				// Ensure the bundled track is imported as a project asset
				const musicItem = BUNDLED_MUSIC.find(
					(item) => item.id === musicSelection!.track.id,
				);
				if (musicItem) {
					try {
						const musicAsset = await ensureBundledAudioAsset({
							editor: this.editor,
							item: musicItem,
						});
						// Apply the music track to the timeline
						await this.executeDirectCommand({
							command: {
								kind: "apply-music-track",
								music_asset_id: musicAsset.id,
								volume: 0.35,
								loop_to_project_end: true,
							},
						});
						messages.push(
							`Music: auto-selected "${musicSelection.track.label}" (score ${musicSelection.score.toFixed(1)}).`,
						);
					} catch (applyError) {
						warnings.push(
							`Music track "${musicSelection.track.label}" was selected but could not be applied: ${applyError instanceof Error ? applyError.message : "unknown error"}.`,
						);
					}
				}

				// Persist the selection snapshot
				const postMusicProject = ensureClipForgeProjectData({
					project: this.editor.project.getActive(),
				});
				this.editor.project.setActiveProject({
					project: {
						...postMusicProject,
						metadata: { ...postMusicProject.metadata, updatedAt: new Date() },
						clipforge: {
							...postMusicProject.clipforge,
							lastMusicSelection: {
								selectedAt: new Date().toISOString(),
								trackId: musicSelection.track.id,
								trackLabel: musicSelection.track.label,
								score: musicSelection.score,
							},
						},
					},
				});
				this.editor.save.markDirty();
			}
		} catch {
			warnings.push("Music auto-selection failed; no music track was applied.");
		}

		// --- 6. Draft recipe & execution ---
		const recipe = this.planDraftRecipe({ brief });
		const draftResult = await this.applyDraftRecipe({ recipe });
		messages.push(
			`Draft: ${draftResult.appliedSteps} steps applied, ${draftResult.skippedSteps} skipped.`,
		);
		messages.push(...draftResult.messages);
		warnings.push(...recipe.warnings);

		// --- 7. Multi-version generation ---
		let versionsGenerated = 1;
		try {
			const versionPlan = planMultiVersionDraft({
				brief,
				enableAllFormats,
			});

			for (const step of versionPlan.additionalSteps) {
				try {
					// Re-use the existing draft recipe step handlers
					if (step.kind === "apply-version-pack") {
						const targets = (step.params.targets as string[]).filter(
							isProjectVersionTarget,
						);
						if (targets.length > 0) {
							const currentProject = this.editor.project.getActive();
							const currentPack = currentProject.settings.versionPack;
							if (currentPack) {
								await this.editor.project.updateVersionPack({
									versionPack: {
										...currentPack,
										targets: currentPack.targets.map((target) => ({
											...target,
											enabled: targets.includes(target.id),
										})),
										activeTargetId:
											versionPlan.primaryTarget ??
											currentPack.activeTargetId ??
											null,
									},
								});
								versionsGenerated = targets.length;
							}
						}
					} else if (step.kind === "apply-safe-layout") {
						const targetVersionIds = (
							(step.params.targetVersionIds as string[]) ?? []
						).filter(isProjectVersionTarget);
						for (const targetVersionId of targetVersionIds) {
							this.editor.timeline.applySafeLayoutToScene({
								targetVersionId,
							});
						}
					}
				} catch (stepError) {
					warnings.push(
						`Multi-version step ${step.kind} failed: ${stepError instanceof Error ? stepError.message : "unknown"}.`,
					);
				}
			}

			if (versionsGenerated > 1) {
				messages.push(
					`Multi-version: generated ${versionsGenerated} platform formats.`,
				);
			}
			warnings.push(...versionPlan.warnings);
		} catch {
			warnings.push("Multi-version generation failed; only the primary format is available.");
		}

		// --- 8. Thumbnail optimization ---
		let thumbnailRecommendation: ThumbnailRecommendation | null = null;
		try {
			const footageReport = this.getSceneFootageIntelligence();
			if (footageReport) {
				const currentProject = this.editor.project.getActive();
				const totalDuration = currentProject.metadata.duration ?? 0;
				thumbnailRecommendation = selectBestThumbnail({
					footageReport,
					totalDurationS: totalDuration,
				});
				if (thumbnailRecommendation) {
					const thumb = thumbnailRecommendation.primary;
					messages.push(
						`Thumbnail: best frame at ${thumb.timeS.toFixed(1)}s (score ${thumb.score.toFixed(1)}).`,
					);

					// Persist the thumbnail snapshot
					const postThumbProject = ensureClipForgeProjectData({
						project: this.editor.project.getActive(),
					});
					this.editor.project.setActiveProject({
						project: {
							...postThumbProject,
							metadata: { ...postThumbProject.metadata, updatedAt: new Date() },
							clipforge: {
								...postThumbProject.clipforge,
								lastThumbnailRecommendation: {
									generatedAt: new Date().toISOString(),
									primaryTimeS: thumb.timeS,
									primaryElementId: thumb.elementId,
									primaryScore: thumb.score,
									alternativeCount: thumbnailRecommendation.alternatives.length,
								},
							},
						},
					});
					this.editor.save.markDirty();

					warnings.push(...thumbnailRecommendation.warnings);
				}
			}
		} catch {
			warnings.push("Thumbnail optimization failed; no recommendation was generated.");
		}

		// --- 9. Optional LLM refinement ---
		if (maxRefinementPasses > 0) {
			try {
				const refineResult = await this.refineWithLLM({
					prompt: `Polish this draft — tighten pacing, clean silence, ensure captions match the ${brief.tone} tone`,
					maxPasses: maxRefinementPasses,
				});
				if (refineResult.totalOpsApplied > 0) {
					messages.push(
						`Refinement: ${refineResult.totalOpsApplied} ops across ${refineResult.passesUsed} pass${refineResult.passesUsed !== 1 ? "es" : ""}.`,
					);
				} else {
					messages.push("Refinement: edit looks good — no further changes.");
				}
				messages.push(...refineResult.messages);
				warnings.push(...refineResult.warnings);
			} catch {
				warnings.push("LLM refinement failed; the draft is used as-is.");
			}
		}

		const result: FullPipelineResult = {
			draftAppliedSteps: draftResult.appliedSteps,
			draftSkippedSteps: draftResult.skippedSteps,
			versionsGenerated,
			musicSelection,
			thumbnailRecommendation,
			sceneAnalysisPerformed,
			messages,
			warnings,
		};

		messages.push(`Pipeline complete: ${buildPipelineSummary({ result })}`);

		return result;
	}

	/**
	 * Analyze imported clips for scene detection and content type classification.
	 * Meant to be called on import for early metadata enrichment.
	 */
	analyzeImportedAssets(): {
		analyzed: number;
		results: Array<{
			assetId: string;
			sceneCutCount: number;
			contentType: string;
		}>;
	} {
		const assets = this.editor.media
			.getAssets()
			.filter((a) => a.type === "video" && !a.ephemeral);
		const activeProject = this.editor.project.getActive();
		const metadataById = activeProject.clipforge?.mediaMetadataById ?? {};

		const importResults = analyzeImportedClips({
			assets,
			metadataById,
		});

		// Persist
		const projectWithData = ensureClipForgeProjectData({
			project: activeProject,
		});
		const importAnalysis: Record<string, import("@/types/clipforge").ImportAnalysisSnapshot> = {
			...(projectWithData.clipforge.importAnalysisByAssetId ?? {}),
		};
		for (const result of importResults) {
			importAnalysis[result.assetId] = {
				analyzedAt: new Date().toISOString(),
				sceneCutCount: result.sceneCutCount,
				activityLevel: result.activityLevel,
				contentType: result.contentType,
				hasSpeech: result.hasSpeech,
				segmentCount: result.segments.length,
			};
		}
		this.editor.project.setActiveProject({
			project: {
				...projectWithData,
				metadata: { ...projectWithData.metadata, updatedAt: new Date() },
				clipforge: {
					...projectWithData.clipforge,
					importAnalysisByAssetId: importAnalysis,
				},
			},
		});
		this.editor.save.markDirty();

		return {
			analyzed: importResults.length,
			results: importResults.map((r) => ({
				assetId: r.assetId,
				sceneCutCount: r.sceneCutCount,
				contentType: r.contentType,
			})),
		};
	}

	/**
	 * Select the best music track from the bundled library for the current project.
	 */
	selectMusicForBrief({
		brief,
	}: {
		brief: CreativeBrief;
	}): MusicSelectionResult | null {
		return selectBestMusicTrack({
			musicLibrary: BUNDLED_MUSIC,
			brief,
		});
	}

	/**
	 * Generate a thumbnail recommendation from the current footage intelligence.
	 */
	generateThumbnailRecommendation(): ThumbnailRecommendation | null {
		const footageReport = this.getSceneFootageIntelligence();
		if (!footageReport) {
			return null;
		}
		const activeProject = this.editor.project.getActive();
		return selectBestThumbnail({
			footageReport,
			totalDurationS: activeProject.metadata.duration ?? 0,
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

	removeTrendSoundReference({ referenceId }: { referenceId: string }): void {
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
					trendSoundReferences:
						nextProject.clipforge.trendSoundReferences.filter(
							(reference) => reference.id !== referenceId,
						),
				},
			},
		});
		this.editor.save.markDirty();
	}

	getActiveReferenceVideoAssetId(): string | null {
		const activeProject = this.editor.project.getActiveOrNull();
		if (!activeProject) return null;
		return ensureClipForgeProjectData({ project: activeProject }).clipforge
			.activeReferenceVideoAssetId;
	}

	getActiveReferenceAnalysis(): ReferenceVideoAnalysis | null {
		const activeProject = this.editor.project.getActiveOrNull();
		if (!activeProject) return null;
		const project = ensureClipForgeProjectData({ project: activeProject });
		const assetId = project.clipforge.activeReferenceVideoAssetId;
		return assetId
			? (project.clipforge.referenceAnalysisByAssetId[assetId] ?? null)
			: null;
	}

	async setActiveReferenceVideo({
		assetId,
	}: {
		assetId: string;
	}): Promise<ReferenceVideoAnalysis> {
		const activeProject = this.editor.project.getActiveOrNull();
		if (!activeProject) {
			throw new Error("No active project.");
		}
		const asset = this.editor.media
			.getAssets()
			.find((candidate) => candidate.id === assetId);
		if (!asset || asset.type !== "video") {
			throw new Error("Reference video must be an imported video asset.");
		}

		const analysis = await this.analyzeReferenceVideo({ assetId });
		const nextProject = ensureClipForgeProjectData({
			project: this.editor.project.getActive(),
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
					activeReferenceVideoAssetId: assetId,
					chatMemory: {
						...nextProject.clipforge.chatMemory,
						referenceIntent: {
							referenceAssetId: assetId,
							referenceMode: "exact-recreation",
						},
					},
				},
			},
		});
		this.editor.save.markDirty();
		return analysis;
	}

	async setAssemblySourcePool({
		assetIds,
		analyze = true,
	}: {
		assetIds: string[];
		analyze?: boolean;
	}): Promise<void> {
		const activeProject = this.editor.project.getActiveOrNull();
		if (!activeProject) {
			throw new Error("No active project.");
		}
		const project = ensureClipForgeProjectData({ project: activeProject });
		const validVideoAssets = this.editor.media
			.getAssets()
			.filter(
				(asset): asset is MediaAsset & { type: "video" } =>
					asset.type === "video" && !asset.ephemeral,
			)
			.filter((asset) => assetIds.includes(asset.id));

		const nextDescriptors: Record<string, FootageDescriptor> = {
			...project.clipforge.footageDescriptorsByAssetId,
		};
		for (const asset of validVideoAssets) {
			let hydratedAsset: MediaAsset & { type: "video" } = asset;
			if (analyze && !hydratedAsset.visualAnalysis) {
				try {
					const analyzedAsset = await this.editor.media.analyzeVisualActivity({
						mediaId: asset.id,
					});
					if (analyzedAsset?.type === "video") {
						hydratedAsset = analyzedAsset as MediaAsset & { type: "video" };
					}
				} catch {
					// Degrade gracefully for pool setup.
				}
			}
			if (analyze && !hydratedAsset.gazeAnalysis) {
				try {
					const analyzedAsset = await this.editor.media.analyzeGazePatterns({
						mediaId: asset.id,
					});
					if (analyzedAsset?.type === "video") {
						hydratedAsset = analyzedAsset as MediaAsset & { type: "video" };
					}
				} catch {
					// Gaze analysis is optional for source matching.
				}
			}
			if (analyze && !hydratedAsset.beatAnalysis) {
				try {
					const analyzedAsset = await this.editor.media.analyzeBeatGrid({
						mediaId: asset.id,
					});
					if (analyzedAsset?.type === "video") {
						hydratedAsset = analyzedAsset as MediaAsset & { type: "video" };
					}
				} catch {
					// Beat analysis is optional for source matching.
				}
			}
			nextDescriptors[asset.id] = buildFootageDescriptor({
				asset: hydratedAsset,
				metadata: project.clipforge.mediaMetadataById[asset.id] ?? null,
			});
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
					assemblySourceAssetIds: validVideoAssets.map((asset) => asset.id),
					footageDescriptorsByAssetId: nextDescriptors,
				},
			},
		});
		this.editor.save.markDirty();
	}

	clearActiveReferenceVideo(): void {
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
					activeReferenceVideoAssetId: null,
					chatMemory: {
						...project.clipforge.chatMemory,
						referenceIntent: null,
						assemblyIntent: {
							referenceAssetId: null,
							sourceAssetIds:
								project.clipforge.chatMemory.assemblyIntent?.sourceAssetIds ??
								[],
							focusMatchIds: [],
						},
					},
				},
			},
		});
		this.editor.save.markDirty();
	}

	async analyzeReferenceVideo({
		assetId,
	}: {
		assetId?: string | null;
	} = {}): Promise<ReferenceVideoAnalysis> {
		const activeProject = this.editor.project.getActiveOrNull();
		if (!activeProject) {
			throw new Error("No active project.");
		}
		const project = ensureClipForgeProjectData({ project: activeProject });
		const resolvedAssetId =
			assetId ?? project.clipforge.activeReferenceVideoAssetId;
		if (!resolvedAssetId) {
			throw new Error("Choose a reference video first.");
		}

		let asset =
			this.editor.media
				.getAssets()
				.find((candidate) => candidate.id === resolvedAssetId) ?? null;
		if (!asset || asset.type !== "video") {
			const missingAnalysis: ReferenceVideoAnalysis = {
				analyzedAt: new Date().toISOString(),
				status: "missing",
				sectionPlan: [],
				shotPattern: {
					average_shot_ms: null,
					transition_cadence: "medium",
					scene_cut_count: 0,
					activity_intensity: "medium",
				},
				captionProfile: {
					presence: "none",
					reveal_preset_id: null,
					tone: null,
					average_words_per_segment: null,
				},
				audioProfile: {
					music_mood: null,
					recommended_music_asset_id: null,
					recommended_sfx_asset_id: null,
					bpm: null,
					energy: "medium",
				},
				overlayProfile: {
					density: "none",
					variant_id: null,
					motion_preset_id: null,
				},
				finishingProfile: {
					polish_profile_id: null,
					finishing_look_id: null,
				},
				publishProfile: {
					publish_destination: null,
					target_version_id: null,
					packaging_hint: "Reference asset is unavailable.",
					hook_pattern: "unknown",
				},
				warnings: ["Reference asset is missing from the current project."],
			};
			this.persistReferenceAnalysis({
				project,
				assetId: resolvedAssetId,
				analysis: missingAnalysis,
				shotPlan: {
					analyzedAt: missingAnalysis.analyzedAt,
					reference_asset_id: resolvedAssetId,
					hook_pattern: "unknown",
					ending_shape: "open-ended",
					sections: [],
					warnings: ["Reference asset is missing from the current project."],
				},
				makeActive: assetId !== undefined,
			});
			return missingAnalysis;
		}

		if (!asset.visualAnalysis) {
			try {
				asset =
					(await this.editor.media.analyzeVisualActivity({
						mediaId: resolvedAssetId,
					})) ?? asset;
			} catch {
				// Gracefully degrade when visual analysis is unavailable.
			}
		}
		if (!asset.gazeAnalysis) {
			try {
				asset =
					(await this.editor.media.analyzeGazePatterns({
						mediaId: resolvedAssetId,
					})) ?? asset;
			} catch {
				// Gracefully degrade when gaze analysis is unavailable.
			}
		}
		if (!asset.beatAnalysis) {
			try {
				asset =
					(await this.editor.media.analyzeBeatGrid({
						mediaId: resolvedAssetId,
					})) ?? asset;
			} catch {
				// Gracefully degrade when beat analysis is unavailable.
			}
		}

		const refreshedProject = ensureClipForgeProjectData({
			project: this.editor.project.getActive(),
		});
		const metadata =
			refreshedProject.clipforge.mediaMetadataById[resolvedAssetId] ?? null;
		const analysis = buildReferenceVideoAnalysis({
			asset,
			metadata,
		});
		const shotPlan = buildReferenceShotPlan({
			asset,
			analysis,
		});
		this.persistReferenceAnalysis({
			project: refreshedProject,
			assetId: resolvedAssetId,
			analysis,
			shotPlan,
			makeActive: assetId !== undefined,
		});
		return analysis;
	}

	private persistReferenceAnalysis({
		project,
		assetId,
		analysis,
		shotPlan,
		makeActive,
	}: {
		project: TProject & {
			clipforge: import("@/types/clipforge").ClipForgeProjectData;
		};
		assetId: string;
		analysis: ReferenceVideoAnalysis;
		shotPlan: import("@/types/clipforge").ReferenceShotPlan;
		makeActive: boolean;
	}): void {
		this.editor.project.setActiveProject({
			project: {
				...project,
				metadata: {
					...project.metadata,
					updatedAt: new Date(),
				},
				clipforge: {
					...project.clipforge,
					activeReferenceVideoAssetId: makeActive
						? assetId
						: project.clipforge.activeReferenceVideoAssetId,
					referenceAnalysisByAssetId: {
						...project.clipforge.referenceAnalysisByAssetId,
						[assetId]: analysis,
					},
					referenceShotPlanByAssetId: {
						...project.clipforge.referenceShotPlanByAssetId,
						[assetId]: shotPlan,
					},
				},
			},
		});
		this.editor.save.markDirty();
	}

	private getEffectiveAssemblySourceAssetIds({
		project,
	}: {
		project: TProject & {
			clipforge: import("@/types/clipforge").ClipForgeProjectData;
		};
	}): string[] {
		const selected = project.clipforge.assemblySourceAssetIds;
		if (selected.length > 0) {
			return selected;
		}
		const activeReferenceAssetId =
			project.clipforge.activeReferenceVideoAssetId;
		return this.editor.media
			.getAssets()
			.filter(
				(asset): asset is MediaAsset & { type: "video" } =>
					asset.type === "video" &&
					!asset.ephemeral &&
					asset.id !== activeReferenceAssetId,
			)
			.map((asset) => asset.id);
	}

	/**
	 * Run gaze analysis on every non-ephemeral video asset that lacks it.
	 * Idempotent — already-analyzed assets are skipped.
	 * Called automatically for gaze-cut chat commands so the planner always
	 * has gaze data available when needed.
	 */
	async ensureGazeAnalysisForAllVideos(): Promise<void> {
		const videoAssets = this.editor.media
			.getAssets()
			.filter((a) => a.type === "video" && !a.ephemeral && !a.gazeAnalysis);
		for (const asset of videoAssets) {
			try {
				await this.editor.media.analyzeGazePatterns({ mediaId: asset.id });
			} catch {
				// Non-fatal — individual failure does not block others
			}
		}
	}

	/**
	 * Analyze silence (audio activity) for a single media asset using only the
	 * Web Audio API — no transcription required. Stores the silence regions in
	 * the project's clipforge metadata so the planner can generate REMOVE_SILENCE
	 * ops immediately.
	 */
	async analyzeSilenceForMediaAsset({
		mediaId,
	}: {
		mediaId: string;
	}): Promise<void> {
		const asset = this.editor.media
			.getAssets()
			.find((a) => a.id === mediaId);
		if (!asset || (asset.type !== "video" && asset.type !== "audio")) return;

		const { samples, sampleRate } = await extractMediaAssetAudioToFloat32({
			mediaAsset: asset,
		});
		const silenceRegions = detectSilenceRegions({ samples, sampleRate });

		const activeProject = this.editor.project.getActive();
		if (!activeProject) return;
		const projectWithClipForge = ensureClipForgeProjectData({
			project: activeProject,
		});
		const existing =
			projectWithClipForge.clipforge.mediaMetadataById[mediaId] ??
			buildEmptyMediaMetadata();

		this.upsertMediaMetadata({
			mediaId,
			metadata: {
				...existing,
				silenceRegions,
				silenceAnalyzedAt: new Date().toISOString(),
			},
		});
	}

	/**
	 * Ensure silence analysis has run for every video asset that hasn't been
	 * analyzed yet (neither via full indexing nor standalone silence analysis).
	 */
	async ensureSilenceAnalysisForAllVideos(): Promise<void> {
		const activeProject = this.editor.project.getActive();
		if (!activeProject) return;
		const cfData = activeProject.clipforge;

		const videoAssets = this.editor.media
			.getAssets()
			.filter((a) => (a.type === "video" || a.type === "audio") && !a.ephemeral);

		for (const asset of videoAssets) {
			const meta = cfData?.mediaMetadataById[asset.id];
			// Already analyzed if indexedAt (full index) OR silenceAnalyzedAt (audio-only) is set
			if (meta?.indexedAt ?? meta?.silenceAnalyzedAt) continue;
			try {
				await this.analyzeSilenceForMediaAsset({ mediaId: asset.id });
			} catch {
				// Non-fatal
			}
		}
	}

	/**
	 * Learn a creator style profile from a pair of durations (raw vs finished).
	 * Saves the profile onto the active project for use by future auto-produce runs.
	 */
	async learnCreatorProfileFromDurations({
		rawDurationS,
		finishedDurationS,
		assetName,
	}: {
		rawDurationS: number;
		finishedDurationS: number;
		assetName: string | null;
	}): Promise<CreatorStyleProfile> {
		const profile = buildCreatorProfileFromDurations({
			rawDurationS,
			finishedDurationS,
			assetName,
		});
		const activeProject = this.editor.project.getActive();
		if (!activeProject) throw new Error("No active project.");
		const projectWithClipForge = ensureClipForgeProjectData({ project: activeProject });
		this.editor.project.setActiveProject({
			project: {
				...projectWithClipForge,
				metadata: {
					...projectWithClipForge.metadata,
					updatedAt: new Date(),
				},
				clipforge: {
					...projectWithClipForge.clipforge,
					creatorProfile: profile,
				},
			},
		});
		this.editor.save.markDirty();
		return profile;
	}

	/**
	 * One-command auto-produce pipeline.
	 *
	 * Sequential steps (mirrors CapCut creator workflow):
	 *
	 * 1. Places the raw video on the main video track (if not already there).
	 * 2. Runs silence analysis (waveform energy).
	 * 3. Ensures transcript — triggers indexing (Whisper) if not ready, waits.
	 * 4. Phase 1 cuts: removes every silence gap above threshold (direct CUT_RANGE).
	 * 5. Phase 2 cuts: detects repeated / mistake takes via transcript similarity → cuts earlier take.
	 * 6. Generates word-by-word captions on the POST-CUT timeline (timestamps auto-remap).
	 * 7. Adds a title overlay (full post-cut duration).
	 * 8. Adds the background music track (last — keeps speech track clean for indexing).
	 */
	async executeAutoProducePipeline({
		rawVideoAssetId,
		musicAssetId,
		targetKeepRatio: keepRatioOverride,
	}: {
		rawVideoAssetId: string | null;
		musicAssetId: string | null;
		targetKeepRatio: number | null;
	}): Promise<{ appliedOps: number; summary: string }> {
		const activeProject = this.editor.project.getActive();
		if (!activeProject) throw new Error("No active project.");

		// --- Resolve profile ---
		const cfData = ensureClipForgeProjectData({ project: activeProject }).clipforge;
		const profile: typeof DEFAULT_CREATOR_PROFILE & Partial<CreatorStyleProfile> =
			cfData.creatorProfile ?? DEFAULT_CREATOR_PROFILE;
		const targetKeepRatio = keepRatioOverride ?? profile.targetKeepRatio;

		// --- Resolve raw video asset ---
		const allAssets = this.editor.media.getAssets();
		const rawAsset =
			(rawVideoAssetId
				? allAssets.find((a) => a.id === rawVideoAssetId)
				: allAssets.find((a) => a.type === "video" && !a.ephemeral)) ?? null;
		if (!rawAsset || rawAsset.type !== "video") {
			throw new Error(
				"No raw video asset found. Import a video first before running auto-produce.",
			);
		}

		// --- Auto-detect portrait video and set canvas to 9:16 ---
		{
			const assetW = (rawAsset as { width?: number }).width ?? null;
			const assetH = (rawAsset as { height?: number }).height ?? null;
			if (assetW && assetH && assetH > assetW) {
				const currentCanvas = activeProject.settings?.canvasSize;
				if (!currentCanvas || currentCanvas.width > currentCanvas.height) {
					this.applyOps({
						ops: [{ type: "SET_ASPECT_RATIO", preset: "9:16" }],
						source: "auto-edit",
					});
				}
			}
		}

		// --- Place raw clip on main video track if timeline is empty ---
		const existingVideoElements = this.editor.timeline
			.getTracks()
			.filter((t) => t.type === "video")
			.flatMap((t) => t.elements.filter((e) => e.type === "video"));
		if (existingVideoElements.length === 0) {
			// Use asset duration if available; the timeline engine will
			// update it automatically when the media loads in the browser.
			const rawDuration =
				typeof rawAsset.duration === "number" && rawAsset.duration > 0
					? rawAsset.duration
					: 300; // 5-minute placeholder — will be corrected by media load
			const element = buildVideoElement({
				mediaId: rawAsset.id,
				name: rawAsset.name,
				duration: rawDuration,
				startTime: 0,
			});
			this.editor.timeline.insertElement({
				placement: { mode: "auto", trackType: "video" },
				element,
			});
		}

		// --- Ensure silence analysis ---
		await this.ensureSilenceAnalysisForAllVideos();

		// --- Ensure transcript (trigger Whisper indexing if not ready) ---
		// Must run BEFORE scoring so segment quality benefits from word-level data,
		// and BEFORE cuts so caption timestamps are valid against the original video.
		//
		// The chat panel already fires indexMediaAssets() as fire-and-forget when a
		// message is submitted.  If that worker is already in progress we WAIT for it
		// rather than spawning a duplicate.  Hard wall: 120 s.
		{
			const TRANSCRIPT_TIMEOUT_MS = 120_000;
			const POLL_INTERVAL_MS = 2_000;

			const preMeta = this.getMediaMetadata({ mediaId: rawAsset.id });
			if (!this.hasUsableMediaTranscript({ metadata: preMeta })) {
				try {
					if (preMeta?.transcriptionStatus === "processing") {
						// Another indexing job is already running (chat auto-index).
						// Poll until it finishes or we time out.
						const deadline = Date.now() + TRANSCRIPT_TIMEOUT_MS;
						while (Date.now() < deadline) {
							await new Promise<void>((r) =>
								setTimeout(r, POLL_INTERVAL_MS),
							);
							const fresh = this.getMediaMetadata({ mediaId: rawAsset.id });
							if (this.hasUsableMediaTranscript({ metadata: fresh })) break;
							if (fresh?.transcriptionStatus !== "processing") break;
						}
					} else {
						// Nothing running yet — start indexing and race with timeout.
						const timeout = new Promise<void>((resolve) =>
							setTimeout(resolve, TRANSCRIPT_TIMEOUT_MS),
						);
						await Promise.race([
							this.indexMediaAsset({ mediaId: rawAsset.id }),
							timeout,
						]);
					}
				} catch {
					// Non-fatal: transcription unavailable (no provider configured,
					// network error, or model not loaded).  Pipeline continues without
					// captions — the word list stays empty and the caption block is a no-op.
				}
			}
		}

		// --- Collect silence regions + transcript words for this asset ---
		// Re-read metadata AFTER both silence analysis and transcript indexing.
		const refreshedProject = this.editor.project.getActive();
		if (!refreshedProject) throw new Error("Project disappeared.");
		const refreshedCfData = ensureClipForgeProjectData({
			project: refreshedProject,
		}).clipforge;
		const meta = refreshedCfData.mediaMetadataById[rawAsset.id];
		const silenceRegions = meta?.silenceRegions ?? [];
		const transcriptWords = meta?.words ?? [];
		const gazeAnalysis = rawAsset.gazeAnalysis ?? null;
		const gazeWindows = (gazeAnalysis?.windows ?? []).map((w) => ({
			startMs: Math.round(w.startTime * 1000),
			endMs: Math.round(w.endTime * 1000),
			score: w.gazeScore,
		}));

		// Prefer the asset's known duration; fall back to current timeline duration
		// (covers the case where the asset duration wasn't populated at pipeline start).
		const assetDurationS =
			typeof rawAsset.duration === "number" && rawAsset.duration > 0
				? rawAsset.duration
				: this.editor.timeline.getTotalDuration();
		const rawDurationMs = Math.round(assetDurationS * 1000);

		// ──────────────────────────────────────────────────────────────────
		// Phase 1  — Cut silence gaps + repeated/mistake takes  (CapCut steps 2-5)
		// Silence removal AND repeat/restart/flub removal are both computed in
		// RAW transcript coordinates and applied together as one merged batch.
		// Running the repeat detector on the raw transcript (not the
		// silence-fragmented timeline) keeps sentence boundaries intact, so the
		// cuts land cleanly and never leave word stubs.  Mirrors the user's
		// workflow: look at the waveform → split at silence/repeats → delete.
		// ──────────────────────────────────────────────────────────────────
		let appliedOps = 0;
		{
			const rawCutRanges: { start_ms: number; end_ms: number }[] = [];

			// Silence regions → cut ranges (keep padMs of breath on each side).
			if (silenceRegions.length > 0 && rawDurationMs > 0) {
				const padMs = profile.silencePadMs ?? 150;
				const minSilenceMs = padMs * 2 + 100;
				for (const region of silenceRegions) {
					const silenceDuration = region.end_ms - region.start_ms;
					if (silenceDuration < minSilenceMs) continue;
					const cutStart = region.start_ms + padMs;
					const cutEnd = region.end_ms - padMs;
					if (cutEnd <= cutStart) continue;
					rawCutRanges.push({ start_ms: cutStart, end_ms: cutEnd });
				}
			}

			// Repeated / restarted / flubbed sentences → cut ranges (UNBUDGETED:
			// a mistake is always cut).  AI primary, heuristic fallback.
			if (transcriptWords.length >= 6) {
				let aiRepeatCuts: { start_ms: number; end_ms: number }[] | null = null;
				try {
					const resp = await fetch("/api/clipforge/detect-repeats", {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({
							words: transcriptWords.map((w) => ({
								text: w.text,
								start_ms: w.start_ms,
								end_ms: w.end_ms,
							})),
						}),
					});
					if (resp.ok) {
						const data = (await resp.json()) as {
							cuts?: { start_ms: number; end_ms: number }[];
						};
						aiRepeatCuts = data.cuts ?? [];
					}
				} catch {
					aiRepeatCuts = null;
				}
				const repeatRanges =
					aiRepeatCuts ??
					detectRepeatTakeCuts({
						words: transcriptWords.map((w) => ({
							text: w.text,
							start_ms: w.start_ms,
							end_ms: w.end_ms,
							segment_id: "",
						})),
						minSimilarity: 0.35,
						minUtteranceWords: 3,
					}).flatMap((op) =>
						op.type === "CUT_RANGE"
							? [{ start_ms: op.start_ms, end_ms: op.end_ms }]
							: [],
					);
				for (const c of repeatRanges) rawCutRanges.push(c);
			}

			// Merge overlapping/adjacent ranges, then apply as one batch.  The
			// op engine applies CUT_RANGE from the end first, so a merged raw
			// set stays valid.
			rawCutRanges.sort((a, b) => a.start_ms - b.start_ms);
			const mergedCuts: { start_ms: number; end_ms: number }[] = [];
			for (const r of rawCutRanges) {
				const last = mergedCuts[mergedCuts.length - 1];
				if (last && r.start_ms <= last.end_ms + 50) {
					last.end_ms = Math.max(last.end_ms, r.end_ms);
				} else {
					mergedCuts.push({ ...r });
				}
			}
			const cutOps: import("@/types/clipforge").TimelineDiffOp[] = mergedCuts.map(
				(r) => ({ type: "CUT_RANGE" as const, start_ms: r.start_ms, end_ms: r.end_ms }),
			);
			if (cutOps.length > 0) {
				const result = this.applyOps({ ops: cutOps, source: "auto-edit" });
				if (result.applied) appliedOps += result.ops.length;
			}
		}

		// ──────────────────────────────────────────────────────────────────
		// Phase 2  — Word-level stutter removal ("only only", "that that").
		// Repeats/restarts are handled in Phase 1; this catches single-word
		// duplications on the post-cut timeline.
		// ──────────────────────────────────────────────────────────────────
		{
			const p = this.editor.project.getActive();
			if (p) {
				const words = buildTimelineTranscriptWords({ project: p });
				const stutterCuts = detectWordStutterCuts({ words });
				if (stutterCuts.length > 0) {
					const result = this.applyOps({
						ops: stutterCuts,
						source: "auto-edit",
					});
					if (result.applied) appliedOps += result.ops.length;
				}
			}
		}

		// ──────────────────────────────────────────────────────────────────
		// Phase 3  — AI editorial pass  (close remaining duration gap)
		// Deterministic cuts (silence + repeats/stutters) get us ~65-70%
		// of raw. The remaining gap to target requires editorial judgment:
		// which segments are redundant, verbose, or weak. LLM decides.
		// Runs up to 2 passes — first pass does bulk, second pass
		// tightens if still over.
		// ──────────────────────────────────────────────────────────────────
		{
			// Target: use profile ratio against RAW duration.
			// Reference: 255s raw → 72s final ≈ 0.28 keep ratio.
			// Default to 0.30 (slightly generous) if no override.
			// Phase 2b — re-transcribe the post-cut audio to catch repeats the
			// first Whisper pass collapsed (it bundles pauses into word durations
			// and drops repeated/restarted lines, hiding them from the
			// transcript-remap detector).  Re-transcribing the shorter post-cut
			// audio exposes them.  Non-fatal enhancement.
			try {
				appliedOps += await this.detectRepeatsByRetranscription({ rawAsset });
			} catch {
				/* re-transcription unavailable (no CLI/cloud transcriber) — skip */
			}

			const editorialTargetMs = Math.round(
				rawDurationMs * (targetKeepRatio > 0 ? targetKeepRatio : 0.30),
			);
			const MAX_EDITORIAL_PASSES = 2;

			for (let editPass = 0; editPass < MAX_EDITORIAL_PASSES; editPass++) {
				const passProject = this.editor.project.getActive();
				if (!passProject) break;

				const currentDurationMs = Math.round(
					this.editor.timeline.getTotalDuration() * 1000,
				);

				// Stop once we're within ~3% of target (or under a 2s overshoot).
				// Tight threshold so the edit still tightens to the reference
				// length after repeat removal, instead of settling several
				// seconds long.
				const overageRatio = currentDurationMs / editorialTargetMs;
				if (overageRatio <= 1.03 || currentDurationMs <= editorialTargetMs + 2000) {
					break;
				}

				const editorialWords = buildTimelineTranscriptWords({
					project: passProject,
				});

				// Build utterances from words: group by 300ms gaps
				const utterances = buildUtterancesFromWords(editorialWords);

				if (utterances.length <= 2) break;

				try {
					const editorialResp = await fetch("/api/clipforge/editorial-cut", {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({
							utterances,
							currentDurationMs,
							targetDurationMs: editorialTargetMs,
						}),
					});

					if (!editorialResp.ok) break;

					const editorialData = (await editorialResp.json()) as {
						cuts: { start_ms: number; end_ms: number; reason: string }[];
						warnings: string[];
					};

					if (editorialData.cuts.length === 0) break; // LLM found nothing to cut

					// Budget cap — the LLM picks WHICH segments are weak (quality);
					// we pick HOW MANY to apply so the edit lands near the target
					// instead of overshooting.  The LLM is told to cut ~Xs but does
					// not count precisely, so without this it removes too much and
					// the video ends up shorter than the reference.
					const neededMs = currentDurationMs - editorialTargetMs;
					const budgetedCuts = selectCutsWithinBudget({
						cuts: editorialData.cuts,
						neededMs,
					});
					if (budgetedCuts.length === 0) break;

					const editorialOps: import("@/types/clipforge").TimelineDiffOp[] =
						budgetedCuts.map((c) => ({
							type: "CUT_RANGE" as const,
							start_ms: c.start_ms,
							end_ms: c.end_ms,
						}));
					const result = this.applyOps({
						ops: editorialOps,
						source: "auto-edit",
					});
					if (result.applied) appliedOps += result.ops.length;

					// If LLM returned cuts but nothing was applied, stop looping
					if (!result.applied) break;
				} catch {
					// Non-fatal — editorial pass is enhancement, not critical path.
					break;
				}
			}
		}

		// --- Captions (word-by-word, after all cuts + fresh transcript) ---
		// Transcript was ensured above; if still empty the catch swallows the error.
		const captionStyleId = profile.captionStyleId ?? "word-by-word";
		// Word-by-word styles get tight chunking (2 words max); others use standard defaults.
		const isWordByWord =
			captionStyleId === "word-by-word" ||
			captionStyleId === "punchy-center" ||
			captionStyleId === "social-pop";
		const captionOptions: CaptionLineBreakOptions | undefined = isWordByWord
			? { maxWordsPerChunk: 1, maxCharsPerLine: 30, maxLines: 1, minDisplaySeconds: 0.25 }
			: undefined;
		let captionsGenerated = 0;
		try {
			const { generated } = this.generateSceneCaptions({
				template: captionStyleId,
				overwriteExisting: false,
				options: captionOptions,
			});
			captionsGenerated = generated;
			if (generated > 0) appliedOps += 1;
		} catch {
			// Non-fatal — transcript unavailable or captions already exist
		}

		// --- Title overlay (full project duration) ---
		if (profile.titleEnabled !== false) {
			const postCutDurationMs = Math.round(
				this.editor.timeline.getTotalDuration() * 1000,
			);
			const titleDurationMs = postCutDurationMs > 0 ? postCutDurationMs : 5000;
			// Reference shows title above speaker head — use "center" (slightly above mid).
			const titlePosition: "top" | "bottom" | "center" =
				(profile.titlePosition as "top" | "bottom" | "center") ?? "center";
			// Title generation. The reference video shows a content hook the
			// creator typed manually ("Always Operate from Abundance"), which a
			// filename alone can't produce.  So: AI hook from the transcript
			// (primary) → cleaned asset name (fallback) → "Untitled".
			const codecPatterns = /\b(h264|h265|hevc|avc|aac|mp4|mov|mkv|webm|avi|raw)\b/gi;
			const assetNameTitle = (() => {
				const cleaned = rawAsset.name
					.replace(/\.[^.]+$/, "")       // strip extension
					.replace(/[-_]/g, " ")          // separators → spaces
					.replace(codecPatterns, "")      // strip codec/container names
					.replace(/\s+/g, " ")
					.trim();
				if (cleaned.length >= 3) {
					return cleaned
						.split(" ")
						.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
						.join(" ")
						.slice(0, 50);
				}
				return "";
			})();

			let titleText = assetNameTitle || "Untitled";

			// AI title hook from the transcript — captures the message the way a
			// creator would title it, instead of echoing the filename.
			if (transcriptWords.length > 0) {
				try {
					const transcriptText = transcriptWords
						.map((w) => w.text.trim())
						.join(" ")
						.trim();
					if (transcriptText.length >= 10) {
						const titleResp = await fetch("/api/clipforge/generate-title", {
							method: "POST",
							headers: { "Content-Type": "application/json" },
							body: JSON.stringify({ transcript: transcriptText }),
						});
						if (titleResp.ok) {
							const titleData = (await titleResp.json()) as {
								title?: string;
								warnings?: string[];
							};
							if (titleData.title && titleData.title.trim().length >= 3) {
								titleText = titleData.title.trim();
							}
						}
					}
				} catch {
					// Non-fatal — fall back to the asset-name title.
				}
			}
			// Wrap long titles onto two balanced lines (reference style); short
			// titles stay one line.  Keeps the title off the canvas edges.
			const wrappedTitleText = balanceTitleLines(titleText);
			// Size in intended output pixels — op engine converts to internal units.
			// Reference title is ~56px on 1920 canvas (wraps multi-word titles to 2 lines).
			const titleResult = this.applyOps({
				ops: [
					{
						type: "ADD_TEXT_OVERLAY",
						text: wrappedTitleText,
						start_ms: 0,
						end_ms: titleDurationMs,
						position: titlePosition,
						style_id: "bold-center",
						font: "Montserrat",
						size: 56,
						color: "#FFFFFF",
						outline: true,
						background: false,
					},
				],
				source: "auto-edit",
			});
			if (titleResult.applied) appliedOps += titleResult.ops.length;
		}

		// --- Background music ---
		const musicAsset = musicAssetId
			? allAssets.find((a) => a.id === musicAssetId && a.type === "audio")
			: allAssets.find((a) => a.type === "audio" && !a.ephemeral) ?? null;
		if (musicAsset) {
			const volume = profile.musicVolumeRatio ?? 0.30;
			const loop = profile.musicLoop !== false;
			await this.insertImportedMusicTrack({
				asset: musicAsset,
				startMs: 0,
				volume,
				loopToProjectEnd: loop,
				replaceExisting: true,
			});
			appliedOps += 1;
		}

		const finalDurationMs = Math.round(
			this.editor.timeline.getTotalDuration() * 1000,
		);
		const summary = [
			`Auto-produced from raw video "${rawAsset.name}"`,
			`target keep: ${Math.round(targetKeepRatio * 100)}%`,
			`${Math.round(rawDurationMs / 1000)}s raw → ${Math.round(finalDurationMs / 1000)}s final`,
			`silence regions: ${silenceRegions.length}`,
			transcriptWords.length > 0
				? `captions: ${captionsGenerated} segments`
				: "captions: skipped (no transcript)",
			musicAsset ? `music: "${musicAsset.name}"` : "no music",
		].join(", ");

		return { appliedOps, summary };
	}

	/**
	 * Re-transcribe the POST-CUT audio and cut any repeats the first Whisper
	 * pass collapsed.  The original transcript bundles pauses into word
	 * durations and drops repeated/restarted lines, so those repeats never reach
	 * the transcript-remap repeat detector.  Re-transcribing the shorter post-cut
	 * audio (assembled from the current video clips) exposes them, then the
	 * existing /detect-repeats route flags the redundant takes.
	 *
	 * Returns the number of cut ops applied (0 if nothing to do / unavailable).
	 */
	private async detectRepeatsByRetranscription({
		rawAsset,
	}: {
		rawAsset: MediaAsset;
	}): Promise<number> {
		const project = this.editor.project.getActive();
		if (!project) return 0;

		// Kept raw ranges = each video clip's [trimStart, trimStart+duration],
		// in timeline order.  Concatenated, these ARE the post-cut timeline audio.
		const videoEls = this.editor.timeline
			.getTracks()
			.filter((t) => t.type === "video")
			.flatMap((t) => t.elements.filter((e) => e.type === "video"))
			.slice()
			.sort((a, b) => a.startTime - b.startTime);
		if (videoEls.length === 0) return 0;

		const { samples, sampleRate } = await extractMediaAssetAudioToFloat32({
			mediaAsset: rawAsset,
		});
		if (!samples || samples.length === 0) return 0;

		const parts: Float32Array[] = [];
		for (const el of videoEls) {
			const meta = el as { trimStart?: number; duration?: number };
			const startS = meta.trimStart ?? 0;
			const durS = meta.duration ?? 0;
			const s = Math.max(0, Math.floor(startS * sampleRate));
			const e = Math.min(samples.length, Math.floor((startS + durS) * sampleRate));
			if (e > s) parts.push(samples.subarray(s, e));
		}
		const totalLen = parts.reduce((n, p) => n + p.length, 0);
		if (totalLen < sampleRate * 2) return 0; // < 2s, skip

		const post = new Float32Array(totalLen);
		let off = 0;
		for (const p of parts) {
			post.set(p, off);
			off += p.length;
		}

		// Re-transcribe via the CLI route (reveals the collapsed repeats).
		const wav = encodeWavPcm16({ samples: post, sampleRate });
		const file = new File([wav], "postcut.wav", { type: "audio/wav" });
		const fd = new FormData();
		fd.set("file", file);
		fd.set("language", "en");
		const txResp = await fetch("/api/clipforge/transcribe", {
			method: "POST",
			body: fd,
		});
		if (!txResp.ok) return 0;
		const tx = (await txResp.json()) as {
			words?: { text: string; start_ms: number; end_ms: number }[];
		};
		const words = tx.words ?? [];
		if (words.length < 6) return 0;

		// Detect repeats on the FRESH post-cut transcript.
		const rrResp = await fetch("/api/clipforge/detect-repeats", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				words: words.map((w) => ({
					text: w.text,
					start_ms: w.start_ms,
					end_ms: w.end_ms,
				})),
			}),
		});
		if (!rrResp.ok) return 0;
		const rr = (await rrResp.json()) as {
			cuts?: { start_ms: number; end_ms: number }[];
		};
		const cuts = rr.cuts ?? [];
		if (cuts.length === 0) return 0;

		// Post-cut audio == current timeline audio, so cut times map directly.
		const ops: import("@/types/clipforge").TimelineDiffOp[] = cuts.map((c) => ({
			type: "CUT_RANGE" as const,
			start_ms: c.start_ms,
			end_ms: c.end_ms,
		}));
		const result = this.applyOps({ ops, source: "auto-edit" });
		return result.applied ? result.ops.length : 0;
	}

	async analyzeSceneFootageIntelligence(): Promise<FootageIntelligenceReport> {
		const activeProject = this.editor.project.getActive();
		if (!activeProject) {
			throw new Error("No active project.");
		}
		const nextProject = ensureClipForgeProjectData({ project: activeProject });
		const activeScene =
			nextProject.scenes.find(
				(scene) => scene.id === nextProject.currentSceneId,
			) ??
			nextProject.scenes[0] ??
			null;
		if (!activeScene) {
			throw new Error("No active scene.");
		}

		const sceneVideoMediaIds = activeScene.tracks
			.filter((track) => track.type === "video")
			.flatMap((track) =>
				track.elements
					.filter(
						(
							element,
						): element is Extract<
							(typeof track.elements)[number],
							{ type: "video" }
						> => element.type === "video",
					)
					.map((element) => element.mediaId),
			);
		for (const mediaId of [...new Set(sceneVideoMediaIds)]) {
			const asset = this.editor.media
				.getAssets()
				.find((candidate) => candidate.id === mediaId);
			if (asset?.type === "video" && !asset.visualAnalysis) {
				await this.editor.media.analyzeVisualActivity({ mediaId });
			}
			if (asset?.type === "video" && !asset.gazeAnalysis) {
				try {
					await this.editor.media.analyzeGazePatterns({ mediaId });
				} catch {
					// Non-fatal
				}
			}
		}

		const beatState = this.editor.audio.getSceneBeatMarkers();
		const report = buildSceneFootageIntelligenceReport({
			project: {
				...nextProject,
				clipforge: ensureClipForgeProjectData({ project: nextProject })
					.clipforge,
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
		return (
			project.clipforge.sceneFootageIntelligenceBySceneId[
				project.currentSceneId
			] ?? null
		);
	}

	planDraftRecipe({ brief }: { brief: CreativeBrief }): DraftRecipe {
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

	previewDraftRecipe({ recipe }: { recipe: DraftRecipe }): DraftImpactSummary {
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
			activeProject?.settings.versionPack?.targets.find(
				(target) => target.enabled,
			)?.id ??
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
			activeProject?.settings.versionPack?.targets.find(
				(target) => target.enabled,
			)?.id ??
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

	async applyRetentionShape({ plan }: { plan: RetentionShapePlan }): Promise<{
		appliedSteps: number;
		skippedSteps: number;
		messages: string[];
	}> {
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
							throw new Error(
								"No keep/cut recommendations were attached to this step.",
							);
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
						messages.push(
							"Delayed slower context until after the opener lands.",
						);
						break;
					}
					case "insert-payoff": {
						appliedSteps += 1;
						messages.push(
							"Reserved a later payoff beat for overlays and caption emphasis.",
						);
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

	async applyDraftRecipe({ recipe }: { recipe: DraftRecipe }): Promise<{
		appliedSteps: number;
		skippedSteps: number;
		messages: string[];
	}> {
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
						const kitId = readStringParam({
							params: step.params,
							key: "kitId",
						});
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
						if (
							!recipe.retentionShape &&
							(recipe.keepCutRecommendationIds?.length ?? 0) > 0
						) {
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
									messages.push(
										`Applied ${keepCutResult.applied} keep/cut recommendations.`,
									);
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
							throw new Error(
								result.errors[0]?.message ?? "MAKE_VERSION failed.",
							);
						}
						appliedSteps += 1;
						messages.push(`Tightened draft to ${durationTargetS}s.`);
						break;
					}
					case "generate-captions": {
						if (this.getSceneCaptions().length > 0) {
							skippedSteps += 1;
							messages.push(
								"Skipped caption generation because scene captions already exist.",
							);
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
							messages.push(
								"Skipped auto montage because no beat source is active.",
							);
							break;
						}
						const visuals = this.getVisualSelectionsForDraft();
						if (visuals.length === 0) {
							skippedSteps += 1;
							messages.push(
								"Skipped auto montage because no visual clips are available.",
							);
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
								readNumberParam({ params: step.params, key: "beatDivision" }) ??
								2,
						});
						appliedSteps += 1;
						messages.push("Applied beat-paced auto montage.");
						break;
					}
					case "insert-overlay": {
						this.editor.timeline.insertSocialOverlayPreset({
							presetId:
								(readStringParam({
									params: step.params,
									key: "presetId",
								}) as Parameters<
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
								readNumberParam({ params: step.params, key: "startTime" }) ??
								0.3,
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
							messages.push(
								"Skipped version pack update because no targets were requested.",
							);
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
							messages.push(
								"Skipped safe layout because no target versions were queued.",
							);
							break;
						}
						for (const targetVersionId of targetVersionIds) {
							this.editor.timeline.applySafeLayoutToScene({ targetVersionId });
						}
						appliedSteps += 1;
						messages.push(
							`Applied safe layout for ${targetVersionIds.join(", ")}.`,
						);
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

	applyHookCandidate({ candidateId }: { candidateId: string }): void {
		const report = this.getSceneFootageIntelligence();
		const candidate =
			report?.hookCandidates.find((item) => item.id === candidateId) ?? null;
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
			throw new Error(
				result.errors[0]?.message ?? "Unable to apply hook candidate.",
			);
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
			activeProject.scenes.find(
				(scene) => scene.id === activeProject.currentSceneId,
			) ??
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
		const recommendations = report.keepCutRecommendations.filter(
			(recommendation) => selectedIds.has(recommendation.id),
		);
		if (recommendations.length === 0) {
			return {
				applied: 0,
				messages: ["No keep/cut recommendations were selected."],
			};
		}

		const trackByElementId = new Map(
			activeScene.tracks.flatMap((track) =>
				track.elements.map(
					(element) => [element.id, { track, element }] as const,
				),
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

		const dedupedOps = [
			...new Map(
				ops
					.sort((left, right) => right.start_ms - left.start_ms)
					.map((op) => [`${op.type}:${op.start_ms}:${op.end_ms}`, op] as const),
			).values(),
		];
		if (dedupedOps.length === 0) {
			return {
				applied: 0,
				messages: ["No trim or cut operations were needed."],
			};
		}
		const result = this.applyOps({
			source: "manual",
			ops: dedupedOps,
		});
		if (!result.applied) {
			throw new Error(
				result.errors[0]?.message ??
					"Unable to apply keep/cut recommendations.",
			);
		}
		return {
			applied: recommendations.length,
			messages: recommendations.map(
				(recommendation) =>
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
		options,
	}: {
		language?: string;
		template: string;
		overwriteExisting: boolean;
		options?: CaptionLineBreakOptions;
	}): { generated: number; trackId: string | null } {
		void language;
		const activeProject = this.editor.project.getActive();
		if (!activeProject) {
			throw new Error("No active project.");
		}

		if (!overwriteExisting && this.getSceneCaptions().length > 0) {
			throw new Error(
				"Captions already exist in this scene. Use regenerate to replace them.",
			);
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
			options,
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
		this.applyCaptionProjectSnapshot({
			before: activeProject,
			after: nextProject,
		});
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
		this.applyCaptionProjectSnapshot({
			before: activeProject,
			after: nextProject,
		});
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
		this.applyCaptionProjectSnapshot({
			before: activeProject,
			after: nextProject,
		});
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
				const firstIndex = ordered.findIndex(
					(element) => element.id === firstElementId,
				);
				const secondIndex = ordered.findIndex(
					(element) => element.id === secondElementId,
				);
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
		this.applyCaptionProjectSnapshot({
			before: activeProject,
			after: nextProject,
		});
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
		const clipforgeProject = ensureClipForgeProjectData({
			project: activeProject,
		});
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
					color: style.color ?? null,
					outline_color: style.outline_color ?? null,
					font_style: style.font_style ?? null,
					font_weight: style.font_weight ?? null,
				},
			],
		});
		if (!result.applied) {
			throw new Error(
				result.errors[0]?.message ?? "Failed to apply caption style.",
			);
		}

		const sceneCaptions = this.getSceneCaptions();
		if (sceneCaptions.length === 0) {
			return;
		}

		const effectiveRevealPresetId =
			revealPresetId ?? style.reveal_preset_id ?? "none";
		const updates = sceneCaptions.flatMap((segment) => {
			const track = this.editor.timeline.getTrackById({
				trackId: segment.trackId,
			});
			const element =
				track?.type === "text"
					? (track.elements.find(
							(candidate) =>
								candidate.type === "text" && candidate.id === segment.elementId,
						) ?? null)
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

	async setCaptionSizeMultiplier({ multiplier }: { multiplier: number }): Promise<void> {
		const activeProject = this.editor.project.getActive();
		if (!activeProject) {
			throw new Error("No active project.");
		}
		const project = ensureClipForgeProjectData({ project: activeProject });
		const clampedMultiplier = Math.max(0.5, Math.min(3, multiplier));

		// Persist the multiplier in project data.
		this.editor.project.setActiveProject({
			project: {
				...project,
				metadata: { ...project.metadata, updatedAt: new Date() },
				clipforge: { ...project.clipforge, captionSizeMultiplier: clampedMultiplier },
			},
		});
		this.editor.save.markDirty();

		// Re-apply the current caption style so existing captions resize immediately.
		const activeStyleId = project.clipforge.activeCaptionStyleId;
		if (activeStyleId) {
			await this.applySceneCaptionStyle({ styleId: activeStyleId });
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
			const track = this.editor.timeline.getTrackById({
				trackId: segment.trackId,
			});
			const element =
				track?.type === "text"
					? (track.elements.find(
							(candidate) =>
								candidate.type === "text" && candidate.id === segment.elementId,
						) ?? null)
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
			messages.push(
				`Updated ${overlayGroups.length} overlay group${overlayGroups.length === 1 ? "" : "s"} to the ${profile.label} polish.`,
			);
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
			messages.push(
				`Skipped finishing look because no visual clip was available to polish.`,
			);
		}

		return { appliedSteps, messages };
	}

	private getSceneOverlayGroups(): Array<{
		trackId: string;
		elementIds: string[];
	}> {
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

	private getSelectedOrPrimaryVisualTargets(): Array<{
		trackId: string;
		elementId: string;
	}> {
		const selected = this.editor.selection
			.getSelectedElements()
			.flatMap(({ trackId, elementId }) => {
				const track = this.editor.timeline.getTrackById({ trackId });
				const element =
					track?.elements.find((candidate) => candidate.id === elementId) ??
					null;
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
		this.applyCaptionProjectSnapshot({
			before: activeProject,
			after: nextProject,
		});
		return { cleared: existing.length };
	}

	async exportBestEffort({
		publishDestination,
	}: {
		publishDestination?: PublishDestination;
	} = {}): Promise<ClipForgeExportArtifact> {
		return this.exportIntegration.exportBestEffort({
			editor: this.editor,
			publishDestination:
				publishDestination ??
				this.getPreferredPublishDestination() ??
				"generic-export",
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
		const mediaIds = [
			...new Set(references.map((reference) => reference.mediaId)),
		];
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

	removeSegmentsReferencingMedia({ mediaId }: { mediaId: string }): {
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
			activeProject.scenes.find(
				(scene) => scene.id === activeProject.currentSceneId,
			) ??
			activeProject.scenes[0] ??
			null;
		if (!activeScene) {
			return {
				applied: false,
				removed: 0,
				errors: [
					{ code: "empty_project", message: "No active scene to repair." },
				],
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

	async createDemoProject(): Promise<{
		projectId: string;
		mediaIds: string[];
	}> {
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

	private resolveReferenceAssetAndAnalysis({
		referenceAssetId,
	}: {
		referenceAssetId?: string | null;
	}): {
		assetId: string;
		asset: MediaAsset | null;
		analysis: ReferenceVideoAnalysis | null;
		status: ReturnType<typeof getReferenceVideoAnalysisStatus>;
	} | null {
		const activeProject = this.editor.project.getActiveOrNull();
		if (!activeProject) {
			return null;
		}
		const project = ensureClipForgeProjectData({ project: activeProject });
		const assetId =
			referenceAssetId ?? project.clipforge.activeReferenceVideoAssetId;
		if (!assetId) {
			return null;
		}
		const asset =
			this.editor.media
				.getAssets()
				.find((candidate) => candidate.id === assetId) ?? null;
		const analysis =
			project.clipforge.referenceAnalysisByAssetId[assetId] ?? null;
		const metadata = project.clipforge.mediaMetadataById[assetId] ?? null;
		return {
			assetId,
			asset,
			analysis,
			status: getReferenceVideoAnalysisStatus({
				analysis,
				asset,
				metadata,
			}),
		};
	}

	private buildReferenceDraftMatches({
		referenceAssetId,
		sourceAssetIds,
	}: {
		referenceAssetId?: string | null;
		sourceAssetIds?: string[];
	}): ReferenceDraftSectionMatch[] {
		const activeProject = this.editor.project.getActiveOrNull();
		if (!activeProject) {
			return [];
		}
		const project = ensureClipForgeProjectData({ project: activeProject });
		const resolved = this.resolveReferenceAssetAndAnalysis({
			referenceAssetId,
		});
		if (!resolved?.asset || !resolved.analysis) {
			return [];
		}
		const poolIds =
			sourceAssetIds && sourceAssetIds.length > 0
				? sourceAssetIds
				: this.getEffectiveAssemblySourceAssetIds({ project });
		const descriptors = poolIds.flatMap((assetId) => {
			const asset = this.editor.media
				.getAssets()
				.find(
					(candidate): candidate is MediaAsset & { type: "video" } =>
						candidate.id === assetId &&
						candidate.type === "video" &&
						!candidate.ephemeral,
				);
			if (!asset) {
				return [];
			}
			const persisted =
				project.clipforge.footageDescriptorsByAssetId[asset.id] ?? null;
			return [
				persisted ??
					buildFootageDescriptor({
						asset,
						metadata: project.clipforge.mediaMetadataById[asset.id] ?? null,
					}),
			];
		});
		const shotPlan =
			project.clipforge.referenceShotPlanByAssetId[resolved.assetId] ??
			buildReferenceShotPlan({
				asset: resolved.asset,
				analysis: resolved.analysis,
			});
		return buildReferenceCandidateMatches({
			referenceShotPlan: shotPlan,
			footageDescriptors: descriptors,
			locks: project.clipforge.referenceMatchLocks,
		});
	}

	private async applyReferenceGuidedDraftCommand({
		command,
	}: {
		command: Extract<
			Exclude<ClipForgeEditorCommand, { kind: "timeline-op" }>,
			{ kind: "build-reference-draft" }
		>;
	}): Promise<void> {
		const activeProject = this.editor.project.getActiveOrNull();
		if (!activeProject) {
			throw new Error("No active project.");
		}
		const project = ensureClipForgeProjectData({ project: activeProject });
		const matches =
			command.matches.length > 0
				? command.matches
				: this.buildReferenceDraftMatches({
						referenceAssetId: command.reference_asset_id,
						sourceAssetIds: command.source_asset_ids,
					});
		if (matches.length === 0) {
			throw new Error(
				"No deterministic source matches were available for the reference draft.",
			);
		}

		const result = buildReferenceGuidedDraft({
			project,
			mediaAssets: this.editor.media.getAssets(),
			matches,
			referenceAssetId:
				command.reference_asset_id ??
				project.clipforge.activeReferenceVideoAssetId ??
				null,
		});
		this.editor.command.execute({
			command: new BuildReferenceGuidedDraftCommand(result.project),
		});
		this.persistRecentReferenceAssemblyChoices({
			project: ensureClipForgeProjectData({
				project: this.editor.project.getActive(),
			}),
			choices: result.appliedChoices,
		});
	}

	private async applyReferenceRecreationDraftCommand({
		command,
	}: {
		command: Extract<
			Exclude<ClipForgeEditorCommand, { kind: "timeline-op" }>,
			{ kind: "build-reference-recreation-draft" }
		>;
	}): Promise<void> {
		const activeProject = this.editor.project.getActiveOrNull();
		if (!activeProject) {
			throw new Error("No active project.");
		}
		const project = ensureClipForgeProjectData({ project: activeProject });
		const referenceAssetId =
			command.reference_asset_id ??
			project.clipforge.activeReferenceVideoAssetId;
		if (!referenceAssetId) {
			throw new Error("Choose a reference video before recreating it.");
		}

		const sourceAssetIds =
			command.source_asset_ids && command.source_asset_ids.length > 0
				? command.source_asset_ids
				: this.getEffectiveAssemblySourceAssetIds({ project });
		if (sourceAssetIds.length === 0) {
			throw new Error(
				"Choose at least one raw source clip before recreating the reference.",
			);
		}
		try {
			await this.setAssemblySourcePool({
				assetIds: sourceAssetIds,
				analyze: false,
			});
		} catch {
			// Source analysis is best-effort; validation has already checked the assets.
		}
		await this.ensureReferenceRecreationSourceTranscripts({
			sourceAssetIds,
			requireTranscript: command.require_transcript ?? false,
		});

		const refreshedProject = ensureClipForgeProjectData({
			project: this.editor.project.getActive(),
		});
		const result = buildReferenceRecreationDraft({
			project: refreshedProject,
			mediaAssets: this.editor.media.getAssets(),
			referenceAssetId,
			sourceAssetIds,
			musicAssetId:
				command.music_asset_id ?? command.plan?.music_asset_id ?? null,
		});
		this.editor.command.execute({
			command: new BuildReferenceGuidedDraftCommand(result.project),
		});
	}

	private persistRecentReferenceAssemblyChoices({
		project,
		choices,
	}: {
		project: TProject & {
			clipforge: import("@/types/clipforge").ClipForgeProjectData;
		};
		choices: ClipForgeRecentReferenceAssemblyChoice[];
	}) {
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
						lockedMatchIds: [
							...new Set([
								...project.clipforge.chatMemory.lockedMatchIds,
								...choices
									.filter(
										(choice) =>
											project.clipforge.referenceMatchLocks[choice.matchId],
									)
									.map((choice) => choice.matchId),
							]),
						],
						recentReferenceAssemblyChoices: choices.slice(-12),
					},
				},
			},
		});
		this.editor.save.markDirty();
	}

	private updateRecentReferenceAssemblyChoiceAsset({
		matchId,
		assetId,
	}: {
		matchId: string;
		assetId: string;
	}) {
		const activeProject = this.editor.project.getActiveOrNull();
		if (!activeProject) {
			return;
		}
		const project = ensureClipForgeProjectData({ project: activeProject });
		const asset = this.editor.media
			.getAssets()
			.find((candidate) => candidate.id === assetId);
		if (!asset) {
			return;
		}
		const nextChoices =
			project.clipforge.chatMemory.recentReferenceAssemblyChoices.map(
				(choice) =>
					choice.matchId === matchId
						? {
								...choice,
								assetId,
								assetLabel: asset.name,
								alternativeAssetIds: [
									...new Set([
										...choice.alternativeAssetIds.filter(
											(candidate) => candidate !== assetId,
										),
										choice.assetId,
									]),
								],
								createdAt: new Date().toISOString(),
							}
						: choice,
			);
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
						recentReferenceAssemblyChoices: nextChoices,
					},
				},
			},
		});
		this.editor.save.markDirty();
	}

	private resolveRecentReferenceAssemblyChoice({
		matchId,
	}: {
		matchId: string;
	}): ClipForgeRecentReferenceAssemblyChoice | null {
		const activeProject = this.editor.project.getActiveOrNull();
		if (!activeProject) {
			return null;
		}
		const project = ensureClipForgeProjectData({ project: activeProject });
		return (
			project.clipforge.chatMemory.recentReferenceAssemblyChoices.find(
				(choice) => choice.matchId === matchId,
			) ?? null
		);
	}

	private persistReferenceMatchLock({
		matchId,
		assetId,
	}: {
		matchId: string;
		assetId: string;
	}): void {
		const activeProject = this.editor.project.getActiveOrNull();
		if (!activeProject) {
			return;
		}
		const project = ensureClipForgeProjectData({ project: activeProject });
		const asset = this.editor.media
			.getAssets()
			.find((candidate) => candidate.id === assetId);
		if (!asset) {
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
					referenceMatchLocks: {
						...project.clipforge.referenceMatchLocks,
						[matchId]: {
							match_id: matchId,
							asset_id: assetId,
							asset_name: asset.name,
							locked_at: new Date().toISOString(),
						},
					},
					chatMemory: {
						...project.clipforge.chatMemory,
						lockedMatchIds: [
							...new Set([
								...project.clipforge.chatMemory.lockedMatchIds,
								matchId,
							]),
						],
					},
				},
			},
		});
		this.editor.save.markDirty();
	}

	private clearReferenceMatchLocks(): void {
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
					referenceMatchLocks: {},
					chatMemory: {
						...project.clipforge.chatMemory,
						lockedMatchIds: [],
					},
				},
			},
		});
		this.editor.save.markDirty();
	}

	private buildReferenceDerivedCommands({
		command,
	}: {
		command: Extract<
			Exclude<ClipForgeEditorCommand, { kind: "timeline-op" }>,
			| { kind: "apply-reference-finish-pass" }
			| { kind: "match-reference-captions" }
			| { kind: "match-reference-audio-profile" }
			| { kind: "match-reference-packaging" }
			| { kind: "match-reference-pacing" }
		>;
	}): Exclude<ClipForgeEditorCommand, { kind: "timeline-op" }>[] {
		const resolved = this.resolveReferenceAssetAndAnalysis({
			referenceAssetId: command.reference_asset_id,
		});
		if (!resolved?.analysis) {
			return [];
		}

		const analysis = resolved.analysis;
		const projectSummary = buildProjectSummary({
			project: this.editor.project.getActive(),
			mediaAssets: this.editor.media.getAssets(),
			playheadMs: Math.round(this.editor.playback.getCurrentTime() * 1000),
			selectedSegmentIds: this.editor.selection
				.getSelectedElements()
				.map((selection) => selection.elementId),
			projectKitTemplates: this.editor.project.getProjectKitTemplates(),
			sceneRecipeTemplates: this.editor.project.getSceneRecipeTemplates(),
		});
		const scope = command.scope ?? "scene";
		const finishCommands: Exclude<
			ClipForgeEditorCommand,
			{ kind: "timeline-op" }
		>[] = [];

		if (
			command.kind === "apply-reference-finish-pass" ||
			command.kind === "match-reference-packaging"
		) {
			if (analysis.publishProfile.publish_destination) {
				finishCommands.push({
					kind: "set-publish-destination",
					publish_destination: analysis.publishProfile.publish_destination,
					scope: "project",
				});
			}
			if (
				analysis.publishProfile.target_version_id &&
				projectSummary.version_pack
			) {
				finishCommands.push({
					kind: "set-version-pack",
					target_ids: [analysis.publishProfile.target_version_id],
					active_target_id: analysis.publishProfile.target_version_id,
					scope: "project",
				});
				if (this.resolveAutoReframeTargets().length > 0) {
					finishCommands.push({
						kind: "auto-reframe-selection",
						target_version_id: analysis.publishProfile.target_version_id,
						scope: scope === "selection" ? "selection" : "scene",
					});
				}
			}
			const preflightActions =
				projectSummary.export_preflight_snapshot?.actionable_actions ?? [];
			if (preflightActions.length > 0) {
				finishCommands.push({
					kind: "run-export-preflight-fixes",
					format: "mp4",
					quality: "high",
					include_audio: true,
					target_version_id: analysis.publishProfile.target_version_id ?? null,
					publish_destination: analysis.publishProfile.publish_destination,
					actions:
						preflightActions as import("@/types/export").ExportPreflightAction[],
					scope: "project",
				});
			}
		}

		if (
			command.kind === "apply-reference-finish-pass" ||
			command.kind === "match-reference-captions"
		) {
			const captionRevealPresetId =
				analysis.captionProfile.reveal_preset_id ??
				inferReferenceCaptionRevealPreset({
					tone: analysis.captionProfile.tone,
				});
			if (captionRevealPresetId) {
				finishCommands.push({
					kind: "apply-caption-reveal",
					preset_id: captionRevealPresetId,
					scope,
				});
			}
		}

		if (
			command.kind === "apply-reference-finish-pass" ||
			command.kind === "match-reference-audio-profile"
		) {
			if (analysis.audioProfile.recommended_music_asset_id) {
				finishCommands.push({
					kind: projectSummary.recent_ai_actions.some(
						(action) =>
							action.kind === "apply-music-track" ||
							action.kind === "replace-music-track",
					)
						? "replace-music-track"
						: "apply-music-track",
					music_asset_id: analysis.audioProfile.recommended_music_asset_id,
					start_ms: 0,
					loop_to_project_end: true,
					volume: chooseReferenceMusicVolume({
						energy: analysis.audioProfile.energy,
					}),
					scope: "project",
				});
			}
			if (analysis.audioProfile.recommended_sfx_asset_id) {
				finishCommands.push({
					kind: "insert-sfx-preset",
					sfx_asset_id: analysis.audioProfile.recommended_sfx_asset_id,
					start_ms: Math.max(
						0,
						projectSummary.playhead_neighborhood.nearby_segments[0]?.start_ms ??
							0,
					),
					scope,
				});
			}
			finishCommands.push({
				kind: "set-audio-mix",
				settings: {
					duckingEnabled: true,
					duckingAmount:
						analysis.audioProfile.energy === "high"
							? 0.72
							: analysis.audioProfile.energy === "medium"
								? 0.58
								: 0.46,
					audioPolishPresetId:
						analysis.audioProfile.energy === "high"
							? "music-forward"
							: "voice-forward",
				},
				scope: "project",
			});
		}

		if (
			command.kind === "apply-reference-finish-pass" ||
			command.kind === "match-reference-pacing"
		) {
			const videoTargets = resolveReferencePacingTargets({
				projectSummary,
				scope,
			});
			if (videoTargets.length > 0) {
				finishCommands.push({
					kind: "set-clip-speed",
					target_segment_ids: videoTargets,
					playback_rate:
						analysis.shotPattern.transition_cadence === "fast"
							? 1.12
							: analysis.shotPattern.transition_cadence === "slow"
								? 0.94
								: 1.03,
					ripple: true,
					scope,
				});
			}
			const transitionTargets = resolveReferenceTransitionTargets({
				projectSummary,
				scope,
			});
			if (transitionTargets.length > 0) {
				finishCommands.push({
					kind: "set-transition-in",
					target_segment_ids: transitionTargets,
					preset:
						analysis.shotPattern.transition_cadence === "slow"
							? "cross-dissolve"
							: "cross-dissolve",
					duration_ms:
						analysis.shotPattern.transition_cadence === "fast"
							? 180
							: analysis.shotPattern.transition_cadence === "slow"
								? 380
								: 260,
					scope,
				});
			}
		}

		if (command.kind === "apply-reference-finish-pass") {
			if (analysis.finishingProfile.polish_profile_id) {
				finishCommands.push({
					kind: "apply-polish-profile",
					profile_id: analysis.finishingProfile.polish_profile_id,
					scope,
				});
			}
			const overlayTargets = resolveReferenceOverlayTargets({
				projectSummary,
				scope,
			});
			if (overlayTargets.length > 0 && analysis.overlayProfile.variant_id) {
				finishCommands.push({
					kind: "apply-overlay-style",
					target_element_ids: overlayTargets,
					variant_id: analysis.overlayProfile.variant_id,
					scope,
				});
			}
			if (
				overlayTargets.length > 0 &&
				analysis.overlayProfile.motion_preset_id
			) {
				finishCommands.push({
					kind: "apply-motion-preset",
					target_element_ids: overlayTargets,
					motion_preset_id: analysis.overlayProfile.motion_preset_id,
					scope,
				});
			}
			const finishingTargets = resolveReferenceFinishingTargets({
				projectSummary,
				scope,
			});
			if (
				finishingTargets.length > 0 &&
				analysis.finishingProfile.finishing_look_id
			) {
				finishCommands.push({
					kind: "apply-finishing-look",
					target_segment_ids: finishingTargets,
					preset_id: analysis.finishingProfile.finishing_look_id,
					scope,
				});
			}
		}

		return dedupeReferenceDerivedCommands({ commands: finishCommands });
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
				if (
					!Number.isFinite(command.playback_rate) ||
					command.playback_rate <= 0
				) {
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
						const target = this.resolveCurrentSceneElement({
							elementId: segmentId,
						});
						return target &&
							(target.element.type === "video" ||
								target.element.type === "audio")
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
						const target = this.resolveCurrentSceneElement({
							elementId: segmentId,
						});
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
							message:
								"Freeze-frame insertion time must be inside the target clip.",
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
						const target = this.resolveCurrentSceneElement({
							elementId: segmentId,
						});
						if (
							!target ||
							(target.element.type !== "video" &&
								target.element.type !== "image")
						) {
							return "Transition targets must be visual clips.";
						}
						const track = this.editor.timeline.getTrackById({
							trackId: target.trackId,
						});
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
						const target = this.resolveCurrentSceneElement({
							elementId: segmentId,
						});
						return target &&
							(target.element.type === "video" ||
								target.element.type === "image")
							? null
							: "Finishing looks only apply to video and image clips.";
					},
				});
			case "apply-effect-preset":
				return validateTargetSegments({
					commandIndex,
					targetIds: command.target_segment_ids,
					resolveTarget: (segmentId) => {
						const target = this.resolveCurrentSceneElement({
							elementId: segmentId,
						});
						if (
							!target ||
							(target.element.type !== "video" &&
								target.element.type !== "image")
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
							(target.element.type === "text" ||
								target.element.type === "sticker")
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
							return target.element.type === "text" &&
								target.element.role === "caption"
								? null
								: "This sound sync preset only applies to caption elements.";
						}
						return target.element.type === "text" ||
							target.element.type === "sticker"
							? null
							: "This sound sync preset only applies to graphics targets.";
					},
				});
			}
			case "apply-music-track":
			case "replace-music-track": {
				// Prefer user-imported audio assets over bundled library tracks.
				const importedAudioAsset = this.editor.media
					.getAssets()
					.find(
						(a) =>
							a.id === command.music_asset_id &&
							a.type === "audio" &&
							!a.ephemeral,
					);
				const musicItem = importedAudioAsset
					? null
					: this.resolveBundledMusicItem({ itemId: command.music_asset_id });
				if (!importedAudioAsset && !musicItem) {
					return [
						buildCommandValidationError({
							commandIndex,
							code: "unknown_music_asset",
							message: "The requested music track does not exist in your library or the bundled tracks.",
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
				// Only check destination safety for bundled tracks — user's own audio
				// is presumed cleared for any destination.
				if (
					musicItem &&
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
							message:
								"The selected music track is not safe for the current publish destination.",
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
								message:
									"Generate or select captions before applying a reveal preset.",
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
				const knownTargets = new Set(
					versionPack.targets.map((target) => target.id),
				);
				return command.target_ids.every((targetId) =>
					knownTargets.has(targetId),
				)
					? []
					: [
							buildCommandValidationError({
								commandIndex,
								code: "unknown_version_target",
								message:
									"One or more requested version targets are unavailable.",
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
							message:
								"Select or previously target at least one visual clip to auto reframe.",
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
						command.publish_destination ??
						this.getPreferredPublishDestination() ??
						"generic-export",
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
								message:
									"No safe export preflight fixes are currently available.",
							}),
						];
			}
			case "set-active-reference-video": {
				const asset = this.editor.media
					.getAssets()
					.find((candidate) => candidate.id === command.asset_id);
				return asset?.type === "video"
					? []
					: [
							buildCommandValidationError({
								commandIndex,
								code: "reference_video_invalid",
								message:
									"Reference video must point to an imported video asset.",
							}),
						];
			}
			case "set-assembly-source-pool": {
				if (command.asset_ids.length === 0) {
					return [
						buildCommandValidationError({
							commandIndex,
							code: "assembly_source_pool_empty",
							message:
								"Choose at least one source clip for reference-guided draft assembly.",
						}),
					];
				}
				const invalidAssetId = command.asset_ids.find((assetId) => {
					const asset = this.editor.media
						.getAssets()
						.find((candidate) => candidate.id === assetId);
					return !asset || asset.type !== "video" || asset.ephemeral;
				});
				return invalidAssetId
					? [
							buildCommandValidationError({
								commandIndex,
								code: "assembly_source_invalid",
								message:
									"Assembly source pool entries must be imported video assets.",
							}),
						]
					: [];
			}
			case "clear-active-reference-video":
				return [];
			case "build-reference-recreation-draft": {
				const referenceAssetId =
					command.reference_asset_id ??
					activeProject.clipforge?.activeReferenceVideoAssetId ??
					null;
				if (!referenceAssetId) {
					return [
						buildCommandValidationError({
							commandIndex,
							code: "reference_video_required",
							message: "Choose a reference video before recreating it.",
						}),
					];
				}
				const referenceAsset = this.editor.media
					.getAssets()
					.find((asset) => asset.id === referenceAssetId);
				if (!referenceAsset || referenceAsset.type !== "video") {
					return [
						buildCommandValidationError({
							commandIndex,
							code: "reference_video_invalid",
							message:
								"Reference recreation requires an imported video reference.",
						}),
					];
				}
				const sourceAssetIds =
					command.source_asset_ids && command.source_asset_ids.length > 0
						? command.source_asset_ids
						: this.getEffectiveAssemblySourceAssetIds({
								project: ensureClipForgeProjectData({ project: activeProject }),
							});
				if (sourceAssetIds.length === 0) {
					return [
						buildCommandValidationError({
							commandIndex,
							code: "assembly_source_pool_empty",
							message:
								"Choose at least one raw source clip for reference recreation.",
						}),
					];
				}
				const invalidSource = sourceAssetIds.find((assetId) => {
					const asset = this.editor.media
						.getAssets()
						.find((candidate) => candidate.id === assetId);
					return !asset || asset.type !== "video" || asset.ephemeral;
				});
				if (invalidSource) {
					return [
						buildCommandValidationError({
							commandIndex,
							code: "assembly_source_invalid",
							message:
								"Reference recreation source entries must be imported video assets.",
						}),
					];
				}
				if (command.music_asset_id) {
					const musicAsset = this.editor.media
						.getAssets()
						.find((asset) => asset.id === command.music_asset_id);
					if (!musicAsset || musicAsset.type !== "audio") {
						return [
							buildCommandValidationError({
								commandIndex,
								code: "imported_music_invalid",
								message:
									"Reference recreation music must point to an imported audio asset.",
							}),
						];
					}
				}
				return [];
			}
			case "build-reference-draft": {
				const matches =
					command.matches.length > 0
						? command.matches
						: this.buildReferenceDraftMatches({
								referenceAssetId: command.reference_asset_id,
								sourceAssetIds: command.source_asset_ids,
							});
				if (matches.length === 0) {
					return [
						buildCommandValidationError({
							commandIndex,
							code: "reference_draft_matches_empty",
							message:
								"No safe source-footage matches were available for the requested reference draft.",
						}),
					];
				}
				const invalidMatch = matches.find(
					(match) =>
						!match.selected_asset_id ||
						!this.editor.media
							.getAssets()
							.some(
								(asset) =>
									asset.id === match.selected_asset_id &&
									asset.type === "video" &&
									!asset.ephemeral,
							),
				);
				return invalidMatch
					? [
							buildCommandValidationError({
								commandIndex,
								code: "reference_draft_invalid_asset",
								message:
									"Reference draft matches must resolve to imported video source clips.",
							}),
						]
					: [];
			}
			case "replace-with-source-match": {
				const choice = this.resolveRecentReferenceAssemblyChoice({
					matchId: command.match_id,
				});
				if (!choice) {
					return [
						buildCommandValidationError({
							commandIndex,
							code: "reference_match_not_found",
							message:
								"The requested reference match could not be found in the current draft.",
						}),
					];
				}
				const asset = this.editor.media
					.getAssets()
					.find((candidate) => candidate.id === command.asset_id);
				if (!asset || asset.type !== "video" || asset.ephemeral) {
					return [
						buildCommandValidationError({
							commandIndex,
							code: "reference_replacement_invalid",
							message:
								"Replacement matches must use imported video source clips.",
						}),
					];
				}
				return [];
			}
			case "lock-reference-match":
				return this.resolveRecentReferenceAssemblyChoice({
					matchId: command.match_id,
				})
					? []
					: [
							buildCommandValidationError({
								commandIndex,
								code: "reference_lock_not_found",
								message: "The requested match is not available to lock yet.",
							}),
						];
			case "clear-reference-match-locks":
				return [];
			case "apply-reference-finish-pass":
			case "match-reference-captions":
			case "match-reference-audio-profile":
			case "match-reference-packaging":
			case "match-reference-pacing": {
				const resolved = this.resolveReferenceAssetAndAnalysis({
					referenceAssetId: command.reference_asset_id,
				});
				if (!resolved) {
					return [
						buildCommandValidationError({
							commandIndex,
							code: "reference_video_required",
							message: "Choose a reference video before matching it.",
						}),
					];
				}
				if (resolved.status === "missing") {
					return [
						buildCommandValidationError({
							commandIndex,
							code: "reference_video_missing",
							message:
								"The selected reference video is missing from the project.",
						}),
					];
				}
				const derivedCommands = this.buildReferenceDerivedCommands({
					command,
				});
				if (derivedCommands.length === 0) {
					return [
						buildCommandValidationError({
							commandIndex,
							code: "reference_match_empty",
							message:
								"The reference did not produce any safe deterministic commands.",
						}),
					];
				}
				return derivedCommands.flatMap((derivedCommand, derivedIndex) =>
					this.validateDirectCommand({
						command: derivedCommand,
						commandIndex: commandIndex + derivedIndex,
					}),
				);
			}
			case "produce-from-raw": {
				const allAssets = this.editor.media.getAssets();
				const videoAssets = allAssets.filter(
					(a) => a.type === "video" && !a.ephemeral,
				);
				if (videoAssets.length === 0) {
					return [
						buildCommandValidationError({
							commandIndex,
							code: "no_video_assets",
							message:
								"Import at least one raw video before running auto-produce.",
						}),
					];
				}
				if (
					command.raw_video_asset_id &&
					!allAssets.find((a) => a.id === command.raw_video_asset_id)
				) {
					return [
						buildCommandValidationError({
							commandIndex,
							code: "unknown_raw_video_asset",
							message: "The specified raw video asset does not exist.",
						}),
					];
				}
				return [];
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
					const target = this.resolveCurrentSceneElement({
						elementId: segmentId,
					});
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
					const target = this.resolveCurrentSceneElement({
						elementId: segmentId,
					});
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
					const target = this.resolveCurrentSceneElement({
						elementId: segmentId,
					});
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
					const target = this.resolveCurrentSceneElement({
						elementId: segmentId,
					});
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
					const target = this.resolveCurrentSceneElement({
						elementId: segmentId,
					});
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
			case "replace-music-track": {
				const replaceExisting = command.kind === "replace-music-track";
				const importedAudio = this.editor.media
					.getAssets()
					.find(
						(a) =>
							a.id === command.music_asset_id &&
							a.type === "audio" &&
							!a.ephemeral,
					);
				if (importedAudio) {
					await this.insertImportedMusicTrack({
						asset: importedAudio,
						startMs: command.start_ms ?? 0,
						volume: command.volume ?? null,
						loopToProjectEnd: command.loop_to_project_end ?? true,
						replaceExisting,
					});
				} else {
					await this.insertBundledMusicTrack({
						itemId: command.music_asset_id,
						startMs: command.start_ms ?? 0,
						volume: command.volume ?? null,
						loopToProjectEnd: command.loop_to_project_end ?? true,
						replaceExisting,
					});
				}
				break;
			}
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
						command.publish_destination ??
						this.getPreferredPublishDestination() ??
						"generic-export",
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
			case "set-active-reference-video":
				await this.setActiveReferenceVideo({
					assetId: command.asset_id,
				});
				break;
			case "set-assembly-source-pool":
				await this.setAssemblySourcePool({
					assetIds: command.asset_ids,
				});
				break;
			case "clear-active-reference-video":
				this.clearActiveReferenceVideo();
				break;
			case "build-reference-recreation-draft":
				await this.applyReferenceRecreationDraftCommand({
					command,
				});
				break;
			case "build-reference-draft":
				await this.applyReferenceGuidedDraftCommand({
					command,
				});
				break;
			case "replace-with-source-match": {
				const choice = this.resolveRecentReferenceAssemblyChoice({
					matchId: command.match_id,
				});
				if (!choice) {
					throw new Error(
						"Reference match could not be found in the current draft.",
					);
				}
				const target = this.resolveCurrentSceneElement({
					elementId: choice.segmentId,
				});
				if (!target) {
					throw new Error(
						"The selected draft section is no longer present in the active scene.",
					);
				}
				this.editor.timeline.replaceElementMedia({
					trackId: target.trackId,
					elementId: choice.segmentId,
					mediaId: command.asset_id,
				});
				this.updateRecentReferenceAssemblyChoiceAsset({
					matchId: command.match_id,
					assetId: command.asset_id,
				});
				break;
			}
			case "lock-reference-match": {
				const choice = this.resolveRecentReferenceAssemblyChoice({
					matchId: command.match_id,
				});
				if (!choice) {
					throw new Error("Reference match could not be found.");
				}
				this.persistReferenceMatchLock({
					matchId: command.match_id,
					assetId: command.asset_id ?? choice.assetId,
				});
				break;
			}
			case "clear-reference-match-locks":
				this.clearReferenceMatchLocks();
				break;
			case "apply-reference-finish-pass":
			case "match-reference-captions":
			case "match-reference-audio-profile":
			case "match-reference-packaging":
			case "match-reference-pacing": {
				const derivedCommands = this.buildReferenceDerivedCommands({
					command,
				});
				for (const derivedCommand of derivedCommands) {
					await this.executeDirectCommand({
						command: derivedCommand,
					});
				}
				break;
			}
			case "produce-from-raw":
				await this.executeAutoProducePipeline({
					rawVideoAssetId: command.raw_video_asset_id ?? null,
					musicAssetId: command.music_asset_id ?? null,
					targetKeepRatio: command.target_keep_ratio ?? null,
				});
				break;
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
			this.editor.project.getActiveOrNull()?.clipforge?.chatMemory
				?.destinationIntent?.publishDestination ?? null
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
			this.editor.timeline.getTracks().find((track) => track.type === "audio")
				?.id ?? this.editor.timeline.addTrack({ type: "audio" })
		);
	}

	private getSceneAudioElementsByRole({
		role,
	}: {
		role: "music" | "sfx" | "audio" | "voiceover";
	}): Array<{ trackId: string; elementId: string }> {
		return this.editor.timeline
			.getTracks()
			.filter(
				(track): track is Extract<typeof track, { type: "audio" }> =>
					track.type === "audio",
			)
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
		const videoEndMs = Math.round(this.editor.timeline.getTotalDuration() * 1000);
		// Use the video end as the project duration so music never extends the timeline.
		const projectDurationMs =
			loopToProjectEnd && videoEndMs > 0
				? videoEndMs
				: startMs + Math.round(item.duration * 1000);
		const desiredEndMs = loopToProjectEnd
			? projectDurationMs
			: startMs + Math.round(item.duration * 1000);
		const trackId = this.getOrCreateAudioTrackId();
		let cursorMs = Math.max(0, startMs);
		const rawDurationMs = Math.round((asset.duration ?? item.duration) * 1000);

		while (cursorMs < desiredEndMs) {
			const remainingMs = desiredEndMs - cursorMs;
			const clampedDurationSec = Math.min(
				asset.duration ?? item.duration,
				remainingMs / 1000,
			);
			if (clampedDurationSec <= 0) break;
			const element = buildUploadAudioElement({
				mediaId: asset.id,
				name: asset.name,
				duration: clampedDurationSec,
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
			cursorMs += Math.max(1, rawDurationMs);
			if (!loopToProjectEnd) {
				break;
			}
		}
	}

	/**
	 * Place a user-imported audio asset on the music track.  Loops to fill the
	 * project if `loopToProjectEnd` is true — same behaviour as bundled tracks.
	 */
	private async insertImportedMusicTrack({
		asset,
		startMs,
		volume,
		loopToProjectEnd,
		replaceExisting,
	}: {
		asset: MediaAsset;
		startMs: number;
		volume: number | null;
		loopToProjectEnd: boolean;
		replaceExisting: boolean;
	}): Promise<void> {
		if (replaceExisting) {
			const existingMusic = this.getSceneAudioElementsByRole({ role: "music" });
			if (existingMusic.length > 0) {
				this.editor.timeline.deleteElements({ elements: existingMusic });
			}
		}

		const assetDuration = typeof asset.duration === "number" ? asset.duration : 0;
		const videoEndMs = Math.round(this.editor.timeline.getTotalDuration() * 1000);
		// Clamp to video end — never let music extend the overall timeline duration.
		const projectDurationMs =
			loopToProjectEnd && videoEndMs > 0
				? videoEndMs
				: startMs + Math.round(assetDuration * 1000);
		const desiredEndMs = loopToProjectEnd
			? projectDurationMs
			: startMs + Math.round(assetDuration * 1000);
		const trackId = this.getOrCreateAudioTrackId();
		let cursorMs = Math.max(0, startMs);
		const rawDurationMs = Math.round(assetDuration * 1000);

		while (cursorMs < desiredEndMs) {
			const remainingMs = desiredEndMs - cursorMs;
			const clampedDurationSec = Math.min(assetDuration, remainingMs / 1000);
			if (clampedDurationSec <= 0) break;
			const element = buildUploadAudioElement({
				mediaId: asset.id,
				name: asset.name,
				duration: clampedDurationSec,
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
			cursorMs += Math.max(1, rawDurationMs);
			if (!loopToProjectEnd || assetDuration <= 0) {
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
				Math.max(
					1,
					durationMs ??
						item.defaultDurationMs ??
						Math.round(item.duration * 1000),
				) / 1000,
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
				this.editor.selection
					.getSelectedElements()
					.map((selection) => selection.elementId),
			);
			const selectedCaptions = this.editor.timeline
				.getTracks()
				.filter(
					(track): track is Extract<typeof track, { type: "text" }> =>
						track.type === "text",
				)
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
			const track = this.editor.timeline.getTrackById({
				trackId: segment.trackId,
			});
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
			throw new Error(
				"Generate or select captions before applying a reveal preset.",
			);
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
		const element =
			track?.elements.find((candidate) => candidate.id === elementId) ?? null;
		if (!track || !element) {
			return null;
		}
		return { trackId, element };
	}

	private resolveAutoReframeTargets(): Array<{
		trackId: string;
		elementId: string;
	}> {
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
			this.editor.project.getActiveOrNull()?.clipforge?.chatMemory
				?.activeTargets ?? [];
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
							commandKinds: [
								...new Set(commands.map((command) => command.kind)),
							],
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
					includeMusic: commands.some(
						(command) =>
							command.kind === "apply-music-track" ||
							command.kind === "replace-music-track",
					)
						? true
						: (existingMemory.finishIntent?.includeMusic ?? null),
					includeSfx: commands.some(
						(command) => command.kind === "insert-sfx-preset",
					)
						? true
						: (existingMemory.finishIntent?.includeSfx ?? null),
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
		const referenceIntent = shouldRefreshReferenceIntent({ commands })
			? {
					referenceAssetId:
						findLatestReferenceAssetId({ commands }) ??
						existingMemory.referenceIntent?.referenceAssetId ??
						project.clipforge.activeReferenceVideoAssetId ??
						null,
					referenceMode: "exact-recreation" as const,
				}
			: existingMemory.referenceIntent;
		const assemblyIntent = shouldRefreshAssemblyIntent({ commands })
			? {
					referenceAssetId:
						findLatestReferenceAssetId({ commands }) ??
						existingMemory.assemblyIntent?.referenceAssetId ??
						project.clipforge.activeReferenceVideoAssetId ??
						null,
					sourceAssetIds:
						findLatestAssemblySourceAssetIds({ commands }) ??
						existingMemory.assemblyIntent?.sourceAssetIds ??
						project.clipforge.assemblySourceAssetIds,
					focusMatchIds:
						findLatestAssemblyFocusMatchIds({ commands }) ??
						existingMemory.assemblyIntent?.focusMatchIds ??
						[],
				}
			: existingMemory.assemblyIntent;
		const recentAssetChoices = [
			...existingMemory.recentAssetChoices,
			...commands
				.map((command) => buildRecentAssetChoice({ command }))
				.filter(
					(choice): choice is ClipForgeRecentAssetChoice => choice !== null,
				),
		].slice(-12);
		const recentReferenceComparisons = [
			...existingMemory.recentReferenceComparisons,
			...commands.flatMap((command) =>
				buildRecentReferenceComparison({ command }),
			),
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
			referenceIntent,
			assemblyIntent,
			lockedMatchIds: [...project.clipforge.chatMemory.lockedMatchIds],
			recentTurnSummaries: nextTurnSummaries.slice(-12),
			recentAppliedCommandSummaries: [
				...existingMemory.recentAppliedCommandSummaries,
				...nextAppliedSummaries,
			].slice(-20),
			recentAssetChoices,
			recentReferenceComparisons,
			recentReferenceAssemblyChoices:
				project.clipforge.chatMemory.recentReferenceAssemblyChoices.slice(-12),
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

	private getVisualSelectionsForDraft(): Array<{
		trackId: string;
		elementId: string;
	}> {
		return this.editor.timeline
			.getTracks()
			.flatMap((track) =>
				track.elements
					.filter(
						(element) => element.type === "video" || element.type === "image",
					)
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
		? value.filter(
				(candidate): candidate is string => typeof candidate === "string",
			)
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

function resolveReferencePacingTargets({
	projectSummary,
	scope,
}: {
	projectSummary: ProjectSummary;
	scope: import("@/types/clipforge").ClipForgeCommandScope;
}): string[] {
	if (
		scope === "selection" &&
		projectSummary.selection.selected_segments.length > 0
	) {
		return projectSummary.selection.selected_segments
			.filter((segment) => segment.segment_kind === "video")
			.map((segment) => segment.segment_id);
	}
	return projectSummary.current_scene_segments
		.filter((segment) => segment.segment_kind === "video")
		.slice(0, 3)
		.map((segment) => segment.segment_id);
}

function resolveReferenceTransitionTargets({
	projectSummary,
	scope,
}: {
	projectSummary: ProjectSummary;
	scope: import("@/types/clipforge").ClipForgeCommandScope;
}): string[] {
	const sourceSegments =
		scope === "selection" &&
		projectSummary.selection.selected_segments.length > 0
			? projectSummary.selection.selected_segments
			: projectSummary.current_scene_segments;
	return sourceSegments
		.filter((segment) => segment.segment_kind === "video")
		.slice(1, 4)
		.map((segment) => segment.segment_id);
}

function resolveReferenceOverlayTargets({
	projectSummary,
	scope,
}: {
	projectSummary: ProjectSummary;
	scope: import("@/types/clipforge").ClipForgeCommandScope;
}): string[] {
	const sourceSegments =
		scope === "selection" &&
		projectSummary.selection.selected_segments.length > 0
			? projectSummary.selection.selected_segments
			: projectSummary.current_scene_segments;
	return sourceSegments
		.filter((segment) => segment.segment_kind === "text-overlay")
		.map((segment) => segment.segment_id);
}

function resolveReferenceFinishingTargets({
	projectSummary,
	scope,
}: {
	projectSummary: ProjectSummary;
	scope: import("@/types/clipforge").ClipForgeCommandScope;
}): string[] {
	if (
		scope === "selection" &&
		projectSummary.selection.selected_segments.length > 0
	) {
		return projectSummary.selection.selected_segments
			.filter((segment) => segment.segment_kind === "video")
			.map((segment) => segment.segment_id);
	}
	return projectSummary.current_scene_segments
		.filter((segment) => segment.segment_kind === "video")
		.map((segment) => segment.segment_id);
}

function dedupeReferenceDerivedCommands({
	commands,
}: {
	commands: Exclude<ClipForgeEditorCommand, { kind: "timeline-op" }>[];
}): Exclude<ClipForgeEditorCommand, { kind: "timeline-op" }>[] {
	const seen = new Set<string>();
	const result: Exclude<ClipForgeEditorCommand, { kind: "timeline-op" }>[] = [];
	for (const command of commands) {
		const key = JSON.stringify(command);
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		result.push(command);
	}
	return result;
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
		scope:
			command.kind === "timeline-op"
				? "selection"
				: (command.scope ?? "selection"),
		createdAt: new Date().toISOString(),
	};
}

function extractCommandTargetSegmentIds(
	command: ClipForgeEditorCommand,
): string[] {
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

function extractCommandTargetElementIds(
	command: ClipForgeEditorCommand,
): string[] {
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
		case "set-active-reference-video":
			return `Set ${command.asset_id} as the active reference video.`;
		case "set-assembly-source-pool":
			return `Set ${command.asset_ids.length} clips as the source pool for reference-guided assembly.`;
		case "clear-active-reference-video":
			return "Cleared the active reference video.";
		case "apply-reference-finish-pass":
			return "Applied a reference-guided finish pass.";
		case "match-reference-captions":
			return "Matched caption styling to the active reference.";
		case "match-reference-audio-profile":
			return "Matched audio feel to the active reference.";
		case "match-reference-packaging":
			return "Matched packaging to the active reference.";
		case "match-reference-pacing":
			return "Matched pacing to the active reference.";
		case "build-reference-recreation-draft":
			return "Built a reference recreation draft with source cuts, captions, voice mix, and imported music.";
		case "build-reference-draft":
			return `Built a reference-guided first draft from ${command.matches.length} matched sections.`;
		case "replace-with-source-match":
			return "Replaced one draft section with a different source clip.";
		case "lock-reference-match":
			return "Locked a reference draft section to the current source clip.";
		case "clear-reference-match-locks":
			return "Cleared all reference draft section locks.";
		case "produce-from-raw":
			return "Auto-produced a finished video from raw footage using creator style profile.";
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
			command.kind === "apply-project-kit" ||
			command.kind === "apply-reference-finish-pass" ||
			command.kind === "match-reference-captions" ||
			command.kind === "build-reference-recreation-draft"
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
			const item = BUNDLED_MUSIC.find(
				(candidate) => candidate.id === command.music_asset_id,
			);
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
			command.kind === "apply-project-kit" ||
			command.kind === "apply-reference-finish-pass" ||
			command.kind === "match-reference-packaging" ||
			command.kind === "match-reference-pacing" ||
			command.kind === "build-reference-recreation-draft" ||
			command.kind === "build-reference-draft",
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
			command.kind === "insert-sfx-preset" ||
			command.kind === "apply-reference-finish-pass" ||
			command.kind === "match-reference-captions" ||
			command.kind === "match-reference-audio-profile" ||
			command.kind === "build-reference-recreation-draft" ||
			command.kind === "build-reference-draft",
	);
}

function shouldRefreshDestinationIntent({
	commands,
}: {
	commands: ClipForgeEditorCommand[];
}): boolean {
	return commands.some(
		(command) =>
			command.kind === "set-publish-destination" ||
			command.kind === "apply-reference-finish-pass" ||
			command.kind === "match-reference-packaging" ||
			command.kind === "build-reference-recreation-draft" ||
			command.kind === "build-reference-draft",
	);
}

function shouldRefreshReferenceIntent({
	commands,
}: {
	commands: ClipForgeEditorCommand[];
}): boolean {
	return commands.some(
		(command) =>
			command.kind === "set-active-reference-video" ||
			command.kind === "apply-reference-finish-pass" ||
			command.kind === "match-reference-captions" ||
			command.kind === "match-reference-audio-profile" ||
			command.kind === "match-reference-packaging" ||
			command.kind === "match-reference-pacing" ||
			command.kind === "build-reference-recreation-draft" ||
			command.kind === "build-reference-draft",
	);
}

function shouldRefreshAssemblyIntent({
	commands,
}: {
	commands: ClipForgeEditorCommand[];
}) {
	return commands.some(
		(command) =>
			command.kind === "set-assembly-source-pool" ||
			command.kind === "build-reference-recreation-draft" ||
			command.kind === "build-reference-draft" ||
			command.kind === "replace-with-source-match" ||
			command.kind === "lock-reference-match" ||
			command.kind === "clear-reference-match-locks",
	);
}

function findLatestReferenceAssetId({
	commands,
}: {
	commands: ClipForgeEditorCommand[];
}): string | null {
	for (let index = commands.length - 1; index >= 0; index -= 1) {
		const command = commands[index];
		if (command?.kind === "set-active-reference-video") {
			return command.asset_id;
		}
		if (
			command?.kind === "apply-reference-finish-pass" ||
			command?.kind === "match-reference-captions" ||
			command?.kind === "match-reference-audio-profile" ||
			command?.kind === "match-reference-packaging" ||
			command?.kind === "match-reference-pacing" ||
			command?.kind === "build-reference-recreation-draft" ||
			command?.kind === "build-reference-draft"
		) {
			return command.reference_asset_id ?? null;
		}
	}
	return null;
}

function findLatestAssemblySourceAssetIds({
	commands,
}: {
	commands: ClipForgeEditorCommand[];
}) {
	for (let index = commands.length - 1; index >= 0; index -= 1) {
		const command = commands[index];
		if (command?.kind === "set-assembly-source-pool") {
			return command.asset_ids;
		}
		if (
			command?.kind === "build-reference-draft" &&
			command.source_asset_ids?.length
		) {
			return command.source_asset_ids;
		}
		if (
			command?.kind === "build-reference-recreation-draft" &&
			command.source_asset_ids?.length
		) {
			return command.source_asset_ids;
		}
	}
	return null;
}

function findLatestAssemblyFocusMatchIds({
	commands,
}: {
	commands: ClipForgeEditorCommand[];
}) {
	for (let index = commands.length - 1; index >= 0; index -= 1) {
		const command = commands[index];
		if (
			command?.kind === "build-reference-draft" &&
			command.focus_match_ids?.length
		) {
			return command.focus_match_ids;
		}
		if (command?.kind === "lock-reference-match") {
			return [command.match_id];
		}
	}
	return null;
}

function buildRecentAssetChoice({
	command,
}: {
	command: ClipForgeEditorCommand;
}): ClipForgeRecentAssetChoice | null {
	switch (command.kind) {
		case "apply-music-track":
		case "replace-music-track": {
			const item = BUNDLED_MUSIC.find(
				(candidate) => candidate.id === command.music_asset_id,
			);
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
			const item = BUNDLED_SFX.find(
				(candidate) => candidate.id === command.sfx_asset_id,
			);
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
		case "build-reference-recreation-draft": {
			const sourceAssetId =
				command.source_asset_ids?.[0] ??
				command.plan?.source_asset_ids[0] ??
				null;
			const sourceAssetName =
				command.plan?.source_ranges.find(
					(range) => range.source_asset_id === sourceAssetId,
				)?.source_asset_name ?? sourceAssetId;
			return sourceAssetId
				? {
						assetId: sourceAssetId,
						assetKind: "source-video",
						label: sourceAssetName ?? sourceAssetId,
						commandKind: command.kind,
						createdAt: new Date().toISOString(),
					}
				: null;
		}
		case "build-reference-draft":
			return command.matches[0]
				? {
						assetId: command.matches[0].selected_asset_id,
						assetKind: "source-video",
						label: command.matches[0].selected_asset_name,
						commandKind: command.kind,
						createdAt: new Date().toISOString(),
					}
				: null;
		case "replace-with-source-match":
			return {
				assetId: command.asset_id,
				assetKind: "source-video",
				label: command.asset_id,
				commandKind: command.kind,
				createdAt: new Date().toISOString(),
			};
		default:
			return null;
	}
}

function buildRecentReferenceComparison({
	command,
}: {
	command: ClipForgeEditorCommand;
}): string[] {
	switch (command.kind) {
		case "apply-reference-finish-pass":
			return ["finish pass closer to active reference"];
		case "match-reference-captions":
			return ["matched captions to active reference"];
		case "match-reference-audio-profile":
			return ["matched audio feel to active reference"];
		case "match-reference-packaging":
			return ["matched packaging to active reference"];
		case "match-reference-pacing":
			return ["matched pacing to active reference"];
		case "build-reference-recreation-draft":
			return ["built a full source-to-reference recreation draft"];
		case "build-reference-draft":
			return ["built a first draft from reference-guided source matches"];
		case "replace-with-source-match":
			return [
				"swapped one reference-guided section to a different source clip",
			];
		case "lock-reference-match":
			return [
				"locked a reference-guided section to preserve the current source clip",
			];
		default:
			return [];
	}
}

// ─── Repeat-take detection ────────────────────────────────────────────────
// Groups post-cut transcript words into utterances (separated by silence
// gaps ≥ 300ms).  Three detection layers:
//   1. Jaccard word-set similarity ≥ 0.35 → repeat take
//   2. Shared bigram ratio ≥ 0.4 → paraphrased repeat
//   3. False starts: utterance ≤ 2 words immediately before a longer one
//      that starts with the same word(s) → abandoned sentence
// The earlier take is cut; the later (usually cleaner) take is kept.

function jaccardWordSimilarity(a: string, b: string): number {
	const setA = new Set(a.toLowerCase().split(/\s+/).filter(Boolean));
	const setB = new Set(b.toLowerCase().split(/\s+/).filter(Boolean));
	let intersection = 0;
	for (const w of setA) {
		if (setB.has(w)) intersection++;
	}
	const union = setA.size + setB.size - intersection;
	return union === 0 ? 0 : intersection / union;
}

function bigramOverlap(a: string, b: string): number {
	const toBigrams = (s: string) => {
		const words = s.toLowerCase().split(/\s+/).filter(Boolean);
		const bigrams = new Set<string>();
		for (let i = 0; i < words.length - 1; i++) {
			bigrams.add(`${words[i]} ${words[i + 1]}`);
		}
		return bigrams;
	};
	const bA = toBigrams(a);
	const bB = toBigrams(b);
	if (bA.size === 0 || bB.size === 0) return 0;
	let intersection = 0;
	for (const bg of bA) {
		if (bB.has(bg)) intersection++;
	}
	return intersection / Math.min(bA.size, bB.size);
}

function isFalseStart(short: string, long: string): boolean {
	const sWords = short.toLowerCase().split(/\s+/).filter(Boolean);
	const lWords = long.toLowerCase().split(/\s+/).filter(Boolean);
	if (sWords.length > 3 || lWords.length <= sWords.length) return false;
	// Check if the longer utterance starts with the same first word(s)
	for (let k = 0; k < Math.min(sWords.length, 2); k++) {
		if (sWords[k] === lWords[k]) return true;
	}
	return false;
}

interface Utterance {
	startMs: number;
	endMs: number;
	text: string;
	wordCount: number;
}

function detectRepeatTakeCuts({
	words,
	minSimilarity = 0.35,
	minUtteranceWords = 3,
}: {
	words: TimelineTranscriptWord[];
	minSimilarity: number;
	minUtteranceWords: number;
}): import("@/types/clipforge").TimelineDiffOp[] {
	if (words.length < 4) return [];

	// Group words into utterances separated by gaps > 300ms
	const utterances: Utterance[] = [];
	let buf: TimelineTranscriptWord[] = [];

	const flush = () => {
		if (buf.length > 0) {
			utterances.push({
				startMs: buf[0].start_ms,
				endMs: buf[buf.length - 1].end_ms,
				text: buf.map((w) => w.text.trim()).join(" "),
				wordCount: buf.length,
			});
			buf = [];
		}
	};

	for (const word of words) {
		if (buf.length > 0) {
			const gap = word.start_ms - buf[buf.length - 1].end_ms;
			if (gap > 300) flush();
		}
		buf.push(word);
	}
	flush();

	// Detect repeats + false starts (look-ahead window = 6)
	const removeIndices = new Set<number>();
	for (let i = 0; i < utterances.length - 1; i++) {
		if (removeIndices.has(i)) continue;

		// Layer 3: false start — very short utterance before a longer one
		if (utterances[i].wordCount <= 2) {
			const next = utterances[i + 1];
			if (next && !removeIndices.has(i + 1) && isFalseStart(utterances[i].text, next.text)) {
				removeIndices.add(i);
				continue;
			}
		}

		if (utterances[i].wordCount < minUtteranceWords) continue;

		for (let j = i + 1; j < Math.min(i + 7, utterances.length); j++) {
			if (removeIndices.has(j)) continue;
			if (utterances[j].wordCount < minUtteranceWords) continue;

			// Layer 1: Jaccard word-set similarity
			const sim = jaccardWordSimilarity(
				utterances[i].text,
				utterances[j].text,
			);
			if (sim >= minSimilarity) {
				removeIndices.add(i);
				break;
			}

			// Layer 2: bigram overlap (catches paraphrased repeats)
			const bOverlap = bigramOverlap(utterances[i].text, utterances[j].text);
			if (bOverlap >= 0.4) {
				removeIndices.add(i);
				break;
			}
		}
	}

	// Build CUT_RANGE ops for each false take (timeline-time coordinates)
	return [...removeIndices]
		.sort((a, b) => a - b)
		.map((idx) => ({
			type: "CUT_RANGE" as const,
			start_ms: utterances[idx].startMs,
			end_ms: utterances[idx].endMs,
		}));
}

// ─── Word-level stutter removal ───────────────────────────────────────────
// Detects consecutive duplicate words ("only only", "that that", "and and")
// and generates CUT_RANGE ops to remove the first occurrence.
// These are common verbal tics in unscripted talking-head footage.

/**
 * Balance a title overlay onto at most two lines, matching the reference's
 * wrapped upper-third title.  The renderer honours "\n" but does not auto-wrap
 * by width, so a long single-line title would otherwise span edge-to-edge.
 * Splits at the word boundary nearest the character midpoint.
 */
function balanceTitleLines(title: string): string {
	const words = title.trim().split(/\s+/).filter(Boolean);
	if (words.length <= 2) return title.trim(); // short → keep one line
	const total = title.trim().length;
	let bestSplit = -1;
	let bestDelta = Number.POSITIVE_INFINITY;
	let acc = 0;
	for (let i = 0; i < words.length - 1; i++) {
		acc += words[i].length + (i > 0 ? 1 : 0); // +1 for the joining space
		const delta = Math.abs(acc - total / 2);
		if (delta < bestDelta) {
			bestDelta = delta;
			bestSplit = i;
		}
	}
	if (bestSplit < 0) return title.trim();
	const line1 = words.slice(0, bestSplit + 1).join(" ");
	const line2 = words.slice(bestSplit + 1).join(" ");
	return `${line1}\n${line2}`;
}

/**
 * Encode mono Float32 PCM samples to a 16-bit WAV ArrayBuffer (so post-cut
 * audio can be POSTed to the Whisper CLI transcribe route for re-transcription).
 */
function encodeWavPcm16({
	samples,
	sampleRate,
}: {
	samples: Float32Array;
	sampleRate: number;
}): ArrayBuffer {
	const n = samples.length;
	const buf = new ArrayBuffer(44 + n * 2);
	const v = new DataView(buf);
	const ws = (off: number, s: string) => {
		for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i));
	};
	ws(0, "RIFF");
	v.setUint32(4, 36 + n * 2, true);
	ws(8, "WAVE");
	ws(12, "fmt ");
	v.setUint32(16, 16, true);
	v.setUint16(20, 1, true); // PCM
	v.setUint16(22, 1, true); // mono
	v.setUint32(24, sampleRate, true);
	v.setUint32(28, sampleRate * 2, true); // byte rate
	v.setUint16(32, 2, true); // block align
	v.setUint16(34, 16, true); // bits per sample
	ws(36, "data");
	v.setUint32(40, n * 2, true);
	let off = 44;
	for (let i = 0; i < n; i++) {
		const x = Math.max(-1, Math.min(1, samples[i]));
		v.setInt16(off, x < 0 ? x * 0x8000 : x * 0x7fff, true);
		off += 2;
	}
	return buf;
}

/**
 * Pick the subset of editorial cuts whose total removed duration is closest
 * to `neededMs`, so the final edit lands near the target instead of
 * overshooting.  The LLM flags every returned segment as weak/redundant, so
 * any subset is editorially valid — we choose the one that best matches the
 * duration budget.
 *
 * Brute-forces all subsets when the cut count is small (≤ 16); for larger
 * lists it falls back to a greedy in-order pack.  Ties prefer the smaller
 * total (cut less → leave the video slightly longer, which reads closer to
 * the reference than cutting too much).
 */
function selectCutsWithinBudget({
	cuts,
	neededMs,
}: {
	cuts: { start_ms: number; end_ms: number; reason: string }[];
	neededMs: number;
}): { start_ms: number; end_ms: number; reason: string }[] {
	const valid = cuts.filter((c) => c.end_ms > c.start_ms);
	if (valid.length === 0 || neededMs <= 0) return [];

	const durMs = (c: { start_ms: number; end_ms: number }) =>
		c.end_ms - c.start_ms;
	const total = valid.reduce((s, c) => s + durMs(c), 0);

	// If everything fits within budget, take it all.
	if (total <= neededMs) return valid;

	// Small list → exact closest-subset-sum.
	if (valid.length <= 16) {
		let bestMask = 0;
		let bestDelta = Number.POSITIVE_INFINITY;
		let bestSum = Number.POSITIVE_INFINITY;
		const combos = 1 << valid.length;
		for (let mask = 1; mask < combos; mask++) {
			let sum = 0;
			for (let i = 0; i < valid.length; i++) {
				if (mask & (1 << i)) sum += durMs(valid[i]);
			}
			const delta = Math.abs(sum - neededMs);
			// Closest to budget; tie-break toward the smaller total (cut less).
			if (delta < bestDelta || (delta === bestDelta && sum < bestSum)) {
				bestDelta = delta;
				bestSum = sum;
				bestMask = mask;
			}
		}
		return valid.filter((_, i) => bestMask & (1 << i));
	}

	// Large list → greedy: take cuts in LLM (priority) order until the next
	// one would overshoot the budget by more than half its own length.
	const selected: typeof valid = [];
	let acc = 0;
	for (const c of valid) {
		const d = durMs(c);
		if (acc + d <= neededMs + d / 2) {
			selected.push(c);
			acc += d;
		}
		if (acc >= neededMs) break;
	}
	// Never return empty when cuts exist — take the single smallest.
	if (selected.length === 0) {
		const smallest = [...valid].sort((a, b) => durMs(a) - durMs(b))[0];
		return [smallest];
	}
	return selected;
}

/**
 * Group timeline transcript words into utterances by 300ms silence gaps.
 * Each utterance = one contiguous speech segment with its full text.
 */
function buildUtterancesFromWords(
	words: TimelineTranscriptWord[],
): { startMs: number; endMs: number; text: string }[] {
	const utterances: { startMs: number; endMs: number; text: string }[] = [];
	let current: { startMs: number; endMs: number; words: string[] } | null = null;

	for (const w of words) {
		if (!current || w.start_ms - current.endMs > 300) {
			if (current) {
				utterances.push({
					startMs: current.startMs,
					endMs: current.endMs,
					text: current.words.join(" "),
				});
			}
			current = { startMs: w.start_ms, endMs: w.end_ms, words: [w.text] };
		} else {
			current.endMs = w.end_ms;
			current.words.push(w.text);
		}
	}
	if (current) {
		utterances.push({
			startMs: current.startMs,
			endMs: current.endMs,
			text: current.words.join(" "),
		});
	}

	return utterances;
}

function detectWordStutterCuts({
	words,
}: {
	words: TimelineTranscriptWord[];
}): import("@/types/clipforge").TimelineDiffOp[] {
	const cuts: import("@/types/clipforge").TimelineDiffOp[] = [];

	for (let i = 0; i < words.length - 1; i++) {
		const current = words[i].text.toLowerCase().replace(/[^a-z']/g, "");
		const next = words[i + 1].text.toLowerCase().replace(/[^a-z']/g, "");

		if (current.length < 2) continue; // skip very short words
		if (current !== next) continue; // not a stutter

		// Check gap — stutters have < 300ms gap between duplicates
		const gap = words[i + 1].start_ms - words[i].end_ms;
		if (gap > 300) continue;

		// Cut the FIRST (stuttered) word, keep the second (clean) one
		cuts.push({
			type: "CUT_RANGE",
			start_ms: words[i].start_ms,
			end_ms: words[i].end_ms,
		});
	}

	return cuts;
}
