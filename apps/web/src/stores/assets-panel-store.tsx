import type { ElementType } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
	ArrowRightDoubleIcon,
	ClosedCaptionIcon,
	Folder03Icon,
	Happy01Icon,
	HeadphonesIcon,
	MagicWand05Icon,
	TextIcon,
	Settings01Icon,
	ColorsIcon,
	Video02Icon,
	SearchList01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { LayoutTemplate } from "lucide-react";

export const TAB_KEYS = [
	"media",
	"stock",
	"sounds",
	"text",
	"stickers",
	"effects",
	"transitions",
	"captions",
	"filters",
	"templates",
	"search",
	"settings",
] as const;

export type Tab = (typeof TAB_KEYS)[number];
export type GraphicsTab = "titles" | "overlays" | "cta" | "polish" | "brand" | "text";
export type TemplatesTab = "components" | "scene-recipes" | "project-kits";

const createHugeiconsIcon =
	({ icon }: { icon: IconSvgElement }) =>
	({ className }: { className?: string }) => (
		<HugeiconsIcon icon={icon} className={className} />
	);

export const tabs = {
	media: {
		icon: createHugeiconsIcon({ icon: Folder03Icon }),
		label: "Media",
	},
	stock: {
		icon: createHugeiconsIcon({ icon: Video02Icon }),
		label: "Stock Video",
	},
	sounds: {
		icon: createHugeiconsIcon({ icon: HeadphonesIcon }),
		label: "Audio",
	},
	text: {
		icon: createHugeiconsIcon({ icon: TextIcon }),
		label: "Text & Graphics",
	},
	stickers: {
		icon: createHugeiconsIcon({ icon: Happy01Icon }),
		label: "Stickers",
	},
	effects: {
		icon: createHugeiconsIcon({ icon: MagicWand05Icon }),
		label: "Effects",
	},
	transitions: {
		icon: createHugeiconsIcon({ icon: ArrowRightDoubleIcon }),
		label: "Transitions",
	},
	captions: {
		icon: createHugeiconsIcon({ icon: ClosedCaptionIcon }),
		label: "Captions",
	},
	filters: {
		icon: createHugeiconsIcon({ icon: ColorsIcon }),
		label: "Filters",
	},
	templates: {
		icon: LayoutTemplate,
		label: "Templates",
	},
	search: {
		icon: createHugeiconsIcon({ icon: SearchList01Icon }),
		label: "Transcript Search",
	},
	settings: {
		icon: createHugeiconsIcon({ icon: Settings01Icon }),
		label: "Settings",
	},
} satisfies Record<
	Tab,
	{ icon: ElementType<{ className?: string }>; label: string }
>;

type MediaViewMode = "grid" | "list";

interface AssetsPanelStore {
	activeTab: Tab;
	setActiveTab: (tab: Tab) => void;
	showTabLabels: boolean;
	toggleTabLabels: () => void;
	graphicsTab: GraphicsTab;
	setGraphicsTab: (tab: GraphicsTab) => void;
	templatesTab: TemplatesTab;
	setTemplatesTab: (tab: TemplatesTab) => void;
	highlightMediaId: string | null;
	requestRevealMedia: (mediaId: string) => void;
	clearHighlight: () => void;

	/* Media */
	mediaViewMode: MediaViewMode;
	setMediaViewMode: (mode: MediaViewMode) => void;
}

export const useAssetsPanelStore = create<AssetsPanelStore>()(
	persist(
		(set) => ({
			activeTab: "media",
			setActiveTab: (tab) => set({ activeTab: tab }),
			showTabLabels: false,
			toggleTabLabels: () =>
				set((state) => ({ showTabLabels: !state.showTabLabels })),
			graphicsTab: "titles",
			setGraphicsTab: (graphicsTab) => set({ activeTab: "text", graphicsTab }),
			templatesTab: "components",
			setTemplatesTab: (templatesTab) =>
				set({ activeTab: "templates", templatesTab }),
			highlightMediaId: null,
			requestRevealMedia: (mediaId) =>
				set({ activeTab: "media", highlightMediaId: mediaId }),
			clearHighlight: () => set({ highlightMediaId: null }),
			mediaViewMode: "grid",
			setMediaViewMode: (mode) => set({ mediaViewMode: mode }),
		}),
		{
			name: "clipforge-assets-panel",
			version: 2,
			partialize: (state) => ({ showTabLabels: state.showTabLabels }),
		},
	),
);
