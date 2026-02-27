import { EditorCore } from "@/core";
import { buildAutoEditTikTokDraft } from "@/lib/clipforge";
import { Command } from "@/lib/commands/base-command";
import type { MediaAsset } from "@/types/assets";
import type { TProject } from "@/types/project";

export class AutoEditTikTokDraftCommand extends Command {
	private beforeProject: TProject | null = null;
	private afterProject: TProject | null = null;

	constructor(private mediaAssets: MediaAsset[]) {
		super();
	}

	execute(): void {
		const editor = EditorCore.getInstance();
		const activeProject = editor.project.getActive();
		if (!activeProject) return;

		if (!this.beforeProject) {
			this.beforeProject = structuredClone(activeProject);
		}
		if (!this.afterProject) {
			this.afterProject = buildAutoEditTikTokDraft({
				project: activeProject,
				mediaAssets: this.mediaAssets,
			});
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
