import { Command } from "@/lib/commands/base-command";
import { EditorCore } from "@/core";
import type { TScene } from "@/types/timeline";
import { duplicateSceneWithFreshIds } from "@/lib/scenes";

export class DuplicateSceneCommand extends Command {
	private savedScenes: TScene[] | null = null;
	private duplicatedScene: TScene | null = null;

	constructor(private sceneId: string) {
		super();
	}

	execute(): void {
		const editor = EditorCore.getInstance();
		const scenes = editor.scenes.getScenes();
		this.savedScenes = [...scenes];

		const sourceScene = scenes.find((scene) => scene.id === this.sceneId) ?? null;
		if (!sourceScene) {
			console.error("Scene not found:", this.sceneId);
			return;
		}

		this.duplicatedScene = duplicateSceneWithFreshIds({ scene: sourceScene });
		const sourceIndex = scenes.findIndex((scene) => scene.id === this.sceneId);
		const updatedScenes = [...scenes];
		updatedScenes.splice(sourceIndex + 1, 0, this.duplicatedScene);
		editor.scenes.setScenes({
			scenes: updatedScenes,
			activeSceneId: this.duplicatedScene.id,
		});
	}

	undo(): void {
		if (!this.savedScenes) return;
		const editor = EditorCore.getInstance();
		editor.scenes.setScenes({ scenes: this.savedScenes });
	}

	getSceneId(): string {
		return this.duplicatedScene?.id ?? "";
	}
}
