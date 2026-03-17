import { EditorCore } from "@/core";
import { Command } from "@/lib/commands/base-command";
import type { TProject } from "@/types/project";

export class BuildReferenceGuidedDraftCommand extends Command {
	private beforeProject: TProject | null = null;

	constructor(private afterProject: TProject) {
		super();
	}

	execute(): void {
		const editor = EditorCore.getInstance();
		const activeProject = editor.project.getActive();
		if (!activeProject) return;

		if (!this.beforeProject) {
			this.beforeProject = structuredClone(activeProject);
		}

		this.applyProjectState({ project: this.afterProject });
	}

	undo(): void {
		if (!this.beforeProject) return;
		this.applyProjectState({ project: this.beforeProject });
	}

	private applyProjectState({ project }: { project: TProject }): void {
		const editor = EditorCore.getInstance();
		editor.scenes.setScenes({
			scenes: project.scenes,
			activeSceneId: project.currentSceneId,
		});
		editor.project.setActiveProject({ project });
		editor.save.markDirty();
	}
}
