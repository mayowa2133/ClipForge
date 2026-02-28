import { describe, expect, test } from "bun:test";
import { HeuristicChatOpsProvider } from "@/lib/clipforge";

describe("HeuristicChatOpsProvider", () => {
	test("returns deterministic ops for common edit intents", async () => {
		const provider = new HeuristicChatOpsProvider();
		const ops = await provider.proposeEdits({
			userText: "make it faster and remove more pauses and use bold center captions",
			projectSummary: {
				total_duration_s: 48,
				caption_style_id: "clean-bottom",
				pause_stats: { region_count: 4, total_pause_ms: 3200 },
				segments: [],
				media_assets: [],
			},
		});

		expect(ops.map((op) => op.type)).toEqual([
			"REMOVE_SILENCE",
			"MAKE_VERSION",
			"SET_CAPTION_STYLE",
		]);
	});

	test("creates CUT_RANGE when a quoted term is found in segment snippets", async () => {
		const provider = new HeuristicChatOpsProvider();
		const ops = await provider.proposeEdits({
			userText: "cut where i say 'bro'",
			projectSummary: {
				total_duration_s: 50,
				caption_style_id: "clean-bottom",
				pause_stats: { region_count: 0, total_pause_ms: 0 },
				segments: [
					{
						segment_id: "s1",
						track_type: "text",
						start_ms: 4000,
						end_ms: 4700,
						transcript_snippet: "hey bro welcome back",
					},
				],
				media_assets: [],
			},
		});

		expect(ops).toHaveLength(1);
		expect(ops[0]?.type).toBe("CUT_RANGE");
	});

	test("creates INSERT_BROLL when a named asset and timing are provided", async () => {
		const provider = new HeuristicChatOpsProvider();
		const ops = await provider.proposeEdits({
			userText: "add b-roll using beach.mp4 from 5s to 8s",
			projectSummary: {
				total_duration_s: 50,
				caption_style_id: "clean-bottom",
				pause_stats: { region_count: 0, total_pause_ms: 0 },
				segments: [],
				media_assets: [
					{
						asset_id: "beach-1",
						name: "beach.mp4",
						type: "video",
					},
				],
			},
		});

		expect(ops).toHaveLength(1);
		expect(ops[0]).toEqual({
			type: "INSERT_BROLL",
			media_id: "beach-1",
			start_ms: 5000,
			end_ms: 8000,
			lane: "overlay-primary",
			fit_mode: "cover",
			mute: true,
		});
	});

	test("returns no B-roll op without strict asset + timing syntax", async () => {
		const provider = new HeuristicChatOpsProvider();
		const missingTiming = await provider.proposeEdits({
			userText: "add b-roll using beach.mp4",
			projectSummary: {
				total_duration_s: 50,
				caption_style_id: "clean-bottom",
				pause_stats: { region_count: 0, total_pause_ms: 0 },
				segments: [],
				media_assets: [{ asset_id: "beach-1", name: "beach.mp4", type: "video" }],
			},
		});
		const missingAsset = await provider.proposeEdits({
			userText: "add b-roll using missing.mp4 from 5s to 8s",
			projectSummary: {
				total_duration_s: 50,
				caption_style_id: "clean-bottom",
				pause_stats: { region_count: 0, total_pause_ms: 0 },
				segments: [],
				media_assets: [{ asset_id: "beach-1", name: "beach.mp4", type: "video" }],
			},
		});

		expect(missingTiming).toEqual([]);
		expect(missingAsset).toEqual([]);
	});
});
