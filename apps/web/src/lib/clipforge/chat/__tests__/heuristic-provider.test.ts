import { describe, expect, test } from "bun:test";
import { HeuristicChatOpsProvider } from "@/lib/clipforge";

function buildSummary() {
	return {
		total_duration_s: 50,
		caption_style_id: "clean-bottom",
		pause_stats: { region_count: 0, total_pause_ms: 0 },
		segments: [
			{
				segment_id: "seg-1",
				track_type: "video",
				start_ms: 1000,
				end_ms: 3000,
				transcript_snippet: "hey bro welcome back summer vibes",
			},
		],
		media_assets: [
			{
				asset_id: "beach-1",
				name: "beach.mp4",
				type: "video" as const,
			},
		],
		timeline_words: [
			{ text: "hey", start_ms: 1000, end_ms: 1200, segment_id: "seg-1" },
			{ text: "bro", start_ms: 1200, end_ms: 1450, segment_id: "seg-1" },
			{ text: "welcome", start_ms: 1450, end_ms: 1900, segment_id: "seg-1" },
			{ text: "back", start_ms: 1900, end_ms: 2200, segment_id: "seg-1" },
			{ text: "summer", start_ms: 2200, end_ms: 2600, segment_id: "seg-1" },
			{ text: "vibes", start_ms: 2600, end_ms: 3000, segment_id: "seg-1" },
		],
	};
}

describe("HeuristicChatOpsProvider", () => {
	test("returns deterministic ops for common edit intents", async () => {
		const provider = new HeuristicChatOpsProvider();
		const ops = await provider.proposeEdits({
			userText: "make it faster and remove more pauses and use bold center captions",
			projectSummary: buildSummary(),
		});

		expect(ops.map((op) => op.type)).toEqual([
			"REMOVE_SILENCE",
			"MAKE_VERSION",
			"SET_CAPTION_STYLE",
		]);
	});

	test("creates ADD_TEXT_OVERLAY for overlay prompts", async () => {
		const provider = new HeuristicChatOpsProvider();
		const ops = await provider.proposeEdits({
			userText: 'add text at the top that says "this"',
			projectSummary: buildSummary(),
		});

		expect(ops).toEqual([
			{
				type: "ADD_TEXT_OVERLAY",
				text: "this",
				start_ms: 0,
				end_ms: 2500,
				position: "top",
				style_id: "overlay-top",
				font: "Arial",
				size: 64,
				color: "#FFFFFF",
				outline: true,
				background: false,
			},
		]);
	});

	test("creates precise CUT_RANGE from phrase matches", async () => {
		const provider = new HeuristicChatOpsProvider();
		const ops = await provider.proposeEdits({
			userText: "cut where i say 'bro'",
			projectSummary: buildSummary(),
		});

		expect(ops).toEqual([
			{
				type: "CUT_RANGE",
				start_ms: 1080,
				end_ms: 1570,
			},
		]);
	});

	test("creates INSERT_BROLL when a named asset and timing are provided", async () => {
		const provider = new HeuristicChatOpsProvider();
		const ops = await provider.proposeEdits({
			userText: "add b-roll using beach.mp4 from 5s to 8s",
			projectSummary: buildSummary(),
		});

		expect(ops).toEqual([
			{
				type: "INSERT_BROLL",
				media_id: "beach-1",
				start_ms: 5000,
				end_ms: 8000,
				lane: "overlay-primary",
				fit_mode: "cover",
				mute: true,
			},
		]);
	});

	test("creates phrase-anchored INSERT_BROLL from transcript timing", async () => {
		const provider = new HeuristicChatOpsProvider();
		const ops = await provider.proposeEdits({
			userText: 'add b-roll using beach.mp4 when i say "summer" for 3s',
			projectSummary: buildSummary(),
		});

		expect(ops).toEqual([
			{
				type: "INSERT_BROLL",
				media_id: "beach-1",
				start_ms: 2200,
				end_ms: 5200,
				lane: "overlay-primary",
				fit_mode: "cover",
				mute: true,
			},
		]);
	});

	test("returns no B-roll op without required asset or quoted phrase syntax", async () => {
		const provider = new HeuristicChatOpsProvider();
		const missingTiming = await provider.proposeEdits({
			userText: "add b-roll using beach.mp4",
			projectSummary: buildSummary(),
		});
		const missingAsset = await provider.proposeEdits({
			userText: 'add b-roll using missing.mp4 when i say "summer" for 3s',
			projectSummary: buildSummary(),
		});
		const missingQuote = await provider.proposeEdits({
			userText: "cut where i say bro",
			projectSummary: buildSummary(),
		});

		expect(missingTiming).toEqual([]);
		expect(missingAsset).toEqual([]);
		expect(missingQuote).toEqual([]);
	});
});
