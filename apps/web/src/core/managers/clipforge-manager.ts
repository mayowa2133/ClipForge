import type { EditorCore } from "@/core";
import { validateTimelineDiffOps } from "@/lib/clipforge";
import { ApplyTimelineDiffOpsCommand } from "@/lib/commands";
import type { TimelineDiffOp, TimelineDiffOpSource } from "@/types/clipforge";

export class ClipForgeManager {
	constructor(private editor: EditorCore) {}

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

		return validateTimelineDiffOps({ project: activeProject, ops });
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

		return {
			applied: true,
			ops: validation.ops,
			errors: [],
		};
	}
}
