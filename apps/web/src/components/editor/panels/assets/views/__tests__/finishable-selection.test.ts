import { describe, expect, test } from "bun:test";
import { resolveSelectedFinishableTarget } from "@/components/editor/panels/assets/views/finishable-selection";

describe("resolveSelectedFinishableTarget", () => {
	test("resolves a single selected visual clip", () => {
		const target = resolveSelectedFinishableTarget({
			editor: buildEditorMock({
				selectedElements: [{ trackId: "video-track", elementId: "video-1" }],
				tracks: [
					{
						id: "video-track",
						type: "video",
						elements: [{ id: "video-1", type: "video", name: "clip.mp4" }],
					},
				],
			}),
		});

		expect(target?.track.id).toBe("video-track");
		expect(target?.element.id).toBe("video-1");
	});

	test("resolves the visual side of a linked video plus audio selection", () => {
		const target = resolveSelectedFinishableTarget({
			editor: buildEditorMock({
				selectedElements: [
					{ trackId: "video-track", elementId: "video-1" },
					{ trackId: "audio-track", elementId: "audio-1" },
				],
				tracks: [
					{
						id: "video-track",
						type: "video",
						elements: [{ id: "video-1", type: "video", name: "clip.mp4" }],
					},
					{
						id: "audio-track",
						type: "audio",
						elements: [{ id: "audio-1", type: "audio", name: "clip-audio" }],
					},
				],
			}),
		});

		expect(target?.track.id).toBe("video-track");
		expect(target?.element.id).toBe("video-1");
	});

	test("returns null when multiple visual clips are selected", () => {
		const target = resolveSelectedFinishableTarget({
			editor: buildEditorMock({
				selectedElements: [
					{ trackId: "video-track", elementId: "video-1" },
					{ trackId: "video-track", elementId: "image-1" },
				],
				tracks: [
					{
						id: "video-track",
						type: "video",
						elements: [
							{ id: "video-1", type: "video", name: "clip.mp4" },
							{ id: "image-1", type: "image", name: "still.png" },
						],
					},
				],
			}),
		});

		expect(target).toBeNull();
	});
});

function buildEditorMock({
	selectedElements,
	tracks,
}: {
	selectedElements: Array<{ trackId: string; elementId: string }>;
	tracks: Array<{ id: string; type: string; elements: Array<{ id: string; type: string; name: string }> }>;
}) {
	return {
		selection: {
			getSelectedElements: () => selectedElements,
		},
		timeline: {
			getTrackById: ({ trackId }: { trackId: string }) =>
				tracks.find((track) => track.id === trackId) ?? null,
		},
	} as never;
}
