"use client";

import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
	SheetTrigger,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import {
	ArrowDown,
	ArrowUp,
	Check,
	Copy,
	Plus,
	Trash2,
} from "lucide-react";
import { cn } from "@/utils/ui";
import { useEditor } from "@/hooks/use-editor";
import { canDeleteScene } from "@/lib/scenes";
import { formatTimeCode } from "@/lib/time";
import { toast } from "sonner";
import { useState } from "react";

export function ScenesView({ children }: { children: React.ReactNode }) {
	const editor = useEditor();
	const scenes = editor.scenes.getScenes();
	const currentScene = editor.scenes.getActiveScene();
	const assembly = editor.scenes.getProjectAssembly();
	const projectDuration = editor.scenes.getProjectDuration();

	const handleSceneSwitch = async (sceneId: string) => {
		try {
			await editor.scenes.switchToScene({ sceneId });
		} catch (error) {
			console.error("Failed to switch scene:", error);
		}
	};

	const handleMoveScene = async ({
		sceneId,
		direction,
	}: {
		sceneId: string;
		direction: "up" | "down";
	}) => {
		const currentIndex = scenes.findIndex((scene) => scene.id === sceneId);
		if (currentIndex < 0) return;
		const nextIndex =
			direction === "up" ? currentIndex - 1 : currentIndex + 1;
		if (nextIndex < 0 || nextIndex >= scenes.length) return;

		const reorderedIds = scenes.map((scene) => scene.id);
		const [moved] = reorderedIds.splice(currentIndex, 1);
		reorderedIds.splice(nextIndex, 0, moved);
		await editor.scenes.reorderScenes({ sceneIds: reorderedIds });
	};

	const handleDuplicateScene = async ({ sceneId }: { sceneId: string }) => {
		try {
			await editor.scenes.duplicateScene({ sceneId });
		} catch (error) {
			console.error("Failed to duplicate scene:", error);
			toast.error("Failed to duplicate scene");
		}
	};

	const handleCreateSceneAfter = async ({ sceneId }: { sceneId: string }) => {
		try {
			await editor.scenes.createSceneAfter({ sceneId });
		} catch (error) {
			console.error("Failed to create scene:", error);
			toast.error("Failed to create scene");
		}
	};

	const handleDeleteScene = async ({ sceneId }: { sceneId: string }) => {
		try {
			await editor.scenes.deleteScene({ sceneId });
		} catch (error) {
			console.error("Failed to delete scene:", error);
			toast.error("Failed to delete scene");
		}
	};

	return (
		<Sheet>
			<SheetTrigger asChild>{children}</SheetTrigger>
			<SheetContent className="sm:max-w-xl">
				<SheetHeader>
					<SheetTitle>Project storyboard</SheetTitle>
					<SheetDescription>
						Assemble your project by ordering scenes. Edit one scene at a time.
					</SheetDescription>
				</SheetHeader>
				<div className="flex items-center justify-between border-b py-4">
					<div>
						<p className="text-sm font-medium">Project duration</p>
						<p className="text-muted-foreground text-xs">
							{formatTimeCode({ timeInSeconds: projectDuration })}
						</p>
					</div>
					<div className="flex items-center gap-2">
						<Button
							size="sm"
							variant="outline"
							onClick={async () => {
								const name = window.prompt(
									"Scene recipe name",
									`${currentScene?.name ?? "Scene"} Recipe`,
								);
								if (!name || !currentScene) return;
								try {
									await editor.scenes.saveSceneAsRecipe({
										name: name.trim(),
										sceneId: currentScene.id,
									});
									toast.success("Scene recipe saved.");
								} catch (error) {
									console.error("Failed to save scene recipe:", error);
									toast.error("Failed to save scene recipe");
								}
							}}
							disabled={!currentScene}
						>
							Save as recipe
						</Button>
						<Button
							size="sm"
							variant="outline"
							onClick={() =>
								editor.scenes.createSceneAfter({
									sceneId: currentScene?.id ?? scenes[scenes.length - 1]?.id ?? "",
								})
							}
							disabled={scenes.length === 0}
						>
							<Plus className="mr-1 size-4" />
							Add scene
						</Button>
					</div>
				</div>
				<div className="flex flex-col gap-3 py-4">
					{scenes.length === 0 ? (
						<div className="text-muted-foreground text-sm">No scenes available.</div>
					) : (
						scenes.map((scene, index) => {
							const assemblyScene =
								assembly.find((entry) => entry.sceneId === scene.id) ?? null;
							const { canDelete, reason } = canDeleteScene({ scene });

							return (
								<div
									key={scene.id}
									className={cn(
										"rounded-md border p-3",
										currentScene?.id === scene.id && "border-primary",
									)}
								>
									<div className="flex items-start justify-between gap-3">
										<button
											type="button"
											className="flex min-w-0 flex-1 flex-col items-start text-left"
											onClick={() => handleSceneSwitch(scene.id)}
										>
											<div className="flex items-center gap-2">
												<p className="font-medium">{scene.name}</p>
												{currentScene?.id === scene.id ? (
													<Badge variant="outline" className="h-5 px-1.5 text-[10px]">
														<Check className="mr-1 size-3" />
														Editing
													</Badge>
												) : null}
											</div>
											<p className="text-muted-foreground mt-1 text-xs">
												Scene {index + 1} · Starts{" "}
												{formatTimeCode({
													timeInSeconds: assemblyScene?.projectStartTime ?? 0,
												})}{" "}
												· Length{" "}
												{formatTimeCode({
													timeInSeconds: assemblyScene?.duration ?? 0,
												})}
											</p>
										</button>
										<div className="flex shrink-0 items-center gap-1">
											<Button
												variant="ghost"
												size="icon"
												className="size-8"
												onClick={() =>
													handleMoveScene({ sceneId: scene.id, direction: "up" })
												}
												disabled={index === 0}
												title="Move scene up"
											>
												<ArrowUp className="size-4" />
											</Button>
											<Button
												variant="ghost"
												size="icon"
												className="size-8"
												onClick={() =>
													handleMoveScene({ sceneId: scene.id, direction: "down" })
												}
												disabled={index === scenes.length - 1}
												title="Move scene down"
											>
												<ArrowDown className="size-4" />
											</Button>
											<Button
												variant="ghost"
												size="icon"
												className="size-8"
												onClick={() => handleDuplicateScene({ sceneId: scene.id })}
												title="Duplicate scene"
											>
												<Copy className="size-4" />
											</Button>
											<Button
												variant="ghost"
												size="icon"
												className="size-8"
												onClick={() => handleCreateSceneAfter({ sceneId: scene.id })}
												title="Add scene after"
											>
												<Plus className="size-4" />
											</Button>
											<DeleteDialog
												sceneName={scene.name}
												disabled={!canDelete}
												disabledReason={reason}
												onDelete={() => handleDeleteScene({ sceneId: scene.id })}
												trigger={
													<Button
														variant="ghost"
														size="icon"
														className="size-8"
														disabled={!canDelete}
														title={reason ?? "Delete scene"}
													>
														<Trash2 className="size-4" />
													</Button>
												}
											/>
										</div>
									</div>
								</div>
							);
						})
					)}
				</div>
			</SheetContent>
		</Sheet>
	);
}

function DeleteDialog({
	sceneName,
	onDelete,
	disabled,
	disabledReason,
	trigger,
}: {
	sceneName: string;
	onDelete: () => void;
	disabled?: boolean;
	disabledReason?: string;
	trigger: React.ReactNode;
}) {
	const [open, setOpen] = useState(false);

	const handleDelete = () => {
		onDelete();
		setOpen(false);
	};

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>{trigger}</DialogTrigger>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Delete scene</DialogTitle>
					<DialogDescription>
						{disabledReason ??
							`Delete "${sceneName}" from the project storyboard? This action cannot be undone.`}
					</DialogDescription>
				</DialogHeader>
				<DialogFooter>
					<Button variant="outline" onClick={() => setOpen(false)}>
						Cancel
					</Button>
					<Button
						variant="destructive"
						onClick={handleDelete}
						disabled={disabled}
					>
						Delete
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
