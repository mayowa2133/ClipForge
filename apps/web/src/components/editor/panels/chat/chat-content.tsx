import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ENABLE_CLIPFORGE_CHAT } from "@/constants/feature-flags";
import { useEditor } from "@/hooks/use-editor";
import {
	buildProjectSummary,
	createChatOpsProvider,
	fetchChatPlannerHealth,
	type TimelineOpsValidationError,
} from "@/lib/clipforge";
import { useClipForgeChatDraftStore } from "@/stores/clipforge-chat-draft-store";
import { useClipForgeChatSettingsStore } from "@/stores/clipforge-chat-settings-store";
import type { TimelineDiffOp } from "@/types/clipforge";
import type {
	ChatPlannerHealth,
	ChatProposalResult,
} from "@/lib/clipforge/chat";

interface ProposalMeta {
	provider: ChatProposalResult["provider"];
	fallbackUsed: boolean;
	warnings: string[];
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
	const [errors, setErrors] = useState<TimelineOpsValidationError[]>([]);
	const [proposalMeta, setProposalMeta] = useState<ProposalMeta | null>(null);
	const [plannerHealth, setPlannerHealth] = useState<ChatPlannerHealth | null>(null);
	const [plannerHealthError, setPlannerHealthError] = useState<string | null>(null);
	const [isCheckingHealth, setIsCheckingHealth] = useState(false);
	const [lastPlanError, setLastPlanError] = useState<string | null>(null);

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
		try {
			const projectSummary = buildProjectSummary({
				project: activeProject,
				mediaAssets: editor.media.getAssets(),
			});
			const result = await provider.proposeEdits({
				userText: prompt,
				projectSummary,
			});
			if (activeRequestIdRef.current !== requestId) {
				return;
			}

			setProposalMeta({
				provider: result.provider,
				fallbackUsed: result.fallbackUsed,
				warnings: result.warnings,
			});

			if (result.ops.length === 0) {
				setProposedOps([]);
				setErrors([]);
				toast.error("No deterministic ops could be generated.");
				return;
			}

			const validation = editor.clipforge.validateOps({ ops: result.ops });
			setProposedOps(validation.ops);
			setErrors(validation.errors);
			setLastPlanError(null);
		} catch (error) {
			if (activeRequestIdRef.current !== requestId) {
				return;
			}
			setProposalMeta(null);
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
		if (proposedOps.length === 0) return;

		const result = editor.clipforge.applyOps({
			ops: proposedOps,
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
		setErrors([]);
		setProposalMeta(null);
		setLastPlanError(null);
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
					placeholder='Try: "trim the first clip by 0.5s at the start", "swap the first and second clips", "replace \"teh\" with \"the\" in captions"'
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

			{proposedOps.length > 0 && (
				<div className="flex flex-1 flex-col gap-2">
					<Label>Proposed JSON Ops</Label>
					<pre className="bg-muted max-h-64 overflow-auto rounded-md border p-3 text-xs">
						{JSON.stringify(proposedOps, null, 2)}
					</pre>
					<div className="flex gap-2">
						<Button onClick={handleApply} disabled={errors.length > 0}>
							Apply
						</Button>
						<Button
							variant="outline"
							onClick={() => {
								setProposedOps([]);
								setErrors([]);
								setProposalMeta(null);
							}}
						>
							Cancel
						</Button>
					</div>
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
