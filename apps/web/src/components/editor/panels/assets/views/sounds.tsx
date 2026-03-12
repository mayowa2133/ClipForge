"use client";

import { useEffect, useMemo, useState } from "react";
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
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useEditor } from "@/hooks/use-editor";
import { useInfiniteScroll } from "@/hooks/use-infinite-scroll";
import { useSoundSearch } from "@/hooks/use-sound-search";
import {
	AUDIO_POLISH_PRESETS,
	getAudioPolishPresetLabel,
} from "@/lib/clipforge/polish-profiles";
import { ensureBundledAudioAsset } from "@/lib/library/bundled-media";
import { BUNDLED_MUSIC, BUNDLED_SFX, getBundledMusicByMood } from "@/lib/library";
import {
	formatPublishDestination,
	getDestinationCompatibilityLabel,
	getMusicRightsLabel,
} from "@/lib/library";
import { buildUploadAudioElement } from "@/lib/timeline";
import { formatTimeCode } from "@/lib/time";
import { getProjectAudioSettings } from "@/lib/media/audio";
import { useSoundsStore } from "@/stores/sounds-store";
import type { MediaAsset } from "@/types/assets";
import type { AudioLibraryItem } from "@/types/library";
import type { TrendSoundReference } from "@/types/clipforge";
import type { SavedSound, SoundEffect } from "@/types/sounds";
import { cn } from "@/utils/ui";
import {
	FavouriteIcon,
	FilterMailIcon,
	Mic01Icon,
	PauseIcon,
	PlayIcon,
	PlusSignIcon,
	Link04Icon,
	VoiceIcon,
	VolumeHighIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { toast } from "sonner";

const BUNDLED_SFX_GROUPS: Array<{
	keys: AudioLibraryItem["usageKind"][];
	label: string;
	description: string;
}> = [
	{
		keys: ["typing"],
		label: "Typing",
		description: "Soft key and typewriter-style accents for text and caption reveals.",
	},
	{
		keys: ["cursor"],
		label: "Cursor",
		description: "Cursor ticks and blink sounds for typing-style cues.",
	},
	{
		keys: ["caption-pop"],
		label: "Caption pops",
		description: "Short pops and snaps for caption and overlay entrances.",
	},
	{
		keys: ["transition-air"],
		label: "Air transitions",
		description: "Airy whooshes, sweeps, and fahhh-style transition sounds.",
	},
	{
		keys: ["ui"],
		label: "UI / Accent",
		description: "Clicks, taps, and interface-style punctuation sounds.",
	},
	{
		keys: ["accent", "transition-impact"],
		label: "Built-in utility",
		description: "Risers, hits, drops, and utility accents for short-form pacing.",
	},
];

export function SoundsView() {
	return (
		<div className="flex h-full flex-col">
			<Tabs defaultValue="voiceover" className="flex h-full flex-col">
				<div className="px-3 pt-4 pb-0">
					<TabsList className="flex flex-wrap gap-1 h-auto">
						<TabsTrigger value="voiceover">Voiceover</TabsTrigger>
						<TabsTrigger value="songs">Songs</TabsTrigger>
						<TabsTrigger value="sound-effects">Sound effects</TabsTrigger>
						<TabsTrigger value="saved">Saved</TabsTrigger>
						<TabsTrigger value="mix">Mix</TabsTrigger>
					</TabsList>
				</div>
				<Separator className="my-4" />
				<TabsContent value="voiceover" className="mt-0 flex min-h-0 flex-1 flex-col p-5 pt-0">
					<VoiceoverView />
				</TabsContent>
				<TabsContent value="songs" className="mt-0 flex min-h-0 flex-1 flex-col p-5 pt-0">
					<SongsView />
				</TabsContent>
				<TabsContent value="sound-effects" className="mt-0 flex min-h-0 flex-1 flex-col p-5 pt-0">
					<SoundEffectsView />
				</TabsContent>
				<TabsContent value="saved" className="mt-0 flex min-h-0 flex-1 flex-col p-5 pt-0">
					<SavedSoundsView />
				</TabsContent>
				<TabsContent value="mix" className="mt-0 flex min-h-0 flex-1 flex-col p-5 pt-0">
					<MixView />
				</TabsContent>
			</Tabs>
		</div>
	);
}

function VoiceoverView() {
	const editor = useEditor();
	const [isRecording, setIsRecording] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [recordingStartedAt, setRecordingStartedAt] = useState<number | null>(null);
	const [elapsedSeconds, setElapsedSeconds] = useState(0);
	const [version, setVersion] = useState(0);
	const currentTime = editor.playback.getCurrentTime();

	useEffect(() => {
		const unsubscribers = [
			editor.timeline.subscribe(() => setVersion((value) => value + 1)),
			editor.media.subscribe(() => setVersion((value) => value + 1)),
		];
		return () => {
			unsubscribers.forEach((unsubscribe) => unsubscribe());
		};
	}, [editor]);
	void version;

	const voiceoverAssets = useMemo(() => {
		const voiceoverIds = new Set(
			editor.timeline
				.getTracks()
				.flatMap((track) =>
					track.type === "audio"
						? track.elements.flatMap((element) =>
								element.type === "audio" &&
								element.sourceType === "upload" &&
								(element.role ?? "audio") === "voiceover"
									? [element.mediaId]
									: [],
							)
						: [],
				),
		);
		return editor.media
			.getAssets()
			.filter((asset) => asset.type === "audio" && voiceoverIds.has(asset.id))
			.sort((a, b) => a.name.localeCompare(b.name));
	}, [editor, version]);

	useEffect(() => {
		if (!isRecording || recordingStartedAt === null) {
			setElapsedSeconds(0);
			return;
		}

		const updateElapsed = () => {
			setElapsedSeconds((Date.now() - recordingStartedAt) / 1000);
		};

		updateElapsed();
		const intervalId = window.setInterval(updateElapsed, 250);
		return () => window.clearInterval(intervalId);
	}, [isRecording, recordingStartedAt]);

	const handleStart = async () => {
		try {
			setError(null);
			await editor.audio.recordVoiceoverStart();
			setIsRecording(true);
			setRecordingStartedAt(Date.now());
			toast.success("Voiceover recording started.");
		} catch (startError) {
			const message =
				startError instanceof Error
					? startError.message
					: "Unable to start voiceover recording.";
			setError(message);
			toast.error(message);
		}
	};

	const handleStop = async () => {
		try {
			setError(null);
			const result = await editor.audio.recordVoiceoverStop();
			setIsRecording(false);
			setRecordingStartedAt(null);
			toast.success(
				`Voiceover added (${formatTimeCode({ timeInSeconds: result.duration })}).`,
			);
		} catch (stopError) {
			const message =
				stopError instanceof Error
					? stopError.message
					: "Unable to stop voiceover recording.";
			setError(message);
			toast.error(message);
		}
	};

	return (
		<div className="flex h-full flex-col gap-5">
			<div className="space-y-2">
				<p className="text-sm font-medium">Record voiceover</p>
				<p className="text-muted-foreground text-sm">
					Records into the active scene at the current playhead and inserts a normal audio clip.
				</p>
			</div>
			<div className="rounded-lg border p-4">
				<div className="flex items-center justify-between gap-3">
					<div>
						<p className="text-sm font-medium">Insert at playhead</p>
						<p className="text-muted-foreground text-sm">
							{formatTimeCode({ timeInSeconds: currentTime })}
						</p>
						{isRecording ? (
							<p className="text-primary mt-2 text-sm font-medium">
								Recording {formatTimeCode({ timeInSeconds: elapsedSeconds })}
							</p>
						) : null}
					</div>
					<Button onClick={isRecording ? handleStop : handleStart} variant={isRecording ? "destructive" : "default"}>
						<HugeiconsIcon icon={isRecording ? VoiceIcon : Mic01Icon} className="mr-2" />
						{isRecording ? "Stop" : "Record"}
					</Button>
				</div>
				{error ? <p className="text-destructive mt-3 text-sm">{error}</p> : null}
				<p className="text-muted-foreground mt-3 text-xs">
					Microphone permission is required. Recording stays local and is saved as an audio asset in this project.
				</p>
			</div>
			<div className="space-y-3">
				<div>
					<p className="text-sm font-medium">Recorded takes</p>
					<p className="text-muted-foreground text-sm">
						Voiceovers stay here so they do not get mixed into Songs.
					</p>
				</div>
				<div className="space-y-3">
					{voiceoverAssets.map((asset) => (
						<VoiceoverAssetItem key={asset.id} asset={asset} />
					))}
					{voiceoverAssets.length === 0 ? (
						<div className="text-muted-foreground rounded-lg border border-dashed p-4 text-sm">
							Record a take to manage it here.
						</div>
					) : null}
				</div>
			</div>
		</div>
	);
}

function SoundEffectsView() {
	const editor = useEditor();
	const {
		topSoundEffects,
		isLoading,
		error,
		searchQuery,
		setSearchQuery,
		scrollPosition,
		setScrollPosition,
		loadSavedSounds,
		showCommercialOnly,
		toggleCommercialFilter,
		hasLoaded,
		setTopSoundEffects,
		setLoading,
		setError,
		setHasLoaded,
		setCurrentPage,
		setHasNextPage,
		setTotalCount,
	} = useSoundsStore();
	const {
		results: searchResults,
		isLoading: isSearching,
		error: searchError,
		loadMore,
		hasNextPage,
		isLoadingMore,
	} = useSoundSearch({
		query: searchQuery,
		commercialOnly: showCommercialOnly,
	});

	const [playingId, setPlayingId] = useState<number | null>(null);
	const [audioElement, setAudioElement] = useState<HTMLAudioElement | null>(null);

	const { scrollAreaRef, handleScroll } = useInfiniteScroll({
		onLoadMore: loadMore,
		hasMore: hasNextPage,
		isLoading: isLoadingMore || isSearching,
	});

	useEffect(() => {
		loadSavedSounds();
	}, [loadSavedSounds]);

	const loadPopularSounds = async () => {
		try {
			setLoading({ loading: true });
			setError({ error: null });
			const response = await fetch("/api/sounds/search?page_size=50&sort=downloads");
			if (!response.ok) {
				let message = `Sound effects unavailable (${response.status}).`;
				try {
					const data = (await response.json()) as { error?: string; message?: string };
					message = data.message || data.error || message;
				} catch {}
				throw new Error(message);
			}
			const data = await response.json();
			setTopSoundEffects({ sounds: data.results });
			setHasLoaded({ loaded: true });
			setCurrentPage({ page: 1 });
			setHasNextPage({ hasNext: !!data.next });
			setTotalCount({ count: data.count });
		} catch (fetchError) {
			setError({
				error:
					fetchError instanceof Error
						? fetchError.message
						: "Sound effects are unavailable right now.",
			});
		} finally {
			setLoading({ loading: false });
		}
	};

	useEffect(() => {
		if (!scrollAreaRef.current || scrollPosition <= 0) return;
		const timeoutId = setTimeout(() => {
			scrollAreaRef.current?.scrollTo({ top: scrollPosition });
		}, 100, {});
		return () => clearTimeout(timeoutId);
	}, [scrollPosition, scrollAreaRef]);

	const displayedSounds = searchQuery ? searchResults : topSoundEffects;
	const bundledEffects = BUNDLED_SFX.filter((item) =>
		item.label.toLowerCase().includes(searchQuery.trim().toLowerCase()),
	);
	const groupedBundledEffects = BUNDLED_SFX_GROUPS.map((group) => ({
		...group,
		items: bundledEffects.filter((item) =>
			group.keys.includes(item.usageKind),
		),
	})).filter((group) => group.items.length > 0);

	const playSound = ({ sound }: { sound: SoundEffect }) => {
		if (playingId === sound.id) {
			audioElement?.pause();
			setPlayingId(null);
			return;
		}
		audioElement?.pause();
		if (!sound.previewUrl) return;
		const audio = new Audio(sound.previewUrl);
		audio.addEventListener("ended", () => setPlayingId(null));
		audio.addEventListener("error", () => setPlayingId(null));
		audio.play().catch(() => setPlayingId(null));
		setAudioElement(audio);
		setPlayingId(sound.id);
	};

	return (
		<div className="mt-1 flex h-full flex-col gap-5">
			<div className="flex items-center gap-3">
				<Input
					placeholder="Search sound effects"
					className="w-full"
					containerClassName="w-full"
					value={searchQuery}
					onChange={({ currentTarget }) => setSearchQuery({ query: currentTarget.value })}
					showClearIcon
					onClear={() => setSearchQuery({ query: "" })}
				/>
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button variant="text" size="icon" className={cn(showCommercialOnly && "text-primary")}>
							<HugeiconsIcon icon={FilterMailIcon} />
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end" className="w-56">
						<DropdownMenuCheckboxItem checked={showCommercialOnly} onCheckedChange={() => toggleCommercialFilter()}>
							Show only commercially licensed
						</DropdownMenuCheckboxItem>
					</DropdownMenuContent>
				</DropdownMenu>
			</div>
			<div className="relative h-full overflow-hidden">
				<ScrollArea
					className="h-full flex-1"
					ref={scrollAreaRef}
					onScrollCapture={({ currentTarget }) => {
						setScrollPosition({ position: currentTarget.scrollTop });
						handleScroll({ currentTarget } as React.UIEvent<HTMLDivElement>);
					}}
				>
					<div className="flex flex-col gap-4">
						<div className="space-y-3">
							<div>
								<p className="text-sm font-medium">Built-in starter SFX</p>
								<p className="text-muted-foreground text-xs">
									Free local accents for transitions, overlays, captions, and UI motion.
								</p>
							</div>
							{groupedBundledEffects.map((group) => (
								<div key={group.label} className="space-y-2">
									<div>
										<p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
											{group.label}
										</p>
										<p className="text-muted-foreground text-[11px]">
											{group.description}
										</p>
									</div>
									{group.items.map((item) => (
										<BundledAudioItem
											key={item.id}
											item={item}
											role="sfx"
											editor={editor}
										/>
									))}
								</div>
							))}
						</div>
						{isLoading && !searchQuery ? <div className="text-muted-foreground text-sm">Loading sounds...</div> : null}
						{isSearching && searchQuery ? <div className="text-muted-foreground text-sm">Searching...</div> : null}
						{searchError ? <div className="text-destructive text-sm">{searchError}</div> : null}
						{error && !searchQuery ? (
							<div className="text-destructive rounded-lg border border-dashed p-4 text-sm">{error}</div>
						) : null}
						{!searchQuery && !isLoading && !error && !hasLoaded ? (
							<div className="rounded-lg border border-dashed p-4 text-sm">
								<p className="font-medium">Browse sound effects</p>
								<p className="text-muted-foreground mt-1">
									Search Freesound results or load a popular starter list.
								</p>
								<Button variant="outline" size="sm" className="mt-3" onClick={() => void loadPopularSounds()}>
									Browse popular
								</Button>
							</div>
						) : null}
						{displayedSounds.map((sound) => (
							<AudioItem key={sound.id} sound={sound} role="sfx" isPlaying={playingId === sound.id} onPlay={playSound} />
						))}
						{!isLoading && !isSearching && displayedSounds.length === 0 && (searchQuery || hasLoaded) && !searchError && !error ? (
							<div className="text-muted-foreground text-sm">
								{searchQuery ? "No sounds found" : "No sounds available"}
							</div>
						) : null}
						{isLoadingMore ? <div className="text-muted-foreground py-4 text-center text-sm">Loading more sounds...</div> : null}
					</div>
				</ScrollArea>
			</div>
		</div>
	);
}

function SavedSoundsView() {
	const { savedSounds, isLoadingSavedSounds, savedSoundsError, loadSavedSounds, clearSavedSounds } = useSoundsStore();
	const [playingId, setPlayingId] = useState<number | null>(null);
	const [audioElement, setAudioElement] = useState<HTMLAudioElement | null>(null);
	const [showClearDialog, setShowClearDialog] = useState(false);

	useEffect(() => {
		loadSavedSounds();
	}, [loadSavedSounds]);

	const playSound = ({ sound }: { sound: SoundEffect }) => {
		if (playingId === sound.id) {
			audioElement?.pause();
			setPlayingId(null);
			return;
		}
		audioElement?.pause();
		if (!sound.previewUrl) return;
		const audio = new Audio(sound.previewUrl);
		audio.addEventListener("ended", () => setPlayingId(null));
		audio.addEventListener("error", () => setPlayingId(null));
		audio.play().catch(() => setPlayingId(null));
		setAudioElement(audio);
		setPlayingId(sound.id);
	};

	const convertToSoundEffect = ({ savedSound }: { savedSound: SavedSound }): SoundEffect => ({
		id: savedSound.id,
		name: savedSound.name,
		description: "",
		url: "",
		previewUrl: savedSound.previewUrl,
		downloadUrl: savedSound.downloadUrl,
		duration: savedSound.duration,
		filesize: 0,
		type: "audio",
		channels: 0,
		bitrate: 0,
		bitdepth: 0,
		samplerate: 0,
		username: savedSound.username,
		tags: savedSound.tags,
		license: savedSound.license,
		created: savedSound.savedAt,
		downloads: 0,
		rating: 0,
		ratingCount: 0,
	});

	if (isLoadingSavedSounds) {
		return <div className="flex h-full items-center justify-center"><div className="text-muted-foreground text-sm">Loading saved sounds...</div></div>;
	}
	if (savedSoundsError) {
		return <div className="flex h-full items-center justify-center"><div className="text-destructive text-sm">Error: {savedSoundsError}</div></div>;
	}
	if (savedSounds.length === 0) {
		return (
			<div className="bg-background flex h-full flex-col items-center justify-center gap-3 p-4">
				<HugeiconsIcon icon={FavouriteIcon} className="text-muted-foreground size-10" />
				<div className="flex flex-col gap-2 text-center">
					<p className="text-lg font-medium">No saved audio</p>
					<p className="text-muted-foreground text-sm text-balance">Save sound effects to keep them ready for reuse.</p>
				</div>
			</div>
		);
	}

	return (
		<div className="mt-1 flex h-full flex-col gap-5">
			<div className="flex items-center justify-between">
				<p className="text-muted-foreground text-sm">{savedSounds.length} saved {savedSounds.length === 1 ? "item" : "items"}</p>
				<Dialog open={showClearDialog} onOpenChange={setShowClearDialog}>
					<DialogTrigger asChild>
						<Button variant="text" size="sm" className="text-muted-foreground hover:text-destructive h-auto !opacity-100">Clear all</Button>
					</DialogTrigger>
					<DialogContent>
						<DialogHeader>
							<DialogTitle>Clear all saved audio?</DialogTitle>
							<DialogDescription>This removes every saved sound from your local collection.</DialogDescription>
						</DialogHeader>
						<DialogFooter>
							<Button variant="text" onClick={() => setShowClearDialog(false)}>Cancel</Button>
							<Button variant="destructive" onClick={async () => {
								await clearSavedSounds();
								setShowClearDialog(false);
							}}>Clear all</Button>
						</DialogFooter>
					</DialogContent>
				</Dialog>
			</div>
			<ScrollArea className="h-full flex-1">
				<div className="flex flex-col gap-4">
					{savedSounds.map((sound) => (
						<AudioItem key={sound.id} sound={convertToSoundEffect({ savedSound: sound })} role="sfx" isPlaying={playingId === sound.id} onPlay={playSound} />
					))}
				</div>
			</ScrollArea>
		</div>
	);
}

function SongsView() {
	const editor = useEditor();
	const [search, setSearch] = useState("");
	const [version, setVersion] = useState(0);
	const [isTrendDialogOpen, setIsTrendDialogOpen] = useState(false);
	const [trendLabel, setTrendLabel] = useState("");
	const [trendPlatform, setTrendPlatform] =
		useState<TrendSoundReference["platform"]>("tiktok");
	const [trendCreator, setTrendCreator] = useState("");
	const [trendSourceUrl, setTrendSourceUrl] = useState("");
	const [trendNotes, setTrendNotes] = useState("");

	useEffect(() => {
		const unsubscribers = [
			editor.media.subscribe(() => setVersion((value) => value + 1)),
			editor.timeline.subscribe(() => setVersion((value) => value + 1)),
			editor.audio.subscribe(() => setVersion((value) => value + 1)),
			editor.project.subscribe(() => setVersion((value) => value + 1)),
		];
		return () => {
			unsubscribers.forEach((unsubscribe) => unsubscribe());
		};
	}, [editor]);
	void version;
	const activeProject = editor.project.getActive();
	const preferredMood = activeProject?.settings.libraryDefaults?.musicMood ?? null;
	const trendReferences = activeProject?.clipforge?.trendSoundReferences ?? [];

	const voiceoverAssetIds = useMemo(
		() =>
			new Set(
				editor.timeline
					.getTracks()
					.flatMap((track) =>
						track.type === "audio"
							? track.elements.flatMap((element) =>
									element.type === "audio" &&
									element.sourceType === "upload" &&
									(element.role ?? "audio") === "voiceover"
										? [element.mediaId]
										: [],
								)
							: [],
					),
			),
		[editor, version],
	);

	const audioAssets = useMemo(
		() =>
			editor.media
				.getAssets()
				.filter((asset) => asset.type === "audio")
				.filter((asset) => !asset.libraryItemId)
				.filter((asset) => !voiceoverAssetIds.has(asset.id))
				.filter((asset) => asset.name.toLowerCase().includes(search.trim().toLowerCase())),
		[editor, search, version, voiceoverAssetIds],
	);
	const beatState = editor.audio.getSceneBeatMarkers();
	const activeBeatSource =
		audioAssets.find((asset) => asset.id === beatState.sourceMediaId) ??
		BUNDLED_MUSIC.find((item) => item.id === beatState.sourceMediaId) ??
		null;
	const bundledMusic = getBundledMusicByMood({ mood: preferredMood }).filter((item) =>
		item.label.toLowerCase().includes(search.trim().toLowerCase()),
	);
	const filteredTrendReferences = trendReferences.filter((reference) =>
		[
			reference.label,
			reference.creator ?? "",
			reference.notes ?? "",
			reference.platform,
		]
			.join(" ")
			.toLowerCase()
			.includes(search.trim().toLowerCase()),
	);

	const handleSaveTrendReference = () => {
		try {
			editor.clipforge.saveTrendSoundReference({
				label: trendLabel,
				platform: trendPlatform,
				creator: trendCreator,
				sourceUrl: trendSourceUrl,
				notes: trendNotes,
			});
			setTrendLabel("");
			setTrendCreator("");
			setTrendSourceUrl("");
			setTrendNotes("");
			setTrendPlatform("tiktok");
			setIsTrendDialogOpen(false);
			toast.success("Trend sound reference saved.");
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Unable to save trend reference.",
			);
		}
	};

	return (
		<div className="flex h-full flex-col gap-5">
			<div className="space-y-2">
				<p className="text-sm font-medium">Songs</p>
				<p className="text-muted-foreground text-sm">
					Built-in starter tracks come first. Trend references stay separate from actual audio, and imported audio stays available as custom music beds.
				</p>
				<p className="text-muted-foreground text-xs">
					Beat source: {activeBeatSource ? `${"label" in activeBeatSource ? activeBeatSource.label : activeBeatSource.name}${beatState.bpm ? ` · ${beatState.bpm} BPM` : ""}` : "None selected"}
				</p>
				{preferredMood ? (
					<p className="text-muted-foreground text-xs">Recommended mood: {preferredMood}</p>
				) : null}
			</div>
			<Input
				placeholder="Filter songs"
				value={search}
				onChange={({ currentTarget }) => setSearch(currentTarget.value)}
				showClearIcon
				onClear={() => setSearch("")}
			/>
			<ScrollArea className="h-full flex-1">
				<div className="flex flex-col gap-3">
					<div className="space-y-3">
						<div>
							<p className="text-sm font-medium">Built-in starter tracks</p>
							<p className="text-muted-foreground text-xs">
								Free-first local music packs with BPM metadata and beat-marker support.
							</p>
						</div>
						{bundledMusic.map((item) => (
							<BundledAudioItem
								key={item.id}
								item={item}
								role="music"
								editor={editor}
								isBeatSource={item.id === beatState.sourceMediaId}
							/>
						))}
						{bundledMusic.length === 0 ? (
							<div className="text-muted-foreground rounded-lg border border-dashed p-4 text-sm">
								No built-in songs match that filter.
							</div>
						) : null}
					</div>
					<div className="space-y-3 pt-2">
						<div className="flex items-start justify-between gap-3">
							<div>
								<p className="text-sm font-medium">Trend sounds</p>
								<p className="text-muted-foreground text-xs">
									Save TikTok, Instagram, or YouTube sound references as style and pacing notes. These do not provide the audio itself.
								</p>
							</div>
							<Dialog open={isTrendDialogOpen} onOpenChange={setIsTrendDialogOpen}>
								<DialogTrigger asChild>
									<Button size="sm" variant="outline">Add reference</Button>
								</DialogTrigger>
								<DialogContent>
									<DialogHeader>
										<DialogTitle>Add trend sound reference</DialogTitle>
										<DialogDescription>
											Save a sound link or title as a planning reference. You still need a valid bundled or imported audio track for export.
										</DialogDescription>
									</DialogHeader>
									<div className="space-y-3">
										<Input
											placeholder="Sound title"
											value={trendLabel}
											onChange={({ currentTarget }) => setTrendLabel(currentTarget.value)}
										/>
										<Select
											value={trendPlatform}
											onValueChange={(value) => {
												if (
													value === "tiktok" ||
													value === "instagram" ||
													value === "youtube"
												) {
													setTrendPlatform(value);
												}
											}}
										>
											<SelectTrigger>
												<SelectValue placeholder="Platform" />
											</SelectTrigger>
											<SelectContent>
												<SelectItem value="tiktok">TikTok</SelectItem>
												<SelectItem value="instagram">Instagram</SelectItem>
												<SelectItem value="youtube">YouTube</SelectItem>
											</SelectContent>
										</Select>
										<Input
											placeholder="Creator (optional)"
											value={trendCreator}
											onChange={({ currentTarget }) => setTrendCreator(currentTarget.value)}
										/>
										<Input
											placeholder="Source URL (optional)"
											value={trendSourceUrl}
											onChange={({ currentTarget }) => setTrendSourceUrl(currentTarget.value)}
										/>
										<Textarea
											placeholder="Notes like use this vibe, pacing, or hook"
											value={trendNotes}
											onChange={({ currentTarget }) => setTrendNotes(currentTarget.value)}
											rows={3}
										/>
									</div>
									<DialogFooter>
										<Button variant="text" onClick={() => setIsTrendDialogOpen(false)}>
											Cancel
										</Button>
										<Button onClick={handleSaveTrendReference}>Save reference</Button>
									</DialogFooter>
								</DialogContent>
							</Dialog>
						</div>
						{filteredTrendReferences.map((reference) => (
							<TrendSoundReferenceItem
								key={reference.id}
								reference={reference}
								onRemove={() => {
									editor.clipforge.removeTrendSoundReference({
										referenceId: reference.id,
									});
									toast.success("Trend sound reference removed.");
								}}
							/>
						))}
						{filteredTrendReferences.length === 0 ? (
							<div className="text-muted-foreground rounded-lg border border-dashed p-4 text-sm">
								Save a trend reference to keep a TikTok or Reels audio vibe attached to the project.
							</div>
						) : null}
					</div>
					<div className="space-y-3 pt-2">
						<div>
							<p className="text-sm font-medium">Imported audio</p>
							<p className="text-muted-foreground text-xs">
								User-imported audio stays available alongside the built-in library. You are responsible for any usage rights on imported tracks.
							</p>
						</div>
						{audioAssets.map((asset) => (
							<UploadedAudioItem
								key={asset.id}
								asset={asset}
								role="music"
								isBeatSource={asset.id === beatState.sourceMediaId}
							/>
						))}
						{audioAssets.length === 0 ? (
							<div className="text-muted-foreground rounded-lg border border-dashed p-4 text-sm">
								Import audio in the Media tab to use custom music beds here.
							</div>
						) : null}
					</div>
					<div className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
						<p className="font-medium text-foreground">Music rights</p>
						<p className="mt-1">Bundled tracks are free-first starter music and safe for generic export.</p>
						<p className="mt-1">Imported tracks are user-managed. ClipForge warns about unknown or destination-limited rights but does not hard-block export.</p>
						<p className="mt-1">Trend references are planning cues only. They do not include playable or licensed audio.</p>
					</div>
				</div>
			</ScrollArea>
		</div>
	);
}

function TrendSoundReferenceItem({
	reference,
	onRemove,
}: {
	reference: TrendSoundReference;
	onRemove: () => void;
}) {
	return (
		<div className="rounded-lg border p-3">
			<div className="flex items-start justify-between gap-3">
				<div className="min-w-0">
					<div className="flex items-center gap-2">
						<HugeiconsIcon icon={Link04Icon} className="size-4 text-muted-foreground" />
						<p className="truncate text-sm font-medium">{reference.label}</p>
					</div>
					<p className="text-muted-foreground mt-1 text-xs">
						{formatPublishDestination({ publishDestination: reference.platform })}
						{reference.creator ? ` · ${reference.creator}` : ""}
					</p>
					{reference.notes ? (
						<p className="text-muted-foreground mt-2 text-xs">{reference.notes}</p>
					) : null}
					{reference.sourceUrl ? (
						<a
							href={reference.sourceUrl}
							target="_blank"
							rel="noreferrer"
							className="mt-2 inline-block text-xs text-primary underline-offset-2 hover:underline"
						>
							Open source
						</a>
					) : null}
				</div>
				<Button variant="text" size="sm" onClick={onRemove}>
					Delete
				</Button>
			</div>
		</div>
	);
}

function VoiceoverAssetItem({ asset }: { asset: MediaAsset }) {
	const editor = useEditor();
	const activeProject = editor.project.getActive();
	const [isRenameOpen, setIsRenameOpen] = useState(false);
	const [draftName, setDraftName] = useState(asset.name);

	useEffect(() => {
		setDraftName(asset.name);
	}, [asset.name]);

	const handleRename = async () => {
		if (!activeProject) return;
		const renamed = await editor.media.renameMediaAsset({
			projectId: activeProject.metadata.id,
			id: asset.id,
			name: draftName,
		});
		if (!renamed) {
			toast.error("Failed to rename voiceover.");
			return;
		}
		setIsRenameOpen(false);
		toast.success("Voiceover renamed.");
	};

	const handleDelete = async () => {
		if (!activeProject) return;
		await editor.media.removeMediaAsset({
			projectId: activeProject.metadata.id,
			id: asset.id,
		});
		toast.success("Voiceover deleted.");
	};

	return (
		<div className="group flex items-center gap-3 rounded-lg border p-3">
			<div className="bg-accent flex size-11 shrink-0 items-center justify-center rounded-md">
				<HugeiconsIcon icon={VoiceIcon} />
			</div>
			<div className="min-w-0 flex-1">
				<p className="truncate text-sm font-medium">{asset.name}</p>
				<p className="text-muted-foreground text-xs">
					{formatTimeCode({ timeInSeconds: asset.duration ?? 0 })}
				</p>
			</div>
			<Dialog open={isRenameOpen} onOpenChange={setIsRenameOpen}>
				<DialogTrigger asChild>
					<Button variant="text" size="sm">Rename</Button>
				</DialogTrigger>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Rename voiceover</DialogTitle>
						<DialogDescription>Update the name shown for this recorded take.</DialogDescription>
					</DialogHeader>
					<Input value={draftName} onChange={({ currentTarget }) => setDraftName(currentTarget.value)} />
					<DialogFooter>
						<Button variant="text" onClick={() => setIsRenameOpen(false)}>Cancel</Button>
						<Button onClick={() => void handleRename()}>Save</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
			<Button variant="text" size="sm" onClick={() => void handleDelete()}>
				Delete
			</Button>
		</div>
	);
}

function MixView() {
	const editor = useEditor();
	const [version, setVersion] = useState(0);
	useEffect(() => {
		const unsubscribers = [
			editor.project.subscribe(() => setVersion((value) => value + 1)),
			editor.timeline.subscribe(() => setVersion((value) => value + 1)),
			editor.media.subscribe(() => setVersion((value) => value + 1)),
		];
		return () => {
			unsubscribers.forEach((unsubscribe) => unsubscribe());
		};
	}, [editor]);
	void version;

	const project = editor.project.getActive();
	if (!project) {
		return <div className="text-muted-foreground text-sm">Open a project to edit audio mix settings.</div>;
	}
	const settings = getProjectAudioSettings({ project });
	const summary = editor.audio.getProjectMixSummary();

	const updateAudioSettings = (updates: Partial<typeof settings>) => {
		editor.project.updateSettings({
			settings: {
				audio: {
					...settings,
					...updates,
				},
			},
		});
	};

	return (
		<div className="flex h-full flex-col gap-5">
			<div className="space-y-2">
				<p className="text-sm font-medium">Project mix</p>
				<p className="text-muted-foreground text-sm">Master level and deterministic music ducking apply to preview and export.</p>
			</div>
			<div className="space-y-5 rounded-lg border p-4">
				<MixSlider label="Master" value={settings.masterVolume} min={0} max={2} step={0.01} display={`${Math.round(settings.masterVolume * 100)}%`} onChange={(value) => updateAudioSettings({ masterVolume: value })} />
				<div className="space-y-2">
					<p className="text-sm font-medium">Audio polish preset</p>
					<Select
						value={settings.audioPolishPresetId ?? "none"}
						onValueChange={(value) =>
							updateAudioSettings({
								audioPolishPresetId: value as typeof settings.audioPolishPresetId,
							})
						}
					>
						<SelectTrigger>
							<SelectValue placeholder="Audio polish preset" />
						</SelectTrigger>
						<SelectContent>
							{AUDIO_POLISH_PRESETS.map((preset) => (
								<SelectItem key={preset.id} value={preset.id}>
									{preset.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					<p className="text-muted-foreground text-xs">
						Applies a lightweight, deterministic voice/music balance profile in preview and export.
					</p>
				</div>
				<div className="space-y-2">
					<div className="flex items-center justify-between gap-3">
						<p className="text-sm font-medium">Duck music</p>
						<Button variant={settings.duckingEnabled ? "secondary" : "outline"} size="sm" onClick={() => updateAudioSettings({ duckingEnabled: !settings.duckingEnabled })}>
							{settings.duckingEnabled ? "On" : "Off"}
						</Button>
					</div>
					<p className="text-muted-foreground text-xs">Dialogue windows from voiceover and indexed transcript media lower music clips only.</p>
				</div>
				<MixSlider label="Amount" value={settings.duckingAmount} min={0} max={1} step={0.01} display={`${Math.round(settings.duckingAmount * 100)}%`} onChange={(value) => updateAudioSettings({ duckingAmount: value })} disabled={!settings.duckingEnabled} />
				<MixSlider label="Attack" value={settings.duckingAttackMs} min={0} max={600} step={10} display={`${Math.round(settings.duckingAttackMs)}ms`} onChange={(value) => updateAudioSettings({ duckingAttackMs: value })} disabled={!settings.duckingEnabled} />
				<MixSlider label="Release" value={settings.duckingReleaseMs} min={0} max={1000} step={10} display={`${Math.round(settings.duckingReleaseMs)}ms`} onChange={(value) => updateAudioSettings({ duckingReleaseMs: value })} disabled={!settings.duckingEnabled} />
				<div className="space-y-2">
					<div className="flex items-center justify-between gap-3">
						<p className="text-sm font-medium">Soft limiter</p>
						<Button
							variant={settings.softLimiterEnabled ? "secondary" : "outline"}
							size="sm"
							onClick={() =>
								updateAudioSettings({
									softLimiterEnabled: !(settings.softLimiterEnabled ?? false),
								})
							}
						>
							{settings.softLimiterEnabled ? "On" : "Off"}
						</Button>
					</div>
					<p className="text-muted-foreground text-xs">
						Softly catches master peaks after audio polish. Keeps preview and export aligned.
					</p>
				</div>
			</div>
			<div className="grid grid-cols-2 gap-3 text-sm">
				<SummaryCard label="Music clips" value={summary.musicClipCount.toString()} />
				<SummaryCard label="Voiceover clips" value={summary.voiceoverClipCount.toString()} />
				<SummaryCard label="Dialogue windows" value={summary.dialogueWindowCount.toString()} />
				<SummaryCard label="Master" value={`${Math.round(summary.masterVolume * 100)}%`} />
				<SummaryCard
					label="Audio polish"
					value={getAudioPolishPresetLabel({
						id: summary.audioPolishPresetId ?? "none",
					})}
				/>
				<SummaryCard
					label="Limiter"
					value={summary.softLimiterEnabled ? "On" : "Off"}
				/>
			</div>
		</div>
	);
}

function MixSlider({ label, value, min, max, step, display, onChange, disabled = false }: { label: string; value: number; min: number; max: number; step: number; display: string; onChange: (value: number) => void; disabled?: boolean; }) {
	return (
		<div className="space-y-2">
			<div className="flex items-center justify-between gap-3 text-sm">
				<span>{label}</span>
				<span className="text-muted-foreground">{display}</span>
			</div>
			<Slider value={[value]} min={min} max={max} step={step} disabled={disabled} onValueChange={(next) => onChange(next[0] ?? value)} />
		</div>
	);
}

function SummaryCard({ label, value }: { label: string; value: string }) {
	return (
		<div className="rounded-lg border p-3">
			<p className="text-muted-foreground text-xs uppercase tracking-wide">{label}</p>
			<p className="mt-1 text-sm font-medium">{value}</p>
		</div>
	);
}

function BundledAudioItem({
	item,
	role,
	editor,
	isBeatSource = false,
}: {
	item: AudioLibraryItem;
	role: "music" | "sfx";
	editor: ReturnType<typeof useEditor>;
	isBeatSource?: boolean;
}) {
	const [isImporting, setIsImporting] = useState(false);

	const ensureAsset = async () =>
		ensureBundledAudioAsset({
			editor,
			item,
		});

	const insertAsset = async () => {
		try {
			setIsImporting(true);
			const asset = await ensureAsset();
			const audioTrack = editor.timeline.getTracks().find((track) => track.type === "audio");
			const trackId = audioTrack?.id ?? editor.timeline.addTrack({ type: "audio" });
			const element = buildUploadAudioElement({
				mediaId: asset.id,
				name: asset.name,
				duration: asset.duration ?? item.duration,
				startTime: editor.playback.getCurrentTime(),
			});
			element.role = role;
			editor.timeline.insertElement({ placement: { mode: "explicit", trackId }, element });
			toast.success(`${role === "music" ? "Song" : "Sound effect"} added to timeline.`);
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Unable to load bundled audio.",
			);
		} finally {
			setIsImporting(false);
		}
	};

	const analyzeBeats = async () => {
		try {
			setIsImporting(true);
			const asset = await ensureAsset();
			const result = await editor.audio.analyzeBeatGrid({ mediaId: asset.id });
			toast.success(
				result.bpm ? `Beat grid ready at ${result.bpm} BPM.` : "Beat grid analyzed.",
			);
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Beat analysis failed.",
			);
		} finally {
			setIsImporting(false);
		}
	};

	const useAsBeatSource = async () => {
		try {
			setIsImporting(true);
			const asset = await ensureAsset();
			editor.audio.setSelectedBeatSource({ mediaId: asset.id });
			toast.success("Using built-in song for beat markers.");
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Unable to set beat source.",
			);
		} finally {
			setIsImporting(false);
		}
	};

	return (
		<div className="group flex flex-col gap-3 rounded-lg border p-3">
			<div className="flex items-center gap-3">
				<div className="bg-accent flex size-11 shrink-0 items-center justify-center rounded-md">
					<HugeiconsIcon icon={VolumeHighIcon} />
				</div>
				<div className="min-w-0 flex-1">
					<p className="truncate text-sm font-medium">{item.label}</p>
					<p className="text-muted-foreground text-xs">
						{formatTimeCode({ timeInSeconds: item.duration })}
						{item.kind === "music" && item.bpm ? ` · ${item.bpm} BPM` : ""}
					</p>
					<p className="text-muted-foreground text-xs">
						{getMusicRightsLabel({
							asset: {
								musicSourceType: "bundled",
								rightsProfile: "universal",
							} as MediaAsset,
						})}{" "}
						· {item.license}
						{isBeatSource ? " · Active markers" : ""}
					</p>
				</div>
			</div>
			<div className="flex flex-wrap items-center gap-2 pointer-events-auto">
				{item.kind === "music" ? (
					<>
						<Button
							size="sm"
							variant="outline"
							onPointerDown={(event) => event.stopPropagation()}
							onClick={() => void analyzeBeats()}
							disabled={isImporting}
						>
							Analyze beats
						</Button>
						<Button
							size="sm"
							variant={isBeatSource ? "secondary" : "outline"}
							onPointerDown={(event) => event.stopPropagation()}
							onClick={() => void useAsBeatSource()}
							disabled={isImporting}
						>
							Use for beats
						</Button>
					</>
				) : null}
				<Button
					size="sm"
					variant="default"
					onPointerDown={(event) => event.stopPropagation()}
					onClick={() => void insertAsset()}
					disabled={isImporting}
				>
					<HugeiconsIcon icon={PlusSignIcon} className="mr-1" />
					Add to timeline
				</Button>
			</div>
		</div>
	);
}

function UploadedAudioItem({
	asset,
	role,
	isBeatSource = false,
}: {
	asset: MediaAsset;
	role: "music" | "sfx" | "audio";
	isBeatSource?: boolean;
}) {
	const editor = useEditor();
	const [isAnalyzing, setIsAnalyzing] = useState(false);
	const insertAsset = () => {
		const audioTrack = editor.timeline.getTracks().find((track) => track.type === "audio");
		const trackId = audioTrack?.id ?? editor.timeline.addTrack({ type: "audio" });
		const element = buildUploadAudioElement({
			mediaId: asset.id,
			name: asset.name,
			duration: asset.duration ?? 1,
			startTime: editor.playback.getCurrentTime(),
		});
		element.role = role;
		editor.timeline.insertElement({ placement: { mode: "explicit", trackId }, element });
		toast.success(`${role === "music" ? "Song" : "Audio"} added to timeline.`);
		if (role === "music" && !asset.beatAnalysis) {
			void editor.audio.analyzeBeatGrid({ mediaId: asset.id }).catch(() => {
				// background analysis is best effort
			});
		}
	};
	const analyzeBeats = async () => {
		try {
			setIsAnalyzing(true);
			const result = await editor.audio.analyzeBeatGrid({ mediaId: asset.id });
			toast.success(
				result.bpm
					? `Beat grid ready at ${result.bpm} BPM.`
					: "Beat grid analyzed.",
			);
		} catch (error) {
			toast.error("Beat analysis failed.", {
				description:
					error instanceof Error ? error.message : "Please try again.",
			});
		} finally {
			setIsAnalyzing(false);
		}
	};
	const useAsBeatSource = () => {
		editor.audio.setSelectedBeatSource({ mediaId: asset.id });
		toast.success("Using song for beat markers.");
	};
	const beatLabel = asset.beatAnalysis?.bpm ? `${asset.beatAnalysis.bpm} BPM` : null;
	const rightsLabel = getMusicRightsLabel({ asset });
	const compatibilityLabel = getDestinationCompatibilityLabel({
		asset,
		publishDestination: "generic-export",
	});

	return (
		<div className="group flex flex-col gap-3 rounded-lg border p-3">
			<div className="flex items-center gap-3">
				<div className="bg-accent flex size-11 shrink-0 items-center justify-center rounded-md">
					<HugeiconsIcon icon={VolumeHighIcon} />
				</div>
				<div className="min-w-0 flex-1">
					<p className="truncate text-sm font-medium">{asset.name}</p>
					<p className="text-muted-foreground text-xs">
						{formatTimeCode({ timeInSeconds: asset.duration ?? 0 })}
					</p>
					{role === "music" ? (
						<p className="text-muted-foreground text-xs">
							{beatLabel ?? "Beat grid not analyzed"}
							{isBeatSource ? " · Active markers" : ""}
						</p>
					) : null}
					<p className="text-muted-foreground text-xs">
						{asset.sourceLabel ?? "Imported by user"} · {rightsLabel}
						{compatibilityLabel ? ` · ${compatibilityLabel}` : ""}
					</p>
					{asset.attributionRequired && asset.attributionText ? (
						<p className="text-muted-foreground text-[10px]">
							Attribution: {asset.attributionText}
						</p>
					) : null}
				</div>
			</div>
			<div className="flex flex-wrap items-center gap-2 pointer-events-auto">
				{role === "music" ? (
					<>
						<Button
							size="sm"
							variant="outline"
							className="pointer-events-auto"
							onPointerDown={(event) => event.stopPropagation()}
							onClick={() => void analyzeBeats()}
							disabled={isAnalyzing}
						>
							{asset.beatAnalysis ? "Re-analyze" : "Analyze beats"}
						</Button>
						<Button
							size="sm"
							variant={isBeatSource ? "secondary" : "outline"}
							className="pointer-events-auto"
							onPointerDown={(event) => event.stopPropagation()}
							onClick={useAsBeatSource}
							disabled={!asset.beatAnalysis}
						>
							Use for beats
						</Button>
					</>
				) : null}
				<Button
					size="sm"
					variant="default"
					className="pointer-events-auto"
					onPointerDown={(event) => event.stopPropagation()}
					onClick={insertAsset}
					title="Add to timeline"
				>
					<HugeiconsIcon icon={PlusSignIcon} className="mr-1" />
					Add to timeline
				</Button>
			</div>
		</div>
	);
}

interface AudioItemProps {
	sound: SoundEffect;
	role: "music" | "sfx" | "audio";
	isPlaying: boolean;
	onPlay: ({ sound }: { sound: SoundEffect }) => void;
}

function AudioItem({ sound, role, isPlaying, onPlay }: AudioItemProps) {
	const { addSoundToTimeline, isSoundSaved, toggleSavedSound } = useSoundsStore();
	const isSaved = isSoundSaved({ soundId: sound.id });

	return (
		<div className="group flex items-center gap-3 opacity-100 hover:opacity-75">
			<button type="button" className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => onPlay({ sound })}>
				<div className="bg-accent relative flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-md">
					<div className="from-primary/20 absolute inset-0 bg-gradient-to-br to-transparent" />
					{isPlaying ? <HugeiconsIcon icon={PauseIcon} className="size-5" /> : <HugeiconsIcon icon={PlayIcon} className="size-5" />}
				</div>
				<div className="min-w-0 flex-1 overflow-hidden">
					<p className="truncate text-sm font-medium">{sound.name}</p>
					<span className="text-muted-foreground block truncate text-xs">{sound.username}</span>
				</div>
			</button>
			<div className="flex items-center gap-3 pr-2">
				<Button variant="text" size="icon" className="text-muted-foreground hover:text-foreground w-auto !opacity-100" onClick={async (event) => {
					event.stopPropagation();
					await addSoundToTimeline({ sound, role });
				}} title="Add to timeline">
					<HugeiconsIcon icon={PlusSignIcon} />
				</Button>
				<Button variant="text" size="icon" className={`hover:text-foreground w-auto !opacity-100 ${isSaved ? "text-red-500 hover:text-red-600" : "text-muted-foreground"}`} onClick={(event) => {
					event.stopPropagation();
					void toggleSavedSound({ soundEffect: sound });
				}} title={isSaved ? "Remove from saved" : "Save sound"}>
					<HugeiconsIcon icon={FavouriteIcon} className={isSaved ? "fill-current" : ""} />
				</Button>
			</div>
		</div>
	);
}
