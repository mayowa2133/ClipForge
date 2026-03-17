import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NumberField } from "@/components/ui/number-field";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { ENABLE_CLIPFORGE_CHAT } from "@/constants/feature-flags";
import { useEditor } from "@/hooks/use-editor";
import {
	buildProjectSummary,
	createChatOpsProvider,
	fetchChatPlannerHealth,
	getAudioPolishPresetLabel,
	getCaptionRevealLabel,
	getFinishingLookLabel,
	getPolishProfileLabel,
	normalizeChatPlanResult,
	projectValidatorWarnings,
	type TimelineOpsValidationError,
} from "@/lib/clipforge";
import { useClipForgeChatDraftStore } from "@/stores/clipforge-chat-draft-store";
import { useClipForgeChatSettingsStore } from "@/stores/clipforge-chat-settings-store";
import type {
	ClipForgeEditorCommand,
	CreativeBrief,
	DraftImpactSummary,
	DraftRecipe,
	TimelineDiffOp,
} from "@/types/clipforge";
import type {
	ChatClarificationRequest,
	ChatPlanPreviewResult,
	ChatPlannerContext,
	ChatPlannerOverrides,
	ChatPlannerHealth,
	ChatPlanSafetySummary,
	ChatProposalResult,
	ProjectSummary,
} from "@/lib/clipforge/chat";

interface ProposalMeta {
	provider: ChatProposalResult["provider"];
	fallbackUsed: boolean;
	warnings: string[];
	safety: ChatProposalResult["safety"];
}

interface PlannerRequestSnapshot {
	userText: string;
	projectSummary: ProjectSummary;
	context: ChatPlannerContext;
}

export function ChatContent() {
	const editor = useEditor();
	const plannerMode = useClipForgeChatSettingsStore((state) => state.plannerMode);
	const provider = useMemo(
		() => createChatOpsProvider({ mode: plannerMode }),
		[plannerMode],
	);
	const draft = useClipForgeChatDraftStore((state) => state.draft);
	const clearDraft = useClipForgeChatDraftStore((state) => state.clearDraft);
	const activeRequestIdRef = useRef(0);
	const [prompt, setPrompt] = useState("");
	const [isLoading, setIsLoading] = useState(false);
	const [proposedCommands, setProposedCommands] = useState<ClipForgeEditorCommand[]>([]);
	const [impactPreview, setImpactPreview] = useState<ChatPlanPreviewResult | null>(
		null,
	);
	const [draftRecipe, setDraftRecipe] = useState<DraftRecipe | null>(null);
	const [draftImpact, setDraftImpact] = useState<DraftImpactSummary | null>(null);
	const [enabledDraftStepsByIndex, setEnabledDraftStepsByIndex] = useState<
		Record<number, boolean>
	>({});
	const [draftBuildMessages, setDraftBuildMessages] = useState<string[]>([]);
	const [enabledCommandsByIndex, setEnabledCommandsByIndex] = useState<
		Record<number, boolean>
	>({});
	const [errors, setErrors] = useState<TimelineOpsValidationError[]>([]);
	const [proposalMeta, setProposalMeta] = useState<ProposalMeta | null>(null);
	const [plannerHealth, setPlannerHealth] = useState<ChatPlannerHealth | null>(null);
	const [plannerHealthError, setPlannerHealthError] = useState<string | null>(null);
	const [isCheckingHealth, setIsCheckingHealth] = useState(false);
	const [lastPlanError, setLastPlanError] = useState<string | null>(null);
	const [pendingClarification, setPendingClarification] =
		useState<ChatClarificationRequest | null>(null);
	const [lastPlannerRequest, setLastPlannerRequest] =
		useState<PlannerRequestSnapshot | null>(null);
	const [, setClarificationOverrides] =
		useState<ChatPlannerOverrides | null>(null);
	const selectedCommands = useMemo(
		() =>
			selectEnabledCommands({
				commands: proposedCommands,
				enabledCommandsByIndex,
			}),
		[proposedCommands, enabledCommandsByIndex],
	);
	const selectedDraftSteps = useMemo(
		() =>
			selectEnabledDraftSteps({
				recipe: draftRecipe,
				enabledStepsByIndex: enabledDraftStepsByIndex,
			}),
		[draftRecipe, enabledDraftStepsByIndex],
	);
	const sceneFootageIntelligence = useMemo(
		() => editor.clipforge.getSceneFootageIntelligence(),
		[editor, draftRecipe],
	);

	useEffect(() => {
		if (draft.length === 0) return;

		if (prompt.trim().length === 0) {
			setPrompt(draft);
		}
		clearDraft();
	}, [draft, prompt, clearDraft]);

	useEffect(() => {
		if (!ENABLE_CLIPFORGE_CHAT) return;
		if (plannerMode === "heuristic") {
			setPlannerHealthError(null);
			setIsCheckingHealth(false);
			return;
		}

		let cancelled = false;
		const loadPlannerHealth = async () => {
			setIsCheckingHealth(true);
			setPlannerHealthError(null);
			try {
				const health = await fetchChatPlannerHealth();
				if (!cancelled) {
					setPlannerHealth(health);
				}
			} catch (error) {
				if (!cancelled) {
					setPlannerHealthError(
						error instanceof Error
							? error.message
							: "Unable to check planner health.",
					);
				}
			} finally {
				if (!cancelled) {
					setIsCheckingHealth(false);
				}
			}
		};

		void loadPlannerHealth();

		return () => {
			cancelled = true;
		};
	}, [plannerMode]);

	useEffect(() => {
		if (proposedCommands.length === 0) return;

		const validation = editor.clipforge.validateCommands({
			commands: selectedCommands,
		});
		setErrors(validation.valid ? [] : validation.errors);
	}, [editor, proposedCommands, selectedCommands]);

	const resetPreview = () => {
		setImpactPreview(null);
		setEnabledCommandsByIndex({});
	};

	const resetDraftRecipe = () => {
		setDraftRecipe(null);
		setDraftImpact(null);
		setEnabledDraftStepsByIndex({});
	};

	const buildPreviewForCommands = ({
		commands,
	}: {
		commands: ClipForgeEditorCommand[];
	}) => {
		const preview = editor.clipforge.previewCommandsImpact({ commands });
		setImpactPreview(preview);
		setEnabledCommandsByIndex(buildEnabledCommandsMap({ commands }));
	};

	const buildPreviewForDraftRecipe = ({ recipe }: { recipe: DraftRecipe }) => {
		setDraftRecipe(recipe);
		setDraftImpact(editor.clipforge.previewDraftRecipe({ recipe }));
		setEnabledDraftStepsByIndex(buildEnabledDraftStepsMap({ recipe }));
	};

	const handlePropose = async () => {
		if (isLoading) return;

		const activeProject = editor.project.getActive();
		if (!activeProject) {
			toast.error("No active project.");
			return;
		}
		if (prompt.trim().length === 0) {
			toast.error("Enter an edit request first.");
			return;
		}

		const requestId = activeRequestIdRef.current + 1;
		activeRequestIdRef.current = requestId;
		clearDraft();
		setIsLoading(true);
		setLastPlanError(null);
		setErrors([]);
		setProposalMeta(null);
		resetPreview();
		resetDraftRecipe();
		setDraftBuildMessages([]);
		setPendingClarification(null);
		setClarificationOverrides(null);
		try {
			const playheadMs = Math.round(editor.playback.getCurrentTime() * 1000);
			const selectedSegmentIds = editor.selection
				.getSelectedElements()
				.map((element) => element.elementId);
			const projectSummary = buildProjectSummary({
				project: activeProject,
				mediaAssets: editor.media.getAssets(),
				playheadMs,
				selectedSegmentIds,
				projectKitTemplates: editor.project.getProjectKitTemplates(),
				sceneRecipeTemplates: editor.project.getSceneRecipeTemplates(),
			});
			const plannerRequest: PlannerRequestSnapshot = {
				userText: prompt,
				projectSummary,
				context: {
					playhead_ms: playheadMs,
					selected_segment_ids: selectedSegmentIds,
					active_scene_id: activeProject.currentSceneId ?? null,
				},
			};
			setLastPlannerRequest(plannerRequest);
			if (editor.clipforge.isDraftBuildIntent({ prompt: plannerRequest.userText })) {
				try {
					await editor.clipforge.analyzeSceneFootageIntelligence();
				} catch (error) {
					console.warn("Footage intelligence analysis failed:", error);
				}
				const brief = editor.clipforge.buildCreativeBrief({
					prompt: plannerRequest.userText,
					context: plannerRequest.context,
				});
				const recipe = editor.clipforge.planDraftRecipe({ brief });
				buildPreviewForDraftRecipe({ recipe });
				setProposedCommands([]);
				setErrors([]);
				setLastPlanError(null);
				setPendingClarification(null);
				return;
			}
			const result = normalizeChatPlanResult(
				await provider.proposeEdits(plannerRequest),
			);
			if (activeRequestIdRef.current !== requestId) {
				return;
			}

			if (result.clarification) {
				setProposalMeta({
					provider: result.provider,
					fallbackUsed: result.fallbackUsed,
					warnings: result.warnings,
					safety: result.safety ?? null,
				});
				setProposedCommands([]);
				setErrors([]);
				resetPreview();
				setPendingClarification(result.clarification);
				setLastPlanError(null);
				return;
			}
			setPendingClarification(null);

			if (result.commands.length === 0) {
				setProposedCommands([]);
				setErrors([]);
				resetPreview();
				toast.error("No deterministic editor commands could be generated.");
				return;
			}

			const reconciliation = editor.clipforge.reconcileAndValidateCommands({
				userText: plannerRequest.userText,
				projectSummary: plannerRequest.projectSummary,
				context: plannerRequest.context,
				commands: result.commands,
			});
			const validatorWarnings = projectValidatorWarnings({
				notices: reconciliation.safety.notices,
			});
			const mergedWarnings = [...result.warnings, ...validatorWarnings];
			const mergedSafety = mergeSafetySummaries(
				result.safety ?? null,
				reconciliation.safety,
			);
			setProposalMeta({
				provider: result.provider,
				fallbackUsed: result.fallbackUsed,
				warnings: mergedWarnings,
				safety: mergedSafety,
			});

			if (reconciliation.clarification) {
				setPendingClarification(reconciliation.clarification);
				setProposedCommands([]);
				setErrors([]);
				resetPreview();
				setLastPlanError(null);
				return;
			}

			if (reconciliation.blocked || reconciliation.commands.length === 0) {
				setProposedCommands([]);
				setErrors(
					reconciliation.secondPassErrors.length > 0
						? reconciliation.secondPassErrors
						: reconciliation.firstPassErrors,
				);
				resetPreview();
				setLastPlanError(null);
				toast.error("Unable to produce validator-clean deterministic commands.");
				return;
			}

			setProposedCommands(reconciliation.commands);
			buildPreviewForCommands({ commands: reconciliation.commands });
			setErrors([]);
			setLastPlanError(null);
		} catch (error) {
			if (activeRequestIdRef.current !== requestId) {
				return;
			}
			setProposalMeta(null);
			resetPreview();
			const message =
				error instanceof Error ? error.message : "Please try again.";
			setLastPlanError(message);
			toast.error("Failed to propose edits.", {
				description: message,
			});
		} finally {
			if (activeRequestIdRef.current === requestId) {
				setIsLoading(false);
			}
		}
	};

	const handleClarificationSelection = async ({
		referenceLabel,
		choiceValue,
	}: {
		referenceLabel: string;
		choiceValue: string;
	}) => {
		if (!lastPlannerRequest || isLoading) {
			return;
		}

		const requestId = activeRequestIdRef.current + 1;
		activeRequestIdRef.current = requestId;
		const overrides: ChatPlannerOverrides =
			choiceValue.startsWith("segment:")
				? {
						forced_segment_ids_by_reference: {
							[referenceLabel]: choiceValue.slice("segment:".length),
						},
				  }
				: {
						forced_segment_ids_by_reference: {},
						forced_choice_values_by_reference: {
							[referenceLabel]: choiceValue,
						},
				  };
		setClarificationOverrides(overrides);
		setIsLoading(true);
		setLastPlanError(null);
		setErrors([]);
		resetPreview();
		try {
			const result = normalizeChatPlanResult(
				await provider.proposeEdits({
					...lastPlannerRequest,
					overrides,
				}),
			);
			if (activeRequestIdRef.current !== requestId) {
				return;
			}

			if (result.clarification) {
				setProposalMeta({
					provider: result.provider,
					fallbackUsed: result.fallbackUsed,
					warnings: result.warnings,
					safety: result.safety ?? null,
				});
				setPendingClarification(result.clarification);
				setProposedCommands([]);
				setErrors([]);
				resetPreview();
				return;
			}

			setPendingClarification(null);
			if (result.commands.length === 0) {
				setProposedCommands([]);
				setErrors([]);
				resetPreview();
				toast.error("No deterministic editor commands could be generated.");
				return;
			}

			const reconciliation = editor.clipforge.reconcileAndValidateCommands({
				userText: lastPlannerRequest.userText,
				projectSummary: lastPlannerRequest.projectSummary,
				context: lastPlannerRequest.context,
				overrides,
				commands: result.commands,
			});
			const validatorWarnings = projectValidatorWarnings({
				notices: reconciliation.safety.notices,
			});
			const mergedWarnings = [...result.warnings, ...validatorWarnings];
			const mergedSafety = mergeSafetySummaries(
				result.safety ?? null,
				reconciliation.safety,
			);
			setProposalMeta({
				provider: result.provider,
				fallbackUsed: result.fallbackUsed,
				warnings: mergedWarnings,
				safety: mergedSafety,
			});

			if (reconciliation.clarification) {
				setPendingClarification(reconciliation.clarification);
				setProposedCommands([]);
				setErrors([]);
				resetPreview();
				return;
			}

			if (reconciliation.blocked || reconciliation.commands.length === 0) {
				setProposedCommands([]);
				setErrors(
					reconciliation.secondPassErrors.length > 0
						? reconciliation.secondPassErrors
						: reconciliation.firstPassErrors,
				);
				resetPreview();
				toast.error("Unable to produce validator-clean deterministic commands.");
				return;
			}

			setProposedCommands(reconciliation.commands);
			buildPreviewForCommands({ commands: reconciliation.commands });
			setErrors([]);
		} catch (error) {
			if (activeRequestIdRef.current !== requestId) {
				return;
			}
			setPendingClarification(null);
			resetPreview();
			const message =
				error instanceof Error ? error.message : "Please try again.";
			setLastPlanError(message);
			toast.error("Failed to propose edits.", {
				description: message,
			});
		} finally {
			if (activeRequestIdRef.current === requestId) {
				setIsLoading(false);
			}
		}
	};

	const handleApply = async () => {
		if (selectedCommands.length === 0) return;

		try {
			const result = await editor.clipforge.applyCommands({
				commands: selectedCommands,
				source: "chat",
				prompt,
			});
			if (!result.applied) {
				setErrors(result.errors);
				toast.error("Commands were rejected by validation.");
				return;
			}

			toast.success("Chat edits applied.");
			setPrompt("");
			setProposedCommands([]);
			resetPreview();
			resetDraftRecipe();
			setDraftBuildMessages([]);
			setErrors([]);
			setProposalMeta(null);
			setLastPlanError(null);
			setPendingClarification(null);
			setClarificationOverrides(null);
		} catch (error) {
			const message =
				error instanceof Error ? error.message : "Failed to apply planned edits.";
			setLastPlanError(message);
			toast.error("Failed to apply planned edits.", {
				description: message,
			});
		}
	};

	const handleToggleDraftStep = ({ stepIndex }: { stepIndex: number }) => {
		setEnabledDraftStepsByIndex((previous) => ({
			...previous,
			[stepIndex]: previous[stepIndex] === false,
		}));
	};

	const handleDraftBriefChange = ({
		nextBrief,
	}: {
		nextBrief: CreativeBrief;
	}) => {
		const nextRecipe = editor.clipforge.planDraftRecipe({ brief: nextBrief });
		buildPreviewForDraftRecipe({ recipe: nextRecipe });
	};

	const handleBuildDraft = async () => {
		if (!draftRecipe || selectedDraftSteps.length === 0) return;

		try {
			const result = await editor.clipforge.applyDraftRecipe({
				recipe: {
					...draftRecipe,
					operations: selectedDraftSteps,
				},
			});
			setDraftBuildMessages(result.messages);
			setPrompt("");
			setProposalMeta(null);
			setErrors([]);
			resetPreview();
			resetDraftRecipe();
			setPendingClarification(null);
			setClarificationOverrides(null);
			toast.success("Draft built.");
		} catch (error) {
			const message =
				error instanceof Error ? error.message : "Failed to build draft.";
			setLastPlanError(message);
			toast.error("Failed to build draft.", {
				description: message,
			});
		}
	};

	const handleToggleCommand = ({ commandIndex }: { commandIndex: number }) => {
		setEnabledCommandsByIndex((previous) => ({
			...previous,
			[commandIndex]: previous[commandIndex] === false,
		}));
	};

	const handleCycleReferenceDraftMatch = ({ matchId }: { matchId: string }) => {
		setProposedCommands((previous) => {
			const next = previous.map((command) => {
				if (command.kind !== "build-reference-draft") {
					return command;
				}
				return {
					...command,
					matches: command.matches.map((match) => {
						if (match.match_id !== matchId || match.candidates.length <= 1) {
							return match;
						}
						const currentIndex = Math.max(
							0,
							match.candidates.findIndex(
								(candidate) => candidate.asset_id === match.selected_asset_id,
							),
						);
						const nextCandidate =
							match.candidates[(currentIndex + 1) % match.candidates.length] ??
							match.candidates[0];
						return nextCandidate
							? {
									...match,
									selected_asset_id: nextCandidate.asset_id,
									selected_asset_name: nextCandidate.asset_name,
									selected_range_id: nextCandidate.range_id,
									selected_start_ms: nextCandidate.start_ms,
									selected_end_ms: nextCandidate.end_ms,
									reasons: nextCandidate.reasons,
							  }
							: match;
					}),
				};
			});
			buildPreviewForCommands({ commands: next });
			return next;
		});
	};

	const handleToggleReferenceDraftLock = ({ matchId }: { matchId: string }) => {
		setProposedCommands((previous) => {
			const next = previous.map((command) => {
				if (command.kind !== "build-reference-draft") {
					return command;
				}
				return {
					...command,
					matches: command.matches.map((match) =>
						match.match_id === matchId
							? {
									...match,
									locked: !match.locked,
							  }
							: match,
					),
				};
			});
			buildPreviewForCommands({ commands: next });
			return next;
		});
	};

	const handleJumpToTarget = ({
		timeMs,
		trackId,
		segmentId,
	}: {
		timeMs: number;
		trackId: string | null;
		segmentId: string | null;
	}) => {
		editor.playback.seek({ time: Math.max(0, timeMs) / 1000 });
		if (trackId && segmentId) {
			editor.selection.setSelectedElements({
				elements: [{ trackId, elementId: segmentId }],
			});
		}
	};

	if (!ENABLE_CLIPFORGE_CHAT) {
		return (
			<div className="text-muted-foreground text-sm">
				Enable `ENABLE_CLIPFORGE_CHAT=true` to use chat edits.
			</div>
		);
	}

	const plannerLabel =
		plannerMode === "openai"
			? "OpenAI"
			: plannerMode === "heuristic"
				? "Heuristic"
				: "Auto";
	const healthToneClassName =
		plannerMode === "heuristic"
			? "border-slate-400/40 bg-slate-500/10 text-slate-600"
			: plannerHealth?.status === "ready"
				? "border-emerald-400/40 bg-emerald-500/10 text-emerald-600"
				: plannerHealth?.status === "degraded"
					? "border-amber-400/40 bg-amber-500/10 text-amber-600"
					: "border-red-400/40 bg-red-500/10 text-red-600";
	const healthSummary =
		plannerMode === "heuristic"
			? "Heuristic mode active"
			: isCheckingHealth
				? "Checking planner health..."
				: plannerHealthError
					? plannerHealthError
					: plannerHealth?.status === "ready"
						? "OpenAI ready"
						: plannerHealth?.status === "degraded"
							? "OpenAI degraded"
							: "OpenAI unavailable";
	const healthDetail =
		plannerMode === "auto"
			? "Auto mode will fall back to heuristic if needed."
			: plannerMode === "openai"
				? plannerHealth?.message ?? "OpenAI mode fails closed."
				: "The deterministic local planner is active.";
	const playheadMs = Math.round(editor.playback.getCurrentTime() * 1000);
	const selectedCount = editor.selection.getSelectedElements().length;
	const activeProject = editor.project.getActiveOrNull();
	const referenceSummary = useMemo(() => {
		if (!activeProject) {
			return null;
		}
		return buildProjectSummary({
			project: activeProject,
			mediaAssets: editor.media.getAssets(),
			playheadMs,
			selectedSegmentIds: editor.selection
				.getSelectedElements()
				.map((selection) => selection.elementId),
			projectKitTemplates: editor.project.getProjectKitTemplates(),
			sceneRecipeTemplates: editor.project.getSceneRecipeTemplates(),
		});
	}, [activeProject, editor, playheadMs, selectedCount]);
	const captionStyleOptions = activeProject?.clipforge
		? Object.values(activeProject.clipforge.captionStylesById)
		: [];
	const overlayStyleOptions = [
		{ value: "clean-vlog", label: "Clean vlog" },
		{ value: "bold-social", label: "Bold social" },
		{ value: "luxury", label: "Luxury" },
		{ value: "minimal", label: "Minimal" },
	] as const;
	const contextSummary = `Context: ${
		selectedCount > 0 ? `${selectedCount} selected` : "no selection"
	}, playhead ${formatPlannerTime(playheadMs)}`;

	return (
		<div className="flex h-full flex-col gap-3">
			<div className="flex flex-col gap-2">
				<Label>Ask ClipForge to edit this timeline</Label>
				<div className="rounded-md border p-3">
					<div className="flex items-center justify-between gap-3">
						<p className="text-sm font-medium">Planner: {plannerLabel}</p>
						<span
							className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${healthToneClassName}`}
						>
							{plannerMode === "heuristic"
								? "active"
								: plannerHealth?.status ?? "unknown"}
						</span>
					</div>
					<p className="mt-2 text-sm">{healthSummary}</p>
					<p className="text-muted-foreground mt-1 text-xs">{healthDetail}</p>
					<p className="text-muted-foreground mt-1 text-xs">{contextSummary}</p>
				</div>
				{lastPlanError && (
					<div className="rounded-md border border-red-300 bg-red-50 p-3">
						<p className="mb-1 text-sm font-medium">Planner error</p>
						<p className="text-xs">{lastPlanError}</p>
					</div>
				)}
				{referenceSummary?.active_reference_video && (
					<div className="rounded-md border p-3">
						<div className="flex items-center justify-between gap-3">
							<p className="text-sm font-medium">Reference video</p>
							<span className="text-muted-foreground text-[10px] uppercase tracking-wide">
								{referenceSummary.active_reference_video.status}
							</span>
						</div>
						<p className="mt-1 text-sm">
							{referenceSummary.active_reference_video.name}
						</p>
						<p className="text-muted-foreground mt-1 text-xs">
							{referenceSummary.reference_match_readiness.reason}
						</p>
						<p className="text-muted-foreground mt-1 text-xs">
							Assembly pool: {referenceSummary.assembly_source_pool.length} clips ·{" "}
							{referenceSummary.footage_match_readiness.reason}
						</p>
					</div>
				)}
				<textarea
					className="min-h-24 rounded-md border p-2 text-sm"
					value={prompt}
					onChange={(event) => setPrompt(event.target.value)}
					placeholder='Try: "trim this clip by 0.5s at the start", "add text here that says \"watch this\"", "replace \"teh\" with \"the\" in this caption"'
				/>
				<Button onClick={handlePropose} disabled={isLoading}>
					{isLoading ? "Proposing..." : "Propose Plan"}
				</Button>
			</div>

			{proposalMeta && (
				<p className="text-muted-foreground text-xs">
					Planned by: {proposalMeta.provider === "openai" ? "OpenAI" : "Heuristic"}
					{proposalMeta.fallbackUsed ? " (fallback)" : ""}
				</p>
			)}

			{proposalMeta && proposalMeta.warnings.length > 0 && (
				<div className="rounded-md border border-amber-300 bg-amber-50 p-3">
					<p className="mb-1 text-sm font-medium">Planner warnings</p>
					<ul className="list-disc space-y-1 pl-4 text-xs">
						{proposalMeta.warnings.map((warning, index) => (
							<li key={`${warning}-${index}`}>{warning}</li>
						))}
					</ul>
				</div>
			)}

			{proposalMeta?.safety && (
				<div className="rounded-md border p-3">
					<p className="mb-1 text-sm font-medium">Plan safety</p>
					<p className="text-xs">
						Repaired: {proposalMeta.safety.repairedCount} · Dropped:{" "}
						{proposalMeta.safety.droppedCount} · Blocked:{" "}
						{proposalMeta.safety.blocked ? "Yes" : "No"}
					</p>
				</div>
			)}

			{pendingClarification && (
				<div className="flex flex-col gap-2 rounded-md border p-3">
					<div>
						<p className="text-sm font-medium">Need clarification</p>
						<p className="text-muted-foreground text-xs">
							{pendingClarification.prompt}
						</p>
					</div>
					<div className="flex flex-col gap-2">
						{pendingClarification.options.map((option) => (
							<button
								key={option.id}
								type="button"
								className="rounded-md border px-3 py-2 text-left text-sm"
								onClick={() =>
									void handleClarificationSelection({
										referenceLabel: pendingClarification.referenceLabel,
										choiceValue: option.segment_id
											? `segment:${option.segment_id}`
											: option.value,
									})
								}
							>
								<span className="block font-medium">{option.label}</span>
								<span className="text-muted-foreground block text-xs">
									{option.text_preview}
								</span>
							</button>
						))}
					</div>
					<div>
						<Button
							variant="outline"
							onClick={() => {
								setPendingClarification(null);
								setClarificationOverrides(null);
							}}
						>
							Cancel
						</Button>
					</div>
				</div>
			)}

			{draftRecipe && (
				<div className="flex flex-col gap-3 rounded-md border p-3">
					<div className="flex items-start justify-between gap-3">
						<div>
							<p className="text-sm font-medium">Creative brief</p>
							<p className="text-muted-foreground text-xs">
								First-draft plan for the active scene.
							</p>
						</div>
						<p className="text-muted-foreground text-xs">
							{draftImpact?.totalSteps ?? draftRecipe.operations.length} steps
						</p>
					</div>
					<div className="grid grid-cols-2 gap-3">
						<div className="flex flex-col gap-2">
							<Label>Target length</Label>
							<NumberField
								value={draftRecipe.brief.durationTargetS ?? 0}
								min={5}
								max={60}
								step={1}
								onChange={(event) =>
									handleDraftBriefChange({
										nextBrief: {
											...draftRecipe.brief,
											durationTargetS: Math.max(
												5,
												Number.parseInt(event.currentTarget.value || "0", 10) || 0,
											),
										},
									})
								}
							/>
						</div>
						<div className="flex flex-col gap-2">
							<Label>Look</Label>
							<Select
								value={draftRecipe.brief.overlayStyleVariantId ?? "clean-vlog"}
								onValueChange={(value) =>
									handleDraftBriefChange({
										nextBrief: {
											...draftRecipe.brief,
											overlayStyleVariantId: value,
											tone:
												value === "luxury"
													? "luxury"
													: value === "bold-social"
														? "bold"
														: value === "minimal"
															? "minimal"
															: "clean",
										},
									})
								}
							>
								<SelectTrigger>
									<SelectValue placeholder="Style" />
								</SelectTrigger>
								<SelectContent>
									{overlayStyleOptions.map((option) => (
										<SelectItem key={option.value} value={option.value}>
											{option.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
						<div className="flex flex-col gap-2">
							<Label>Caption look</Label>
							<Select
								value={draftRecipe.brief.captionStyleId ?? "bold-center"}
								onValueChange={(value) =>
									handleDraftBriefChange({
										nextBrief: {
											...draftRecipe.brief,
											captionStyleId: value,
										},
									})
								}
							>
								<SelectTrigger>
									<SelectValue placeholder="Caption style" />
								</SelectTrigger>
								<SelectContent>
									{captionStyleOptions.map((style) => (
										<SelectItem key={style.style_id} value={style.style_id}>
											{style.style_id}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
						<div className="flex flex-col gap-2">
							<Label>Publish targets</Label>
							<p className="text-muted-foreground rounded-md border px-3 py-2 text-xs">
								{draftRecipe.brief.versionTargets.join(", ")}
							</p>
						</div>
					</div>
					<div className="rounded-md border px-3 py-2">
						<p className="text-sm font-medium">Story arc</p>
						<ul className="text-muted-foreground mt-2 space-y-1 text-xs">
							{draftRecipe.sections.map((section) => (
								<li key={`${section.kind}-${section.label}`}>
									{section.label}: {section.targetDurationS.toFixed(1)}s ·{" "}
									{formatDraftSectionStrategy({ strategy: section.strategy })}
								</li>
							))}
						</ul>
					</div>
					<div className="rounded-md border px-3 py-2">
						<p className="text-sm font-medium">Polish</p>
						{(() => {
							const polishProfile = resolveDraftPolishProfile({
								recipe: draftRecipe,
							});
							return (
						<div className="text-muted-foreground mt-2 space-y-1 text-xs">
							<p>
								<span className="font-medium text-foreground">Profile:</span>{" "}
								{polishProfile.label}
							</p>
							<p>
								<span className="font-medium text-foreground">Caption reveal:</span>{" "}
								{getCaptionRevealLabel({
									presetId: polishProfile.captionRevealPresetId,
								})}
							</p>
							<p>
								<span className="font-medium text-foreground">Audio polish:</span>{" "}
								{getAudioPolishPresetLabel({
									id: polishProfile.audioPolishPresetId,
								})}
							</p>
							<p>
								<span className="font-medium text-foreground">Finishing look:</span>{" "}
								{getFinishingLookLabel({
									lookId: polishProfile.finishingLookId,
								})}
							</p>
						</div>
							);
						})()}
					</div>
					{draftRecipe.retentionShape && (
						<div className="rounded-md border px-3 py-2">
							<p className="text-sm font-medium">Story shape</p>
							<div className="text-muted-foreground mt-2 space-y-2 text-xs">
								<div>
									<p className="font-medium text-foreground">Recommended opener</p>
									{(() => {
										const candidate =
											sceneFootageIntelligence?.hookCandidates.find(
												(item) => item.id === draftRecipe.retentionShape?.hookCandidateId,
											) ?? null;
										if (!candidate) {
											return (
												<p>
													Hook-first shaping will follow the current opener because no
													scored opener beat was available.
												</p>
											);
										}
										return (
											<p>
												{formatSeconds(candidate.startTime)} to{" "}
												{formatSeconds(candidate.endTime)} ·{" "}
												{candidate.reasons[0] ?? "Strong early hook moment."}
											</p>
										);
									})()}
								</div>
								<div>
									<p className="font-medium text-foreground">Retention beats</p>
									<ul className="mt-1 space-y-1">
										{draftRecipe.retentionShape.beats.map((beat) => (
											<li key={`${beat.kind}-${beat.startTime}-${beat.endTime}`}>
												{formatRetentionBeatKind({ kind: beat.kind })}:{" "}
												{formatSeconds(beat.startTime)} to {formatSeconds(beat.endTime)} ·{" "}
												{formatDraftSectionStrategy({ strategy: beat.strategy })}
											</li>
										))}
									</ul>
								</div>
								{draftRecipe.retentionShape.steps.filter(
									(step) =>
										step.kind === "trim-setup" ||
										step.kind === "delay-context" ||
										step.kind === "compress-body",
								).length > 0 && (
									<div>
										<p className="font-medium text-foreground">Likely setup trims</p>
										<ul className="mt-1 space-y-1">
											{draftRecipe.retentionShape.steps
												.filter(
													(step) =>
														step.kind === "trim-setup" ||
														step.kind === "delay-context" ||
														step.kind === "compress-body",
												)
												.slice(0, 3)
												.map((step, index) => (
													<li key={`${step.kind}-${index}`}>
														{formatRetentionStepLabel({ kind: step.kind })} ·{" "}
														{step.reasons[0] ?? "Trim weaker context before the body."}
													</li>
												))}
										</ul>
									</div>
								)}
								{draftRecipe.retentionShape.payoffMomentIds?.length ? (
									<div>
										<p className="font-medium text-foreground">Payoff anchor</p>
										{(() => {
											const payoffMoment = sceneFootageIntelligence?.momentScores.find(
												(moment) =>
													draftRecipe.retentionShape?.payoffMomentIds?.includes(moment.id),
											);
											return (
												<p>
													{payoffMoment
														? `${formatSeconds(payoffMoment.startTime)} to ${formatSeconds(payoffMoment.endTime)} · ${payoffMoment.reasons[0] ?? "Strong later moment."}`
														: "A later payoff beat is reserved for the reveal or result."}
												</p>
											);
										})()}
									</div>
								) : null}
								{draftRecipe.retentionShape.warnings.length > 0 && (
									<div>
										<p className="font-medium text-foreground">Structure warnings</p>
										<ul className="mt-1 space-y-1">
											{draftRecipe.retentionShape.warnings.map((warning, index) => (
												<li key={`${warning}-${index}`}>{warning}</li>
											))}
										</ul>
									</div>
								)}
							</div>
						</div>
					)}
					{sceneFootageIntelligence && (
						<div className="rounded-md border px-3 py-2">
							<p className="text-sm font-medium">Footage insights</p>
							<div className="text-muted-foreground mt-2 space-y-2 text-xs">
								{draftRecipe.hookCandidateId && (
									<div>
										<p className="font-medium text-foreground">Recommended opener</p>
										{(() => {
											const candidate = sceneFootageIntelligence.hookCandidates.find(
												(item) => item.id === draftRecipe.hookCandidateId,
											);
											if (!candidate) {
												return (
													<p>Hook scoring is unavailable, so the opener will follow clip order.</p>
												);
											}
											return (
												<p>
													{formatSeconds(candidate.startTime)} to {formatSeconds(candidate.endTime)} ·{" "}
													{candidate.reasons[0] ?? "Strong early moment."}
												</p>
											);
										})()}
									</div>
								)}
								{sceneFootageIntelligence.momentScores.slice(0, 3).length > 0 && (
									<div>
										<p className="font-medium text-foreground">Strong moments</p>
										<ul className="mt-1 space-y-1">
											{sceneFootageIntelligence.momentScores.slice(0, 3).map((moment) => (
												<li key={moment.id}>
													{formatSeconds(moment.startTime)} to {formatSeconds(moment.endTime)} ·{" "}
													{moment.reasons[0] ?? "High-signal moment."}
												</li>
											))}
										</ul>
									</div>
								)}
								{sceneFootageIntelligence.keepCutRecommendations.filter(
									(recommendation) => recommendation.action !== "keep",
								).length > 0 && (
									<div>
										<p className="font-medium text-foreground">Likely trims and cuts</p>
										<ul className="mt-1 space-y-1">
											{sceneFootageIntelligence.keepCutRecommendations
												.filter((recommendation) => recommendation.action !== "keep")
												.slice(0, 3)
												.map((recommendation) => (
													<li key={recommendation.id}>
														{recommendation.action === "trim" ? "Trim" : "Cut"} ·{" "}
														{formatSeconds(recommendation.startTime)} to{" "}
														{formatSeconds(recommendation.endTime)} ·{" "}
														{recommendation.reasons[0] ?? "Weak footage span."}
													</li>
												))}
										</ul>
									</div>
								)}
								{sceneFootageIntelligence.warnings.length > 0 && (
									<div>
										<p className="font-medium text-foreground">Analysis warnings</p>
										<ul className="mt-1 space-y-1">
											{sceneFootageIntelligence.warnings.slice(0, 2).map((warning, index) => (
												<li key={`${warning}-${index}`}>{warning}</li>
											))}
										</ul>
									</div>
								)}
							</div>
						</div>
					)}
					<div className="rounded-md border px-3 py-2">
						<p className="text-sm font-medium">Build plan</p>
						<div className="mt-2 flex flex-col gap-2">
							{draftRecipe.operations.map((step, index) => {
								const enabled = enabledDraftStepsByIndex[index] !== false;
								return (
									<label
										key={`${step.kind}-${index}`}
										className="flex cursor-pointer items-start gap-2 text-sm"
									>
										<input
											type="checkbox"
											checked={enabled}
											onChange={() => handleToggleDraftStep({ stepIndex: index })}
										/>
										<span>
											<span className="block font-medium">
												{formatDraftStepLabel({ step })}
											</span>
											<span className="text-muted-foreground block text-xs">
												{formatDraftStepDetail({ step })}
											</span>
										</span>
									</label>
								);
							})}
						</div>
					</div>
					{draftRecipe.warnings.length > 0 && (
						<div className="rounded-md border border-amber-300 bg-amber-50 p-3">
							<p className="mb-1 text-sm font-medium">Things to know</p>
							<ul className="list-disc space-y-1 pl-4 text-xs">
								{draftRecipe.warnings.map((warning, index) => (
									<li key={`${warning}-${index}`}>{warning}</li>
								))}
							</ul>
						</div>
					)}
					<div className="flex gap-2">
						<Button
							onClick={() => void handleBuildDraft()}
							disabled={selectedDraftSteps.length === 0}
						>
							Build first draft
						</Button>
						<Button
							variant="outline"
							onClick={() => {
								resetDraftRecipe();
								setDraftBuildMessages([]);
							}}
						>
							Cancel
						</Button>
					</div>
				</div>
			)}

			{proposedCommands.length > 0 && (
				<div className="flex flex-1 flex-col gap-2">
					{impactPreview && (
						<div className="rounded-md border p-3">
							<p className="text-sm font-medium">Plan impact</p>
							<p className="text-muted-foreground mb-2 text-xs">
								{impactPreview.summary.impactCount} impacts · Duration delta{" "}
								{formatSignedDurationMs(
									impactPreview.summary.simulatedDurationDeltaMs,
								)}
							</p>
							<div className="flex max-h-52 flex-col gap-2 overflow-auto pr-1">
								{impactPreview.cards.map((card) => {
									const enabled = enabledCommandsByIndex[card.opIndex] !== false;
									return (
										<div
											key={`${card.opType}-${card.opIndex}`}
											className="rounded-md border px-3 py-2"
										>
											<div className="flex items-start justify-between gap-2">
												<label className="flex cursor-pointer items-start gap-2 text-sm">
													<input
														type="checkbox"
														checked={enabled}
														onChange={() =>
															handleToggleCommand({
																commandIndex: card.opIndex,
															})
														}
													/>
													<span>
														<span className="block font-medium">
															{card.title}
														</span>
														<span className="text-muted-foreground block text-xs">
															{card.detail}
														</span>
														{card.beforeText && (
															<span className="text-muted-foreground block text-xs">
																Before: {card.beforeText}
															</span>
														)}
														{card.afterText && (
															<span className="text-muted-foreground block text-xs">
																After: {card.afterText}
															</span>
														)}
													</span>
												</label>
												{card.jump && (
													<Button
														type="button"
														variant="outline"
														size="sm"
														onClick={() =>
															handleJumpToTarget({
																timeMs: card.jump?.time_ms ?? 0,
																trackId: card.jump?.track_id ?? null,
																segmentId: card.jump?.segment_id ?? null,
															})
														}
													>
														Jump
													</Button>
												)}
											</div>
										</div>
									);
								})}
							</div>
						</div>
					)}
					{proposedCommands.some((command) => command.kind === "build-reference-draft") && (
						<div className="rounded-md border p-3">
							<p className="text-sm font-medium">Reference draft matches</p>
							<p className="text-muted-foreground mb-2 text-xs">
								Review why each section was chosen, cycle alternates, or lock a section
								before apply.
							</p>
							<div className="flex max-h-56 flex-col gap-2 overflow-auto pr-1">
								{proposedCommands.flatMap((command) =>
									command.kind === "build-reference-draft"
										? command.matches.map((match) => (
												<div
													key={match.match_id}
													className="rounded-md border px-3 py-2"
												>
													<div className="flex items-start justify-between gap-2">
														<div>
															<p className="text-sm font-medium">
																{match.section_label}
															</p>
															<p className="text-muted-foreground text-xs">
																{match.selected_asset_name}
																{match.locked ? " · locked" : ""}
															</p>
															<ul className="text-muted-foreground mt-1 list-disc space-y-1 pl-4 text-[11px]">
																{match.reasons.slice(0, 2).map((reason, index) => (
																	<li key={`${match.match_id}-${index}`}>{reason}</li>
																))}
															</ul>
														</div>
														<div className="flex gap-2">
															<Button
																type="button"
																variant="outline"
																size="sm"
																onClick={() =>
																	handleCycleReferenceDraftMatch({
																		matchId: match.match_id,
																	})
																}
																disabled={match.candidates.length <= 1}
															>
																Swap
															</Button>
															<Button
																type="button"
																variant="outline"
																size="sm"
																onClick={() =>
																	handleToggleReferenceDraftLock({
																		matchId: match.match_id,
																	})
																}
															>
																{match.locked ? "Unlock" : "Lock"}
															</Button>
														</div>
													</div>
												</div>
											))
										: [],
								)}
							</div>
						</div>
					)}
					<Label>
						Selected JSON Commands ({selectedCommands.length}/{proposedCommands.length})
					</Label>
					<pre className="bg-muted max-h-64 overflow-auto rounded-md border p-3 text-xs">
						{JSON.stringify(selectedCommands, null, 2)}
					</pre>
					<div className="flex gap-2">
						<Button
							onClick={() => void handleApply()}
							disabled={errors.length > 0 || selectedCommands.length === 0}
						>
							Apply
						</Button>
						<Button
							variant="outline"
							onClick={() => {
								setProposedCommands([]);
								resetPreview();
								setErrors([]);
								setProposalMeta(null);
								setPendingClarification(null);
								setClarificationOverrides(null);
							}}
						>
							Cancel
						</Button>
					</div>
				</div>
			)}

			{draftBuildMessages.length > 0 && (
				<div className="rounded-md border p-3">
					<p className="mb-1 text-sm font-medium">What was built</p>
					<ul className="list-disc space-y-1 pl-4 text-xs">
						{draftBuildMessages.map((message, index) => (
							<li key={`${message}-${index}`}>{message}</li>
						))}
					</ul>
				</div>
			)}

			{errors.length > 0 && (
				<div className="rounded-md border border-red-300 bg-red-50 p-3">
					<p className="mb-1 text-sm font-medium">Validation errors</p>
					<ul className="list-disc space-y-1 pl-4 text-xs">
						{errors.map((error, index) => (
							<li key={`${error.code}-${index}`}>
								[{error.code}] {error.message}
							</li>
						))}
					</ul>
				</div>
			)}
		</div>
	);
}

function buildEnabledDraftStepsMap({
	recipe,
}: {
	recipe: DraftRecipe;
}): Record<number, boolean> {
	const next: Record<number, boolean> = {};
	for (const [index] of recipe.operations.entries()) {
		next[index] = true;
	}
	return next;
}

function selectEnabledDraftSteps({
	recipe,
	enabledStepsByIndex,
}: {
	recipe: DraftRecipe | null;
	enabledStepsByIndex: Record<number, boolean>;
}) {
	if (!recipe) return [];
	return recipe.operations.filter((_, index) => enabledStepsByIndex[index] !== false);
}

function formatDraftStepLabel({
	step,
}: {
	step: DraftRecipe["operations"][number];
}): string {
	switch (step.kind) {
		case "auto-edit":
			return "Assemble first cut";
		case "make-version":
			return "Trim to target length";
		case "generate-captions":
			return "Generate captions";
		case "apply-caption-style":
			return "Style captions";
		case "apply-project-kit":
			return "Apply creator kit";
		case "insert-scene-recipe":
			return "Add scene pattern";
		case "insert-overlay":
			return "Add overlay";
		case "auto-montage":
			return "Tighten pacing to music";
		case "apply-version-pack":
			return "Set publish formats";
		case "apply-safe-layout":
			return "Adapt layout for extra formats";
		case "apply-polish-profile":
			return "Apply final polish";
	}
}

function formatDraftStepDetail({
	step,
}: {
	step: DraftRecipe["operations"][number];
}): string {
	switch (step.kind) {
		case "make-version":
			return `Aim for ${step.params.durationTargetS ?? "target"}s total.`;
		case "apply-caption-style":
			return `Use ${step.params.styleId ?? "the active"} caption style.`;
		case "apply-project-kit":
			return String(step.params.kitName ?? "Matched creator defaults");
		case "insert-scene-recipe":
			return String(step.params.recipeId ?? "Built-in scene pattern");
		case "insert-overlay":
			return `Drop in ${String(step.params.presetId ?? "an overlay preset")}.`;
		case "auto-montage":
			return `${step.params.strategy ?? "Beat montage"} using the active beat grid.`;
		case "apply-version-pack":
			return `${Array.isArray(step.params.targets) ? step.params.targets.join(", ") : "Current target"} format targets.`;
		case "apply-safe-layout":
			return "Keep overlays and captions in-frame for extra formats.";
		case "apply-polish-profile":
			return `${resolveDraftStepPolishProfile({ step }).label} captions, motion, finishing, and audio balance.`;
		default:
			return "Deterministic build step.";
	}
}

function resolveDraftPolishProfile({
	recipe,
}: {
	recipe: DraftRecipe;
}) {
	const profileStep = recipe.operations.find(
		(step) => step.kind === "apply-polish-profile",
	);
	return resolveDraftStepPolishProfile({
		step: profileStep ?? {
			kind: "apply-polish-profile",
			params: { profileId: "clean-vlog" },
		},
	});
}

function resolveDraftStepPolishProfile({
	step,
}: {
	step: DraftRecipe["operations"][number];
}) {
	const profileId = normalizeDraftPolishProfileId({
		profileId: step.params.profileId,
	});
	return {
		profileId,
		label: getPolishProfileLabel({ profileId }),
		captionRevealPresetId:
			profileId === "luxury-routine"
				? "luxury-rise"
				: profileId === "bold-social"
					? "type-on-bold"
					: profileId === "talking-head"
						? "lift-in"
						: profileId === "product-promo"
							? "pop-line"
							: "fade-line",
		audioPolishPresetId:
			profileId === "luxury-routine"
				? "luxury-soft"
				: profileId === "bold-social" || profileId === "product-promo"
					? "bold-social"
					: "voice-forward",
		finishingLookId:
			profileId === "luxury-routine"
				? "warm"
				: profileId === "bold-social"
					? "dramatic"
					: profileId === "product-promo"
						? "cool"
						: "clean",
	} as const;
}

function normalizeDraftPolishProfileId({
	profileId,
}: {
	profileId: unknown;
}): "clean-vlog" | "luxury-routine" | "bold-social" | "talking-head" | "product-promo" {
	switch (profileId) {
		case "luxury-routine":
		case "bold-social":
		case "talking-head":
		case "product-promo":
		case "clean-vlog":
			return profileId;
		default:
			return "clean-vlog";
	}
}

function formatDraftSectionStrategy({
	strategy,
}: {
	strategy: DraftRecipe["sections"][number]["strategy"];
}): string {
	switch (strategy) {
		case "talking":
			return "talking-led";
		case "montage":
			return "montage";
		case "broll":
			return "b-roll";
		case "caption-led":
			return "caption-led";
		case "overlay-led":
			return "overlay-led";
	}
}

function formatRetentionBeatKind({
	kind,
}: {
	kind: NonNullable<DraftRecipe["retentionShape"]>["beats"][number]["kind"];
}): string {
	switch (kind) {
		case "hook":
			return "Hook";
		case "setup":
			return "Setup";
		case "body":
			return "Body";
		case "payoff":
			return "Payoff";
		case "cta":
			return "CTA";
	}
}

function formatRetentionStepLabel({
	kind,
}: {
	kind: NonNullable<DraftRecipe["retentionShape"]>["steps"][number]["kind"];
}): string {
	switch (kind) {
		case "promote-hook":
			return "Promote opener";
		case "trim-setup":
			return "Trim setup";
		case "compress-body":
			return "Compress body";
		case "delay-context":
			return "Delay context";
		case "insert-payoff":
			return "Anchor payoff";
		case "reserve-cta":
			return "Reserve CTA";
	}
}

function formatPlannerTime(playheadMs: number): string {
	const totalSeconds = Math.max(0, Math.floor(playheadMs / 1000));
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatSeconds(seconds: number): string {
	const totalMs = Math.max(0, Math.round(seconds * 1000));
	return formatPlannerTime(totalMs);
}

function formatSignedDurationMs(durationMs: number): string {
	const sign = durationMs >= 0 ? "+" : "-";
	const absoluteMs = Math.abs(durationMs);
	const seconds = absoluteMs / 1000;
	return `${sign}${seconds.toFixed(2)}s`;
}

export function buildEnabledCommandsMap({
	commands,
}: {
	commands: ClipForgeEditorCommand[];
}): Record<number, boolean> {
	const next: Record<number, boolean> = {};
	for (const [index] of commands.entries()) {
		next[index] = true;
	}
	return next;
}

export function selectEnabledCommands({
	commands,
	enabledCommandsByIndex,
}: {
	commands: ClipForgeEditorCommand[];
	enabledCommandsByIndex: Record<number, boolean>;
}): ClipForgeEditorCommand[] {
	return commands.filter((_, index) => enabledCommandsByIndex[index] !== false);
}

export function buildEnabledOpsMap({
	ops,
}: {
	ops: TimelineDiffOp[];
}): Record<number, boolean> {
	return buildEnabledCommandsMap({
		commands: ops.map((op) => ({
			kind: "timeline-op",
			op,
		})),
	});
}

export function selectEnabledOps({
	ops,
	enabledOpsByIndex,
}: {
	ops: TimelineDiffOp[];
	enabledOpsByIndex: Record<number, boolean>;
}): TimelineDiffOp[] {
	return ops.filter((_, index) => enabledOpsByIndex[index] !== false);
}

function mergeSafetySummaries(
	primary: ChatPlanSafetySummary | null,
	secondary: ChatPlanSafetySummary | null,
): ChatPlanSafetySummary | null {
	if (!primary && !secondary) {
		return null;
	}
	if (!primary) {
		return secondary;
	}
	if (!secondary) {
		return primary;
	}
	return {
		repairedCount: primary.repairedCount + secondary.repairedCount,
		droppedCount: primary.droppedCount + secondary.droppedCount,
		blocked: primary.blocked || secondary.blocked,
		notices: [...primary.notices, ...secondary.notices],
	};
}
