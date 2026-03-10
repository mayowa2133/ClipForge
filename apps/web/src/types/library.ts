export type ContentPackKind = "font" | "music" | "sfx" | "sticker" | "preset";

export type LibraryMusicMood =
	| "clean"
	| "luxury"
	| "upbeat"
	| "energetic"
	| "minimal";

export interface LibraryItem {
	id: string;
	label: string;
	tags: string[];
	previewUrl?: string;
	licenseNotice?: string;
}

export interface FontLibraryItem extends LibraryItem {
	kind: "font";
	family: string;
	role: "title" | "body" | "luxury" | "bold-social";
	license: string;
	source: string;
}

export interface AudioLibraryItem extends LibraryItem {
	kind: "music" | "sfx";
	url: string;
	duration: number;
	mood?: LibraryMusicMood;
	bpm?: number | null;
	usageKind: "music" | "sfx";
	license: string;
	source: string;
}

export interface StickerLibraryItem extends LibraryItem {
	kind: "sticker";
	url: string;
	category: "cta" | "decor" | "shape" | "icon";
	license: string;
	source: string;
}

export interface PresetLibraryItem extends LibraryItem {
	kind: "preset";
	category:
		| "caption-style"
		| "graphics"
		| "overlay"
		| "motion"
		| "transition"
		| "scene-recipe"
		| "project-kit"
		| "mix";
	presetId: string;
	license: string;
	source: string;
}

export type ContentPackItem =
	| FontLibraryItem
	| AudioLibraryItem
	| StickerLibraryItem
	| PresetLibraryItem;

export interface ContentPackManifest {
	id: string;
	name: string;
	kind: ContentPackKind;
	license: string;
	version: 1;
	items: ContentPackItem[];
}
