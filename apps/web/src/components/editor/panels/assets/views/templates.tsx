"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useEditor } from "@/hooks/use-editor";
import {
	type TemplatesTab,
	useAssetsPanelStore,
} from "@/stores/assets-panel-store";
import { PanelView } from "./base-view";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
	BUILT_IN_SCENE_RECIPES,
	type BuiltInSceneRecipeDefinition,
} from "@/lib/timeline";
import type {
	ComponentTemplate,
	CreatorTemplate,
	ProjectKitTemplate,
	SceneRecipeTemplate,
} from "@/types/templates";
import { formatTimeCode } from "@/lib/time";
import { cn } from "@/utils/ui";

const TEMPLATE_TAB_OPTIONS: Array<{ key: TemplatesTab; label: string }> = [
	{ key: "components", label: "Components" },
	{ key: "scene-recipes", label: "Scene recipes" },
	{ key: "project-kits", label: "Project kits" },
];

export function TemplatesView() {
	const editor = useEditor();
	const templatesTab = useAssetsPanelStore((state) => state.templatesTab);
	const setTemplatesTab = useAssetsPanelStore((state) => state.setTemplatesTab);
	const [version, setVersion] = useState(0);
	const [isSaveOpen, setIsSaveOpen] = useState(false);
	const [templateName, setTemplateName] = useState("");

	useEffect(() => {
		void editor.project.loadTemplateLibrary();
		const unsubscribers = [
			editor.project.subscribe(() => setVersion((value) => value + 1)),
			editor.selection.subscribe(() => setVersion((value) => value + 1)),
			editor.scenes.subscribe(() => setVersion((value) => value + 1)),
		];
		return () => {
			unsubscribers.forEach((unsubscribe) => unsubscribe());
		};
	}, [editor]);
	void version;

	const componentTemplates = editor.project.getComponentTemplates();
	const sceneRecipeTemplates = editor.project.getSceneRecipeTemplates();
	const projectKitTemplates = editor.project.getProjectKitTemplates();
	const selectedElements = editor.selection.getSelectedElements();
	const canSaveSelection = selectedElements.length > 0;
	const activeScene = editor.scenes.getActiveScene();
	const activeProject = editor.project.getActiveOrNull();

	const handleSave = async () => {
		const trimmedName = templateName.trim();
		if (!trimmedName) return;
		try {
			if (templatesTab === "components") {
				editor.timeline.saveSelectionAsComponentTemplate({ name: trimmedName });
				toast.success("Component template saved.");
			} else if (templatesTab === "scene-recipes") {
				await editor.scenes.saveSceneAsRecipe({
					name: trimmedName,
					sceneId: activeScene.id,
				});
				toast.success("Scene recipe saved.");
			} else {
				await editor.project.saveProjectAsKit({ name: trimmedName });
				toast.success("Project kit saved.");
			}
			setTemplateName("");
			setIsSaveOpen(false);
		} catch (error) {
			const message = error instanceof Error ? error.message : "Unable to save template.";
			toast.error(message);
		}
	};

	const saveLabel =
		templatesTab === "components"
			? "Save current selection"
			: templatesTab === "scene-recipes"
				? "Save active scene"
				: "Save current project";
	const saveDisabled =
		templatesTab === "components" ? !canSaveSelection : activeProject === null;

	return (
		<PanelView title="Templates">
			<div className="flex flex-col gap-4 pb-4">
				<div className="flex flex-wrap gap-2 px-1 pt-1">
					{TEMPLATE_TAB_OPTIONS.map((option) => (
						<Button
							key={option.key}
							variant={templatesTab === option.key ? "default" : "outline"}
							size="sm"
							onClick={() => setTemplatesTab(option.key)}
						>
							{option.label}
						</Button>
					))}
				</div>
				<div className="flex items-center justify-between gap-3 px-1">
					<p className="text-muted-foreground text-xs">
						Save reusable creator building blocks, then reinsert them as concrete editable state.
					</p>
					<SaveTemplateDialog
						open={isSaveOpen}
						onOpenChange={setIsSaveOpen}
						name={templateName}
						onNameChange={setTemplateName}
						title={
							templatesTab === "components"
								? "Save component"
								: templatesTab === "scene-recipes"
									? "Save scene recipe"
									: "Save project kit"
						}
						triggerLabel={saveLabel}
						onSave={() => void handleSave()}
						disabled={saveDisabled}
					/>
				</div>
				{templatesTab === "components" ? (
					<ComponentsSection templates={componentTemplates} />
				) : null}
				{templatesTab === "scene-recipes" ? (
					<SceneRecipesSection
						savedTemplates={sceneRecipeTemplates}
						builtInRecipes={BUILT_IN_SCENE_RECIPES}
					/>
				) : null}
				{templatesTab === "project-kits" ? (
					<ProjectKitsSection templates={projectKitTemplates} />
				) : null}
			</div>
		</PanelView>
	);
}

function ComponentsSection({
	templates,
}: {
	templates: ComponentTemplate[];
}) {
	const editor = useEditor();

	return (
		<div className="space-y-3 px-1">
			<p className="text-muted-foreground text-xs">
				Save grouped titles, lower thirds, overlays, and CTA stacks from the timeline selection.
			</p>
			{templates.length === 0 ? (
				<EmptyCard message="Save a grouped overlay or title selection to reuse it later." />
			) : (
				templates.map((template) => (
					<TemplateCard
						key={template.id}
						title={template.name}
						description={`${template.payload.elements.length} element${template.payload.elements.length === 1 ? "" : "s"} · ${formatTimeCode({ timeInSeconds: template.payload.duration })}`}
						primaryActionLabel="Insert"
						onPrimaryAction={() =>
							editor.timeline.insertComponentTemplate({
								templateId: template.id,
								startTime: editor.playback.getCurrentTime(),
							})
						}
						onDelete={() => void editor.project.deleteTemplate({ templateId: template.id })}
					/>
				))
			)}
		</div>
	);
}

function SceneRecipesSection({
	builtInRecipes,
	savedTemplates,
}: {
	builtInRecipes: BuiltInSceneRecipeDefinition[];
	savedTemplates: SceneRecipeTemplate[];
}) {
	const editor = useEditor();

	return (
		<div className="space-y-5 px-1">
			<div className="space-y-3">
				<div>
					<p className="text-sm font-medium">Starter recipes</p>
					<p className="text-muted-foreground text-xs">
						Reusable intro, chapter, location, CTA, and vlog-section starters.
					</p>
				</div>
				{builtInRecipes.map((recipe) => (
					<TemplateCard
						key={recipe.id}
						title={recipe.label}
						description={recipe.description}
						primaryActionLabel="Insert"
						onPrimaryAction={() =>
							void editor.scenes.insertSceneRecipe({
								recipeId: recipe.id,
								startTime: editor.playback.getCurrentTime(),
							})
						}
					/>
				))}
			</div>
			<div className="space-y-3">
				<div>
					<p className="text-sm font-medium">Saved scene recipes</p>
					<p className="text-muted-foreground text-xs">
						Portable scene starters saved from the active scene’s design layer.
					</p>
				</div>
				{savedTemplates.length === 0 ? (
					<EmptyCard message="Save the active scene to build your own reusable intro, chapter, or outro recipe." />
				) : (
					savedTemplates.map((template) => (
						<TemplateCard
							key={template.id}
							title={template.name}
							description={`${template.payload.elements.length} reusable elements`}
							primaryActionLabel="Insert"
							onPrimaryAction={() =>
								void editor.scenes.insertSceneRecipe({
									recipeId: template.id,
									startTime: editor.playback.getCurrentTime(),
								})
							}
							onDelete={() => void editor.project.deleteTemplate({ templateId: template.id })}
						/>
					))
				)}
			</div>
		</div>
	);
}

function ProjectKitsSection({
	templates,
}: {
	templates: ProjectKitTemplate[];
}) {
	const editor = useEditor();
	const activeProject = editor.project.getActiveOrNull();

	const activeSummary = useMemo(() => {
		if (!activeProject) return "No active project";
		return [
			activeProject.settings.brandKit ? "brand" : null,
			activeProject.settings.overlayDefaults ? "overlays" : null,
			activeProject.settings.audio ? "audio mix" : null,
			activeProject.settings.montageDefaults ? "montage" : null,
			activeProject.clipforge?.activeCaptionStyleId ? "captions" : null,
		]
			.filter(Boolean)
			.join(" · ");
	}, [activeProject]);

	return (
		<div className="space-y-3 px-1">
			<p className="text-muted-foreground text-xs">
				Project kits capture creator defaults for brand, overlays, captions, audio mix, and montage pacing.
			</p>
			<div className="rounded-lg border border-dashed px-4 py-3 text-sm">
				<p className="font-medium">Current project defaults</p>
				<p className="text-muted-foreground mt-1 text-xs">{activeSummary || "No defaults set."}</p>
			</div>
			{templates.length === 0 ? (
				<EmptyCard message="Save the current project as a kit to reuse its creator defaults in other projects." />
			) : (
				templates.map((template) => (
					<TemplateCard
						key={template.id}
						title={template.name}
						description={describeProjectKit({ template })}
						primaryActionLabel="Apply"
						onPrimaryAction={() => void editor.project.applyProjectKit({ kitId: template.id })}
						onDelete={() => void editor.project.deleteTemplate({ templateId: template.id })}
					/>
				))
			)}
		</div>
	);
}

function SaveTemplateDialog({
	open,
	onOpenChange,
	name,
	onNameChange,
	title,
	triggerLabel,
	onSave,
	disabled,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	name: string;
	onNameChange: (value: string) => void;
	title: string;
	triggerLabel: string;
	onSave: () => void;
	disabled?: boolean;
}) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogTrigger asChild>
				<Button size="sm" disabled={disabled}>
					{triggerLabel}
				</Button>
			</DialogTrigger>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{title}</DialogTitle>
					<DialogDescription>
						Save this reusable creator asset locally so you can reinsert it later as concrete editable state.
					</DialogDescription>
				</DialogHeader>
				<Input
					autoFocus
					placeholder="Template name"
					value={name}
					onChange={(event) => onNameChange(event.target.value)}
				/>
				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button onClick={onSave} disabled={name.trim().length === 0}>
						Save
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function TemplateCard({
	title,
	description,
	primaryActionLabel,
	onPrimaryAction,
	onDelete,
}: {
	title: string;
	description: string;
	primaryActionLabel: string;
	onPrimaryAction: () => void;
	onDelete?: () => void;
}) {
	return (
		<div className="rounded-lg border px-4 py-3">
			<div className="flex items-start justify-between gap-3">
				<div className="min-w-0">
					<p className="text-sm font-medium">{title}</p>
					<p className="text-muted-foreground mt-1 text-xs">{description}</p>
				</div>
				<div className="flex shrink-0 gap-2">
					<Button size="sm" onClick={onPrimaryAction}>
						{primaryActionLabel}
					</Button>
					{onDelete ? (
						<Button size="sm" variant="outline" onClick={onDelete}>
							Delete
						</Button>
					) : null}
				</div>
			</div>
		</div>
	);
}

function EmptyCard({ message }: { message: string }) {
	return (
		<div className={cn("text-muted-foreground rounded-lg border border-dashed p-4 text-sm")}>
			{message}
		</div>
	);
}

function describeProjectKit({ template }: { template: ProjectKitTemplate }) {
	const summary = [
		template.payload.brandKit ? "brand" : null,
		template.payload.overlayDefaults ? "overlays" : null,
		template.payload.captionStyleId ? "captions" : null,
		template.payload.audio ? "audio mix" : null,
		template.payload.montageDefaults ? "montage" : null,
	]
		.filter(Boolean)
		.join(" · ");
	return summary || "Defaults only";
}
