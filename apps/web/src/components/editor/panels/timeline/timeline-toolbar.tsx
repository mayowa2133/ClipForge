import { useEditor } from "@/hooks/use-editor";
import { toast } from "sonner";
import {
	TooltipProvider,
	Tooltip,
	TooltipTrigger,
	TooltipContent,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { SplitSquareHorizontal } from "lucide-react";
import {
	SplitButton,
	SplitButtonLeft,
	SplitButtonRight,
	SplitButtonSeparator,
} from "@/components/ui/split-button";
import { Slider } from "@/components/ui/slider";
import { TIMELINE_CONSTANTS } from "@/constants/timeline-constants";
import { sliderToZoom, zoomToSlider } from "@/lib/timeline/zoom-utils";
import { ScenesView } from "../../scenes-view";
import { type TAction, invokeAction } from "@/lib/actions";
import { cn } from "@/utils/ui";
import { useTimelineStore } from "@/stores/timeline-store";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
	Bookmark02Icon,
	Delete02Icon,
	SnowIcon,
	ScissorIcon,
	MagnetIcon,
	Link04Icon,
	SearchAddIcon,
	SearchMinusIcon,
	Copy01Icon,
	AlignLeftIcon,
	AlignRightIcon,
	Layers01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

export function TimelineToolbar({
	zoomLevel,
	minZoom,
	setZoomLevel,
	beatState,
}: {
	zoomLevel: number;
	minZoom: number;
	setZoomLevel: ({ zoom }: { zoom: number }) => void;
	beatState: {
		sourceMediaId: string | null;
		bpm: number | null;
		markers: Array<{ time: number; kind: "beat" | "downbeat"; sourceMediaId: string }>;
	};
}) {
	const handleZoom = ({ direction }: { direction: "in" | "out" }) => {
		const newZoomLevel =
			direction === "in"
				? Math.min(
						TIMELINE_CONSTANTS.ZOOM_MAX,
						zoomLevel * TIMELINE_CONSTANTS.ZOOM_BUTTON_FACTOR,
					)
				: Math.max(minZoom, zoomLevel / TIMELINE_CONSTANTS.ZOOM_BUTTON_FACTOR);
		setZoomLevel({ zoom: newZoomLevel });
	};

	return (
		<ScrollArea className="scrollbar-hidden">
			<div className="flex h-10 items-center justify-between border-b px-2 py-1">
				<ToolbarLeftSection />
				

				<SceneSelector />

				<ToolbarRightSection
					zoomLevel={zoomLevel}
					minZoom={minZoom}
					onZoomChange={(zoom) => setZoomLevel({ zoom })}
					onZoom={handleZoom}
					beatState={beatState}
				/>
			</div>
		</ScrollArea>
	);
}

function ToolbarLeftSection() {
	const editor = useEditor();
	const currentTime = editor.playback.getCurrentTime();
	const currentBookmarked = editor.scenes.isBookmarked({ time: currentTime });
	const beatState = editor.audio.getSceneBeatMarkers();

	const handleAction = ({
		action,
		event,
	}: {
		action: TAction;
		event: React.MouseEvent;
	}) => {
		event.stopPropagation();
		invokeAction(action);
	};

	return (
		<div className="flex items-center gap-1">
			<TooltipProvider delayDuration={500}>
				<ToolbarButton
					icon={<HugeiconsIcon icon={ScissorIcon} />}
					tooltip="Split element"
					onClick={({ event }) => handleAction({ action: "split", event })}
				/>

				<ToolbarButton
					icon={<HugeiconsIcon icon={AlignLeftIcon} />}
					tooltip="Split left"
					onClick={({ event }) => handleAction({ action: "split-left", event })}
				/>

				<ToolbarButton
					icon={<HugeiconsIcon icon={AlignRightIcon} />}
					tooltip="Split right"
					onClick={({ event }) =>
						handleAction({ action: "split-right", event })
					}
				/>

				<div className="bg-border mx-1 h-6 w-px" />

				<ToolbarButton
					icon={<SplitSquareHorizontal />}
					tooltip="Separate audio"
					onClick={({ event }) =>
						handleAction({ action: "separate-audio-selected", event })
					}
				/>

				<ToolbarButton
					icon={<HugeiconsIcon icon={Copy01Icon} />}
					tooltip="Duplicate element"
					onClick={({ event }) =>
						handleAction({ action: "duplicate-selected", event })
					}
				/>

				<ToolbarButton
					icon={<HugeiconsIcon icon={SnowIcon} />}
					tooltip="Insert freeze frame"
					onClick={({ event }) =>
						handleAction({ action: "insert-freeze-frame", event })
					}
				/>

				<ToolbarButton
					icon={<HugeiconsIcon icon={Delete02Icon} />}
					tooltip="Delete element"
					onClick={({ event }) =>
						handleAction({ action: "delete-selected", event })
					}
				/>

				<div className="bg-border mx-1 h-6 w-px" />

				<ToolbarButton
					icon={<HugeiconsIcon icon={MagnetIcon} />}
					tooltip="Quantize selected clips to beats"
					onClick={({ event }) => {
						event.stopPropagation();
						try {
							editor.timeline.quantizeSelectedClipsToBeats({
								mode: "clip-starts",
							});
							toast.success("Selected clips quantized to beats.");
						} catch (error) {
							toast.error("Quantize failed.", {
								description:
									error instanceof Error ? error.message : "Please try again.",
							});
						}
					}}
				/>

				<ToolbarButton
					icon={<HugeiconsIcon icon={ScissorIcon} />}
					tooltip="Split selected clips on beats"
					onClick={({ event }) => {
						event.stopPropagation();
						try {
							editor.timeline.splitSelectedClipsOnBeats();
							toast.success("Selected clips split on beats.");
						} catch (error) {
							toast.error("Split on beats failed.", {
								description:
									error instanceof Error ? error.message : "Please try again.",
							});
						}
					}}
				/>

				<ToolbarButton
					icon={<HugeiconsIcon icon={Layers01Icon} />}
					tooltip="Build auto montage"
					onClick={({ event }) => {
						event.stopPropagation();
						try {
							if (!beatState.sourceMediaId) {
								throw new Error("Choose a music beat source first.");
							}
							editor.timeline.buildAutoMontageFromSelection({
								musicMediaId: beatState.sourceMediaId,
								strategy: "one-cut-per-two-beats",
								beatDivision: 2,
							});
							toast.success("Auto montage draft created.");
						} catch (error) {
							toast.error("Auto montage failed.", {
								description:
									error instanceof Error ? error.message : "Please try again.",
							});
						}
					}}
				/>

				<Tooltip>
					<ToolbarButton
						icon={<HugeiconsIcon icon={Bookmark02Icon} />}
						isActive={currentBookmarked}
						tooltip={currentBookmarked ? "Remove bookmark" : "Add bookmark"}
						onClick={({ event }) =>
							handleAction({ action: "toggle-bookmark", event })
						}
					/>
				</Tooltip>
			</TooltipProvider>
		</div>
	);
}

function SceneSelector() {
	const editor = useEditor();
	const currentScene = editor.scenes.getActiveScene();
	const assembly = editor.scenes.getProjectAssembly();
	const currentSceneIndex = assembly.findIndex(
		(scene) => scene.sceneId === currentScene?.id,
	);
	const currentSceneLabel =
		currentScene && currentSceneIndex >= 0
			? `Scene ${currentSceneIndex + 1} · ${currentScene.name}`
			: currentScene?.name || "No Scene";

	return (
		<div>
			<SplitButton className="border-foreground/10 border">
				<SplitButtonLeft>{currentSceneLabel}</SplitButtonLeft>
				<SplitButtonSeparator />
				<ScenesView>
					<SplitButtonRight onClick={() => {}}>
						<HugeiconsIcon icon={Layers01Icon} className="size-4" />
					</SplitButtonRight>
				</ScenesView>
			</SplitButton>
		</div>
	);
}

function ToolbarRightSection({
	zoomLevel,
	minZoom,
	onZoomChange,
	onZoom,
	beatState,
}: {
	zoomLevel: number;
	minZoom: number;
	onZoomChange: (zoom: number) => void;
	onZoom: (options: { direction: "in" | "out" }) => void;
	beatState: {
		sourceMediaId: string | null;
		bpm: number | null;
		markers: Array<{ time: number; kind: "beat" | "downbeat"; sourceMediaId: string }>;
	};
}) {
	const {
		snappingEnabled,
		snapToBeats,
		showBeatMarkers,
		rippleEditingEnabled,
		toggleSnapping,
		setBeatSnapping,
		setBeatMarkerVisibility,
		toggleRippleEditing,
	} = useTimelineStore();

	return (
		<div className="flex items-center gap-1">
			<TooltipProvider delayDuration={500}>
				<ToolbarButton
					icon={<HugeiconsIcon icon={Bookmark02Icon} />}
					isActive={showBeatMarkers}
					tooltip="Show beats"
					onClick={() => {
						setBeatMarkerVisibility(!showBeatMarkers);
					}}
				/>

				<ToolbarButton
					icon={<HugeiconsIcon icon={MagnetIcon} className="scale-90" />}
					isActive={snapToBeats}
					tooltip="Snap to beats"
					onClick={() => {
						setBeatSnapping(!snapToBeats);
					}}
				/>

				<ToolbarButton
					icon={<HugeiconsIcon icon={MagnetIcon} />}
					isActive={snappingEnabled}
					tooltip="Snapping"
					onClick={() => toggleSnapping()}
				/>

				<ToolbarButton
					icon={<HugeiconsIcon icon={Link04Icon} className="scale-110" />}
					isActive={rippleEditingEnabled}
					tooltip="Ripple"
					onClick={() => toggleRippleEditing()}
				/>
			</TooltipProvider>

			<div className="bg-border mx-1 h-6 w-px" />

			{beatState.sourceMediaId ? (
				<div className="text-muted-foreground px-2 text-xs whitespace-nowrap">
					Beats {beatState.bpm ? `${beatState.bpm} BPM` : "ready"} · {beatState.markers.length}
				</div>
			) : (
				<div className="text-muted-foreground px-2 text-xs whitespace-nowrap">
					No beat source
				</div>
			)}

			<div className="bg-border mx-1 h-6 w-px" />

			<div className="flex items-center gap-1">
				<Button
					variant="text"
					size="icon"
					onClick={() => onZoom({ direction: "out" })}
				>
					<HugeiconsIcon icon={SearchMinusIcon} />
				</Button>
				<Slider
					className="w-28"
					value={[zoomToSlider({ zoomLevel, minZoom })]}
					onValueChange={(values) =>
						onZoomChange(sliderToZoom({ sliderPosition: values[0], minZoom }))
					}
					min={0}
					max={1}
					step={0.005}
				/>
				<Button
					variant="text"
					size="icon"
					onClick={() => onZoom({ direction: "in" })}
				>
					<HugeiconsIcon icon={SearchAddIcon} />
				</Button>
			</div>
		</div>
	);
}

function ToolbarButton({
	icon,
	tooltip,
	onClick,
	disabled,
	isActive,
}: {
	icon: React.ReactNode;
	tooltip: string;
	onClick: ({ event }: { event: React.MouseEvent }) => void;
	disabled?: boolean;
	isActive?: boolean;
}) {
	return (
		<Tooltip delayDuration={200}>
			<TooltipTrigger asChild>
				<Button
					variant={isActive ? "secondary" : "text"}
					size="icon"
					onClick={(event) => onClick({ event })}
					className={cn(
						"rounded-sm",
						disabled ? "cursor-not-allowed opacity-50" : "",
					)}
				>
					{icon}
				</Button>
			</TooltipTrigger>
			<TooltipContent>{tooltip}</TooltipContent>
		</Tooltip>
	);
}
