import { EditorCore } from "@/core";
import { Command } from "@/lib/commands/base-command";
import { storageService } from "@/services/storage/service";
import type { CreatorTemplate } from "@/types/templates";

export class DeleteCreatorTemplateCommand extends Command {
	private savedTemplates: CreatorTemplate[] | null = null;

	constructor(private templateId: string) {
		super();
	}

	execute(): void {
		const editor = EditorCore.getInstance();
		this.savedTemplates = [...editor.project.getTemplateLibrary()];
		editor.project.setTemplateLibrary({
			templates: this.savedTemplates.filter((template) => template.id !== this.templateId),
		});
		void storageService.deleteTemplate({ id: this.templateId }).catch((error) => {
			console.error("Failed to delete template:", error);
		});
	}

	undo(): void {
		if (!this.savedTemplates) return;
		const editor = EditorCore.getInstance();
		editor.project.setTemplateLibrary({ templates: this.savedTemplates });
		for (const template of this.savedTemplates) {
			void storageService.saveTemplate({ template }).catch((error) => {
				console.error("Failed to restore template during undo:", error);
			});
		}
	}
}
