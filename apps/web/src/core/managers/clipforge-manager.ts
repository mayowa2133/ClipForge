import type { EditorCore } from "@/core";
import {
	BestEffortExportIntegration,
	buildClipIndex,
	buildSceneCaptionSegments,
	buildEmptyMediaMetadata,
	buildCreativeBriefFromPrompt,
	buildDraftImpactSummary,
	buildRetentionShapePlan,
	buildSceneFootageIntelligenceReport,
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
	isCreativeDraftIntent,
	planDraftRecipe as planCreativeDraftRecipe,
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
	CreativeBrief,
	DraftImpactSummary,
	DraftRecipe,
	FootageIntelligenceReport,
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
						this.applySceneCaptionStyle({ styleId });
						appliedSteps += 1;
						messages.push(`Applied caption style ${styleId}.`);
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
