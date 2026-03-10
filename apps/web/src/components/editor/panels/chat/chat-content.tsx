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
	projectValidatorWarnings,
	type TimelineOpsValidationError,
} from "@/lib/clipforge";
import { useClipForgeChatDraftStore } from "@/stores/clipforge-chat-draft-store";
import { useClipForgeChatSettingsStore } from "@/stores/clipforge-chat-settings-store";
import type {
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
	const [proposedOps, setProposedOps] = useState<TimelineDiffOp[]>([]);
	const [impactPreview, setImpactPreview] = useState<ChatPlanPreviewResult | null>(
		null,
	);
	const [draftRecipe, setDraftRecipe] = useState<DraftRecipe | null>(null);
	const [draftImpact, setDraftImpact] = useState<DraftImpactSummary | null>(null);
	const [enabledDraftStepsByIndex, setEnabledDraftStepsByIndex] = useState<
		Record<number, boolean>
	>({});
	const [draftBuildMessages, setDraftBuildMessages] = useState<string[]>([]);
	const [enabledOpsByIndex, setEnabledOpsByIndex] = useState<
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
	const selectedOps = useMemo(
		() =>
			selectEnabledOps({
				ops: proposedOps,
				enabledOpsByIndex,
			}),
		[proposedOps, enabledOpsByIndex],
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
		if (proposedOps.length === 0) return;

		const validation = editor.clipforge.validateOps({ ops: selectedOps });
		setErrors(validation.valid ? [] : validation.errors);
	}, [editor, proposedOps, selectedOps]);

	const resetPreview = () => {
		setImpactPreview(null);
		setEnabledOpsByIndex({});
	};

	const resetDraftRecipe = () => {
		setDraftRecipe(null);
		setDraftImpact(null);
		setEnabledDraftStepsByIndex({});
	};

	const buildPreviewForOps = ({ ops }: { ops: TimelineDiffOp[] }) => {
		const preview = editor.clipforge.previewOpsImpact({ ops });
		setImpactPreview(preview);
		setEnabledOpsByIndex(buildEnabledOpsMap({ ops }));
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
			const projectSummary = buildProjectSummary({
				project: activeProject,
				mediaAssets: editor.media.getAssets(),
			});
			const playheadMs = Math.round(editor.playback.getCurrentTime() * 1000);
			const selectedSegmentIds = editor.selection
				.getSelectedElements()
				.map((element) => element.elementId);
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
				setProposedOps([]);
				setErrors([]);
				setLastPlanError(null);
				setPendingClarification(null);
				return;
			}
			const result = await provider.proposeEdits(plannerRequest);
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
				setProposedOps([]);
				setErrors([]);
				resetPreview();
				setPendingClarification(result.clarification);
				setLastPlanError(null);
				return;
			}
			setPendingClarification(null);

			if (result.ops.length === 0) {
				setProposedOps([]);
				setErrors([]);
				resetPreview();
				toast.error("No deterministic ops could be generated.");
				return;
			}

			const reconciliation = editor.clipforge.reconcileAndValidateOps({
				userText: plannerRequest.userText,
				projectSummary: plannerRequest.projectSummary,
				context: plannerRequest.context,
				ops: result.ops,
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
				setProposedOps([]);
				setErrors([]);
				resetPreview();
				setLastPlanError(null);
				return;
			}

			if (reconciliation.blocked || reconciliation.ops.length === 0) {
				setProposedOps([]);
				setErrors(
					reconciliation.secondPassErrors.length > 0
						? reconciliation.secondPassErrors
						: reconciliation.firstPassErrors,
				);
				resetPreview();
				setLastPlanError(null);
				toast.error("Unable to produce validator-clean deterministic ops.");
				return;
			}

			setProposedOps(reconciliation.ops);
			buildPreviewForOps({ ops: reconciliation.ops });
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
		segmentId,
	}: {
		referenceLabel: string;
		segmentId: string;
	}) => {
		if (!lastPlannerRequest || isLoading) {
			return;
		}

		const requestId = activeRequestIdRef.current + 1;
		activeRequestIdRef.current = requestId;
		const overrides: ChatPlannerOverrides = {
			forced_segment_ids_by_reference: {
				[referenceLabel]: segmentId,
			},
		};
		setClarificationOverrides(overrides);
		setIsLoading(true);
		setLastPlanError(null);
		setErrors([]);
		resetPreview();
		try {
			const result = await provider.proposeEdits({
				...lastPlannerRequest,
				overrides,
			});
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
				setProposedOps([]);
				setErrors([]);
				resetPreview();
				return;
			}

			setPendingClarification(null);
			if (result.ops.length === 0) {
				setProposedOps([]);
				setErrors([]);
				resetPreview();
				toast.error("No deterministic ops could be generated.");
				return;
			}

			const reconciliation = editor.clipforge.reconcileAndValidateOps({
				userText: lastPlannerRequest.userText,
				projectSummary: lastPlannerRequest.projectSummary,
				context: lastPlannerRequest.context,
				overrides,
				ops: result.ops,
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
				setProposedOps([]);
				setErrors([]);
				resetPreview();
				return;
			}

			if (reconciliation.blocked || reconciliation.ops.length === 0) {
				setProposedOps([]);
				setErrors(
					reconciliation.secondPassErrors.length > 0
						? reconciliation.secondPassErrors
						: reconciliation.firstPassErrors,
				);
				resetPreview();
				toast.error("Unable to produce validator-clean deterministic ops.");
				return;
			}

			setProposedOps(reconciliation.ops);
			buildPreviewForOps({ ops: reconciliation.ops });
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

	const handleApply = () => {
		if (selectedOps.length === 0) return;

		const result = editor.clipforge.applyOps({
			ops: selectedOps,
			source: "chat",
		});
		if (!result.applied) {
			setErrors(result.errors);
			toast.error("Ops were rejected by validation.");
			return;
		}

		toast.success("Chat edits applied.");
		setPrompt("");
		setProposedOps([]);
		resetPreview();
		resetDraftRecipe();
		setDraftBuildMessages([]);
		setErrors([]);
		setProposalMeta(null);
		setLastPlanError(null);
		setPendingClarification(null);
		setClarificationOverrides(null);
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

	const handleToggleOp = ({ opIndex }: { opIndex: number }) => {
		setEnabledOpsByIndex((previous) => ({
			...previous,
			[opIndex]: previous[opIndex] === false,
		}));
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
				<textarea
					className="min-h-24 rounded-md border p-2 text-sm"
					value={prompt}
					onChange={(event) => setPrompt(event.target.value)}
					placeholder='Try: "trim this clip by 0.5s at the start", "add text here that says \"watch this\"", "replace \"teh\" with \"the\" in this caption"'
				/>
				<Button onClick={handlePropose} disabled={isLoading}>
					{isLoading ? "Proposing..." : "Propose Ops"}
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
										segmentId: option.segment_id,
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

			{proposedOps.length > 0 && (
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
									const enabled = enabledOpsByIndex[card.opIndex] !== false;
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
															handleToggleOp({ opIndex: card.opIndex })
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
					<Label>
						Selected JSON Ops ({selectedOps.length}/{proposedOps.length})
					</Label>
					<pre className="bg-muted max-h-64 overflow-auto rounded-md border p-3 text-xs">
						{JSON.stringify(selectedOps, null, 2)}
					</pre>
					<div className="flex gap-2">
						<Button
							onClick={handleApply}
							disabled={errors.length > 0 || selectedOps.length === 0}
						>
							Apply
						</Button>
						<Button
							variant="outline"
							onClick={() => {
								setProposedOps([]);
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
		default:
			return "Deterministic build step.";
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

export function buildEnabledOpsMap({
	ops,
}: {
	ops: TimelineDiffOp[];
}): Record<number, boolean> {
	const next: Record<number, boolean> = {};
	for (const [index] of ops.entries()) {
		next[index] = true;
	}
	return next;
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
