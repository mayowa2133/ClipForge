import { describe, expect, test } from "bun:test";
import {
	collapseOverlaySelection,
	getSelectionSummaryLabel,
	getLinkedSelectionLabel,
} from "@/components/editor/panels/properties";

describe("properties linked selection label", () => {
	test("returns video plus audio for one linked group", () => {
		expect(
			getLinkedSelectionLabel({
				elementsWithTracks: [
					{
						track: { id: "video-track", type: "video", name: "Video", elements: [] } as never,
						element: {
							id: "video-1",
							type: "video",
							name: "clip.mp4",
							linkedGroupId: "group-1",
						} as never,
					},
					{
						track: { id: "audio-track", type: "audio", name: "Audio", elements: [] } as never,
						element: {
							id: "audio-1",
							type: "audio",
							name: "clip-audio",
							linkedGroupId: "group-1",
						} as never,
					},
				],
			}),
		).toBe("Video + Audio");
	});

	test("returns null for unrelated multi-selection", () => {
		expect(
			getLinkedSelectionLabel({
				elementsWithTracks: [
					{
						track: { id: "video-track", type: "video", name: "Video", elements: [] } as never,
						element: {
							id: "video-1",
							type: "video",
							name: "clip.mp4",
							linkedGroupId: "group-1",
						} as never,
					},
					{
						track: { id: "audio-track", type: "audio", name: "Audio", elements: [] } as never,
						element: {
							id: "audio-1",
							type: "audio",
							name: "clip-audio",
							linkedGroupId: "group-2",
						} as never,
					},
				],
			}),
		).toBeNull();
	});

	test("collapses a linked overlay text pair into one inspector target", () => {
		const collapsed = collapseOverlaySelection({
			elementsWithTracks: [
				{
					track: { id: "text-track", type: "text", name: "Text", elements: [] } as never,
					element: {
						id: "overlay-1",
						type: "text",
						name: "7:20 am",
						linkedGroupId: "overlay-group",
						overlayMeta: { kind: "timestamp-card", variantId: "clean-vlog", slot: "time" },
					} as never,
				},
				{
					track: { id: "text-track", type: "text", name: "Text", elements: [] } as never,
					element: {
						id: "overlay-2",
						type: "text",
						name: "Get loose",
						linkedGroupId: "overlay-group",
						overlayMeta: { kind: "timestamp-card", variantId: "clean-vlog", slot: "label" },
					} as never,
				},
			],
		});

		expect(collapsed).toHaveLength(1);
		expect(collapsed[0]?.element.id).toBe("overlay-1");
	});

	test("does not collapse unrelated text selection", () => {
		const collapsed = collapseOverlaySelection({
			elementsWithTracks: [
				{
					track: { id: "text-track", type: "text", name: "Text", elements: [] } as never,
					element: {
						id: "text-1",
						type: "text",
						name: "Headline",
						role: "text",
					} as never,
				},
				{
					track: { id: "text-track", type: "text", name: "Text", elements: [] } as never,
					element: {
						id: "text-2",
						type: "text",
						name: "Subtitle",
						role: "text",
					} as never,
				},
			],
		});

		expect(collapsed).toHaveLength(2);
	});

	test("summarizes caption and overlay selection clearly", () => {
		expect(
			getSelectionSummaryLabel({
				elementsWithTracks: [
					{
						track: { id: "text-track", type: "text", name: "Text", elements: [] } as never,
						element: {
							id: "caption-1",
							type: "text",
							role: "caption",
						} as never,
					},
				],
			}),
		).toBe("Caption");

		expect(
			getSelectionSummaryLabel({
				elementsWithTracks: [
					{
						track: { id: "text-track", type: "text", name: "Text", elements: [] } as never,
						element: {
							id: "overlay-1",
							type: "text",
							overlayMeta: { kind: "timestamp-card", variantId: "clean-vlog", slot: "time" },
						} as never,
					},
				],
			}),
		).toBe("Overlay");
	});
});
