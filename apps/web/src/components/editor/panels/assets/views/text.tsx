"use client";

import { PanelView } from "@/components/editor/panels/assets/views/base-view";
import { Button } from "@/components/ui/button";
import { ColorPicker } from "@/components/ui/color-picker";
import { FontPicker } from "@/components/ui/font-picker";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { DEFAULT_TEXT_ELEMENT } from "@/constants/text-constants";
import { DEFAULT_PROJECT_LIBRARY_DEFAULTS } from "@/constants/project-constants";
import { useEditor } from "@/hooks/use-editor";
import { BUILT_IN_CAPTION_STYLES } from "@/lib/clipforge/caption-style-library";
import {
	POLISH_PROFILES,
	getAudioPolishPresetLabel,
	getCaptionRevealLabel,
	getFinishingLookLabel,
} from "@/lib/clipforge/polish-profiles";
import { BUNDLED_MUSIC } from "@/lib/library";
import { buildTextElement } from "@/lib/timeline/element-utils";
import {
	GRAPHICS_PRESETS,
	OVERLAY_STYLE_VARIANTS,
	SOCIAL_OVERLAY_PRESETS,
	resolveProjectBrandKit,
	resolveProjectOverlayDefaults,
	type GraphicsMotionPresetId,
	type GraphicsPresetId,
} from "@/lib/timeline";
import { type GraphicsTab, useAssetsPanelStore } from "@/stores/assets-panel-store";
import { uppercase } from "@/utils/string";
import { cn } from "@/utils/ui";
import { useEffect, useMemo, useState } from "react";
import type { OverlaySafeMarginPreset, OverlayMotionPresetId } from "@/types/project";
import type { OverlayStyleVariantId, SocialOverlayPresetId } from "@/types/timeline";

const GRAPHICS_TAB_OPTIONS: Array<{ key: GraphicsTab; label: string }> = [
	{ key: "titles", label: "Titles" },
	{ key: "overlays", label: "Overlays" },
	{ key: "cta", label: "CTA" },
	{ key: "polish", label: "Polish" },
	{ key: "brand", label: "Brand" },
	{ key: "text", label: "Text" },
];

const MOTION_PRESET_OPTIONS: Array<{
	value: GraphicsMotionPresetId;
	label: string;
}> = [
	{ value: "fade-up", label: "Fade up" },
	{ value: "slide-up", label: "Slide up" },
	{ value: "pop-in", label: "Pop in" },
	{ value: "drift-in", label: "Drift in" },
	{ value: "none", label: "None" },
];

const PRESET_GROUPS: Record<
	Exclude<GraphicsTab, "brand" | "text" | "overlays">,
	GraphicsPresetId[]
> = {
	titles: ["title-clean", "title-bold", "lower-third-clean", "lower-third-brand", "quote-card"],
	cta: ["cta-subscribe", "cta-follow"],
	polish: [],
};

const OVERLAY_CARD_LABELS: Record<SocialOverlayPresetId, { title: string; subtitle: string }> = {
	"timestamp-card": { title: "7:20 am", subtitle: "Get loose" },
	"routine-label": { title: "Morning workout", subtitle: "Single-pill overlay" },
	"location-tag": { title: "Brooklyn, NY", subtitle: "Friday" },
	"chapter-card": { title: "Afternoon run", subtitle: "Court session" },
	"stat-card": { title: "10K", subtitle: "Steps before lunch" },
	"quote-card-social": { title: '"Build the habit first."', subtitle: "Coach note" },
};

const SAFE_MARGIN_OPTIONS: Array<{ value: OverlaySafeMarginPreset; label: string }> = [
	{ value: "standard", label: "Standard" },
	{ value: "tight", label: "Tight" },
];

export function TextView() {
	const editor = useEditor();
	const graphicsTab = useAssetsPanelStore((state) => state.graphicsTab);
	const setGraphicsTab = useAssetsPanelStore((state) => state.setGraphicsTab);
	const activeProject = editor.project.getActive();
	const brandKit = resolveProjectBrandKit({ project: activeProject });
	const overlayDefaults = resolveProjectOverlayDefaults({ project: activeProject });
	const libraryDefaults =
		activeProject?.settings.libraryDefaults ?? DEFAULT_PROJECT_LIBRARY_DEFAULTS;
	const [motionPresetId, setMotionPresetId] = useState<GraphicsMotionPresetId>(overlayDefaults.motionPresetId);
	const [overlayVariantId, setOverlayVariantId] = useState<OverlayStyleVariantId>(overlayDefaults.variantId);
	const imageAssets = editor.media
		.getAssets()
		.filter((asset) => asset.type === "image")
		.sort((left, right) => left.name.localeCompare(right.name));

	useEffect(() => {
		setMotionPresetId(overlayDefaults.motionPresetId);
		setOverlayVariantId(overlayDefaults.variantId);
	}, [overlayDefaults.motionPresetId, overlayDefaults.variantId]);

	const groupedPresets = useMemo(() => {
		if (graphicsTab === "brand" || graphicsTab === "text" || graphicsTab === "overlays") {
			return [];
		}
		return PRESET_GROUPS[graphicsTab]
			.map((presetId) => GRAPHICS_PRESETS.find((preset) => preset.id === presetId) ?? null)
			.filter((preset): preset is (typeof GRAPHICS_PRESETS)[number] => preset !== null);
	}, [graphicsTab]);

	const insertPreset = ({ presetId }: { presetId: GraphicsPresetId }) => {
		editor.timeline.insertGraphicsPreset({
			presetId,
			motionPresetId,
			startTime: editor.playback.getCurrentTime(),
		});
	};

	const insertOverlay = ({ presetId }: { presetId: SocialOverlayPresetId }) => {
		editor.timeline.insertSocialOverlayPreset({
			presetId,
			variantId: overlayVariantId,
			motionPresetId,
			startTime: editor.playback.getCurrentTime(),
		});
	};

	const insertRawText = () => {
		const element = buildTextElement({
			raw: DEFAULT_TEXT_ELEMENT,
			startTime: editor.playback.getCurrentTime(),
		});
		editor.timeline.insertElement({
			element,
			placement: { mode: "auto" },
		});
	};

	const updateBrandKit = (updates: Partial<typeof brandKit>) => {
		void editor.project.updateSettings({
			settings: {
				brandKit: {
					...brandKit,
					...updates,
				},
			},
		});
	};

	const updateOverlayDefaults = (updates: Partial<typeof overlayDefaults>) => {
		void editor.project.updateSettings({
			settings: {
				overlayDefaults: {
					...overlayDefaults,
					...updates,
				},
			},
		});
	};

	const updateLibraryDefaults = (updates: Partial<typeof libraryDefaults>) => {
		void editor.project.updateSettings({
			settings: {
				libraryDefaults: {
					...libraryDefaults,
					...updates,
				},
			},
		});
	};

	const titlePresetOptions = GRAPHICS_PRESETS.filter((preset) => preset.kind === "title");
	const musicMoodOptions = Array.from(
		new Set(BUNDLED_MUSIC.map((item) => item.mood).filter(Boolean)),
	) as Array<NonNullable<(typeof BUNDLED_MUSIC)[number]["mood"]>>;

	return (
		<PanelView title="Graphics">
			<div className="flex flex-col gap-4 pb-4">
				<div className="flex flex-wrap gap-2 px-1 pt-1">
					{GRAPHICS_TAB_OPTIONS.map((option) => (
						<Button
							key={option.key}
							variant={graphicsTab === option.key ? "default" : "outline"}
							size="sm"
							onClick={() => setGraphicsTab(option.key)}
						>
							{option.label}
						</Button>
					))}
				</div>

				{graphicsTab !== "brand" && graphicsTab !== "polish" ? (
					<div className="space-y-2 px-1">
						<p className="text-muted-foreground text-xs">
							Insert at the playhead, then tune it in the inspector.
						</p>
						<div className="flex flex-wrap items-center gap-2">
							<span className="text-muted-foreground text-xs">Motion</span>
							<Select
								value={motionPresetId}
								onValueChange={(value) => setMotionPresetId(value as GraphicsMotionPresetId)}
							>
								<SelectTrigger className="h-8 w-40">
									<SelectValue placeholder="Motion preset" />
								</SelectTrigger>
								<SelectContent>
									{MOTION_PRESET_OPTIONS.map((option) => (
										<SelectItem key={option.value} value={option.value}>
											{option.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
							{graphicsTab === "overlays" ? (
								<>
									<span className="text-muted-foreground ml-2 text-xs">Style</span>
									<Select
										value={overlayVariantId}
										onValueChange={(value) => setOverlayVariantId(value as OverlayStyleVariantId)}
									>
										<SelectTrigger className="h-8 w-40">
											<SelectValue placeholder="Overlay style" />
										</SelectTrigger>
										<SelectContent>
											{OVERLAY_STYLE_VARIANTS.map((variant) => (
												<SelectItem key={variant.id} value={variant.id}>
													{variant.label}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</>
							) : null}
						</div>
					</div>
				) : null}

				{graphicsTab === "brand" ? (
					<div className="space-y-4 px-1">
						<div className="space-y-1">
							<p className="text-sm font-medium">Brand kit</p>
							<p className="text-muted-foreground text-xs">
								New graphics presets use these defaults. Existing graphics stay unchanged.
							</p>
						</div>
						<div className="flex justify-end">
							<Button
								variant="outline"
								size="sm"
								onClick={() => {
									const name = window.prompt(
										"Project kit name",
										`${editor.project.getActive()?.metadata.name ?? "Creator"} Kit`,
									);
									if (!name) return;
									void editor.project.saveProjectAsKit({ name: name.trim() });
								}}
							>
								Save as project kit
							</Button>
						</div>
						<BrandField label="Primary color">
							<ColorPicker
								value={uppercase({ string: brandKit.primaryColor.replace("#", "") })}
								onChange={(color) => updateBrandKit({ primaryColor: `#${color}` })}
								onChangeEnd={() => undefined}
							/>
						</BrandField>
						<BrandField label="Secondary color">
							<ColorPicker
								value={uppercase({ string: brandKit.secondaryColor.replace("#", "") })}
								onChange={(color) => updateBrandKit({ secondaryColor: `#${color}` })}
								onChangeEnd={() => undefined}
							/>
						</BrandField>
						<BrandField label="Accent color">
							<ColorPicker
								value={uppercase({ string: brandKit.accentColor.replace("#", "") })}
								onChange={(color) => updateBrandKit({ accentColor: `#${color}` })}
								onChangeEnd={() => undefined}
							/>
						</BrandField>
						<BrandField label="Title font">
							<FontPicker
								defaultValue={brandKit.titleFontFamily}
								onValueChange={(value) => updateBrandKit({ titleFontFamily: value })}
							/>
						</BrandField>
						<BrandField label="Body font">
							<FontPicker
								defaultValue={brandKit.bodyFontFamily}
								onValueChange={(value) => updateBrandKit({ bodyFontFamily: value })}
							/>
						</BrandField>
						<BrandField label="Logo">
							<Select
								value={brandKit.logoMediaId ?? "none"}
								onValueChange={(value) =>
									updateBrandKit({ logoMediaId: value === "none" ? null : value })
								}
							>
								<SelectTrigger>
									<SelectValue placeholder="Select logo" />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="none">No logo</SelectItem>
									{imageAssets.map((asset) => (
										<SelectItem key={asset.id} value={asset.id}>
											{asset.name}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</BrandField>
						<BrandField label="Default overlay style">
							<Select
								value={overlayDefaults.variantId}
								onValueChange={(value) =>
									updateOverlayDefaults({ variantId: value as OverlayStyleVariantId })
								}
							>
								<SelectTrigger>
									<SelectValue placeholder="Select default style" />
								</SelectTrigger>
								<SelectContent>
									{OVERLAY_STYLE_VARIANTS.map((variant) => (
										<SelectItem key={variant.id} value={variant.id}>
											{variant.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</BrandField>
						<BrandField label="Default overlay motion">
							<Select
								value={overlayDefaults.motionPresetId}
								onValueChange={(value) =>
									updateOverlayDefaults({ motionPresetId: value as OverlayMotionPresetId })
								}
							>
								<SelectTrigger>
									<SelectValue placeholder="Select default motion" />
								</SelectTrigger>
								<SelectContent>
									{MOTION_PRESET_OPTIONS.map((option) => (
										<SelectItem key={option.value} value={option.value}>
											{option.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</BrandField>
						<BrandField label="Safe margins">
							<Select
								value={overlayDefaults.safeMarginPreset ?? "standard"}
								onValueChange={(value) =>
									updateOverlayDefaults({ safeMarginPreset: value as OverlaySafeMarginPreset })
								}
							>
								<SelectTrigger>
									<SelectValue placeholder="Safe margin preset" />
								</SelectTrigger>
								<SelectContent>
									{SAFE_MARGIN_OPTIONS.map((option) => (
										<SelectItem key={option.value} value={option.value}>
											{option.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</BrandField>
						<BrandField label="Default caption style">
							<Select
								value={libraryDefaults.captionStyleId}
								onValueChange={(value) =>
									updateLibraryDefaults({ captionStyleId: value })
								}
							>
								<SelectTrigger>
									<SelectValue placeholder="Select default caption style" />
								</SelectTrigger>
								<SelectContent>
									{BUILT_IN_CAPTION_STYLES.map((style) => (
										<SelectItem key={style.id} value={style.id}>
											{style.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</BrandField>
						<BrandField label="Default title preset">
							<Select
								value={libraryDefaults.titlePresetId}
								onValueChange={(value) =>
									updateLibraryDefaults({ titlePresetId: value })
								}
							>
								<SelectTrigger>
									<SelectValue placeholder="Select default title preset" />
								</SelectTrigger>
								<SelectContent>
									{titlePresetOptions.map((preset) => (
										<SelectItem key={preset.id} value={preset.id}>
											{preset.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</BrandField>
						<BrandField label="Default music mood">
							<Select
								value={libraryDefaults.musicMood}
								onValueChange={(value) =>
									updateLibraryDefaults({
										musicMood: value as typeof libraryDefaults.musicMood,
									})
								}
							>
								<SelectTrigger>
									<SelectValue placeholder="Select default mood" />
								</SelectTrigger>
								<SelectContent>
									{musicMoodOptions.map((mood) => (
										<SelectItem key={mood} value={mood}>
											{uppercase({ string: mood })}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</BrandField>
					</div>
				) : null}

				{graphicsTab === "polish" ? (
					<div className="grid gap-3 px-1 pb-2">
						<p className="text-muted-foreground px-1 text-xs">
							Apply a bundled final-pass look that coordinates captions, overlays, motion, finishing, and audio polish.
						</p>
						{POLISH_PROFILES.map((profile) => (
							<button
								key={profile.id}
								type="button"
								onClick={() => {
									void editor.clipforge.applyPolishProfile({ profileId: profile.id });
								}}
								className={cn(
									"hover:bg-accent/60 flex flex-col items-start gap-2 rounded-lg border px-4 py-3 text-left transition-colors",
								)}
							>
								<div className="flex w-full items-center justify-between gap-3">
									<div>
										<p className="text-sm font-medium">{profile.label}</p>
										<p className="text-muted-foreground text-xs">
											{getCaptionRevealLabel({ presetId: profile.captionRevealPresetId })} captions · {getAudioPolishPresetLabel({ id: profile.audioPolishPresetId })}
										</p>
									</div>
									<span className="text-muted-foreground text-[11px]">
										{getFinishingLookLabel({ lookId: profile.finishingLookId })}
									</span>
								</div>
								<div className="bg-muted w-full rounded-md border px-4 py-3 text-xs text-muted-foreground">
									<div>Caption style: {profile.captionStyleId}</div>
									<div>Overlay style: {profile.overlayStyleVariantId}</div>
									<div>Motion: {profile.motionPresetId}</div>
								</div>
							</button>
						))}
					</div>
				) : null}

				{graphicsTab === "text" ? (
					<div className="space-y-3 px-1">
						<p className="text-muted-foreground text-xs">
							Insert a plain text layer when you do not want a preset.
						</p>
						<Button onClick={insertRawText}>Insert text</Button>
					</div>
				) : null}

				{graphicsTab === "overlays" ? (
					<div className="grid gap-3 px-1 pb-2">
						{SOCIAL_OVERLAY_PRESETS.map((preset) => (
							<button
								key={preset.id}
								type="button"
								onClick={() => insertOverlay({ presetId: preset.id })}
								className={cn(
									"hover:bg-accent/60 flex flex-col items-start gap-2 rounded-lg border px-4 py-3 text-left transition-colors",
								)}
							>
								<div className="flex w-full items-center justify-between gap-3">
									<div>
										<p className="text-sm font-medium">{preset.label}</p>
										<p className="text-muted-foreground text-xs">{preset.description}</p>
									</div>
									<span className="text-muted-foreground text-[11px]">
										{preset.defaultDuration.toFixed(1)}s
									</span>
								</div>
								<div className="bg-muted h-18 w-full rounded-md border px-4 py-3">
									<div className="text-sm font-semibold">{OVERLAY_CARD_LABELS[preset.id].title}</div>
									<div className="text-muted-foreground mt-1 text-xs">
										{OVERLAY_CARD_LABELS[preset.id].subtitle}
									</div>
								</div>
							</button>
						))}
					</div>
				) : null}

				{graphicsTab !== "brand" && graphicsTab !== "text" && graphicsTab !== "overlays" ? (
					<div className="grid gap-3 px-1 pb-2">
						{groupedPresets.map((preset) => (
							<button
								key={preset.id}
								type="button"
								onClick={() => insertPreset({ presetId: preset.id })}
								className={cn(
									"hover:bg-accent/60 flex flex-col items-start gap-2 rounded-lg border px-4 py-3 text-left transition-colors",
								)}
							>
								<div className="flex w-full items-center justify-between gap-3">
									<div>
										<p className="text-sm font-medium">{preset.label}</p>
										<p className="text-muted-foreground text-xs">{preset.description}</p>
									</div>
									<span className="text-muted-foreground text-[11px]">
										{preset.defaultDuration.toFixed(1)}s
									</span>
								</div>
								<div className="bg-muted h-18 w-full rounded-md border px-4 py-3">
									<div className="text-sm font-semibold">
										{preset.kind === "lower-third"
											? "Name Surname"
											: preset.kind === "cta"
												? "Call to action"
												: preset.kind === "quote"
													? '"Quote"'
													: "Main title"}
									</div>
									<div className="text-muted-foreground mt-1 text-xs">
										{preset.kind === "lower-third"
											? "Role or description"
											: preset.kind === "title"
												? "Add a short supporting line"
												: preset.kind === "quote"
													? "Centered pull quote"
													: "Branded social prompt"}
									</div>
								</div>
							</button>
						))}
					</div>
				) : null}
			</div>
		</PanelView>
	);
}

function BrandField({
	label,
	children,
}: {
	label: string;
	children: React.ReactNode;
}) {
	return (
		<div className="space-y-2">
			<p className="text-xs font-medium">{label}</p>
			{children}
		</div>
	);
}
