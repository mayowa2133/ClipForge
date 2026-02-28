import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ENABLE_CLIPFORGE_CHAT } from "@/constants/feature-flags";
import { useEditor } from "@/hooks/use-editor";
import {
	buildProjectSummary,
	HeuristicChatOpsProvider,
	type TimelineOpsValidationError,
} from "@/lib/clipforge";
import type { TimelineDiffOp } from "@/types/clipforge";

export function ChatContent() {
	const editor = useEditor();
	const providerRef = useRef(new HeuristicChatOpsProvider());
	const [prompt, setPrompt] = useState("");
	const [isLoading, setIsLoading] = useState(false);
	const [proposedOps, setProposedOps] = useState<TimelineDiffOp[]>([]);
	const [errors, setErrors] = useState<TimelineOpsValidationError[]>([]);

	const handlePropose = async () => {
		const activeProject = editor.project.getActive();
		if (!activeProject) {
			toast.error("No active project.");
			return;
		}
		if (prompt.trim().length === 0) {
			toast.error("Enter an edit request first.");
			return;
		}

		setIsLoading(true);
		setErrors([]);
		try {
			const projectSummary = buildProjectSummary({
				project: activeProject,
				mediaAssets: editor.media.getAssets(),
			});
			const ops = await providerRef.current.proposeEdits({
				userText: prompt,
				projectSummary,
			});

			if (ops.length === 0) {
				setProposedOps([]);
				toast.error("No deterministic ops could be generated.");
				return;
			}

			const validation = editor.clipforge.validateOps({ ops });
			setProposedOps(validation.ops);
			setErrors(validation.errors);
		} catch (error) {
			toast.error("Failed to propose edits.", {
				description:
					error instanceof Error ? error.message : "Please try again.",
			});
		} finally {
			setIsLoading(false);
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
	};

	if (!ENABLE_CLIPFORGE_CHAT) {
		return (
			<div className="text-muted-foreground text-sm">
				Enable `ENABLE_CLIPFORGE_CHAT=true` to use chat edits.
			</div>
		);
	}

	return (
		<div className="flex h-full flex-col gap-3">
			<div className="flex flex-col gap-2">
				<Label>Ask ClipForge to edit this timeline</Label>
				<textarea
					className="min-h-24 rounded-md border p-2 text-sm"
					value={prompt}
					onChange={(event) => setPrompt(event.target.value)}
					placeholder='Try: "make it faster", "remove more pauses", "bold center captions"'
				/>
				<Button onClick={handlePropose} disabled={isLoading}>
					{isLoading ? "Proposing..." : "Propose Ops"}
				</Button>
			</div>

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
