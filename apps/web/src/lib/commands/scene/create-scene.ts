import { Command } from "@/lib/commands/base-command";
import { EditorCore } from "@/core";
import type { TScene } from "@/types/timeline";
import { buildDefaultScene } from "@/lib/scenes";

export class CreateSceneCommand extends Command {
	private savedScenes: TScene[] | null = null;
	private createdScene: TScene | null = null;

	constructor(
		private name: string,
		private isMain: boolean = false,
		private afterSceneId?: string,
	) {
		super();
	}

	execute(): void {
		const editor = EditorCore.getInstance();
		this.savedScenes = [...editor.scenes.getScenes()];

		this.createdScene = buildDefaultScene({
			name: this.name,
			isMain: this.isMain,
		});

		const insertionIndex = this.afterSceneId
			? this.savedScenes.findIndex((scene) => scene.id === this.afterSceneId) + 1
			: this.savedScenes.length;
		const safeInsertionIndex =
			insertionIndex > 0 ? insertionIndex : this.savedScenes.length;
		const updatedScenes = [...this.savedScenes];
		updatedScenes.splice(safeInsertionIndex, 0, this.createdScene);
		editor.scenes.setScenes({ scenes: updatedScenes });
	}

	undo(): void {
		if (this.savedScenes) {
			const editor = EditorCore.getInstance();
			editor.scenes.setScenes({ scenes: this.savedScenes });
		}
	}

	getSceneId(): string {
		return this.createdScene?.id ?? "";
	}
}
