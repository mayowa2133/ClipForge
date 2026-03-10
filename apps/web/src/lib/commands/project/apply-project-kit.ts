import { EditorCore } from "@/core";
import { Command } from "@/lib/commands/base-command";
import type { TProject } from "@/types/project";
import type { ProjectKitPayload } from "@/types/templates";
import { applyProjectKitPayload } from "@/lib/timeline";

export class ApplyProjectKitCommand extends Command {
	private savedProject: TProject | null = null;

	constructor(private payload: ProjectKitPayload) {
		super();
	}

	execute(): void {
		const editor = EditorCore.getInstance();
		const activeProject = editor.project.getActiveOrNull();
		if (!activeProject) return;

		this.savedProject = activeProject;
		editor.project.setActiveProject({
			project: {
				...applyProjectKitPayload({
					project: activeProject,
					payload: this.payload,
				}),
				metadata: {
					...activeProject.metadata,
					updatedAt: new Date(),
				},
			},
		});
		editor.save.markDirty();
	}

	undo(): void {
		if (!this.savedProject) return;
		const editor = EditorCore.getInstance();
		editor.project.setActiveProject({ project: this.savedProject });
		editor.save.markDirty();
	}
}
