import { describe, expect, test } from "bun:test";
import {
	buildBlackVideoFfmpegInvocation,
	buildDrawtextFilter,
	buildFfmpegPlan,
	buildVideoConcatFfmpegInvocation,
	buildVideoFilterGraphFfmpegInvocation,
	buildXfadeChainFilter,
} from "@/lib/clipforge/production/worker/ffmpeg-plan";
import { buildRenderGraphInput } from "@/lib/clipforge/production/render-graph";
import {
	FfmpegRenderEngine,
	type FfmpegRunner,
	type FileSystemAdapter,
	type MediaFetcher,
} from "@/lib/clipforge/production/worker/ffmpeg-engine";
import type { TProject } from "@/types/project";
import type {
	ImageElement,
	TScene,
	TextElement,
	TextTrack,
	VideoElement,
	VideoTrack,
} from "@/types/timeline";

function makeProject(overrides: Partial<TProject> = {}): TProject {
	return {
		metadata: {
			id: "proj_test",
			name: "Sample",
			duration: 5,
			createdAt: new Date(),
			updatedAt: new Date(),
		},
		scenes: [],
		currentSceneId: "scene_main",
		settings: {
			fps: 30,
			canvasSize: { width: 1080, height: 1920 },
			background: { type: "color", color: "#000000" },
		},
		version: 1,
		...overrides,
	} as TProject;
}

function makeMainScene({
	elements,
	id = "scene_main",
}: {
	elements: (VideoElement | ImageElement)[];
	id?: string;
}): TScene {
	const track: VideoTrack = {
		id: "track_main",
		name: "Main",
		type: "video",
		isMain: true,
		muted: false,
		hidden: false,
		elements,
	};
	return {
		id,
		name: id,
		isMain: true,
		tracks: [track],
		bookmarks: [],
		createdAt: new Date(),
		updatedAt: new Date(),
	};
}

function makeVideoElement(overrides: Partial<VideoElement>): VideoElement {
	return {
		id: "el_1",
		name: "Clip 1",
		type: "video",
		mediaId: "asset_1",
		duration: 4,
		startTime: 0,
		trimStart: 0,
		trimEnd: 0,
		transform: { scale: 1, position: { x: 0, y: 0 }, rotate: 0 },
		opacity: 1,
		...overrides,
	} as VideoElement;
}

describe("buildFfmpegPlan", () => {
	test("empty project returns black-video plan with project duration", () => {
		const input = buildRenderGraphInput({
			project: makeProject({ metadata: { ...makeProject().metadata, duration: 10 } }),
			format: "mp4",
			quality: "high",
			includeAudio: true,
			publishDestination: "generic-export",
		});
		const plan = buildFfmpegPlan({ input });
		expect(plan.kind).toBe("black-video");
		if (plan.kind !== "black-video") return;
		expect(plan.canvasSize).toEqual({ width: 1080, height: 1920 });
		expect(plan.durationSeconds).toBe(10);
		expect(plan.includeAudio).toBe(true);
	});

	test("single video clip with cloud media key produces a video-concat plan", () => {
		const input = buildRenderGraphInput({
			project: makeProject({
				scenes: [
					makeMainScene({
						elements: [makeVideoElement({ mediaId: "asset_1", duration: 4 })],
					}),
				],
			}),
			format: "mp4",
			quality: "high",
			includeAudio: true,
			publishDestination: "generic-export",
			mediaRefs: [{ mediaId: "asset_1", cloudStorageKey: "key_1" }],
		});
		const plan = buildFfmpegPlan({ input });
		expect(plan.kind).toBe("video-concat");
		if (plan.kind !== "video-concat") return;
		expect(plan.clips).toHaveLength(1);
		expect(plan.clips[0]!.storageKey).toBe("key_1");
		expect(plan.clips[0]!.durationSeconds).toBe(4);
	});

	test("missing cloud media for any clip returns unsupported with explicit reason", () => {
		const input = buildRenderGraphInput({
			project: makeProject({
				scenes: [
					makeMainScene({
						elements: [
							makeVideoElement({ mediaId: "asset_1" }),
							makeVideoElement({ id: "el_2", mediaId: "asset_2", startTime: 4 }),
						],
					}),
				],
			}),
			format: "mp4",
			quality: "high",
			includeAudio: true,
			publishDestination: "generic-export",
			mediaRefs: [{ mediaId: "asset_1", cloudStorageKey: "key_1" }],
		});
		const plan = buildFfmpegPlan({ input });
		expect(plan.kind).toBe("unsupported");
		if (plan.kind !== "unsupported") return;
		expect(plan.reasons.some((r) => r.includes("asset_2"))).toBe(true);
	});

	test("orders clips by startTime", () => {
		const input = buildRenderGraphInput({
			project: makeProject({
				scenes: [
					makeMainScene({
						elements: [
							makeVideoElement({ id: "b", mediaId: "m_b", startTime: 4 }),
							makeVideoElement({ id: "a", mediaId: "m_a", startTime: 0 }),
						],
					}),
				],
			}),
			format: "mp4",
			quality: "high",
			includeAudio: true,
			publishDestination: "generic-export",
			mediaRefs: [
				{ mediaId: "m_a", cloudStorageKey: "key_a" },
				{ mediaId: "m_b", cloudStorageKey: "key_b" },
			],
		});
		const plan = buildFfmpegPlan({ input });
		expect(plan.kind).toBe("video-concat");
		if (plan.kind !== "video-concat") return;
		expect(plan.clips.map((c) => c.mediaId)).toEqual(["m_a", "m_b"]);
	});
});

class FakeFs implements FileSystemAdapter {
	tempDirs: string[] = [];
	writes: Array<{ path: string; contents: string }> = [];
	removed: string[] = [];
	files = new Map<string, Uint8Array>();
	private counter = 0;
	async makeTempDir(prefix: string): Promise<string> {
		const dir = `/tmp/${prefix}${++this.counter}`;
		this.tempDirs.push(dir);
		return dir;
	}
	async writeTextFile(path: string, contents: string): Promise<void> {
		this.writes.push({ path, contents });
	}
	async readBinaryFile(path: string): Promise<Uint8Array> {
		const known = this.files.get(path);
		if (known) return known;
		return new Uint8Array([0x00, 0x01, 0x02, 0x03]);
	}
	async removeDir(path: string): Promise<void> {
		this.removed.push(path);
	}
	join(...parts: string[]): string {
		return parts.join("/").replace(/\/+/g, "/");
	}
}

class FakeRunner implements FfmpegRunner {
	calls: Array<{ args: string[] }> = [];
	throwError: Error | null = null;
	async run({ ffmpegArgs }: { ffmpegArgs: string[] }): Promise<void> {
		this.calls.push({ args: ffmpegArgs });
		if (this.throwError) throw this.throwError;
	}
}

class FakeMediaFetcher implements MediaFetcher {
	calls: Array<{ mediaId: string; storageKey: string | null }> = [];
	async fetchToLocalPath({
		mediaRef,
		mediaIndex,
	}: {
		mediaRef: { mediaId: string; cloudStorageKey: string | null };
		mediaIndex: number;
	}) {
		this.calls.push({
			mediaId: mediaRef.mediaId,
			storageKey: mediaRef.cloudStorageKey,
		});
		return { localPath: `/tmp/clip-${mediaIndex}.bin` };
	}
}

describe("FfmpegRenderEngine", () => {
	test("renders empty project as black video and writes output", async () => {
		const fs = new FakeFs();
		const runner = new FakeRunner();
		const fetcher = new FakeMediaFetcher();
		const engine = new FfmpegRenderEngine({
			ffmpegRunner: runner,
			mediaFetcher: fetcher,
			fs,
		});
		const input = buildRenderGraphInput({
			project: makeProject({ metadata: { ...makeProject().metadata, duration: 6 } }),
			format: "mp4",
			quality: "high",
			includeAudio: true,
			publishDestination: "generic-export",
		});

		const result = await engine.render({
			input,
			onProgress: async () => undefined,
		});

		expect(result.contentType).toBe("video/mp4");
		expect(result.stub).toBe(false);
		expect(runner.calls).toHaveLength(1);
		expect(runner.calls[0]!.args).toContain("color=c=black:s=1080x1920:d=6");
		expect(runner.calls[0]!.args).toContain("libx264");
		expect(fetcher.calls).toHaveLength(0);
		expect(fs.tempDirs.length).toBe(1);
		expect(fs.removed).toEqual(fs.tempDirs);
	});

	test("renders concat plan with downloaded media and a concat list", async () => {
		const fs = new FakeFs();
		const runner = new FakeRunner();
		const fetcher = new FakeMediaFetcher();
		const engine = new FfmpegRenderEngine({
			ffmpegRunner: runner,
			mediaFetcher: fetcher,
			fs,
		});
		const input = buildRenderGraphInput({
			project: makeProject({
				scenes: [
					makeMainScene({
						elements: [
							makeVideoElement({ id: "a", mediaId: "m_a", duration: 3 }),
							makeVideoElement({ id: "b", mediaId: "m_b", startTime: 3, duration: 5 }),
						],
					}),
				],
			}),
			format: "webm",
			quality: "medium",
			includeAudio: false,
			publishDestination: "generic-export",
			mediaRefs: [
				{ mediaId: "m_a", cloudStorageKey: "key_a" },
				{ mediaId: "m_b", cloudStorageKey: "key_b" },
			],
		});

		const result = await engine.render({
			input,
			onProgress: async () => undefined,
		});

		expect(result.contentType).toBe("video/webm");
		expect(result.durationSeconds).toBe(8);
		expect(fetcher.calls.map((c) => c.mediaId)).toEqual(["m_a", "m_b"]);
		expect(fs.writes).toHaveLength(1);
		expect(fs.writes[0]!.contents).toContain("file '/tmp/clip-0.bin'");
		expect(fs.writes[0]!.contents).toContain("file '/tmp/clip-1.bin'");
		expect(runner.calls[0]!.args).toContain("libvpx-vp9");
		expect(runner.calls[0]!.args).toContain("-an");
	});

	test("throws explicit error when project has unsupported features (missing media)", async () => {
		const fs = new FakeFs();
		const runner = new FakeRunner();
		const fetcher = new FakeMediaFetcher();
		const engine = new FfmpegRenderEngine({
			ffmpegRunner: runner,
			mediaFetcher: fetcher,
			fs,
		});
		const input = buildRenderGraphInput({
			project: makeProject({
				scenes: [
					makeMainScene({ elements: [makeVideoElement({ mediaId: "missing" })] }),
				],
			}),
			format: "mp4",
			quality: "high",
			includeAudio: true,
			publishDestination: "generic-export",
			mediaRefs: [],
		});

		await expect(
			engine.render({ input, onProgress: async () => undefined }),
		).rejects.toThrow(/missing/i);
		expect(runner.calls).toHaveLength(0);
	});

	test("cleans up temp dir even when ffmpeg fails", async () => {
		const fs = new FakeFs();
		const runner = new FakeRunner();
		runner.throwError = new Error("ffmpeg crashed");
		const engine = new FfmpegRenderEngine({
			ffmpegRunner: runner,
			mediaFetcher: new FakeMediaFetcher(),
			fs,
		});
		const input = buildRenderGraphInput({
			project: makeProject(),
			format: "mp4",
			quality: "high",
			includeAudio: true,
			publishDestination: "generic-export",
		});
		await expect(
			engine.render({ input, onProgress: async () => undefined }),
		).rejects.toThrow("ffmpeg crashed");
		expect(fs.removed).toEqual(fs.tempDirs);
	});
});

function makeTextElement(overrides: Partial<TextElement> = {}): TextElement {
	return {
		id: "txt_1",
		name: "caption",
		type: "text",
		duration: 3,
		startTime: 1,
		trimStart: 0,
		trimEnd: 0,
		content: "Hello world",
		fontSize: 48,
		fontFamily: "Inter",
		color: "#FFFFFF",
		background: { color: "#00000080" },
		textAlign: "center",
		fontWeight: "bold",
		fontStyle: "normal",
		textDecoration: "none",
		transform: { scale: 1, position: { x: 0, y: 200 }, rotate: 0 },
		opacity: 1,
		...overrides,
	} as TextElement;
}

function makeTextScene({ elements }: { elements: TextElement[] }): TScene {
	const track: TextTrack = {
		id: "track_text",
		name: "Captions",
		type: "text",
		hidden: false,
		elements,
	};
	return {
		id: "scene_text",
		name: "Text scene",
		isMain: true,
		tracks: [track],
		bookmarks: [],
		createdAt: new Date(),
		updatedAt: new Date(),
	};
}

function makeImageElement(overrides: Partial<ImageElement> = {}): ImageElement {
	return {
		id: "img_1",
		name: "logo",
		type: "image",
		mediaId: "asset_logo",
		duration: 4,
		startTime: 0,
		trimStart: 0,
		trimEnd: 0,
		transform: { scale: 1, position: { x: 100, y: -200 }, rotate: 0 },
		opacity: 1,
		...overrides,
	} as ImageElement;
}

describe("buildFfmpegPlan with text overlays feature flag", () => {
	test("text elements remain unsupported when textOverlays flag is off", () => {
		const input = buildRenderGraphInput({
			project: makeProject({
				scenes: [makeTextScene({ elements: [makeTextElement()] })],
			}),
			format: "mp4",
			quality: "high",
			includeAudio: true,
			publishDestination: "generic-export",
		});
		const plan = buildFfmpegPlan({ input });
		expect(plan.kind).toBe("black-video");
		if (plan.kind !== "black-video") return;
		expect(plan.textOverlays).toEqual([]);
	});

	test("text elements become drawtext overlays when feature flag is on", () => {
		const input = buildRenderGraphInput({
			project: makeProject({
				scenes: [
					makeTextScene({
						elements: [makeTextElement({ content: "Hi", startTime: 1, duration: 2 })],
					}),
				],
			}),
			format: "mp4",
			quality: "high",
			includeAudio: true,
			publishDestination: "generic-export",
		});
		const plan = buildFfmpegPlan({
			input,
			features: { textOverlays: true },
		});
		expect(plan.kind).toBe("black-video");
		if (plan.kind !== "black-video") return;
		expect(plan.textOverlays).toHaveLength(1);
		expect(plan.textOverlays[0]!.content).toBe("Hi");
		expect(plan.textOverlays[0]!.startTime).toBe(1);
		expect(plan.textOverlays[0]!.endTime).toBe(3);
		expect(plan.textOverlays[0]!.fontSize).toBe(48);
	});

	test("hidden text elements are skipped", () => {
		const input = buildRenderGraphInput({
			project: makeProject({
				scenes: [
					makeTextScene({
						elements: [makeTextElement({ hidden: true })],
					}),
				],
			}),
			format: "mp4",
			quality: "high",
			includeAudio: true,
			publishDestination: "generic-export",
		});
		const plan = buildFfmpegPlan({
			input,
			features: { textOverlays: true },
		});
		expect(plan.kind).toBe("black-video");
		if (plan.kind !== "black-video") return;
		expect(plan.textOverlays).toEqual([]);
	});
});

describe("buildFfmpegPlan with image overlays feature flag", () => {
	test("image elements stay unsupported when imageOverlays flag is off", () => {
		const input = buildRenderGraphInput({
			project: makeProject({
				scenes: [
					makeMainScene({
						elements: [
							makeVideoElement({ mediaId: "v1" }),
							makeImageElement({ mediaId: "logo1" }),
						],
					}),
				],
			}),
			format: "mp4",
			quality: "high",
			includeAudio: true,
			publishDestination: "generic-export",
			mediaRefs: [{ mediaId: "v1", cloudStorageKey: "k_v1" }],
		});
		const plan = buildFfmpegPlan({ input });
		expect(plan.kind).toBe("video-concat");
		if (plan.kind !== "video-concat") return;
		expect(plan.imageOverlays).toEqual([]);
	});

	test("image elements become overlays when flag is on and storage key exists", () => {
		const input = buildRenderGraphInput({
			project: makeProject({
				scenes: [
					makeMainScene({
						elements: [
							makeVideoElement({ mediaId: "v1" }),
							makeImageElement({ mediaId: "logo1", startTime: 1, duration: 2 }),
						],
					}),
				],
			}),
			format: "mp4",
			quality: "high",
			includeAudio: true,
			publishDestination: "generic-export",
			mediaRefs: [
				{ mediaId: "v1", cloudStorageKey: "k_v1" },
				{ mediaId: "logo1", cloudStorageKey: "k_logo" },
			],
		});
		const plan = buildFfmpegPlan({
			input,
			features: { imageOverlays: true },
		});
		expect(plan.kind).toBe("video-concat");
		if (plan.kind !== "video-concat") return;
		expect(plan.imageOverlays).toHaveLength(1);
		expect(plan.imageOverlays[0]!.storageKey).toBe("k_logo");
		expect(plan.imageOverlays[0]!.startTime).toBe(1);
		expect(plan.imageOverlays[0]!.endTime).toBe(3);
	});

	test("image overlay missing cloud media yields unsupported plan", () => {
		const input = buildRenderGraphInput({
			project: makeProject({
				scenes: [
					makeMainScene({
						elements: [
							makeVideoElement({ mediaId: "v1" }),
							makeImageElement({ mediaId: "logo_missing" }),
						],
					}),
				],
			}),
			format: "mp4",
			quality: "high",
			includeAudio: true,
			publishDestination: "generic-export",
			mediaRefs: [{ mediaId: "v1", cloudStorageKey: "k_v1" }],
		});
		const plan = buildFfmpegPlan({
			input,
			features: { imageOverlays: true },
		});
		expect(plan.kind).toBe("unsupported");
		if (plan.kind !== "unsupported") return;
		expect(plan.reasons.some((r) => r.includes("logo_missing"))).toBe(true);
	});
});

describe("buildDrawtextFilter", () => {
	test("escapes special characters in text content", () => {
		const filter = buildDrawtextFilter({
			overlay: {
				id: "t1",
				content: "It's a 50% test:value",
				startTime: 0,
				endTime: 5,
				canvasOffset: { x: 540, y: 1500 },
				fontSize: 32,
				color: "#FF0000",
				background: null,
				textAlign: "center",
				fontWeight: "normal",
			},
		});
		expect(filter).toContain("It\\'s a 50\\% test\\:value");
		expect(filter).toContain("fontsize=32");
		expect(filter).toContain("fontcolor=#FF0000");
		expect(filter).toContain("between(t\\,0\\,5)");
	});

	test("includes box=1 + boxcolor when background is set", () => {
		const filter = buildDrawtextFilter({
			overlay: {
				id: "t1",
				content: "Caption",
				startTime: 0,
				endTime: 2,
				canvasOffset: { x: 540, y: 1500 },
				fontSize: 48,
				color: "#FFFFFF",
				background: { color: "#000000", alpha: 0.5, paddingX: 12, paddingY: 6 },
				textAlign: "center",
				fontWeight: "bold",
			},
		});
		expect(filter).toContain("box=1");
		expect(filter).toContain("boxcolor=#00000080");
		expect(filter).toContain("boxborderw=12");
	});

	test("includes fontfile when provided", () => {
		const filter = buildDrawtextFilter({
			overlay: {
				id: "t1",
				content: "Hello",
				startTime: 0,
				endTime: 2,
				canvasOffset: { x: 0, y: 0 },
				fontSize: 24,
				color: "#FFFFFF",
				background: null,
				textAlign: "left",
				fontWeight: "normal",
			},
			fontFile: "/fonts/Inter.ttf",
		});
		expect(filter).toContain("fontfile='/fonts/Inter.ttf'");
	});
});

describe("filter graph wiring in invocation builders", () => {
	test("black-video invocation uses filter_complex with map placeholder resolved to drawtext", () => {
		const input = buildRenderGraphInput({
			project: makeProject({
				scenes: [makeTextScene({ elements: [makeTextElement()] })],
			}),
			format: "mp4",
			quality: "high",
			includeAudio: true,
			publishDestination: "generic-export",
		});
		const plan = buildFfmpegPlan({ input, features: { textOverlays: true } });
		if (plan.kind !== "black-video") throw new Error("expected black-video plan");

		const invocation = buildBlackVideoFfmpegInvocation({
			plan,
			outputPath: "/tmp/out.mp4",
			supportSummary: [],
		});
		expect(invocation.args).toContain("-filter_complex");
		const mapIndex = invocation.args.indexOf("-map");
		expect(mapIndex).toBeGreaterThan(-1);
		expect(invocation.args[mapIndex + 1]).toBe("[txt0]");
	});

	test("video-concat invocation chains image overlay then text overlay", () => {
		const input = buildRenderGraphInput({
			project: makeProject({
				scenes: [
					{
						id: "scene_combo",
						name: "Combo",
						isMain: true,
						bookmarks: [],
						createdAt: new Date(),
						updatedAt: new Date(),
						tracks: [
							{
								id: "track_main",
								name: "Main",
								type: "video",
								isMain: true,
								muted: false,
								hidden: false,
								elements: [
									makeVideoElement({ mediaId: "v1" }),
									makeImageElement({ mediaId: "logo1", startTime: 1, duration: 2 }),
								],
							},
							{
								id: "track_text",
								name: "Captions",
								type: "text",
								hidden: false,
								elements: [
									makeTextElement({
										id: "tx",
										content: "Caption",
										startTime: 1,
										duration: 2,
									}),
								],
							},
						],
					},
				],
			}),
			format: "mp4",
			quality: "high",
			includeAudio: false,
			publishDestination: "generic-export",
			mediaRefs: [
				{ mediaId: "v1", cloudStorageKey: "k_v1" },
				{ mediaId: "logo1", cloudStorageKey: "k_logo" },
			],
		});
		const plan = buildFfmpegPlan({
			input,
			features: { textOverlays: true, imageOverlays: true },
		});
		if (plan.kind !== "video-concat") throw new Error("expected video-concat plan");

		const invocation = buildVideoConcatFfmpegInvocation({
			plan,
			outputPath: "/tmp/out.mp4",
			concatListPath: "/tmp/concat.txt",
			supportSummary: [],
			imageInputPaths: ["/tmp/logo.png"],
		});
		const filterIndex = invocation.args.indexOf("-filter_complex");
		expect(filterIndex).toBeGreaterThan(-1);
		const filterGraph = invocation.args[filterIndex + 1]!;
		expect(filterGraph).toContain("[base]");
		expect(filterGraph).toContain("overlay=");
		expect(filterGraph).toContain("drawtext=");
		const mapIndex = invocation.args.indexOf("-map");
		expect(invocation.args[mapIndex + 1]).toBe("[txt0]");
	});
});

describe("buildFfmpegPlan with caption word reveals feature flag", () => {
	function makeCaptionElement({
		id = "caption_1",
		startTime = 1,
		duration = 4,
		words,
	}: {
		id?: string;
		startTime?: number;
		duration?: number;
		words: Array<{ text: string; startTime: number; endTime: number }>;
	}): TextElement {
		return makeTextElement({
			id,
			role: "caption",
			startTime,
			duration,
			content: words.map((w) => w.text).join(" "),
			captionTiming: { words },
		});
	}

	test("captions render as a single overlay when captionWordReveals flag is off", () => {
		const input = buildRenderGraphInput({
			project: makeProject({
				scenes: [
					makeTextScene({
						elements: [
							makeCaptionElement({
								words: [
									{ text: "Hello", startTime: 1, endTime: 1.4 },
									{ text: "world", startTime: 1.4, endTime: 2.0 },
								],
							}),
						],
					}),
				],
			}),
			format: "mp4",
			quality: "high",
			includeAudio: true,
			publishDestination: "generic-export",
		});
		const plan = buildFfmpegPlan({ input, features: { textOverlays: true } });
		if (plan.kind !== "black-video") throw new Error("expected black-video plan");
		expect(plan.textOverlays).toHaveLength(1);
		expect(plan.textOverlays[0]!.content).toBe("Hello world");
	});

	test("captions expand into per-word overlays when captionWordReveals is on", () => {
		const input = buildRenderGraphInput({
			project: makeProject({
				scenes: [
					makeTextScene({
						elements: [
							makeCaptionElement({
								words: [
									{ text: "Hello", startTime: 1, endTime: 1.4 },
									{ text: "world", startTime: 1.4, endTime: 2.0 },
									{ text: "again", startTime: 2.0, endTime: 2.6 },
								],
							}),
						],
					}),
				],
			}),
			format: "mp4",
			quality: "high",
			includeAudio: true,
			publishDestination: "generic-export",
		});
		const plan = buildFfmpegPlan({
			input,
			features: { textOverlays: true, captionWordReveals: true },
		});
		if (plan.kind !== "black-video") throw new Error("expected black-video plan");
		expect(plan.textOverlays).toHaveLength(3);
		expect(plan.textOverlays.map((o) => o.content)).toEqual([
			"Hello",
			"world",
			"again",
		]);
		expect(plan.textOverlays[0]!.startTime).toBe(1);
		expect(plan.textOverlays[0]!.endTime).toBe(1.4);
		expect(plan.textOverlays[2]!.id).toContain("__w2");
	});

	test("non-caption text elements are unaffected by captionWordReveals", () => {
		const input = buildRenderGraphInput({
			project: makeProject({
				scenes: [
					makeTextScene({
						elements: [
							makeTextElement({ id: "title", content: "Title" }),
							makeCaptionElement({
								id: "cap",
								words: [
									{ text: "A", startTime: 0.5, endTime: 0.7 },
									{ text: "B", startTime: 0.7, endTime: 1.0 },
								],
							}),
						],
					}),
				],
			}),
			format: "mp4",
			quality: "high",
			includeAudio: true,
			publishDestination: "generic-export",
		});
		const plan = buildFfmpegPlan({
			input,
			features: { textOverlays: true, captionWordReveals: true },
		});
		if (plan.kind !== "black-video") throw new Error("expected black-video plan");
		// 1 title + 2 caption words
		expect(plan.textOverlays).toHaveLength(3);
		const titleOverlay = plan.textOverlays.find((o) => o.id === "title");
		expect(titleOverlay?.content).toBe("Title");
	});

	test("caption with empty captionTiming words falls back to single overlay", () => {
		const input = buildRenderGraphInput({
			project: makeProject({
				scenes: [
					makeTextScene({
						elements: [
							makeTextElement({
								id: "empty_cap",
								role: "caption",
								content: "Fallback",
								captionTiming: { words: [] },
							}),
						],
					}),
				],
			}),
			format: "mp4",
			quality: "high",
			includeAudio: true,
			publishDestination: "generic-export",
		});
		const plan = buildFfmpegPlan({
			input,
			features: { textOverlays: true, captionWordReveals: true },
		});
		if (plan.kind !== "black-video") throw new Error("expected black-video plan");
		expect(plan.textOverlays).toHaveLength(1);
		expect(plan.textOverlays[0]!.content).toBe("Fallback");
	});
});

describe("buildFfmpegPlan with transitions feature flag", () => {
	test("transitions are still skipped (video-concat) when transitions flag is off", () => {
		const input = buildRenderGraphInput({
			project: makeProject({
				scenes: [
					makeMainScene({
						elements: [
							makeVideoElement({ id: "a", mediaId: "v_a", duration: 4 }),
							makeVideoElement({
								id: "b",
								mediaId: "v_b",
								startTime: 4,
								duration: 4,
								transitionIn: { preset: "cross-dissolve", duration: 1 },
							}),
						],
					}),
				],
			}),
			format: "mp4",
			quality: "high",
			includeAudio: true,
			publishDestination: "generic-export",
			mediaRefs: [
				{ mediaId: "v_a", cloudStorageKey: "k_a" },
				{ mediaId: "v_b", cloudStorageKey: "k_b" },
			],
		});
		const plan = buildFfmpegPlan({ input });
		expect(plan.kind).toBe("video-concat");
	});

	test("cross-dissolve transition switches plan to video-filter-graph and clamps duration", () => {
		const input = buildRenderGraphInput({
			project: makeProject({
				scenes: [
					makeMainScene({
						elements: [
							makeVideoElement({ id: "a", mediaId: "v_a", duration: 3 }),
							makeVideoElement({
								id: "b",
								mediaId: "v_b",
								startTime: 3,
								duration: 5,
								transitionIn: { preset: "cross-dissolve", duration: 1 },
							}),
						],
					}),
				],
			}),
			format: "mp4",
			quality: "high",
			includeAudio: false,
			publishDestination: "generic-export",
			mediaRefs: [
				{ mediaId: "v_a", cloudStorageKey: "k_a" },
				{ mediaId: "v_b", cloudStorageKey: "k_b" },
			],
		});
		const plan = buildFfmpegPlan({ input, features: { transitions: true } });
		expect(plan.kind).toBe("video-filter-graph");
		if (plan.kind !== "video-filter-graph") return;
		expect(plan.clips).toHaveLength(2);
		expect(plan.clips[0]!.transitionInFromPrev).toBeNull();
		expect(plan.clips[1]!.transitionInFromPrev?.kind).toBe("fade");
		expect(plan.clips[1]!.transitionInFromPrev?.durationSeconds).toBe(1);
	});

	test("first clip's transitionIn is ignored (nothing to fade from)", () => {
		const input = buildRenderGraphInput({
			project: makeProject({
				scenes: [
					makeMainScene({
						elements: [
							makeVideoElement({
								id: "a",
								mediaId: "v_a",
								duration: 3,
								transitionIn: { preset: "cross-dissolve", duration: 1 },
							}),
						],
					}),
				],
			}),
			format: "mp4",
			quality: "high",
			includeAudio: false,
			publishDestination: "generic-export",
			mediaRefs: [{ mediaId: "v_a", cloudStorageKey: "k_a" }],
		});
		const plan = buildFfmpegPlan({ input, features: { transitions: true } });
		// No xfade applies (transition was on first clip), so falls back to concat path
		expect(plan.kind).toBe("video-concat");
	});

	test("unsupported transition preset is ignored cleanly when flag is on", () => {
		const input = buildRenderGraphInput({
			project: makeProject({
				scenes: [
					makeMainScene({
						elements: [
							makeVideoElement({ id: "a", mediaId: "v_a", duration: 3 }),
							makeVideoElement({
								id: "b",
								mediaId: "v_b",
								startTime: 3,
								duration: 4,
								transitionIn: {
									preset: "wormhole" as never,
									duration: 1,
								},
							}),
						],
					}),
				],
			}),
			format: "mp4",
			quality: "high",
			includeAudio: false,
			publishDestination: "generic-export",
			mediaRefs: [
				{ mediaId: "v_a", cloudStorageKey: "k_a" },
				{ mediaId: "v_b", cloudStorageKey: "k_b" },
			],
		});
		const plan = buildFfmpegPlan({ input, features: { transitions: true } });
		// No supported xfade transitions, so falls back to concat
		expect(plan.kind).toBe("video-concat");
	});

	test("clamps requested transition duration to fit within shortest clip", () => {
		const input = buildRenderGraphInput({
			project: makeProject({
				scenes: [
					makeMainScene({
						elements: [
							makeVideoElement({ id: "a", mediaId: "v_a", duration: 1 }),
							makeVideoElement({
								id: "b",
								mediaId: "v_b",
								startTime: 1,
								duration: 4,
								transitionIn: { preset: "fade-black", duration: 5 },
							}),
						],
					}),
				],
			}),
			format: "mp4",
			quality: "high",
			includeAudio: false,
			publishDestination: "generic-export",
			mediaRefs: [
				{ mediaId: "v_a", cloudStorageKey: "k_a" },
				{ mediaId: "v_b", cloudStorageKey: "k_b" },
			],
		});
		const plan = buildFfmpegPlan({ input, features: { transitions: true } });
		expect(plan.kind).toBe("video-filter-graph");
		if (plan.kind !== "video-filter-graph") return;
		// Min clip = 1s, so duration should clamp to ~0.95s (1 - 0.05)
		const transition = plan.clips[1]!.transitionInFromPrev!;
		expect(transition.kind).toBe("fadeblack");
		expect(transition.durationSeconds).toBeLessThanOrEqual(0.95);
		expect(transition.durationSeconds).toBeGreaterThan(0);
	});
});

describe("buildXfadeChainFilter", () => {
	test("single clip emits one normalized stream and final label v0", () => {
		const result = buildXfadeChainFilter({
			canvasSize: { width: 1080, height: 1920 },
			clips: [
				{
					mediaId: "a",
					storageKey: "k_a",
					durationSeconds: 3,
					trimStartSeconds: 0,
					trimEndSeconds: 0,
					transitionInFromPrev: null,
				},
			],
		});
		expect(result.finalLabel).toBe("[v0]");
		expect(result.totalDurationSeconds).toBe(3);
		expect(result.filter).toContain("[0:v]");
		expect(result.filter).toContain("format=yuv420p[v0]");
	});

	test("two clips with cross-dissolve emits xfade with correct offset", () => {
		const result = buildXfadeChainFilter({
			canvasSize: { width: 1080, height: 1920 },
			clips: [
				{
					mediaId: "a",
					storageKey: "k_a",
					durationSeconds: 3,
					trimStartSeconds: 0,
					trimEndSeconds: 0,
					transitionInFromPrev: null,
				},
				{
					mediaId: "b",
					storageKey: "k_b",
					durationSeconds: 4,
					trimStartSeconds: 0,
					trimEndSeconds: 0,
					transitionInFromPrev: { kind: "fade", durationSeconds: 1 },
				},
			],
		});
		expect(result.filter).toContain("xfade=transition=fade:duration=1:offset=2.000");
		// total = 3 + 4 - 1 = 6
		expect(result.totalDurationSeconds).toBe(6);
	});

	test("three clips, only first transition has xfade, second uses concat", () => {
		const result = buildXfadeChainFilter({
			canvasSize: { width: 1080, height: 1920 },
			clips: [
				{
					mediaId: "a",
					storageKey: "k_a",
					durationSeconds: 3,
					trimStartSeconds: 0,
					trimEndSeconds: 0,
					transitionInFromPrev: null,
				},
				{
					mediaId: "b",
					storageKey: "k_b",
					durationSeconds: 4,
					trimStartSeconds: 0,
					trimEndSeconds: 0,
					transitionInFromPrev: { kind: "fadeblack", durationSeconds: 1 },
				},
				{
					mediaId: "c",
					storageKey: "k_c",
					durationSeconds: 2,
					trimStartSeconds: 0,
					trimEndSeconds: 0,
					transitionInFromPrev: null,
				},
			],
		});
		expect(result.filter).toContain("xfade=transition=fadeblack");
		expect(result.filter).toContain("concat=n=2:v=1:a=0");
		// total = 3 + (4-1) + 2 = 8
		expect(result.totalDurationSeconds).toBe(8);
	});
});

describe("buildVideoFilterGraphFfmpegInvocation", () => {
	test("emits per-clip -i inputs, filter_complex with xfade, -t totalDuration", () => {
		const invocation = buildVideoFilterGraphFfmpegInvocation({
			plan: {
				kind: "video-filter-graph",
				canvasSize: { width: 1080, height: 1920 },
				includeAudio: false,
				format: "mp4",
				quality: "high",
				clips: [
					{
						mediaId: "a",
						storageKey: "k_a",
						durationSeconds: 3,
						trimStartSeconds: 0,
						trimEndSeconds: 0,
						transitionInFromPrev: null,
					},
					{
						mediaId: "b",
						storageKey: "k_b",
						durationSeconds: 4,
						trimStartSeconds: 0,
						trimEndSeconds: 0,
						transitionInFromPrev: { kind: "fade", durationSeconds: 1 },
					},
				],
				textOverlays: [],
				imageOverlays: [],
			},
			outputPath: "/tmp/out.mp4",
			supportSummary: [],
			mediaInputPaths: ["/tmp/a.mp4", "/tmp/b.mp4"],
		});
		// Two -i inputs
		const inputCount = invocation.args.filter((a) => a === "-i").length;
		expect(inputCount).toBe(2);
		const filterIndex = invocation.args.indexOf("-filter_complex");
		expect(filterIndex).toBeGreaterThan(-1);
		expect(invocation.args[filterIndex + 1]!).toContain("xfade=transition=fade");
		// Final -t arg matches expected total duration (3 + 4 - 1 = 6)
		const tIndex = invocation.args.lastIndexOf("-t");
		expect(invocation.args[tIndex + 1]!).toBe("6.000");
		// -an because includeAudio=false
		expect(invocation.args).toContain("-an");
	});

	test("includes audio concat when includeAudio is true", () => {
		const invocation = buildVideoFilterGraphFfmpegInvocation({
			plan: {
				kind: "video-filter-graph",
				canvasSize: { width: 1080, height: 1920 },
				includeAudio: true,
				format: "mp4",
				quality: "high",
				clips: [
					{
						mediaId: "a",
						storageKey: "k_a",
						durationSeconds: 3,
						trimStartSeconds: 0,
						trimEndSeconds: 0,
						transitionInFromPrev: null,
					},
					{
						mediaId: "b",
						storageKey: "k_b",
						durationSeconds: 4,
						trimStartSeconds: 0,
						trimEndSeconds: 0,
						transitionInFromPrev: { kind: "fade", durationSeconds: 1 },
					},
				],
				textOverlays: [],
				imageOverlays: [],
			},
			outputPath: "/tmp/out.mp4",
			supportSummary: [],
			mediaInputPaths: ["/tmp/a.mp4", "/tmp/b.mp4"],
		});
		// Two filter_complex args (one for video, one for audio concat)
		const filterArgs = invocation.args.filter((a, i) => a === "-filter_complex");
		expect(filterArgs.length).toBeGreaterThanOrEqual(1);
		expect(invocation.args.some((a) => a.includes("[0:a][1:a]"))).toBe(true);
		expect(invocation.args.some((a) => a.includes("concat=n=2:v=0:a=1"))).toBe(true);
		expect(invocation.args).toContain("-map");
		expect(invocation.args).toContain("[outa]");
		expect(invocation.args).not.toContain("-an");
	});

	test("throws when mediaInputPaths length doesn't match clip count", () => {
		expect(() =>
			buildVideoFilterGraphFfmpegInvocation({
				plan: {
					kind: "video-filter-graph",
					canvasSize: { width: 1080, height: 1920 },
					includeAudio: false,
					format: "mp4",
					quality: "high",
					clips: [
						{
							mediaId: "a",
							storageKey: "k_a",
							durationSeconds: 3,
							trimStartSeconds: 0,
							trimEndSeconds: 0,
							transitionInFromPrev: null,
						},
					],
					textOverlays: [],
					imageOverlays: [],
				},
				outputPath: "/tmp/out.mp4",
				supportSummary: [],
				mediaInputPaths: [],
			}),
		).toThrow(/expected 1 media input paths/i);
	});
});

describe("buildFfmpegPlan with per-clip trims", () => {
	test("plan stays video-concat when no clip is trimmed", () => {
		const input = buildRenderGraphInput({
			project: makeProject({
				scenes: [
					makeMainScene({
						elements: [
							makeVideoElement({ id: "a", mediaId: "v_a", duration: 4 }),
							makeVideoElement({ id: "b", mediaId: "v_b", startTime: 4, duration: 4 }),
						],
					}),
				],
			}),
			format: "mp4",
			quality: "high",
			includeAudio: false,
			publishDestination: "generic-export",
			mediaRefs: [
				{ mediaId: "v_a", cloudStorageKey: "k_a" },
				{ mediaId: "v_b", cloudStorageKey: "k_b" },
			],
		});
		const plan = buildFfmpegPlan({ input });
		expect(plan.kind).toBe("video-concat");
	});

	test("any clip with trimStart > 0 forces video-filter-graph (no transitions needed)", () => {
		const input = buildRenderGraphInput({
			project: makeProject({
				scenes: [
					makeMainScene({
						elements: [
							makeVideoElement({
								id: "a",
								mediaId: "v_a",
								duration: 4,
								trimStart: 1.5,
							}),
						],
					}),
				],
			}),
			format: "mp4",
			quality: "high",
			includeAudio: false,
			publishDestination: "generic-export",
			mediaRefs: [{ mediaId: "v_a", cloudStorageKey: "k_a" }],
		});
		const plan = buildFfmpegPlan({ input });
		expect(plan.kind).toBe("video-filter-graph");
		if (plan.kind !== "video-filter-graph") return;
		expect(plan.clips[0]!.trimStartSeconds).toBe(1.5);
	});

	test("any clip with trimEnd > 0 also forces video-filter-graph", () => {
		const input = buildRenderGraphInput({
			project: makeProject({
				scenes: [
					makeMainScene({
						elements: [
							makeVideoElement({
								id: "a",
								mediaId: "v_a",
								duration: 4,
								trimEnd: 0.5,
							}),
						],
					}),
				],
			}),
			format: "mp4",
			quality: "high",
			includeAudio: false,
			publishDestination: "generic-export",
			mediaRefs: [{ mediaId: "v_a", cloudStorageKey: "k_a" }],
		});
		const plan = buildFfmpegPlan({ input });
		expect(plan.kind).toBe("video-filter-graph");
	});
});

describe("buildXfadeChainFilter trim handling", () => {
	test("emits trim+setpts before scale when trimStart > 0", () => {
		const result = buildXfadeChainFilter({
			canvasSize: { width: 1080, height: 1920 },
			clips: [
				{
					mediaId: "a",
					storageKey: "k_a",
					durationSeconds: 4,
					trimStartSeconds: 1.5,
					trimEndSeconds: 0,
					transitionInFromPrev: null,
				},
			],
		});
		expect(result.filter).toContain("trim=start=1.500:duration=4.000");
		expect(result.filter).toContain("setpts=PTS-STARTPTS");
		// trim before scale to avoid wasted work
		const trimIdx = result.filter.indexOf("trim=");
		const scaleIdx = result.filter.indexOf("scale=");
		expect(trimIdx).toBeGreaterThan(-1);
		expect(scaleIdx).toBeGreaterThan(trimIdx);
	});

	test("non-trimmed clip omits trim filter", () => {
		const result = buildXfadeChainFilter({
			canvasSize: { width: 1080, height: 1920 },
			clips: [
				{
					mediaId: "a",
					storageKey: "k_a",
					durationSeconds: 4,
					trimStartSeconds: 0,
					trimEndSeconds: 0,
					transitionInFromPrev: null,
				},
			],
		});
		expect(result.filter).not.toContain("trim=");
		expect(result.filter).not.toContain("setpts=");
	});
});
