import type { ClipMediaMetadata } from "@/types/clipforge";

export interface ClipForgeDemoAssetSpec {
	id: string;
	fileName: string;
	mediaType: "video";
	displayName: string;
	metadata: ClipMediaMetadata;
	usedFor: "primary" | "broll";
}

export interface ClipForgeDemoManifest {
	version: 1;
	projectName: string;
	defaultCaptionStyle: "bold-center";
	assets: ClipForgeDemoAssetSpec[];
	samplePrompts: string[];
}

const DEMO_INDEXED_AT = "2026-03-03T00:00:00.000Z";

function buildMetadata({
	words,
	segments,
	silenceRegions,
}: Pick<ClipMediaMetadata, "words" | "segments" | "silenceRegions">): ClipMediaMetadata {
	return {
		words,
		segments,
		silenceRegions,
		transcriptionStatus: "ready",
		transcriptionProvider: "srt-import",
		transcriptionLanguage: "en",
		transcriptionError: null,
		indexedAt: DEMO_INDEXED_AT,
	};
}

export const CLIPFORGE_DEMO_MANIFEST: ClipForgeDemoManifest = {
	version: 1,
	projectName: "ClipForge Demo",
	defaultCaptionStyle: "bold-center",
	assets: [
		{
			id: "clip-1",
			fileName: "clip-1.mp4",
			mediaType: "video",
			displayName: "clip-1.mp4",
			usedFor: "primary",
			metadata: buildMetadata({
				words: [
					{ text: "hey", start_ms: 0, end_ms: 260 },
					{ text: "welcome", start_ms: 260, end_ms: 700 },
					{ text: "to", start_ms: 700, end_ms: 860 },
					{ text: "clipforge", start_ms: 860, end_ms: 1400 },
				],
				segments: [
					{
						text: "hey welcome to clipforge",
						start_ms: 0,
						end_ms: 1400,
					},
				],
				silenceRegions: [{ start_ms: 1500, end_ms: 2100 }],
			}),
		},
		{
			id: "clip-2",
			fileName: "clip-2.mp4",
			mediaType: "video",
			displayName: "clip-2.mp4",
			usedFor: "primary",
			metadata: buildMetadata({
				words: [
					{ text: "this", start_ms: 0, end_ms: 220 },
					{ text: "demo", start_ms: 220, end_ms: 520 },
					{ text: "shows", start_ms: 520, end_ms: 860 },
					{ text: "smart", start_ms: 860, end_ms: 1140 },
					{ text: "jump", start_ms: 1140, end_ms: 1380 },
					{ text: "cuts", start_ms: 1380, end_ms: 1660 },
				],
				segments: [
					{
						text: "this demo shows smart jump cuts",
						start_ms: 0,
						end_ms: 1660,
					},
				],
				silenceRegions: [{ start_ms: 1720, end_ms: 2240 }],
			}),
		},
		{
			id: "clip-3",
			fileName: "clip-3.mp4",
			mediaType: "video",
			displayName: "clip-3.mp4",
			usedFor: "primary",
			metadata: buildMetadata({
				words: [
					{ text: "use", start_ms: 0, end_ms: 220 },
					{ text: "chat", start_ms: 220, end_ms: 520 },
					{ text: "to", start_ms: 520, end_ms: 640 },
					{ text: "make", start_ms: 640, end_ms: 940 },
					{ text: "it", start_ms: 940, end_ms: 1080 },
					{ text: "faster", start_ms: 1080, end_ms: 1600 },
				],
				segments: [
					{
						text: "use chat to make it faster",
						start_ms: 0,
						end_ms: 1600,
					},
				],
				silenceRegions: [{ start_ms: 1680, end_ms: 2200 }],
			}),
		},
		{
			id: "broll-1",
			fileName: "broll-1.mp4",
			mediaType: "video",
			displayName: "broll-1.mp4",
			usedFor: "broll",
			metadata: buildMetadata({
				words: [],
				segments: [],
				silenceRegions: [],
			}),
		},
	],
	samplePrompts: [
		"make it faster",
		'add text at the top that says "watch this"',
		'add b-roll using broll-1.mp4 when I say "clipforge" for 2s',
	],
};
