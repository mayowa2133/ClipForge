import { OcDataBuddyIcon, OcMarbleIcon } from "@opencut/ui/icons";

export const SITE_URL =
	process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://clipforge.app";

export const SITE_INFO = {
	title: "ClipForge",
	description:
		"AI-native video editing with a familiar timeline, fast finishing tools, and local-first control.",
	url: SITE_URL,
	openGraphImage: "/open-graph/default.jpg",
	twitterImage: "/open-graph/default.jpg",
	favicon: "/favicon.ico",
};

export type ExternalTool = {
	name: string;
	description: string;
	url: string;
	icon: React.ElementType;
};

export const EXTERNAL_TOOLS: ExternalTool[] = [
	{
		name: "Marble",
		description:
			"Modern headless CMS for content management and the blog for ClipForge",
		url: "https://marblecms.com?utm_source=clipforge",
		icon: OcMarbleIcon,
	},
	{
		name: "Databuddy",
		description: "GDPR compliant analytics and user insights for ClipForge",
		url: "https://databuddy.cc?utm_source=clipforge",
		icon: OcDataBuddyIcon,
	},
];

export const DEFAULT_LOGO_URL = "/logos/opencut/svg/logo.svg";

export const SOCIAL_LINKS = {
	x: "https://x.com/clipforgeapp",
	github: "https://github.com/mayowa2133/ClipForge",
	discord: "https://discord.com/invite/Mu3acKZvCp",
};

export type Sponsor = {
	name: string;
	url: string;
	logo: string;
	description: string;
};

export const SPONSORS: Sponsor[] = [
	{
		name: "Fal.ai",
		url: "https://fal.ai?utm_source=clipforge",
		logo: "/logos/others/fal.svg",
		description: "Generative image, video, and audio models all in one place.",
	},
	{
		name: "Vercel",
		url: "https://vercel.com?utm_source=clipforge",
		logo: "/logos/others/vercel.svg",
		description: "Platform where we deploy and host ClipForge.",
	},
];
