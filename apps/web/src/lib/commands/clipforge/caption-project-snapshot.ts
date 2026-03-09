import { EditorCore } from "@/core";
import { Command } from "@/lib/commands/base-command";
import type { TProject } from "@/types/project";

export class CaptionProjectSnapshotCommand extends Command {
	constructor(
		private before: TProject,
		private after: TProject,
	) {
		super();
	}

	execute(): void {
		this.applyProject({ project: this.after });
	}

	undo(): void {
		this.applyProject({ project: this.before });
	}

	private applyProject({ project }: { project: TProject }): void {
		const editor = EditorCore.getInstance();
		editor.scenes.setScenes({
			scenes: project.scenes,
			activeSceneId: project.currentSceneId,
		});
		editor.project.setActiveProject({ project });
		editor.save.markDirty();
	}
}
