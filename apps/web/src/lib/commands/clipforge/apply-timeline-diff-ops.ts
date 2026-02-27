import { EditorCore } from "@/core";
import { Command } from "@/lib/commands/base-command";
import {
	applyTimelineDiffPatch,
	buildTimelineDiffPatch,
	revertTimelineDiffPatch,
} from "@/lib/clipforge";
import type { TimelineDiffOp, TimelineDiffOpSource } from "@/types/clipforge";

export class ApplyTimelineDiffOpsCommand extends Command {
	private patch: ReturnType<typeof buildTimelineDiffPatch> | null = null;

	constructor(
		private readonly ops: TimelineDiffOp[],
		private readonly source: TimelineDiffOpSource = "manual",
	) {
		super();
	}

	execute(): void {
		const editor = EditorCore.getInstance();
		const activeProject = editor.project.getActive();
		if (!activeProject) return;

		if (!this.patch) {
			this.patch = buildTimelineDiffPatch({
				project: activeProject,
				ops: this.ops,
				source: this.source,
			});
		}

		const nextProject = applyTimelineDiffPatch({ patch: this.patch });
		this.applyProjectState({ project: nextProject });
	}

	undo(): void {
		if (!this.patch) return;
		const previousProject = revertTimelineDiffPatch({ patch: this.patch });
		this.applyProjectState({ project: previousProject });
	}

	private applyProjectState({
		project,
	}: {
		project: ReturnType<typeof applyTimelineDiffPatch>;
	}): void {
		const editor = EditorCore.getInstance();
		editor.scenes.setScenes({
			scenes: project.scenes,
			activeSceneId: project.currentSceneId,
		});
		editor.project.setActiveProject({ project });
		editor.save.markDirty();
	}
}
