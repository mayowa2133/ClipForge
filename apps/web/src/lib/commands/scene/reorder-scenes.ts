import { Command } from "@/lib/commands/base-command";
import { EditorCore } from "@/core";
import type { TScene } from "@/types/timeline";

export class ReorderScenesCommand extends Command {
	private savedScenes: TScene[] | null = null;

	constructor(private sceneIds: string[]) {
		super();
	}

	execute(): void {
		const editor = EditorCore.getInstance();
		const scenes = editor.scenes.getScenes();
		this.savedScenes = [...scenes];

		const nextIds = new Set(this.sceneIds);
		if (nextIds.size !== scenes.length) {
			console.error("Invalid scene reorder payload");
			return;
		}

		const byId = new Map(scenes.map((scene) => [scene.id, scene]));
		const reorderedScenes = this.sceneIds
			.map((sceneId) => byId.get(sceneId) ?? null)
			.filter((scene): scene is TScene => scene !== null);

		if (reorderedScenes.length !== scenes.length) {
			console.error("Failed to reorder scenes: scene ids do not match existing scenes");
			return;
		}

		editor.scenes.setScenes({ scenes: reorderedScenes });
	}

	undo(): void {
		if (!this.savedScenes) return;
		const editor = EditorCore.getInstance();
		editor.scenes.setScenes({ scenes: this.savedScenes });
	}
}
