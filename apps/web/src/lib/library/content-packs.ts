import type {
	AudioLibraryItem,
	ContentPackManifest,
	FontLibraryItem,
	LibraryMusicMood,
	PresetLibraryItem,
	StickerLibraryItem,
} from "@/types/library";

const LICENSE_CC0 = "CC0-1.0";
const LICENSE_SELF = "ClipForge Starter Pack License";
const LICENSE_OFL = "SIL OFL / Google Fonts";

export const BUNDLED_FONTS: FontLibraryItem[] = [
	{
		id: "font-archivo-black",
		kind: "font",
		label: "Archivo Black",
		family: "Archivo Black",
		role: "title",
		tags: ["clean", "display", "headline"],
		license: LICENSE_OFL,
		source: "Google Fonts",
		licenseNotice: "Free open-source font loaded from the bundled atlas and Google Fonts runtime stylesheet.",
	},
	{
		id: "font-archivo",
		kind: "font",
		label: "Archivo",
		family: "Archivo",
		role: "body",
		tags: ["clean", "body", "vlog"],
		license: LICENSE_OFL,
		source: "Google Fonts",
	},
	{
		id: "font-dm-sans",
		kind: "font",
		label: "DM Sans",
		family: "DM Sans",
		role: "body",
		tags: ["clean", "minimal", "body"],
		license: LICENSE_OFL,
		source: "Google Fonts",
	},
	{
		id: "font-poppins",
		kind: "font",
		label: "Poppins",
		family: "Poppins",
		role: "bold-social",
		tags: ["bold", "social", "cta"],
		license: LICENSE_OFL,
		source: "Google Fonts",
	},
	{
		id: "font-anton",
		kind: "font",
		label: "Anton",
		family: "Anton",
		role: "bold-social",
		tags: ["bold", "social", "impact"],
		license: LICENSE_OFL,
		source: "Google Fonts",
	},
	{
		id: "font-bebas-neue",
		kind: "font",
		label: "Bebas Neue",
		family: "Bebas Neue",
		role: "title",
		tags: ["display", "clean", "title"],
		license: LICENSE_OFL,
		source: "Google Fonts",
	},
	{
		id: "font-playfair-display",
		kind: "font",
		label: "Playfair Display",
		family: "Playfair Display",
		role: "luxury",
		tags: ["luxury", "editorial", "serif"],
		license: LICENSE_OFL,
		source: "Google Fonts",
	},
	{
		id: "font-cormorant-garamond",
		kind: "font",
		label: "Cormorant Garamond",
		family: "Cormorant Garamond",
		role: "luxury",
		tags: ["luxury", "serif", "editorial"],
		license: LICENSE_OFL,
		source: "Google Fonts",
	},
];

function musicItem({
	id,
	label,
	mood,
	bpm,
	duration,
	tags,
}: {
	id: string;
	label: string;
	mood: LibraryMusicMood;
	bpm: number;
	duration: number;
	tags: string[];
}): AudioLibraryItem {
	return {
		id,
		kind: "music",
		label,
		url: `/library/audio/music/${id}.wav`,
		previewUrl: `/library/audio/music/${id}.wav`,
		duration,
		mood,
		bpm,
		usageKind: "music",
		tags,
		license: LICENSE_SELF,
		source: "ClipForge starter audio pack",
		licenseNotice: "Bundled starter loop generated for ClipForge and free to use inside the app.",
	};
}

function sfxItem({
	id,
	label,
	duration,
	tags,
}: {
	id: string;
	label: string;
	duration: number;
	tags: string[];
}): AudioLibraryItem {
	return {
		id,
		kind: "sfx",
		label,
		url: `/library/audio/sfx/${id}.wav`,
		previewUrl: `/library/audio/sfx/${id}.wav`,
		duration,
		usageKind: "sfx",
		tags,
		license: LICENSE_SELF,
		source: "ClipForge starter audio pack",
		licenseNotice: "Bundled starter SFX generated for ClipForge and free to use inside the app.",
	};
}

export const BUNDLED_MUSIC: AudioLibraryItem[] = [
	musicItem({ id: "clean-cruise", label: "Clean Cruise", mood: "clean", bpm: 96, duration: 6, tags: ["clean", "vlog", "cruise"] }),
	musicItem({ id: "luxury-drift", label: "Luxury Drift", mood: "luxury", bpm: 88, duration: 7, tags: ["luxury", "editorial", "drift"] }),
	musicItem({ id: "upbeat-spark", label: "Upbeat Spark", mood: "upbeat", bpm: 124, duration: 5, tags: ["upbeat", "montage", "spark"] }),
	musicItem({ id: "energetic-bounce", label: "Energetic Bounce", mood: "energetic", bpm: 132, duration: 5.5, tags: ["energetic", "bounce", "short-form"] }),
	musicItem({ id: "minimal-glow", label: "Minimal Glow", mood: "minimal", bpm: 100, duration: 6.5, tags: ["minimal", "clean", "bed"] }),
	musicItem({ id: "bold-pulse", label: "Bold Pulse", mood: "energetic", bpm: 116, duration: 5.25, tags: ["bold", "pulse", "social"] }),
	musicItem({ id: "vlog-daylight", label: "Vlog Daylight", mood: "clean", bpm: 108, duration: 6.2, tags: ["vlog", "daylight", "clean"] }),
	musicItem({ id: "talking-head-bed", label: "Talking Head Bed", mood: "minimal", bpm: 92, duration: 6.8, tags: ["talking-head", "minimal", "bed"] }),
];

export const BUNDLED_SFX: AudioLibraryItem[] = [
	sfxItem({ id: "whoosh-soft", label: "Whoosh Soft", duration: 0.45, tags: ["whoosh", "transition"] }),
	sfxItem({ id: "whoosh-fast", label: "Whoosh Fast", duration: 0.25, tags: ["whoosh", "transition"] }),
	sfxItem({ id: "riser-light", label: "Riser Light", duration: 0.7, tags: ["riser", "build"] }),
	sfxItem({ id: "hit-soft", label: "Hit Soft", duration: 0.18, tags: ["hit", "accent"] }),
	sfxItem({ id: "hit-hard", label: "Hit Hard", duration: 0.12, tags: ["hit", "accent"] }),
	sfxItem({ id: "pop-clean", label: "Pop Clean", duration: 0.1, tags: ["pop", "ui"] }),
	sfxItem({ id: "pop-bright", label: "Pop Bright", duration: 0.08, tags: ["pop", "ui"] }),
	sfxItem({ id: "click-ui", label: "Click UI", duration: 0.06, tags: ["click", "ui"] }),
	sfxItem({ id: "click-soft", label: "Click Soft", duration: 0.07, tags: ["click", "ui"] }),
	sfxItem({ id: "swipe-up", label: "Swipe Up", duration: 0.22, tags: ["swipe", "transition"] }),
	sfxItem({ id: "swipe-down", label: "Swipe Down", duration: 0.22, tags: ["swipe", "transition"] }),
	sfxItem({ id: "sparkle", label: "Sparkle", duration: 0.35, tags: ["sparkle", "accent"] }),
	sfxItem({ id: "accent-rise", label: "Accent Rise", duration: 0.5, tags: ["accent", "riser"] }),
	sfxItem({ id: "accent-drop", label: "Accent Drop", duration: 0.4, tags: ["accent", "drop"] }),
	sfxItem({ id: "tag-appear", label: "Tag Appear", duration: 0.14, tags: ["tag", "ui"] }),
	sfxItem({ id: "marker-check", label: "Marker Check", duration: 0.12, tags: ["check", "ui"] }),
	sfxItem({ id: "transition-air", label: "Transition Air", duration: 0.3, tags: ["transition", "whoosh"] }),
	sfxItem({ id: "tap-glass", label: "Tap Glass", duration: 0.09, tags: ["tap", "ui"] }),
	sfxItem({ id: "thump-low", label: "Thump Low", duration: 0.16, tags: ["thump", "accent"] }),
	sfxItem({ id: "success-soft", label: "Success Soft", duration: 0.24, tags: ["success", "ui"] }),
];

export const BUNDLED_STICKERS: StickerLibraryItem[] = [
	{ id: "builtin:arrow-up", kind: "sticker", label: "Arrow Up", url: "/library/stickers/arrow-up.svg", previewUrl: "/library/stickers/arrow-up.svg", category: "cta", tags: ["arrow", "cta"], license: LICENSE_CC0, source: "ClipForge starter sticker pack" },
	{ id: "builtin:arrow-right", kind: "sticker", label: "Arrow Right", url: "/library/stickers/arrow-right.svg", previewUrl: "/library/stickers/arrow-right.svg", category: "cta", tags: ["arrow", "cta"], license: LICENSE_CC0, source: "ClipForge starter sticker pack" },
	{ id: "builtin:check-badge", kind: "sticker", label: "Check Badge", url: "/library/stickers/check-badge.svg", previewUrl: "/library/stickers/check-badge.svg", category: "icon", tags: ["check", "badge"], license: LICENSE_CC0, source: "ClipForge starter sticker pack" },
	{ id: "builtin:spark-star", kind: "sticker", label: "Spark Star", url: "/library/stickers/spark-star.svg", previewUrl: "/library/stickers/spark-star.svg", category: "decor", tags: ["spark", "star"], license: LICENSE_CC0, source: "ClipForge starter sticker pack" },
	{ id: "builtin:circle-outline", kind: "sticker", label: "Circle Outline", url: "/library/stickers/circle-outline.svg", previewUrl: "/library/stickers/circle-outline.svg", category: "shape", tags: ["circle", "shape"], license: LICENSE_CC0, source: "ClipForge starter sticker pack" },
	{ id: "builtin:highlight-swoosh", kind: "sticker", label: "Highlight Swoosh", url: "/library/stickers/highlight-swoosh.svg", previewUrl: "/library/stickers/highlight-swoosh.svg", category: "decor", tags: ["highlight", "swoosh"], license: LICENSE_CC0, source: "ClipForge starter sticker pack" },
	{ id: "builtin:social-heart", kind: "sticker", label: "Social Heart", url: "/library/stickers/social-heart.svg", previewUrl: "/library/stickers/social-heart.svg", category: "icon", tags: ["heart", "social"], license: LICENSE_CC0, source: "ClipForge starter sticker pack" },
	{ id: "builtin:cta-plus", kind: "sticker", label: "CTA Plus", url: "/library/stickers/cta-plus.svg", previewUrl: "/library/stickers/cta-plus.svg", category: "cta", tags: ["plus", "cta"], license: LICENSE_CC0, source: "ClipForge starter sticker pack" },
	{ id: "builtin:tag-pill", kind: "sticker", label: "Tag Pill", url: "/library/stickers/tag-pill.svg", previewUrl: "/library/stickers/tag-pill.svg", category: "shape", tags: ["tag", "pill"], license: LICENSE_CC0, source: "ClipForge starter sticker pack" },
	{ id: "builtin:comment-bubble", kind: "sticker", label: "Comment Bubble", url: "/library/stickers/comment-bubble.svg", previewUrl: "/library/stickers/comment-bubble.svg", category: "cta", tags: ["comment", "bubble"], license: LICENSE_CC0, source: "ClipForge starter sticker pack" },
];

export const BUNDLED_PRESETS: PresetLibraryItem[] = [
	{ id: "preset-caption-clean-bottom", kind: "preset", label: "Clean Bottom", category: "caption-style", presetId: "clean-bottom", tags: ["caption", "clean"], license: LICENSE_SELF, source: "ClipForge built-in presets" },
	{ id: "preset-caption-bold-center", kind: "preset", label: "Bold Center", category: "caption-style", presetId: "bold-center", tags: ["caption", "bold"], license: LICENSE_SELF, source: "ClipForge built-in presets" },
	{ id: "preset-graphics-title-clean", kind: "preset", label: "Clean Title", category: "graphics", presetId: "title-clean", tags: ["title", "clean"], license: LICENSE_SELF, source: "ClipForge built-in presets" },
	{ id: "preset-graphics-title-bold", kind: "preset", label: "Bold Title", category: "graphics", presetId: "title-bold", tags: ["title", "bold"], license: LICENSE_SELF, source: "ClipForge built-in presets" },
	{ id: "preset-overlay-timestamp", kind: "preset", label: "Timestamp Card", category: "overlay", presetId: "timestamp-card", tags: ["overlay", "timestamp"], license: LICENSE_SELF, source: "ClipForge built-in presets" },
	{ id: "preset-overlay-routine", kind: "preset", label: "Routine Label", category: "overlay", presetId: "routine-label", tags: ["overlay", "routine"], license: LICENSE_SELF, source: "ClipForge built-in presets" },
	{ id: "preset-motion-fade-up", kind: "preset", label: "Fade Up", category: "motion", presetId: "fade-up", tags: ["motion", "clean"], license: LICENSE_SELF, source: "ClipForge built-in presets" },
	{ id: "preset-motion-pop-in", kind: "preset", label: "Pop In", category: "motion", presetId: "pop-in", tags: ["motion", "social"], license: LICENSE_SELF, source: "ClipForge built-in presets" },
	{ id: "preset-transition-cross-dissolve", kind: "preset", label: "Cross Dissolve", category: "transition", presetId: "cross-dissolve", tags: ["transition", "clean"], license: LICENSE_SELF, source: "ClipForge built-in presets" },
	{ id: "preset-scene-intro-title", kind: "preset", label: "Intro Title Recipe", category: "scene-recipe", presetId: "intro-title", tags: ["recipe", "intro"], license: LICENSE_SELF, source: "ClipForge built-in presets" },
	{ id: "preset-kit-clean-vlog", kind: "preset", label: "Clean Vlog Kit", category: "project-kit", presetId: "clean-vlog-kit", tags: ["kit", "vlog"], license: LICENSE_SELF, source: "ClipForge built-in presets" },
	{ id: "preset-mix-clean-vlog", kind: "preset", label: "Clean Vlog Mix", category: "mix", presetId: "clean-vlog", tags: ["mix", "vlog"], license: LICENSE_SELF, source: "ClipForge built-in presets" },
];

export const CREATIVE_LIBRARY_PACKS: ContentPackManifest[] = [
	{ id: "starter-fonts", name: "Starter Fonts", kind: "font", license: LICENSE_OFL, version: 1, items: BUNDLED_FONTS },
	{ id: "starter-music", name: "Starter Music", kind: "music", license: LICENSE_SELF, version: 1, items: BUNDLED_MUSIC },
	{ id: "starter-sfx", name: "Starter Sound Effects", kind: "sfx", license: LICENSE_SELF, version: 1, items: BUNDLED_SFX },
	{ id: "starter-stickers", name: "Starter Stickers", kind: "sticker", license: LICENSE_CC0, version: 1, items: BUNDLED_STICKERS },
	{ id: "starter-presets", name: "Starter Presets", kind: "preset", license: LICENSE_SELF, version: 1, items: BUNDLED_PRESETS },
];

export const BUNDLED_FONT_FAMILIES = BUNDLED_FONTS.map((font) => font.family);

export function getBundledMusicByMood({
	mood,
}: {
	mood: LibraryMusicMood | null | undefined;
}): AudioLibraryItem[] {
	if (!mood) {
		return BUNDLED_MUSIC;
	}
	return BUNDLED_MUSIC.filter((item) => item.mood === mood);
}

export function getBundledAttributionLines(): string[] {
	return CREATIVE_LIBRARY_PACKS.flatMap((pack) =>
		pack.items.map((item) => `${pack.name}: ${item.label} · ${pack.license}`),
	);
}
