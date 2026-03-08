import { describe, expect, test } from "bun:test";
import { getLinkedSelectionLabel } from "@/components/editor/panels/properties";

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
});
