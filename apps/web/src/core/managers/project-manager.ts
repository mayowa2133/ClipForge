import type { EditorCore } from "@/core";
import type {
	ProjectVersionPack,
	ProjectVersionTarget,
	TProject,
	TProjectMetadata,
	TProjectSortKey,
	TProjectSortOption,
	TProjectSettings,
	TTimelineViewState,
} from "@/types/project";
import type { ExportOptions, ExportResult } from "@/types/export";
import type {
	ComponentTemplate,
	CreatorTemplate,
	ProjectKitTemplate,
	SceneRecipeTemplate,
} from "@/types/templates";
import { storageService } from "@/services/storage/service";
import { toast } from "sonner";
import { generateUUID } from "@/utils/id";
import {
	ApplyProjectKitCommand,
	UpdateProjectSettingsCommand,
	DeleteCreatorTemplateCommand,
	UpsertCreatorTemplateCommand,
} from "@/lib/commands";
import {
	DEFAULT_FPS,
	DEFAULT_CANVAS_SIZE,
	DEFAULT_COLOR,
	DEFAULT_PROJECT_AUDIO_SETTINGS,
	DEFAULT_PROJECT_BRAND_KIT,
	DEFAULT_PROJECT_LIBRARY_DEFAULTS,
	DEFAULT_PROJECT_MONTAGE_DEFAULTS,
	DEFAULT_PROJECT_OVERLAY_DEFAULTS,
	buildDefaultProjectVersionPack,
} from "@/constants/project-constants";
import { buildDefaultScene, getProjectDurationFromScenes } from "@/lib/scenes";
import { buildScene } from "@/services/renderer/scene-builder";
import { CanvasRenderer } from "@/services/renderer/canvas-renderer";
import {
	CURRENT_PROJECT_VERSION,
	migrations,
	runStorageMigrations,
	type MigrationProgress,
} from "@/services/storage/migrations";
import { DEFAULT_TIMELINE_VIEW_STATE } from "@/constants/timeline-constants";
import { loadFonts } from "@/lib/fonts/google-fonts";
import { collectFontFamilies } from "@/lib/timeline/element-utils";
import { buildDefaultClipForgeProjectData } from "@/lib/clipforge";
import { buildProjectKitPayload } from "@/lib/timeline";

export interface MigrationState {
	isMigrating: boolean;
	fromVersion: number | null;
	toVersion: number | null;
	projectName: string | null;
}

export class ProjectManager {
	private active: TProject | null = null;
	private savedProjects: TProjectMetadata[] = [];
	private templateLibrary: CreatorTemplate[] = [];
	private isLoading = true;
	private isInitialized = false;
	private invalidProjectIds = new Set<string>();
	private storageMigrationPromise: Promise<void> | null = null;
	private templateLibraryPromise: Promise<void> | null = null;
	private listeners = new Set<() => void>();
	private migrationState: MigrationState = {
		isMigrating: false,
		fromVersion: null,
		toVersion: null,
		projectName: null,
	};

	constructor(private editor: EditorCore) {
		void this.loadTemplateLibrary();
	}

	private async ensureStorageMigrations(): Promise<void> {
		if (this.storageMigrationPromise) {
			await this.storageMigrationPromise;
			return;
		}

		this.storageMigrationPromise = (async () => {
			await runStorageMigrations({
				migrations,
				onProgress: (progress: MigrationProgress) => {
					this.migrationState = progress;
					this.notify();
				},
			});
		})();

		await this.storageMigrationPromise;
	}

	async createNewProject({ name }: { name: string }): Promise<string> {
		const mainScene = buildDefaultScene({ name: "Main scene", isMain: true });
		const newProject: TProject = {
			metadata: {
				id: generateUUID(),
				name,
				duration: getProjectDurationFromScenes({ scenes: [mainScene] }),
				createdAt: new Date(),
				updatedAt: new Date(),
			},
			scenes: [mainScene],
			currentSceneId: mainScene.id,
			settings: {
				fps: DEFAULT_FPS,
				canvasSize: DEFAULT_CANVAS_SIZE,
				originalCanvasSize: null,
				background: {
					type: "color",
					color: DEFAULT_COLOR,
				},
				audio: { ...DEFAULT_PROJECT_AUDIO_SETTINGS },
				brandKit: { ...DEFAULT_PROJECT_BRAND_KIT },
				libraryDefaults: { ...DEFAULT_PROJECT_LIBRARY_DEFAULTS },
				overlayDefaults: { ...DEFAULT_PROJECT_OVERLAY_DEFAULTS },
				montageDefaults: { ...DEFAULT_PROJECT_MONTAGE_DEFAULTS },
				versionPack: buildDefaultProjectVersionPack({
					canvasSize: DEFAULT_CANVAS_SIZE,
				}),
				polishProfileId: null,
			},
			version: CURRENT_PROJECT_VERSION,
			clipforge: buildDefaultClipForgeProjectData(),
		};

		this.active = newProject;
		this.notify();

		this.editor.media.clearAllAssets();
		this.editor.scenes.initializeScenes({
			scenes: newProject.scenes,
			currentSceneId: newProject.currentSceneId,
		});

		try {
			await storageService.saveProject({ project: newProject });
			this.updateMetadata(newProject);

			return newProject.metadata.id;
		} catch (error) {
			toast.error("Failed to save new project");
			throw error;
		}
	}

	async loadProject({ id }: { id: string }): Promise<void> {
		if (!this.isInitialized) {
			this.isLoading = true;
			this.notify();
		}

		this.editor.save.pause();
		await this.ensureStorageMigrations();
		this.editor.media.clearAllAssets();
		this.editor.scenes.clearScenes();

		try {
			const result = await storageService.loadProject({ id });
			if (!result) {
				throw new Error(`Project with id ${id} not found`);
			}

			const project = result.project;

			this.active = project;
			this.notify();

			if (project.scenes && project.scenes.length > 0) {
				this.editor.scenes.initializeScenes({
					scenes: project.scenes,
					currentSceneId: project.currentSceneId,
				});
			}

			await this.editor.media.loadProjectMedia({ projectId: id });

			const allTracks = (project.scenes ?? []).flatMap((scene) => scene.tracks);
			await loadFonts({ families: collectFontFamilies({ tracks: allTracks }) });

			if (!project.metadata.thumbnail) {
				const didUpdateThumbnail = await this.updateThumbnailFromTimeline();
				if (didUpdateThumbnail) {
					await this.saveCurrentProject();
				}
			}
		} catch (error) {
			console.error("Failed to load project:", error);
			throw error;
		} finally {
			this.isLoading = false;
			this.notify();
			this.editor.save.resume();
		}
	}

	async saveCurrentProject(): Promise<void> {
		if (!this.active) return;

		try {
			const timelineTracks = this.editor.timeline.getTracks();
			const scenes = this.editor.scenes.getScenes().map((scene) =>
				scene.id === this.active?.currentSceneId
					? {
							...scene,
							tracks: timelineTracks,
							updatedAt: new Date(),
					  }
					: scene,
			);
			const updatedProject = {
				...this.active,
				scenes,
				metadata: {
					...this.active.metadata,
					duration: getProjectDurationFromScenes({ scenes }),
					updatedAt: new Date(),
				},
			};

			await storageService.saveProject({ project: updatedProject });
			this.active = updatedProject;
			this.updateMetadata(updatedProject);
		} catch (error) {
			console.error("Failed to save project:", error);
		}
	}

	async export({ options }: { options: ExportOptions }): Promise<ExportResult> {
		return this.editor.renderer.exportProject({ options });
	}

	async loadAllProjects(): Promise<void> {
		if (!this.isInitialized) {
			this.isLoading = true;
			this.notify();
		}

		await this.ensureStorageMigrations();
		try {
			const metadata = await storageService.loadAllProjectsMetadata();
			this.savedProjects = metadata;
			this.notify();
		} catch (error) {
			console.error("Failed to load projects:", error);
		} finally {
			this.isLoading = false;
			this.isInitialized = true;
			this.notify();
		}
	}

	async loadTemplateLibrary(): Promise<void> {
		if (this.templateLibraryPromise) {
			await this.templateLibraryPromise;
			return;
		}
		this.templateLibraryPromise = storageService
			.loadAllTemplates()
			.then((templates) => {
				this.templateLibrary = templates;
				this.notify();
			})
			.finally(() => {
				this.templateLibraryPromise = null;
			});
		await this.templateLibraryPromise;
	}

	async deleteProjects({ ids }: { ids: string[] }): Promise<void> {
		const uniqueIds = Array.from(new Set(ids));
		if (uniqueIds.length === 0) return;

		try {
			await Promise.all(
				uniqueIds.map((id) =>
					Promise.all([
						storageService.deleteProjectMedia({ projectId: id }),
						storageService.deleteProject({ id }),
					]),
				),
			);

			const idSet = new Set(uniqueIds);
			this.savedProjects = this.savedProjects.filter(
				(project) => !idSet.has(project.id),
			);

			const shouldClearActive =
				this.active && idSet.has(this.active.metadata.id);

			if (shouldClearActive) {
				this.active = null;
				this.editor.media.clearAllAssets();
				this.editor.scenes.clearScenes();
			}

			this.notify();
		} catch (error) {
			console.error("Failed to delete projects:", error);
		}
	}

	closeProject(): void {
		this.active = null;
		this.notify();

		this.editor.media.clearAllAssets();
		this.editor.scenes.clearScenes();
	}

	async renameProject({
		id,
		name,
	}: {
		id: string;
		name: string;
	}): Promise<void> {
		try {
			const result = await storageService.loadProject({ id });
			if (!result) {
				toast.error("Project not found", {
					description: "Please try again",
				});
				return;
			}

			const updatedProject: TProject = {
				...result.project,
				metadata: {
					...result.project.metadata,
					name,
					updatedAt: new Date(),
				},
			};

			await storageService.saveProject({ project: updatedProject });

			if (this.active?.metadata.id === id) {
				this.active = updatedProject;
				this.notify();
			}

			this.updateMetadata(updatedProject);
		} catch (error) {
			console.error("Failed to rename project:", error);
			toast.error("Failed to rename project", {
				description:
					error instanceof Error ? error.message : "Please try again",
			});
		}
	}

	async duplicateProjects({ ids }: { ids: string[] }): Promise<string[]> {
		const uniqueIds = Array.from(new Set(ids));
		if (uniqueIds.length === 0) return [];

		try {
			const getDuplicateBaseName = ({ name }: { name: string }) => {
				const match = name.match(/^\((\d+)\)\s+(.+)$/);
				const number = match ? Number.parseInt(match[1], 10) : null;
				const baseName = match ? match[2] : name;
				return { baseName, number };
			};

			const loadResults = await Promise.all(
				uniqueIds.map(async (projectId) => {
					const result = await storageService.loadProject({ id: projectId });
					return { projectId, project: result?.project ?? null };
				}),
			);

			const missingProjectIds = loadResults
				.filter((result) => !result.project)
				.map((result) => result.projectId);

			if (missingProjectIds.length > 0) {
				toast.error(
					missingProjectIds.length === 1
						? "Project not found"
						: "Projects not found",
					{
						description:
							missingProjectIds.length === 1
								? "Please try again"
								: "Some projects could not be found",
					},
				);
				throw new Error(`Projects not found: ${missingProjectIds.join(", ")}`);
			}

			const projectsToDuplicate = loadResults.flatMap((result) =>
				result.project ? [result.project] : [],
			);

			const maxNumberByBaseName = new Map<string, number>();

			for (const project of this.savedProjects) {
				const { baseName, number } = getDuplicateBaseName({
					name: project.name,
				});

				if (number === null) continue;

				const currentMax = maxNumberByBaseName.get(baseName);
				if (currentMax === undefined || number > currentMax) {
					maxNumberByBaseName.set(baseName, number);
				}
			}

			const nextNumberByBaseName = new Map<string, number>();
			for (const [baseName, maxNumber] of maxNumberByBaseName) {
				nextNumberByBaseName.set(baseName, maxNumber + 1);
			}

			const duplicationPlans = projectsToDuplicate.map((project) => {
				const { baseName } = getDuplicateBaseName({
					name: project.metadata.name,
				});
				const nextNumber = nextNumberByBaseName.get(baseName) ?? 1;
				nextNumberByBaseName.set(baseName, nextNumber + 1);

				const newProjectId = generateUUID();
				const newProject: TProject = {
					...project,
					metadata: {
						...project.metadata,
						id: newProjectId,
						name: `(${nextNumber}) ${baseName}`,
						createdAt: new Date(),
						updatedAt: new Date(),
					},
				};

				return {
					newProjectId,
					newProject,
					sourceProjectId: project.metadata.id,
				};
			});

			await Promise.all(
				duplicationPlans.map(({ newProject }) =>
					storageService.saveProject({ project: newProject }),
				),
			);

			await Promise.all(
				duplicationPlans.map(async ({ sourceProjectId, newProjectId }) => {
					const sourceMediaAssets = await storageService.loadAllMediaAssets({
						projectId: sourceProjectId,
					});

					await Promise.all(
						sourceMediaAssets.map((mediaAsset) =>
							storageService.saveMediaAsset({
								projectId: newProjectId,
								mediaAsset,
							}),
						),
					);
				}),
			);

			for (const { newProject } of duplicationPlans) {
				this.updateMetadata(newProject);
			}

			return duplicationPlans.map((plan) => plan.newProjectId);
		} catch (error) {
			console.error("Failed to duplicate projects:", error);
			toast.error("Failed to duplicate projects", {
				description:
					error instanceof Error ? error.message : "Please try again",
			});
			throw error;
		}
	}

	async updateSettings({
		settings,
		pushHistory = true,
	}: {
		settings: Partial<TProjectSettings>;
		pushHistory?: boolean;
	}): Promise<void> {
		if (!this.active) return;

		const command = new UpdateProjectSettingsCommand(settings);
		if (pushHistory) {
			this.editor.command.execute({ command });
			return;
		}

		command.execute();
	}

	async setActiveVersionTarget({
		targetId,
	}: {
		targetId: ProjectVersionTarget | null;
	}): Promise<void> {
		const activeProject = this.getActiveOrNull();
		if (!activeProject) return;
		const currentVersionPack = activeProject.settings.versionPack;
		if (!currentVersionPack) return;
		await this.updateSettings({
			settings: {
				versionPack: {
					...currentVersionPack,
					activeTargetId: targetId,
				},
			},
		});
	}

	async updateVersionPack({
		versionPack,
	}: {
		versionPack: ProjectVersionPack;
	}): Promise<void> {
		await this.updateSettings({
			settings: {
				versionPack,
			},
		});
	}

	getTemplateLibrary(): CreatorTemplate[] {
		return this.templateLibrary;
	}

	getComponentTemplates(): ComponentTemplate[] {
		return this.templateLibrary.filter(
			(template): template is ComponentTemplate => template.kind === "component",
		);
	}

	getSceneRecipeTemplates(): SceneRecipeTemplate[] {
		return this.templateLibrary.filter(
			(template): template is SceneRecipeTemplate => template.kind === "scene-recipe",
		);
	}

	getProjectKitTemplates(): ProjectKitTemplate[] {
		return this.templateLibrary.filter(
			(template): template is ProjectKitTemplate => template.kind === "project-kit",
		);
	}

	setTemplateLibrary({ templates }: { templates: CreatorTemplate[] }): void {
		this.templateLibrary = templates;
		this.notify();
	}

	findTemplateById({ templateId }: { templateId: string }): CreatorTemplate | null {
		return this.templateLibrary.find((template) => template.id === templateId) ?? null;
	}

	async deleteTemplate({ templateId }: { templateId: string }): Promise<void> {
		this.editor.command.execute({
			command: new DeleteCreatorTemplateCommand(templateId),
		});
	}

	async saveProjectAsKit({
		name,
		includeBrand = true,
		includeCaptionStyle = true,
		includeOverlayDefaults = true,
		includeAudioMix = true,
		includeMontageDefaults = true,
	}: {
		name: string;
		includeBrand?: boolean;
		includeCaptionStyle?: boolean;
		includeOverlayDefaults?: boolean;
		includeAudioMix?: boolean;
		includeMontageDefaults?: boolean;
	}): Promise<string> {
		const activeProject = this.getActiveOrNull();
		if (!activeProject) {
			throw new Error("No active project");
		}

		const now = new Date();
		const template: ProjectKitTemplate = {
			id: generateUUID(),
			name,
			kind: "project-kit",
			version: 1,
			thumbnailAssetId: activeProject.metadata.thumbnail ?? null,
			createdAt: now,
			updatedAt: now,
			payload: buildProjectKitPayload({
				project: activeProject,
				includeBrand,
				includeCaptionStyle,
				includeOverlayDefaults,
				includeAudioMix,
				includeMontageDefaults,
			}),
		};

		this.editor.command.execute({
			command: new UpsertCreatorTemplateCommand(template),
		});
		return template.id;
	}

	async applyProjectKit({ kitId }: { kitId: string }): Promise<void> {
		const template = this.findTemplateById({ templateId: kitId });
		if (!template || template.kind !== "project-kit") {
			throw new Error("Project kit not found.");
		}

		this.editor.command.execute({
			command: new ApplyProjectKitCommand(template.payload),
		});
	}

	async updateThumbnail({ thumbnail }: { thumbnail: string }): Promise<void> {
		if (!this.active) return;

		const updatedProject: TProject = {
			...this.active,
			metadata: { ...this.active.metadata, thumbnail, updatedAt: new Date() },
		};
		this.active = updatedProject;
		this.notify();
		this.updateMetadata(updatedProject);
		this.editor.save.markDirty();
	}

	async prepareExit(): Promise<void> {
		if (!this.active) return;

		try {
			const didUpdateThumbnail = await this.updateThumbnailFromTimeline();
			if (didUpdateThumbnail) {
				await this.editor.save.flush();
			}
		} catch (error) {
			console.error("Failed to generate project thumbnail on exit:", error);
		}
	}

	getFilteredAndSortedProjects({
		searchQuery,
		sortOption,
	}: {
		searchQuery: string;
		sortOption: TProjectSortOption;
	}): TProjectMetadata[] {
		const filteredProjects = this.savedProjects.filter((project) =>
			project.name.toLowerCase().includes(searchQuery.toLowerCase()),
		);

		const [key, order] = sortOption.split("-") as [
			TProjectSortKey,
			"asc" | "desc",
		];

		const sortedProjects = [...filteredProjects].sort((a, b) => {
			const aValue = a[key];
			const bValue = b[key];

			if (order === "asc") {
				if (aValue < bValue) return -1;
				if (aValue > bValue) return 1;
				return 0;
			}
			if (aValue > bValue) return -1;
			if (aValue < bValue) return 1;
			return 0;
		});

		return sortedProjects;
	}

	isInvalidProjectId({ id }: { id: string }): boolean {
		return this.invalidProjectIds.has(id);
	}

	markProjectIdAsInvalid({ id }: { id: string }): void {
		this.invalidProjectIds.add(id);
		this.notify();
	}

	clearInvalidProjectIds(): void {
		this.invalidProjectIds.clear();
		this.notify();
	}

	getActive(): TProject {
		if (!this.active) {
			throw new Error("No active project");
		}
		return this.active;
	}

	/**
	 * for agents:
	 * in most cases, the project is guaranteed to be active, in which getActive() should be used instead.
	 * for very rare cases, this function may be used.
	 */
	getActiveOrNull(): TProject | null {
		return this.active;
	}

	getTimelineViewState(): TTimelineViewState {
		return this.active?.timelineViewState ?? DEFAULT_TIMELINE_VIEW_STATE;
	}

	setTimelineViewState({ viewState }: { viewState: TTimelineViewState }): void {
		if (!this.active) return;
		this.active = {
			...this.active,
			timelineViewState: viewState ?? undefined,
		};
		this.editor.save.markDirty();
	}

	getSavedProjects(): TProjectMetadata[] {
		return this.savedProjects;
	}

	getIsLoading(): boolean {
		return this.isLoading;
	}

	getIsInitialized(): boolean {
		return this.isInitialized;
	}

	getMigrationState(): MigrationState {
		return this.migrationState;
	}

	setActiveProject({ project }: { project: TProject }): void {
		this.active = project;
		this.notify();
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private async updateThumbnailFromTimeline(): Promise<boolean> {
		if (!this.active) return false;

		const tracks = this.editor.timeline.getTracks();
		const mediaAssets = this.editor.media.getAssets();
		const duration = this.editor.timeline.getTotalDuration();

		if (duration === 0) return false;

		const { canvasSize, background } = this.active.settings;

		const scene = buildScene({
			tracks,
			mediaAssets,
			duration,
			canvasSize,
			background,
		});

		const renderer = new CanvasRenderer({
			width: canvasSize.width,
			height: canvasSize.height,
			fps: this.active.settings.fps,
		});

		const tempCanvas = document.createElement("canvas");
		tempCanvas.width = canvasSize.width;
		tempCanvas.height = canvasSize.height;

		await renderer.renderToCanvas({
			node: scene,
			time: 0,
			targetCanvas: tempCanvas,
		});

		const thumbnailDataUrl = tempCanvas.toDataURL("image/png");

		await this.updateThumbnail({ thumbnail: thumbnailDataUrl });
		return true;
	}

	private updateMetadata(project: TProject): void {
		const index = this.savedProjects.findIndex(
			(p) => p.id === project.metadata.id,
		);

		if (index !== -1) {
			this.savedProjects[index] = project.metadata;
		} else {
			this.savedProjects = [project.metadata, ...this.savedProjects];
		}

		this.notify();
	}

	private notify(): void {
		this.listeners.forEach((fn) => fn());
	}
}
