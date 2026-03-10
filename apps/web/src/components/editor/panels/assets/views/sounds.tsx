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
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useEditor } from "@/hooks/use-editor";
import { useInfiniteScroll } from "@/hooks/use-infinite-scroll";
import { useSoundSearch } from "@/hooks/use-sound-search";
import { buildUploadAudioElement } from "@/lib/timeline";
import { formatTimeCode } from "@/lib/time";
import { getProjectAudioSettings } from "@/lib/media/audio";
import { useSoundsStore } from "@/stores/sounds-store";
import type { MediaAsset } from "@/types/assets";
import type { SavedSound, SoundEffect } from "@/types/sounds";
import { cn } from "@/utils/ui";
import {
	FavouriteIcon,
	FilterMailIcon,
	Mic01Icon,
	PauseIcon,
	PlayIcon,
	PlusSignIcon,
	VoiceIcon,
	VolumeHighIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { toast } from "sonner";

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

	useEffect(() => {
		const unsubscribers = [
			editor.media.subscribe(() => setVersion((value) => value + 1)),
			editor.timeline.subscribe(() => setVersion((value) => value + 1)),
			editor.audio.subscribe(() => setVersion((value) => value + 1)),
		];
		return () => {
			unsubscribers.forEach((unsubscribe) => unsubscribe());
		};
	}, [editor]);
	void version;

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
				.filter((asset) => !voiceoverAssetIds.has(asset.id))
				.filter((asset) => asset.name.toLowerCase().includes(search.trim().toLowerCase())),
		[editor, search, version, voiceoverAssetIds],
	);
	const beatState = editor.audio.getSceneBeatMarkers();
	const activeBeatSource = audioAssets.find(
		(asset) => asset.id === beatState.sourceMediaId,
	);

	return (
		<div className="flex h-full flex-col gap-5">
			<div className="space-y-2">
				<p className="text-sm font-medium">Songs</p>
				<p className="text-muted-foreground text-sm">Use imported audio assets as music beds. They insert at the playhead with the music role.</p>
				<p className="text-muted-foreground text-xs">
					Beat source: {activeBeatSource ? `${activeBeatSource.name}${beatState.bpm ? ` · ${beatState.bpm} BPM` : ""}` : "None selected"}
				</p>
			</div>
			<Input
				placeholder="Filter imported audio"
				value={search}
				onChange={({ currentTarget }) => setSearch(currentTarget.value)}
				showClearIcon
				onClear={() => setSearch("")}
			/>
			<ScrollArea className="h-full flex-1">
				<div className="flex flex-col gap-3">
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
							Import audio in the Media tab to use it as a song here.
						</div>
					) : null}
				</div>
			</ScrollArea>
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
			</div>
			<div className="grid grid-cols-2 gap-3 text-sm">
				<SummaryCard label="Music clips" value={summary.musicClipCount.toString()} />
				<SummaryCard label="Voiceover clips" value={summary.voiceoverClipCount.toString()} />
				<SummaryCard label="Dialogue windows" value={summary.dialogueWindowCount.toString()} />
				<SummaryCard label="Master" value={`${Math.round(summary.masterVolume * 100)}%`} />
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
