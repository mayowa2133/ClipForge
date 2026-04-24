"use client";

import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { PanelView } from "@/components/editor/panels/assets/views/base-view";
import { MediaDragOverlay } from "@/components/editor/panels/assets/drag-overlay";
import { DraggableItem } from "@/components/editor/panels/assets/draggable-item";
import { Button } from "@/components/ui/button";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import {
	ENABLE_CLIPFORGE_AUTO_EDIT,
	ENABLE_CLIPFORGE_EXPERIENCE,
} from "@/constants/feature-flags";
import { TIMELINE_CONSTANTS } from "@/constants/timeline-constants";
import { useEditor } from "@/hooks/use-editor";
import {
	DemoProjectCreationError,
	type IncompatibleMediaReference,
	type MissingMediaReference,
	getReferenceVideoAnalysisStatus,
	summarizeReferenceAnalysis,
} from "@/lib/clipforge";
import { useFileUpload } from "@/hooks/use-file-upload";
import { useRevealItem } from "@/hooks/use-reveal-item";
import { processMediaAssets } from "@/lib/media/processing";
import { buildElementFromMedia } from "@/lib/timeline/element-utils";
import { invokeAction } from "@/lib/actions";
import { useAssetsPanelStore } from "@/stores/assets-panel-store";
import { useClipForgeOnboardingStore } from "@/stores/clipforge-onboarding-store";
import { useChatPanelStore } from "@/stores/chat-panel-store";
import type { MediaAsset } from "@/types/assets";
import { cn } from "@/utils/ui";
import {
	CloudUploadIcon,
	GridViewIcon,
	LeftToRightListDashIcon,
	SortingOneNineIcon,
	Image02Icon,
	MusicNote03Icon,
	Video01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";

export function MediaView() {
	const editor = useEditor();
	const router = useRouter();
	const searchParams = useSearchParams();
	const mediaFiles = editor.media.getAssets();
	const activeProject = editor.project.getActive();
	const openChatPanel = useChatPanelStore((state) => state.open);
	const startPendingGuide = useClipForgeOnboardingStore(
		(state) => state.startPendingGuide,
	);
	const hasCompletedFirstImport = useClipForgeOnboardingStore(
		(state) => state.hasCompletedFirstImport,
	);
	const hasCompletedFirstAssistantAction = useClipForgeOnboardingStore(
		(state) => state.hasCompletedFirstAssistantAction,
	);
	const hasCompletedFirstExport = useClipForgeOnboardingStore(
		(state) => state.hasCompletedFirstExport,
	);
	const markFirstImportCompleted = useClipForgeOnboardingStore(
		(state) => state.markFirstImportCompleted,
	);

	const { mediaViewMode, setMediaViewMode, highlightMediaId, clearHighlight } =
		useAssetsPanelStore();
	const { highlightedId, registerElement } = useRevealItem(
		highlightMediaId,
		clearHighlight,
	);

	const [isProcessing, setIsProcessing] = useState(false);
	const [isCreatingDemo, setIsCreatingDemo] = useState(false);
	const [isRelinkingMissingMedia, setIsRelinkingMissingMedia] = useState(false);
	const [isScanningCompatibility, setIsScanningCompatibility] = useState(false);
	const [progress, setProgress] = useState(0);
	const [pendingSrtMediaId, setPendingSrtMediaId] = useState<string | null>(null);
	const [pendingMissingMediaRelink, setPendingMissingMediaRelink] = useState<{
		mediaId: string;
		allowedReplacementTypes: Array<"video" | "image" | "audio">;
	} | null>(null);
	const [sortBy, setSortBy] = useState<"name" | "type" | "duration" | "size">(
		"name",
	);
	const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
	const hasTriggeredStarterImportRef = useRef(false);
	const srtInputRef = useRef<HTMLInputElement>(null);
	const missingMediaRelinkInputRef = useRef<HTMLInputElement>(null);
	const activeReferenceAssetId = activeProject?.clipforge?.activeReferenceVideoAssetId ?? null;
	const explicitAssemblySourceAssetIds = activeProject?.clipforge?.assemblySourceAssetIds ?? [];
	const assemblySourceAssetIds =
		explicitAssemblySourceAssetIds.length > 0
			? explicitAssemblySourceAssetIds
			: mediaFiles
					.filter(
						(asset) =>
							asset.type === "video" &&
							!asset.ephemeral &&
							asset.id !== activeReferenceAssetId,
					)
					.map((asset) => asset.id);
	const activeReferenceAsset =
		mediaFiles.find((asset) => asset.id === activeReferenceAssetId) ?? null;
	const activeReferenceAnalysis =
		activeReferenceAssetId && activeProject?.clipforge?.referenceAnalysisByAssetId
			? activeProject.clipforge.referenceAnalysisByAssetId[activeReferenceAssetId] ?? null
			: null;
	const activeReferenceStatus = getReferenceVideoAnalysisStatus({
		analysis: activeReferenceAnalysis,
		asset: activeReferenceAsset,
		metadata:
			activeReferenceAssetId && activeProject?.clipforge?.mediaMetadataById
				? activeProject.clipforge.mediaMetadataById[activeReferenceAssetId] ?? null
				: null,
	});

	const runIndexing = async ({
		mediaIds,
	}: {
		mediaIds?: string[];
	}) => {
		toast("Indexing clips for captions and smart edits...");
		const result = await editor.clipforge.indexMediaAssets({ mediaIds });
		if (result.failed.length > 0) {
			toast.error(
				`Indexed ${result.completed.length} of ${
					result.completed.length + result.failed.length
				} clips; some failed`,
			);
			return result;
		}

		toast.success(`Indexed ${result.completed.length} clips`);
		return result;
	};

	const processFiles = async ({ files }: { files: FileList }) => {
		if (!files || files.length === 0) return;
		if (!activeProject) {
			toast.error("No active project");
			return;
		}

		setIsProcessing(true);
		setProgress(0);
		try {
			const processedAssets = await processMediaAssets({
				files,
				onProgress: (progress: { progress: number }) =>
					setProgress(progress.progress),
			});
			const importedAssets: MediaAsset[] = [];
			for (const asset of processedAssets) {
				const importedAsset = await editor.media.addMediaAsset({
					projectId: activeProject.metadata.id,
					asset,
				});
				if (importedAsset) {
					importedAssets.push(importedAsset);
				}
			}

			if (importedAssets.length > 0) {
				editor.clipforge.initializeMediaMetadata({
					mediaAssets: importedAssets,
				});
				void runIndexing({
					mediaIds: importedAssets.map((asset) => asset.id),
				});
			}
		} catch (error) {
			console.error("Error processing files:", error);
			toast.error("Failed to process files");
		} finally {
			setIsProcessing(false);
			setProgress(0);
		}
	};

	const { isDragOver, dragProps, openFilePicker, fileInputProps } =
		useFileUpload({
			accept: ENABLE_CLIPFORGE_AUTO_EDIT
				? "video/*,audio/*"
				: "image/*,video/*,audio/*",
			multiple: true,
			onFilesSelected: (files) => processFiles({ files }),
		});

	useEffect(() => {
		if (!hasCompletedFirstImport && mediaFiles.some((asset) => !asset.ephemeral)) {
			markFirstImportCompleted();
		}
	}, [hasCompletedFirstImport, markFirstImportCompleted, mediaFiles]);

	useEffect(() => {
		if (hasTriggeredStarterImportRef.current) {
			return;
		}
		if (searchParams.get("starter") !== "import") {
			return;
		}
		if (!activeProject) {
			return;
		}

		hasTriggeredStarterImportRef.current = true;
		router.replace(`/editor/${activeProject.metadata.id}`);
		requestAnimationFrame(() => {
			openFilePicker();
		});
	}, [activeProject, openFilePicker, router, searchParams]);

	const handleCreateDemoProject = async () => {
		if (isCreatingDemo) return;

		setIsCreatingDemo(true);
		try {
			const result = await editor.clipforge.createDemoProject();
			startPendingGuide();
			router.replace(`/editor/${result.projectId}`);
		} catch (error) {
			const maybeDemoError =
				error instanceof DemoProjectCreationError ? error : null;
			if (maybeDemoError?.projectId) {
				router.replace(`/editor/${maybeDemoError.projectId}`);
			}
			toast.error("Failed to create demo project.", {
				description:
					error instanceof Error ? error.message : "Please try again.",
			});
		} finally {
			setIsCreatingDemo(false);
		}
	};

	const handleRemove = async ({
		event,
		id,
	}: {
		event: React.MouseEvent;
		id: string;
	}) => {
		event.stopPropagation();

		if (!activeProject) {
			toast.error("No active project");
			return;
		}

		await editor.media.removeMediaAsset({
			projectId: activeProject.metadata.id,
			id,
		});
	};

	const handleSetReference = async ({ mediaId }: { mediaId: string }) => {
		try {
			await editor.clipforge.setActiveReferenceVideo({ assetId: mediaId });
			toast.success("Reference video updated.");
		} catch (error) {
			toast.error("Failed to set reference video.", {
				description: error instanceof Error ? error.message : "Please try again.",
			});
		}
	};

	const handleClearReference = () => {
		editor.clipforge.clearActiveReferenceVideo();
		toast.success("Reference video cleared.");
	};

	const handleToggleAssemblySource = async ({ mediaId }: { mediaId: string }) => {
		const nextIds = assemblySourceAssetIds.includes(mediaId)
			? assemblySourceAssetIds.filter((assetId) => assetId !== mediaId)
			: [...assemblySourceAssetIds, mediaId];
		try {
			await editor.clipforge.setAssemblySourcePool({ assetIds: nextIds });
			toast.success(
				nextIds.includes(mediaId)
					? "Added clip to AI draft source pool."
					: "Removed clip from AI draft source pool.",
			);
		} catch (error) {
			toast.error("Failed to update AI draft source pool.", {
				description: error instanceof Error ? error.message : "Please try again.",
			});
		}
	};

	const addElementAtTime = ({
		asset,
		startTime,
	}: {
		asset: MediaAsset;
		startTime: number;
	}): boolean => {
		const duration =
			asset.duration ?? TIMELINE_CONSTANTS.DEFAULT_ELEMENT_DURATION;
		const element = buildElementFromMedia({
			mediaId: asset.id,
			mediaType: asset.type,
			name: asset.name,
			duration,
			startTime,
		});
		editor.timeline.insertElement({
			element,
			placement: { mode: "auto" },
		});
		return true;
	};

	const handleIndexClip = async ({ mediaId }: { mediaId: string }) => {
		const metadata = await editor.clipforge.indexMediaAsset({ mediaId });
		if (metadata.transcriptionStatus === "ready") {
			toast.success("Clip indexed");
			return;
		}

		toast.error(metadata.transcriptionError ?? "Clip indexing failed");
	};

	const handleImportSrt = ({ mediaId }: { mediaId: string }) => {
		setPendingSrtMediaId(mediaId);
		srtInputRef.current?.click();
	};

	const handleSrtInputChange = async (
		event: React.ChangeEvent<HTMLInputElement>,
	) => {
		const file = event.target.files?.[0];
		const mediaId = pendingSrtMediaId;
		event.currentTarget.value = "";
		setPendingSrtMediaId(null);

		if (!file || !mediaId) return;

		try {
			const srtText = await file.text();
			await editor.clipforge.importSrtForMedia({
				mediaId,
				srtText,
			});
			toast.success("SRT imported");
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Failed to import SRT",
			);
		}
	};

	const openMissingMediaRelinkPicker = ({
		mediaId,
		allowedReplacementTypes,
	}: {
		mediaId: string;
		allowedReplacementTypes: Array<"video" | "image" | "audio">;
	}) => {
		if (!missingMediaRelinkInputRef.current) {
			return;
		}
		missingMediaRelinkInputRef.current.accept = buildRelinkAccept({
			allowedReplacementTypes,
		});
		missingMediaRelinkInputRef.current.multiple = false;
		setPendingMissingMediaRelink({
			mediaId,
			allowedReplacementTypes,
		});
		missingMediaRelinkInputRef.current.click();
	};

	const handleMissingMediaRelinkInputChange = async (
		event: React.ChangeEvent<HTMLInputElement>,
	) => {
		const file = event.target.files?.[0];
		event.currentTarget.value = "";
		const pendingRelink = pendingMissingMediaRelink;
		setPendingMissingMediaRelink(null);
		if (!file || !pendingRelink) return;

		setIsRelinkingMissingMedia(true);
		try {
			const processedAssets = await processMediaAssets({
				files: [file],
			});
			const replacementAsset = processedAssets[0];
			if (!replacementAsset) {
				throw new Error("Failed to process replacement media.");
			}
			const result = await editor.clipforge.relinkMissingMediaReference({
				mediaId: pendingRelink.mediaId,
				replacementAsset,
			});
			toast.success(
				`Relinked ${result.restoredReferences} segment(s) for missing media ${result.mediaId}.`,
			);
		} catch (error) {
			toast.error(
				error instanceof Error
					? error.message
					: "Failed to relink missing media reference.",
			);
		} finally {
			setIsRelinkingMissingMedia(false);
		}
	};

	const handleRemoveMissingMediaSegments = ({ mediaId }: { mediaId: string }) => {
		const result = editor.clipforge.removeSegmentsReferencingMedia({
			mediaId,
		});
		if (!result.applied) {
			toast.error(
				result.errors[0]?.message ??
					`Failed to remove segments referencing missing media ${mediaId}.`,
			);
			return;
		}

		toast.success(
			result.removed > 0
				? `Removed ${result.removed} segment(s) referencing missing media ${mediaId}.`
				: `No segments referencing missing media ${mediaId} were found.`,
		);
	};

	const handleRescanCompatibility = async ({
		mediaId,
	}: {
		mediaId?: string;
	}) => {
		setIsScanningCompatibility(true);
		try {
			const result = mediaId
				? await editor.media.probeMediaCompatibility({
						ids: [mediaId],
					})
				: await editor.clipforge.scanReferencedMediaCompatibility({
						includeAudio: true,
					});
			toast.success(
				`Scanned ${result.scanned} media asset(s); updated ${result.updated}.`,
			);
			if (result.failed > 0) {
				toast.warning(
					`${result.failed} media asset(s) failed compatibility probing.`,
				);
			}
		} catch (error) {
			toast.error(
				error instanceof Error
					? error.message
					: "Failed to scan media compatibility.",
			);
		} finally {
			setIsScanningCompatibility(false);
		}
	};

	const filteredMediaItems = useMemo(() => {
		const filtered = mediaFiles.filter((item) => !item.ephemeral);

		filtered.sort((a, b) => {
			let valueA: string | number;
			let valueB: string | number;

			switch (sortBy) {
				case "name":
					valueA = a.name.toLowerCase();
					valueB = b.name.toLowerCase();
					break;
				case "type":
					valueA = a.type;
					valueB = b.type;
					break;
				case "duration":
					valueA = a.duration || 0;
					valueB = b.duration || 0;
					break;
				case "size":
					valueA = a.file.size;
					valueB = b.file.size;
					break;
				default:
					return 0;
			}

			if (valueA < valueB) return sortOrder === "asc" ? -1 : 1;
			if (valueA > valueB) return sortOrder === "asc" ? 1 : -1;
			return 0;
		});

		return filtered;
	}, [mediaFiles, sortBy, sortOrder]);
	const missingMediaReferences = editor.clipforge.listMissingMediaReferences();
	const incompatibleMediaReferences = editor.clipforge.listIncompatibleMediaReferences({
		includeAudio: true,
	});

	const hasVideoAssets = filteredMediaItems.some((item) => item.type === "video");

	const previewComponents = useMemo(() => {
		const previews = new Map<string, React.ReactNode>();

		filteredMediaItems.forEach((item) => {
			previews.set(item.id, <MediaPreview item={item} />);
			previews.set(
				`compact-${item.id}`,
				<MediaPreview item={item} variant="compact" />,
			);
		});

		return previews;
	}, [filteredMediaItems]);

	const renderPreview = (item: MediaAsset) => previewComponents.get(item.id);
	const renderCompactPreview = (item: MediaAsset) =>
		previewComponents.get(`compact-${item.id}`);
	const showStartHereCard =
		filteredMediaItems.length === 0 &&
		missingMediaReferences.length === 0 &&
		incompatibleMediaReferences.length === 0 &&
		ENABLE_CLIPFORGE_EXPERIENCE &&
		!hasCompletedFirstImport &&
		!hasCompletedFirstAssistantAction &&
		!hasCompletedFirstExport;

	const mediaActions = (
		<div>
			<TooltipProvider>
				<Tooltip>
					<TooltipTrigger asChild>
						<Button
							size="icon"
							variant="ghost"
							onClick={() =>
								setMediaViewMode(mediaViewMode === "grid" ? "list" : "grid")
							}
							disabled={isProcessing}
							className="items-center justify-center"
						>
							{mediaViewMode === "grid" ? (
								<HugeiconsIcon icon={LeftToRightListDashIcon} />
							) : (
								<HugeiconsIcon icon={GridViewIcon} />
							)}
						</Button>
					</TooltipTrigger>
					<TooltipContent>
						<p>
							{mediaViewMode === "grid"
								? "Switch to list view"
								: "Switch to grid view"}
						</p>
					</TooltipContent>
					<Tooltip>
						<DropdownMenu>
							<TooltipTrigger asChild>
								<DropdownMenuTrigger asChild>
									<Button
										size="icon"
										variant="ghost"
										disabled={isProcessing}
										className="items-center justify-center"
									>
										<HugeiconsIcon icon={SortingOneNineIcon} />
									</Button>
								</DropdownMenuTrigger>
							</TooltipTrigger>
							<DropdownMenuContent align="end">
								<SortMenuItem
									label="Name"
									sortKey="name"
									currentSortBy={sortBy}
									currentSortOrder={sortOrder}
									onSort={({ key }) => {
										if (sortBy === key) {
											setSortOrder(sortOrder === "asc" ? "desc" : "asc");
										} else {
											setSortBy(key);
											setSortOrder("asc");
										}
									}}
								/>
								<SortMenuItem
									label="Type"
									sortKey="type"
									currentSortBy={sortBy}
									currentSortOrder={sortOrder}
									onSort={({ key }) => {
										if (sortBy === key) {
											setSortOrder(sortOrder === "asc" ? "desc" : "asc");
										} else {
											setSortBy(key);
											setSortOrder("asc");
										}
									}}
								/>
								<SortMenuItem
									label="Duration"
									sortKey="duration"
									currentSortBy={sortBy}
									currentSortOrder={sortOrder}
									onSort={({ key }) => {
										if (sortBy === key) {
											setSortOrder(sortOrder === "asc" ? "desc" : "asc");
										} else {
											setSortBy(key);
											setSortOrder("asc");
										}
									}}
								/>
								<SortMenuItem
									label="File size"
									sortKey="size"
									currentSortBy={sortBy}
									currentSortOrder={sortOrder}
									onSort={({ key }) => {
										if (sortBy === key) {
											setSortOrder(sortOrder === "asc" ? "desc" : "asc");
										} else {
											setSortBy(key);
											setSortOrder("asc");
										}
									}}
								/>
							</DropdownMenuContent>
						</DropdownMenu>
						<TooltipContent>
							<p>
								Sort by {sortBy} (
								{sortOrder === "asc" ? "ascending" : "descending"})
							</p>
						</TooltipContent>
					</Tooltip>
				</Tooltip>
			</TooltipProvider>
			<Button
				variant="outline"
				onClick={openFilePicker}
				disabled={isProcessing}
				size="sm"
				className="items-center justify-center gap-1.5 ml-1.5"
			>
				<HugeiconsIcon icon={CloudUploadIcon} />
				{ENABLE_CLIPFORGE_AUTO_EDIT ? "Import Clips" : "Import"}
			</Button>
			{ENABLE_CLIPFORGE_AUTO_EDIT && (
				<>
					<Button
						variant="outline"
						onClick={() => void runIndexing({})}
						disabled={
							isProcessing ||
							!filteredMediaItems.some(
								(item) => item.type === "video" || item.type === "audio",
							)
						}
						size="sm"
						className="items-center justify-center gap-1.5 ml-1.5"
					>
						Index All Clips
					</Button>
					<Button
						variant="outline"
						onClick={() => invokeAction("clipforge-auto-edit-tiktok")}
						disabled={isProcessing || !hasVideoAssets}
						size="sm"
						className="items-center justify-center gap-1.5 ml-1.5"
					>
						Auto Edit TikTok
					</Button>
				</>
			)}
		</div>
	);

	return (
		<>
			<input {...fileInputProps} />
			<input
				ref={srtInputRef}
				type="file"
				accept=".srt"
				className="hidden"
				onChange={handleSrtInputChange}
			/>
			<input
				ref={missingMediaRelinkInputRef}
				type="file"
				className="hidden"
				onChange={handleMissingMediaRelinkInputChange}
			/>

			<PanelView
				title="Assets"
				actions={mediaActions}
				className={isDragOver ? "bg-accent/30" : ""}
				{...dragProps}
			>
				{showStartHereCard ? (
					<StartHereCard
						onImportClips={openFilePicker}
						onTryDemo={() => void handleCreateDemoProject()}
						onAskAssistant={() => {
							openChatPanel();
							editor.clipforge.populateChatDraft("Make a first cut");
						}}
					/>
				) : null}
				{activeReferenceAssetId ? (
					<div className="mb-3 rounded-md border p-3">
						<div className="flex items-center justify-between gap-3">
							<div>
								<p className="text-sm font-medium">Reference Video</p>
								<p className="text-muted-foreground text-xs">
									{activeReferenceAsset?.name ?? activeReferenceAssetId}
								</p>
							</div>
							<Button
								variant="outline"
								size="sm"
								className="h-7 text-xs"
								onClick={handleClearReference}
							>
								Clear
							</Button>
						</div>
						<p className="mt-2 text-xs uppercase tracking-wide text-muted-foreground">
							Status: {activeReferenceStatus}
						</p>
						<p className="mt-1 text-xs">
							{summarizeReferenceAnalysis({
								analysis: activeReferenceAnalysis,
							})}
						</p>
						{activeReferenceAnalysis ? (
							<div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-muted-foreground">
								<p>Pacing: {activeReferenceAnalysis.shotPattern.transition_cadence}</p>
								<p>
									Captions: {activeReferenceAnalysis.captionProfile.tone ?? "inferred"}
								</p>
								<p>
									Transitions: {activeReferenceAnalysis.shotPattern.scene_cut_count} cuts
								</p>
								<p>
									Look:{" "}
									{activeReferenceAnalysis.finishingProfile.finishing_look_id ??
										"adaptable"}
								</p>
								<p>
									Music feel: {activeReferenceAnalysis.audioProfile.music_mood ?? "none"}
								</p>
								<p>
									Packaging:{" "}
									{activeReferenceAnalysis.publishProfile.target_version_id ??
										"flexible"}
								</p>
							</div>
						) : null}
					</div>
				) : null}
				{hasVideoAssets ? (
					<div className="mb-3 rounded-md border p-3">
						<p className="text-sm font-medium">AI Draft Source Pool</p>
						<p className="text-muted-foreground mt-1 text-xs">
							{assemblySourceAssetIds.length} clip
							{assemblySourceAssetIds.length === 1 ? "" : "s"} selected for
							reference-guided draft assembly.
						</p>
					</div>
				) : null}
				{missingMediaReferences.length > 0 ? (
					<MissingMediaSection
						references={missingMediaReferences}
						isRelinking={isRelinkingMissingMedia || isScanningCompatibility}
						onRelink={openMissingMediaRelinkPicker}
						onRemoveSegments={handleRemoveMissingMediaSegments}
					/>
				) : null}
				{incompatibleMediaReferences.length > 0 ? (
					<IncompatibleMediaSection
						references={incompatibleMediaReferences}
						isBusy={isRelinkingMissingMedia || isScanningCompatibility}
						onRelink={openMissingMediaRelinkPicker}
						onRemoveSegments={handleRemoveMissingMediaSegments}
						onRescan={handleRescanCompatibility}
					/>
				) : null}
				{isDragOver ||
				(filteredMediaItems.length === 0 &&
					missingMediaReferences.length === 0 &&
					incompatibleMediaReferences.length === 0) ? (
					<MediaDragOverlay
						isVisible={true}
						isProcessing={isProcessing}
						progress={progress}
						onClick={isCreatingDemo ? undefined : openFilePicker}
						secondaryAction={
							!isDragOver &&
							filteredMediaItems.length === 0 &&
							ENABLE_CLIPFORGE_EXPERIENCE
								? {
										label: isCreatingDemo
											? "Creating Demo..."
											: "Try Demo Project",
										onClick: () => void handleCreateDemoProject(),
										disabled: isCreatingDemo,
									}
								: undefined
						}
					/>
				) : mediaViewMode === "grid" ? (
					<GridView
						items={filteredMediaItems}
						renderPreview={renderPreview}
						onRemove={handleRemove}
						onIndexClip={handleIndexClip}
						onImportSrt={handleImportSrt}
						onSetReference={handleSetReference}
						onToggleAssemblySource={handleToggleAssemblySource}
						onClearReference={handleClearReference}
						activeReferenceAssetId={activeReferenceAssetId}
						assemblySourceAssetIds={assemblySourceAssetIds}
						onAddToTimeline={addElementAtTime}
						highlightedId={highlightedId}
						registerElement={registerElement}
					/>
				) : (
					<ListView
						items={filteredMediaItems}
						renderPreview={renderCompactPreview}
						onRemove={handleRemove}
						onIndexClip={handleIndexClip}
						onImportSrt={handleImportSrt}
						onSetReference={handleSetReference}
						onToggleAssemblySource={handleToggleAssemblySource}
						onClearReference={handleClearReference}
						activeReferenceAssetId={activeReferenceAssetId}
						assemblySourceAssetIds={assemblySourceAssetIds}
						onAddToTimeline={addElementAtTime}
						highlightedId={highlightedId}
						registerElement={registerElement}
					/>
				)}
			</PanelView>
		</>
	);
}

function StartHereCard({
	onImportClips,
	onTryDemo,
	onAskAssistant,
}: {
	onImportClips: () => void;
	onTryDemo: () => void;
	onAskAssistant: () => void;
}) {
	return (
		<div className="mb-3 rounded-md border bg-muted/25 p-3">
			<p className="text-sm font-medium">Start here</p>
			<p className="text-muted-foreground mt-1 text-xs">
				If you already know CapCut, the flow is the same: bring in footage, edit on
				the timeline, and export when you are ready.
			</p>
			<div className="mt-3 flex flex-wrap gap-2">
				<Button type="button" size="sm" onClick={onImportClips}>
					Import clips
				</Button>
				<Button type="button" size="sm" variant="outline" onClick={onTryDemo}>
					Try demo
				</Button>
				<Button type="button" size="sm" variant="outline" onClick={onAskAssistant}>
					Ask Assistant
				</Button>
			</div>
		</div>
	);
}

function MediaItemWithContextMenu({
	item,
	children,
	onRemove,
	onIndexClip,
	onImportSrt,
	onSetReference,
	onToggleAssemblySource,
	onClearReference,
	activeReferenceAssetId,
	assemblySourceAssetIds,
}: {
	item: MediaAsset;
	children: React.ReactNode;
	onRemove: ({ event, id }: { event: React.MouseEvent; id: string }) => void;
	onIndexClip: ({ mediaId }: { mediaId: string }) => void;
	onImportSrt: ({ mediaId }: { mediaId: string }) => void;
	onSetReference: ({ mediaId }: { mediaId: string }) => void;
	onToggleAssemblySource: ({ mediaId }: { mediaId: string }) => void;
	onClearReference: () => void;
	activeReferenceAssetId: string | null;
	assemblySourceAssetIds: string[];
}) {
	return (
		<ContextMenu>
			<ContextMenuTrigger>{children}</ContextMenuTrigger>
			<ContextMenuContent>
				<ContextMenuItem>Export clips</ContextMenuItem>
				{item.type === "video" && activeReferenceAssetId !== item.id && (
					<ContextMenuItem onClick={() => onSetReference({ mediaId: item.id })}>
						Use as reference
					</ContextMenuItem>
				)}
				{item.type === "video" && activeReferenceAssetId === item.id && (
					<ContextMenuItem onClick={onClearReference}>Clear reference</ContextMenuItem>
				)}
				{item.type === "video" && item.id !== activeReferenceAssetId && (
					<ContextMenuItem onClick={() => onToggleAssemblySource({ mediaId: item.id })}>
						{assemblySourceAssetIds.includes(item.id)
							? "Remove from AI draft pool"
							: "Use for AI draft"}
					</ContextMenuItem>
				)}
				{(item.type === "video" || item.type === "audio") && (
					<ContextMenuItem onClick={() => onIndexClip({ mediaId: item.id })}>
						Index Clip
					</ContextMenuItem>
				)}
				{(item.type === "video" || item.type === "audio") && (
					<ContextMenuItem onClick={() => onImportSrt({ mediaId: item.id })}>
						Import SRT...
					</ContextMenuItem>
				)}
				<ContextMenuItem
					variant="destructive"
					onClick={(event) => onRemove({ event, id: item.id })}
				>
					Delete
				</ContextMenuItem>
			</ContextMenuContent>
		</ContextMenu>
	);
}

function GridView({
	items,
	renderPreview,
	onRemove,
	onIndexClip,
	onImportSrt,
	onSetReference,
	onToggleAssemblySource,
	onClearReference,
	activeReferenceAssetId,
	assemblySourceAssetIds,
	onAddToTimeline,
	highlightedId,
	registerElement,
}: {
	items: MediaAsset[];
	renderPreview: (item: MediaAsset) => React.ReactNode;
	onRemove: ({ event, id }: { event: React.MouseEvent; id: string }) => void;
	onIndexClip: ({ mediaId }: { mediaId: string }) => void;
	onImportSrt: ({ mediaId }: { mediaId: string }) => void;
	onSetReference: ({ mediaId }: { mediaId: string }) => void;
	onToggleAssemblySource: ({ mediaId }: { mediaId: string }) => void;
	onClearReference: () => void;
	activeReferenceAssetId: string | null;
	assemblySourceAssetIds: string[];
	onAddToTimeline: ({
		asset,
		startTime,
	}: {
		asset: MediaAsset;
		startTime: number;
	}) => boolean;
	highlightedId: string | null;
	registerElement: (id: string, element: HTMLElement | null) => void;
}) {
	return (
		<div
			className="grid gap-2"
			style={{
				gridTemplateColumns: "repeat(auto-fill, 160px)",
			}}
		>
			{items.map((item) => (
				<div key={item.id} ref={(el) => registerElement(item.id, el)}>
					<MediaItemWithContextMenu
						item={item}
						onRemove={onRemove}
						onIndexClip={onIndexClip}
						onImportSrt={onImportSrt}
						onSetReference={onSetReference}
						onToggleAssemblySource={onToggleAssemblySource}
						onClearReference={onClearReference}
						activeReferenceAssetId={activeReferenceAssetId}
						assemblySourceAssetIds={assemblySourceAssetIds}
					>
						<DraggableItem
							name={item.name}
							preview={renderPreview(item)}
							dragData={{
								id: item.id,
								type: "media",
								mediaType: item.type,
								name: item.name,
							}}
							shouldShowPlusOnDrag={false}
							onAddToTimeline={({ currentTime }) =>
								onAddToTimeline({ asset: item, startTime: currentTime })
							}
							isRounded={false}
							variant="card"
							isHighlighted={highlightedId === item.id}
						/>
					</MediaItemWithContextMenu>
				</div>
			))}
		</div>
	);
}

function ListView({
	items,
	renderPreview,
	onRemove,
	onIndexClip,
	onImportSrt,
	onSetReference,
	onToggleAssemblySource,
	onClearReference,
	activeReferenceAssetId,
	assemblySourceAssetIds,
	onAddToTimeline,
	highlightedId,
	registerElement,
}: {
	items: MediaAsset[];
	renderPreview: (item: MediaAsset) => React.ReactNode;
	onRemove: ({ event, id }: { event: React.MouseEvent; id: string }) => void;
	onIndexClip: ({ mediaId }: { mediaId: string }) => void;
	onImportSrt: ({ mediaId }: { mediaId: string }) => void;
	onSetReference: ({ mediaId }: { mediaId: string }) => void;
	onToggleAssemblySource: ({ mediaId }: { mediaId: string }) => void;
	onClearReference: () => void;
	activeReferenceAssetId: string | null;
	assemblySourceAssetIds: string[];
	onAddToTimeline: ({
		asset,
		startTime,
	}: {
		asset: MediaAsset;
		startTime: number;
	}) => boolean;
	highlightedId: string | null;
	registerElement: (id: string, element: HTMLElement | null) => void;
}) {
	return (
		<div className="space-y-1">
			{items.map((item) => (
				<div key={item.id} ref={(el) => registerElement(item.id, el)}>
					<MediaItemWithContextMenu
						item={item}
						onRemove={onRemove}
						onIndexClip={onIndexClip}
						onImportSrt={onImportSrt}
						onSetReference={onSetReference}
						onToggleAssemblySource={onToggleAssemblySource}
						onClearReference={onClearReference}
						activeReferenceAssetId={activeReferenceAssetId}
						assemblySourceAssetIds={assemblySourceAssetIds}
					>
						<DraggableItem
							name={item.name}
							preview={renderPreview(item)}
							dragData={{
								id: item.id,
								type: "media",
								mediaType: item.type,
								name: item.name,
							}}
							shouldShowPlusOnDrag={false}
							onAddToTimeline={({ currentTime }) =>
								onAddToTimeline({ asset: item, startTime: currentTime })
							}
							variant="compact"
							isHighlighted={highlightedId === item.id}
						/>
					</MediaItemWithContextMenu>
				</div>
			))}
		</div>
	);
}

function MissingMediaSection({
	references,
	isRelinking,
	onRelink,
	onRemoveSegments,
}: {
	references: MissingMediaReference[];
	isRelinking: boolean;
	onRelink: ({
		mediaId,
		allowedReplacementTypes,
	}: {
		mediaId: string;
		allowedReplacementTypes: Array<"video" | "image" | "audio">;
	}) => void;
	onRemoveSegments: ({ mediaId }: { mediaId: string }) => void;
}) {
	return (
		<div className="mb-3 space-y-2 rounded border border-red-500/30 bg-red-500/5 p-2">
			<p className="text-xs font-medium">Missing Media</p>
			{references.map((reference) => (
				<div
					key={reference.mediaId}
					className="space-y-1 rounded border border-border/70 bg-background/60 p-2"
				>
					<p className="text-xs leading-4">
						{reference.mediaId} · {reference.referenceCount} segment
						{reference.referenceCount === 1 ? "" : "s"}
					</p>
					<p className="text-muted-foreground text-[11px]">
						Allowed replacement types:{" "}
						{reference.allowedReplacementTypes.length > 0
							? reference.allowedReplacementTypes.join(" / ")
							: "none"}
					</p>
					<div className="flex gap-2">
						<Button
							variant="outline"
							size="sm"
							className="h-7 flex-1 text-xs"
							onClick={() =>
								onRelink({
									mediaId: reference.mediaId,
									allowedReplacementTypes: reference.allowedReplacementTypes,
								})
							}
							disabled={isRelinking || reference.allowedReplacementTypes.length === 0}
						>
							Relink File
						</Button>
						<Button
							variant="outline"
							size="sm"
							className="h-7 flex-1 text-xs"
							onClick={() =>
								onRemoveSegments({
									mediaId: reference.mediaId,
								})
							}
							disabled={isRelinking}
						>
							Remove Affected Segments
						</Button>
					</div>
				</div>
			))}
		</div>
	);
}

function IncompatibleMediaSection({
	references,
	isBusy,
	onRelink,
	onRemoveSegments,
	onRescan,
}: {
	references: IncompatibleMediaReference[];
	isBusy: boolean;
	onRelink: ({
		mediaId,
		allowedReplacementTypes,
	}: {
		mediaId: string;
		allowedReplacementTypes: Array<"video" | "image" | "audio">;
	}) => void;
	onRemoveSegments: ({ mediaId }: { mediaId: string }) => void;
	onRescan: ({ mediaId }: { mediaId?: string }) => void;
}) {
	return (
		<div className="mb-3 space-y-2 rounded border border-yellow-500/30 bg-yellow-500/5 p-2">
			<p className="text-xs font-medium">Incompatible Media</p>
			{references.map((reference) => (
				<div
					key={reference.mediaId}
					className="space-y-1 rounded border border-border/70 bg-background/60 p-2"
				>
					<p className="text-xs leading-4">
						{reference.mediaId} · {reference.referenceCount} segment
						{reference.referenceCount === 1 ? "" : "s"}
					</p>
					<p className="text-muted-foreground text-[11px]">
						Status: {reference.compatibilityStatus}
						{reference.compatibilityReason
							? ` (${reference.compatibilityReason})`
							: ""}
					</p>
					<p className="text-muted-foreground text-[11px]">
						Allowed replacement types:{" "}
						{reference.allowedReplacementTypes.length > 0
							? reference.allowedReplacementTypes.join(" / ")
							: "none"}
					</p>
					<div className="flex gap-2">
						<Button
							variant="outline"
							size="sm"
							className="h-7 flex-1 text-xs"
							onClick={() =>
								onRelink({
									mediaId: reference.mediaId,
									allowedReplacementTypes: reference.allowedReplacementTypes,
								})
							}
							disabled={isBusy || reference.allowedReplacementTypes.length === 0}
						>
							Relink File
						</Button>
						<Button
							variant="outline"
							size="sm"
							className="h-7 flex-1 text-xs"
							onClick={() =>
								onRemoveSegments({
									mediaId: reference.mediaId,
								})
							}
							disabled={isBusy}
						>
							Remove Affected Segments
						</Button>
						<Button
							variant="outline"
							size="sm"
							className="h-7 flex-1 text-xs"
							onClick={() =>
								onRescan({
									mediaId: reference.mediaId,
								})
							}
							disabled={isBusy}
						>
							Re-scan
						</Button>
					</div>
				</div>
			))}
		</div>
	);
}

export function buildRelinkAccept({
	allowedReplacementTypes,
}: {
	allowedReplacementTypes: Array<"video" | "image" | "audio">;
}): string {
	if (allowedReplacementTypes.length === 0) {
		return "*";
	}

	return allowedReplacementTypes
		.flatMap((type) => (type === "audio" ? ["audio/*", "video/*"] : [`${type}/*`]))
		.filter((value, index, values) => values.indexOf(value) === index)
		.join(",");
}

const formatDuration = ({ duration }: { duration: number }) => {
	const min = Math.floor(duration / 60);
	const sec = Math.floor(duration % 60);
	return `${min}:${sec.toString().padStart(2, "0")}`;
};

function MediaDurationBadge({ duration }: { duration?: number }) {
	if (!duration) return null;

	return (
		<div className="absolute right-1 bottom-1 rounded bg-black/70 px-1 text-xs text-white">
			{formatDuration({ duration })}
		</div>
	);
}

function MediaDurationLabel({ duration }: { duration?: number }) {
	if (!duration) return null;

	return (
		<span className="text-xs opacity-70">{formatDuration({ duration })}</span>
	);
}

function MediaTypePlaceholder({
	icon,
	label,
	duration,
	variant,
}: {
	icon: IconSvgElement;
	label: string;
	duration?: number;
	variant: "muted" | "bordered";
}) {
	const iconClassName = cn("size-6", variant === "bordered" && "mb-1");

	return (
		<div
			className={cn(
				"text-muted-foreground flex size-full flex-col items-center justify-center rounded",
				variant === "muted" ? "bg-muted/30" : "border",
			)}
		>
			<HugeiconsIcon icon={icon} className={iconClassName} />
			<span className="text-xs">{label}</span>
			<MediaDurationLabel duration={duration} />
		</div>
	);
}

function MediaPreview({
	item,
	variant = "grid",
}: {
	item: MediaAsset;
	variant?: "grid" | "compact";
}) {
	const shouldShowDurationBadge = variant === "grid";

	if (item.type === "image") {
		return (
			<div className="relative flex size-full items-center justify-center">
				<Image
					src={item.url ?? ""}
					alt={item.name}
					fill
					sizes="100vw"
					className="object-cover"
					loading="lazy"
					unoptimized
				/>
			</div>
		);
	}

	if (item.type === "video") {
		if (item.thumbnailUrl) {
			return (
				<div className="relative size-full">
					<Image
						src={item.thumbnailUrl}
						alt={item.name}
						fill
						sizes="100vw"
						className="rounded object-cover"
						loading="lazy"
						unoptimized
					/>
					{shouldShowDurationBadge ? (
						<MediaDurationBadge duration={item.duration} />
					) : null}
				</div>
			);
		}

		return (
			<MediaTypePlaceholder
				icon={Video01Icon}
				label="Video"
				duration={item.duration}
				variant="muted"
			/>
		);
	}

	if (item.type === "audio") {
		return (
			<MediaTypePlaceholder
				icon={MusicNote03Icon}
				label="Audio"
				duration={item.duration}
				variant="bordered"
			/>
		);
	}

	return (
		<MediaTypePlaceholder icon={Image02Icon} label="Unknown" variant="muted" />
	);
}

function SortMenuItem({
	label,
	sortKey,
	currentSortBy,
	currentSortOrder,
	onSort,
}: {
	label: string;
	sortKey: "name" | "type" | "duration" | "size";
	currentSortBy: string;
	currentSortOrder: "asc" | "desc";
	onSort: ({ key }: { key: "name" | "type" | "duration" | "size" }) => void;
}) {
	const isActive = currentSortBy === sortKey;
	const arrow = isActive ? (currentSortOrder === "asc" ? "↑" : "↓") : "";

	return (
		<DropdownMenuItem onClick={() => onSort({ key: sortKey })}>
			{label} {arrow}
		</DropdownMenuItem>
	);
}
