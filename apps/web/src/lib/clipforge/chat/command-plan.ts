import type { ClipForgeEditorCommand, TimelineDiffOp } from "@/types/clipforge";
import type { ChatPlanResult } from "./types";

export function wrapTimelineOp(op: TimelineDiffOp): ClipForgeEditorCommand {
	return {
		kind: "timeline-op",
		op,
	};
}

export function wrapTimelineOpsAsCommands(
	ops: TimelineDiffOp[],
): ClipForgeEditorCommand[] {
	return ops.map((op) => wrapTimelineOp(op));
}

export function extractTimelineOpsFromCommands(
	commands: ClipForgeEditorCommand[],
): TimelineDiffOp[] {
	return commands.flatMap((command) =>
		command.kind === "timeline-op" ? [command.op] : [],
	);
}

export function normalizeChatPlanResult(
	result: ChatPlanResult,
): ChatPlanResult & {
	commands: ClipForgeEditorCommand[];
	ops: TimelineDiffOp[];
} {
	const commands =
		result.commands && result.commands.length > 0
			? result.commands
			: wrapTimelineOpsAsCommands(result.ops ?? []);
	const ops =
		result.ops && result.ops.length > 0
			? result.ops
			: extractTimelineOpsFromCommands(commands);

	return {
		...result,
		commands,
		ops,
	};
}
