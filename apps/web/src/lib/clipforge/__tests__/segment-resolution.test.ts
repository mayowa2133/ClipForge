import { describe, expect, test } from "bun:test";
import { buildProjectSegmentSummaryFixture } from "@/lib/clipforge/__tests__/fixtures";
import {
	findAddressableSegments,
	findCaptionReferenceCandidates,
	findSegmentReferenceCandidates,
	resolveCaptionReference,
	resolveSegmentReference,
} from "@/lib/clipforge";

function buildSummary() {
	return {
		segments: [
			buildProjectSegmentSummaryFixture({
				segment_id: "seg-1",
				element_name: "Clip 1",
				start_ms: 0,
				end_ms: 2000,
				asset_id: "clip-1",
				transcript_snippet: "hello bro",
			}),
			buildProjectSegmentSummaryFixture({
				segment_id: "seg-2",
				element_name: "Clip 2",
				start_ms: 2000,
				end_ms: 4000,
				ordinal: 2,
				asset_id: "clip-2",
				transcript_snippet: "summer vibes",
			}),
			buildProjectSegmentSummaryFixture({
				segment_id: "caption-1",
				track_id: "track-text",
				track_type: "text",
				segment_kind: "caption" as const,
				element_name: "Caption 1",
				start_ms: 500,
				end_ms: 1200,
				ordinal: 1,
				asset_id: null,
				text_content: "hello there",
				transcript_snippet: "hello there",
			}),
			buildProjectSegmentSummaryFixture({
				segment_id: "caption-2",
				track_id: "track-text",
				track_type: "text",
				segment_kind: "caption" as const,
				element_name: "Caption 2",
				start_ms: 2500,
				end_ms: 3200,
				ordinal: 2,
				asset_id: null,
				text_content: "hello again",
				transcript_snippet: "hello again",
			}),
		],
		timeline_words: [
			{ text: "hello", start_ms: 0, end_ms: 200, segment_id: "seg-1", media_id: "clip-1" },
			{ text: "bro", start_ms: 200, end_ms: 500, segment_id: "seg-1", media_id: "clip-1" },
			{ text: "summer", start_ms: 2200, end_ms: 2500, segment_id: "seg-2", media_id: "clip-2" },
			{ text: "bro", start_ms: 2500, end_ms: 2700, segment_id: "seg-2", media_id: "clip-2" },
		],
	};
}

describe("segment resolution", () => {
	test("resolves ordinal clip references", () => {
		const summary = buildSummary();

		expect(
			findAddressableSegments({ projectSummary: summary, target: "clip" }).map(
				(segment) => segment.segment_id,
			),
		).toEqual(["seg-1", "seg-2"]);
		expect(
			resolveSegmentReference({
				projectSummary: summary,
				reference: { target: "clip", occurrence: 1 },
			})?.segment_id,
		).toBe("seg-1");
		expect(
			resolveSegmentReference({
				projectSummary: summary,
				reference: { target: "clip", occurrence: 2 },
			})?.segment_id,
		).toBe("seg-2");
		expect(
			resolveSegmentReference({
				projectSummary: summary,
				reference: { target: "clip", useLast: true },
			})?.segment_id,
		).toBe("seg-2");
	});

	test("resolves phrase-anchored clip references", () => {
		const summary = buildSummary();

		expect(
			findSegmentReferenceCandidates({
				projectSummary: summary,
				reference: { target: "clip", phrase: "bro" },
			}).map((segment) => segment.segment_id),
		).toEqual(["seg-1", "seg-2"]);
		expect(
			resolveSegmentReference({
				projectSummary: summary,
				reference: { target: "clip", phrase: "bro", occurrence: 1 },
			})?.segment_id,
		).toBe("seg-1");
		expect(
			resolveSegmentReference({
				projectSummary: summary,
				reference: { target: "clip", phrase: "bro" },
			}),
		).toBeNull();
	});

	test("resolves caption references by content", () => {
		const summary = buildSummary();

		expect(
			findCaptionReferenceCandidates({
				projectSummary: summary,
				reference: { target: "caption", content: "hello" },
			}).map((segment) => segment.segment_id),
		).toEqual(["caption-1", "caption-2"]);
		expect(
			resolveCaptionReference({
				projectSummary: summary,
				reference: { target: "caption", content: "hello" },
			}),
		).toBeNull();
		expect(
			resolveCaptionReference({
				projectSummary: summary,
				reference: { target: "caption", content: "hello", occurrence: 2 },
			})?.segment_id,
		).toBe("caption-2");
		expect(
			resolveCaptionReference({
				projectSummary: summary,
				reference: { target: "caption", content: "missing" },
			}),
		).toBeNull();
	});
});
