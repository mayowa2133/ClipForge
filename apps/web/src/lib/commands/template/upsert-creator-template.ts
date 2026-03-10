import { EditorCore } from "@/core";
import { Command } from "@/lib/commands/base-command";
import { storageService } from "@/services/storage/service";
import type { CreatorTemplate } from "@/types/templates";

export class UpsertCreatorTemplateCommand extends Command {
	private savedTemplates: CreatorTemplate[] | null = null;

	constructor(private template: CreatorTemplate) {
		super();
	}

	execute(): void {
		const editor = EditorCore.getInstance();
		this.savedTemplates = [...editor.project.getTemplateLibrary()];
		const nextTemplates = [
			...this.savedTemplates.filter((candidate) => candidate.id !== this.template.id),
			this.template,
		].sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime());
		editor.project.setTemplateLibrary({ templates: nextTemplates });
		void storageService.saveTemplate({ template: this.template }).catch((error) => {
			console.error("Failed to save template:", error);
		});
	}

	undo(): void {
		if (!this.savedTemplates) return;
		const editor = EditorCore.getInstance();
		editor.project.setTemplateLibrary({ templates: this.savedTemplates });
		void storageService.deleteTemplate({ id: this.template.id }).catch((error) => {
			console.error("Failed to delete template during undo:", error);
		});
		for (const template of this.savedTemplates) {
			void storageService.saveTemplate({ template }).catch((error) => {
				console.error("Failed to restore template during undo:", error);
			});
		}
	}
}
