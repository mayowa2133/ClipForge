import { describe, expect, test } from "bun:test";
import {
	buildAcrossfadeChainFilter,
	buildAdjustmentsFilter,
	buildAtempoChain,
	buildAudioMixChain,
	buildBlackVideoFfmpegInvocation,
	buildColorBalanceFilter,
	buildDrawtextFilter,
	buildEffectFilter,
	buildFfmpegPlan,
	buildKeyframeExpression,
	buildOpacityKeyframeFilter,
	buildOverlayFilterChain,
	buildRotateKeyframeFilter,
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
	AudioTrack,
	ImageElement,
	LibraryAudioElement,
	TScene,
	TextElement,
	TextTrack,
	UploadAudioElement,
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

	test("includes acrossfade audio chain when includeAudio is true and there is a transition", () => {
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
		// Single -filter_complex containing both xfade chain and acrossfade chain
		const filterArgs = invocation.args.filter((a) => a === "-filter_complex");
		expect(filterArgs.length).toBe(1);
		const filterIdx = invocation.args.indexOf("-filter_complex");
		const filterValue = invocation.args[filterIdx + 1]!;
		expect(filterValue).toContain("acrossfade=d=1:c1=tri:c2=tri");
		expect(filterValue).toContain("[0:a]anull[a0]");
		expect(filterValue).toContain("[1:a]anull[a1]");
		// Mapped to the produced audio output label
		const mapIndices = invocation.args
			.map((a, i) => (a === "-map" ? i : -1))
			.filter((i) => i >= 0);
		const mappedValues = mapIndices.map((i) => invocation.args[i + 1]);
		expect(mappedValues).toContain("[outa]");
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

describe("buildAcrossfadeChainFilter", () => {
	test("single clip emits anull stage and final label [a0]", () => {
		const result = buildAcrossfadeChainFilter({
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
		expect(result.finalLabel).toBe("[a0]");
		expect(result.filter).toBe("[0:a]anull[a0]");
	});

	test("two clips with cross-dissolve emits acrossfade with matching duration", () => {
		const result = buildAcrossfadeChainFilter({
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
					transitionInFromPrev: { kind: "fade", durationSeconds: 1.25 },
				},
			],
		});
		expect(result.filter).toContain("acrossfade=d=1.25:c1=tri:c2=tri");
		expect(result.finalLabel).toBe("[outa]");
	});

	test("clip with trimStart prepends atrim+asetpts before chain", () => {
		const result = buildAcrossfadeChainFilter({
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
		expect(result.filter).toContain("atrim=start=1.500:duration=4.000");
		expect(result.filter).toContain("asetpts=PTS-STARTPTS");
	});

	test("three clips with one transition uses acrossfade then concat", () => {
		const result = buildAcrossfadeChainFilter({
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
		expect(result.filter).toContain("acrossfade=d=1");
		expect(result.filter).toContain("concat=n=2:v=0:a=1");
		expect(result.finalLabel).toBe("[outa]");
	});
});

describe("buildAdjustmentsFilter", () => {
	test("returns null when all knobs are zero", () => {
		expect(
			buildAdjustmentsFilter({
				adjustments: { exposure: 0, contrast: 0, saturation: 0 },
			}),
		).toBeNull();
	});

	test("includes exposure as brightness, clamped to [-1, 1]", () => {
		expect(
			buildAdjustmentsFilter({
				adjustments: { exposure: 0.4, contrast: 0, saturation: 0 },
			}),
		).toContain("brightness=0.400");
		expect(
			buildAdjustmentsFilter({
				adjustments: { exposure: 5, contrast: 0, saturation: 0 },
			}),
		).toContain("brightness=1.000");
	});

	test("maps contrast to 1+offset and saturation to 1+offset, both clamped", () => {
		const filter = buildAdjustmentsFilter({
			adjustments: { exposure: 0, contrast: 0.5, saturation: -0.25 },
		});
		expect(filter).toContain("contrast=1.500");
		expect(filter).toContain("saturation=0.750");
	});

	test("returns the eq= prefix when any knob is non-zero", () => {
		const filter = buildAdjustmentsFilter({
			adjustments: { exposure: 0.1, contrast: 0, saturation: 0 },
		});
		expect(filter?.startsWith("eq=")).toBe(true);
	});
});

describe("buildEffectFilter", () => {
	test("blur maps to gblur=sigma=N", () => {
		expect(buildEffectFilter({ effect: { kind: "blur", radius: 4 } })).toBe(
			"gblur=sigma=4.000",
		);
	});

	test("blur clamps a 0-radius to 0.1 (ffmpeg requires sigma > 0)", () => {
		expect(buildEffectFilter({ effect: { kind: "blur", radius: 0 } })).toContain(
			"sigma=0.100",
		);
	});

	test("sharpen maps to unsharp with luma amount", () => {
		expect(
			buildEffectFilter({ effect: { kind: "sharpen", amount: 0.5 } }),
		).toBe("unsharp=lx=5:ly=5:la=0.500");
	});

	test("vignette maps to vignette=angle=intensity * pi/4", () => {
		const filter = buildEffectFilter({
			effect: { kind: "vignette", intensity: 0.5 },
		});
		// 0.5 * pi/4 ≈ 0.393
		expect(filter).toContain("vignette=angle=");
		expect(filter).toContain("0.393");
	});
});

describe("buildFfmpegPlan with colorAndEffects feature flag", () => {
	test("clips with effects stay video-concat when flag is off, with skip warning", () => {
		const input = buildRenderGraphInput({
			project: makeProject({
				scenes: [
					makeMainScene({
						elements: [
							makeVideoElement({
								id: "a",
								mediaId: "v_a",
								duration: 4,
								effects: [
									{ id: "e1", kind: "blur", enabled: true, radius: 5 },
								],
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
		expect(plan.kind).toBe("video-concat");
	});

	test("clip with effect is rendered when flag is on (forces filter-graph)", () => {
		const input = buildRenderGraphInput({
			project: makeProject({
				scenes: [
					makeMainScene({
						elements: [
							makeVideoElement({
								id: "a",
								mediaId: "v_a",
								duration: 4,
								effects: [
									{ id: "e1", kind: "blur", enabled: true, radius: 4 },
								],
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
		const plan = buildFfmpegPlan({ input, features: { colorAndEffects: true } });
		expect(plan.kind).toBe("video-filter-graph");
		if (plan.kind !== "video-filter-graph") return;
		expect(plan.clips[0]!.effects).toEqual([{ kind: "blur", radius: 4 }]);
	});

	test("disabled effects are not applied even with flag on", () => {
		const input = buildRenderGraphInput({
			project: makeProject({
				scenes: [
					makeMainScene({
						elements: [
							makeVideoElement({
								id: "a",
								mediaId: "v_a",
								duration: 4,
								effects: [
									{ id: "e1", kind: "blur", enabled: false, radius: 4 },
								],
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
		const plan = buildFfmpegPlan({ input, features: { colorAndEffects: true } });
		// No effects to apply, no other reason to switch to filter-graph
		expect(plan.kind).toBe("video-concat");
	});

	test("clip with non-zero exposure routes to filter-graph and emits adjustments", () => {
		const input = buildRenderGraphInput({
			project: makeProject({
				scenes: [
					makeMainScene({
						elements: [
							makeVideoElement({
								id: "a",
								mediaId: "v_a",
								duration: 4,
								adjustments: {
									exposure: 0.2,
									contrast: 0,
									saturation: 0,
									temperature: 0,
									tint: 0,
									highlights: 0,
									shadows: 0,
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
			mediaRefs: [{ mediaId: "v_a", cloudStorageKey: "k_a" }],
		});
		const plan = buildFfmpegPlan({ input, features: { colorAndEffects: true } });
		expect(plan.kind).toBe("video-filter-graph");
		if (plan.kind !== "video-filter-graph") return;
		expect(plan.clips[0]!.adjustments).toEqual({
			exposure: 0.2,
			contrast: 0,
			saturation: 0,
			temperature: 0,
			tint: 0,
			highlights: 0,
			shadows: 0,
		});
	});

	test("temperature/tint/highlights/shadows are now supported and route to filter-graph", () => {
		const input = buildRenderGraphInput({
			project: makeProject({
				scenes: [
					makeMainScene({
						elements: [
							makeVideoElement({
								id: "a",
								mediaId: "v_a",
								duration: 4,
								adjustments: {
									exposure: 0,
									contrast: 0,
									saturation: 0,
									temperature: 0.3,
									tint: 0,
									highlights: 0.5,
									shadows: 0,
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
			mediaRefs: [{ mediaId: "v_a", cloudStorageKey: "k_a" }],
		});
		const plan = buildFfmpegPlan({ input, features: { colorAndEffects: true } });
		expect(plan.kind).toBe("video-filter-graph");
		if (plan.kind !== "video-filter-graph") return;
		expect(plan.clips[0]!.adjustments?.temperature).toBe(0.3);
		expect(plan.clips[0]!.adjustments?.highlights).toBe(0.5);
	});
});

describe("xfade chain integrates color/effect filters per clip", () => {
	test("emits eq before format=yuv420p and after baseScale", () => {
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
					adjustments: { exposure: 0.1, contrast: 0, saturation: 0 },
					effects: [],
				},
			],
		});
		expect(result.filter).toContain("eq=brightness=0.100");
		const eqIdx = result.filter.indexOf("eq=");
		const fmtIdx = result.filter.indexOf("format=yuv420p");
		const scaleIdx = result.filter.indexOf("scale=");
		expect(scaleIdx).toBeLessThan(eqIdx);
		expect(eqIdx).toBeLessThan(fmtIdx);
	});

	test("emits effect filters in declaration order", () => {
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
					adjustments: null,
					effects: [
						{ kind: "blur", radius: 2 },
						{ kind: "sharpen", amount: 0.4 },
					],
				},
			],
		});
		const blurIdx = result.filter.indexOf("gblur=");
		const sharpIdx = result.filter.indexOf("unsharp=");
		expect(blurIdx).toBeGreaterThan(-1);
		expect(sharpIdx).toBeGreaterThan(blurIdx);
	});
});

function makeUploadAudioElement(
	overrides: Partial<UploadAudioElement> = {},
): UploadAudioElement {
	return {
		id: "ae_1",
		name: "voice.wav",
		type: "audio",
		sourceType: "upload",
		mediaId: "audio_a",
		duration: 4,
		startTime: 0,
		trimStart: 0,
		trimEnd: 0,
		volume: 1,
		...overrides,
	} as UploadAudioElement;
}

function makeSceneWithVideoAndAudio({
	video,
	audio,
	audioTrackMuted = false,
}: {
	video: VideoElement[];
	audio: UploadAudioElement[];
	audioTrackMuted?: boolean;
}): TScene {
	const videoTrack: VideoTrack = {
		id: "track_main",
		name: "Main",
		type: "video",
		isMain: true,
		muted: false,
		hidden: false,
		elements: video,
	};
	const audioTrack: AudioTrack = {
		id: "track_audio",
		name: "Audio",
		type: "audio",
		muted: audioTrackMuted,
		elements: audio,
	};
	return {
		id: "scene_av",
		name: "av",
		isMain: true,
		tracks: [videoTrack, audioTrack],
		bookmarks: [],
		createdAt: new Date(),
		updatedAt: new Date(),
	};
}

describe("buildFfmpegPlan with audioMixing feature flag", () => {
	test("upload audio elements are skipped when flag is off (with warning summary)", () => {
		const input = buildRenderGraphInput({
			project: makeProject({
				scenes: [
					makeSceneWithVideoAndAudio({
						video: [makeVideoElement({ mediaId: "v_a" })],
						audio: [makeUploadAudioElement({ mediaId: "audio_a" })],
					}),
				],
			}),
			format: "mp4",
			quality: "high",
			includeAudio: true,
			publishDestination: "generic-export",
			mediaRefs: [
				{ mediaId: "v_a", cloudStorageKey: "k_v" },
				{ mediaId: "audio_a", cloudStorageKey: "k_a" },
			],
		});
		const plan = buildFfmpegPlan({ input });
		expect(plan.kind).toBe("video-concat");
	});

	test("upload audio with flag on routes to filter-graph and surfaces audioElements", () => {
		const input = buildRenderGraphInput({
			project: makeProject({
				scenes: [
					makeSceneWithVideoAndAudio({
						video: [makeVideoElement({ mediaId: "v_a", duration: 6 })],
						audio: [
							makeUploadAudioElement({
								id: "ae_voice",
								mediaId: "audio_a",
								startTime: 1,
								duration: 3,
								volume: 0.7,
								role: "voiceover",
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
				{ mediaId: "v_a", cloudStorageKey: "k_v" },
				{ mediaId: "audio_a", cloudStorageKey: "k_a" },
			],
		});
		const plan = buildFfmpegPlan({ input, features: { audioMixing: true } });
		expect(plan.kind).toBe("video-filter-graph");
		if (plan.kind !== "video-filter-graph") return;
		expect(plan.audioElements).toHaveLength(1);
		expect(plan.audioElements?.[0]).toMatchObject({
			mediaId: "audio_a",
			startTimeSeconds: 1,
			durationSeconds: 3,
			volume: 0.7,
			role: "voiceover",
			storageKey: "k_a",
		});
	});

	test("muted audio elements are dropped (element-level)", () => {
		const input = buildRenderGraphInput({
			project: makeProject({
				scenes: [
					makeSceneWithVideoAndAudio({
						video: [makeVideoElement({ mediaId: "v_a" })],
						audio: [
							makeUploadAudioElement({ mediaId: "audio_a", muted: true }),
						],
					}),
				],
			}),
			format: "mp4",
			quality: "high",
			includeAudio: true,
			publishDestination: "generic-export",
			mediaRefs: [
				{ mediaId: "v_a", cloudStorageKey: "k_v" },
				{ mediaId: "audio_a", cloudStorageKey: "k_a" },
			],
		});
		const plan = buildFfmpegPlan({ input, features: { audioMixing: true } });
		expect(plan.kind).toBe("video-concat");
	});

	test("muted audio track drops all its elements", () => {
		const input = buildRenderGraphInput({
			project: makeProject({
				scenes: [
					makeSceneWithVideoAndAudio({
						video: [makeVideoElement({ mediaId: "v_a" })],
						audio: [makeUploadAudioElement({ mediaId: "audio_a" })],
						audioTrackMuted: true,
					}),
				],
			}),
			format: "mp4",
			quality: "high",
			includeAudio: true,
			publishDestination: "generic-export",
			mediaRefs: [
				{ mediaId: "v_a", cloudStorageKey: "k_v" },
				{ mediaId: "audio_a", cloudStorageKey: "k_a" },
			],
		});
		const plan = buildFfmpegPlan({ input, features: { audioMixing: true } });
		expect(plan.kind).toBe("video-concat");
	});

	test("audio element missing cloud media yields unsupported plan", () => {
		const input = buildRenderGraphInput({
			project: makeProject({
				scenes: [
					makeSceneWithVideoAndAudio({
						video: [makeVideoElement({ mediaId: "v_a" })],
						audio: [makeUploadAudioElement({ mediaId: "audio_missing" })],
					}),
				],
			}),
			format: "mp4",
			quality: "high",
			includeAudio: true,
			publishDestination: "generic-export",
			mediaRefs: [{ mediaId: "v_a", cloudStorageKey: "k_v" }],
		});
		const plan = buildFfmpegPlan({ input, features: { audioMixing: true } });
		expect(plan.kind).toBe("unsupported");
		if (plan.kind !== "unsupported") return;
		expect(plan.reasons.some((r) => r.includes("audio_missing"))).toBe(true);
	});
});

describe("buildAudioMixChain", () => {
	test("returns empty chain when there are no audio elements", () => {
		const result = buildAudioMixChain({
			clipChainLabel: "[outa]",
			audioElements: [],
			firstAudioInputIndex: 5,
		});
		expect(result.filter).toBe("");
		expect(result.finalLabel).toBe("[outa]");
	});

	test("single audio element with volume + delay produces a single labeled stream", () => {
		const result = buildAudioMixChain({
			clipChainLabel: null,
			audioElements: [
				{
					mediaId: "a",
					storageKey: "k",
					startTimeSeconds: 1.25,
					durationSeconds: 3,
					trimStartSeconds: 0,
					trimEndSeconds: 0,
					volume: 0.5,
					role: "voiceover",
				},
			],
			firstAudioInputIndex: 4,
		});
		expect(result.filter).toContain("[4:a]");
		expect(result.filter).toContain("atrim=start=0.000:duration=3.000");
		expect(result.filter).toContain("volume=0.500");
		expect(result.filter).toContain("adelay=1250|1250");
		expect(result.filter).not.toContain("amix=");
		expect(result.finalLabel).toBe("[ae0]");
	});

	test("clip-audio + one element mixes into [finala] via amix=2", () => {
		const result = buildAudioMixChain({
			clipChainLabel: "[outa]",
			audioElements: [
				{
					mediaId: "a",
					storageKey: "k",
					startTimeSeconds: 0,
					durationSeconds: 4,
					trimStartSeconds: 0,
					trimEndSeconds: 0,
					volume: 1,
					role: "music",
				},
			],
			firstAudioInputIndex: 4,
		});
		expect(result.filter).toContain("amix=inputs=2:duration=longest:dropout_transition=0[finala]");
		expect(result.finalLabel).toBe("[finala]");
		// The mix order should put [outa] first, then [ae0]
		expect(result.filter).toMatch(/\[outa\]\[ae0\]amix=/);
	});

	test("multiple elements without clip audio still mix together", () => {
		const result = buildAudioMixChain({
			clipChainLabel: null,
			audioElements: [
				{
					mediaId: "a",
					storageKey: "k1",
					startTimeSeconds: 0,
					durationSeconds: 4,
					trimStartSeconds: 0,
					trimEndSeconds: 0,
					volume: 1,
					role: "music",
				},
				{
					mediaId: "b",
					storageKey: "k2",
					startTimeSeconds: 0,
					durationSeconds: 4,
					trimStartSeconds: 0,
					trimEndSeconds: 0,
					volume: 1,
					role: "sfx",
				},
			],
			firstAudioInputIndex: 4,
		});
		expect(result.filter).toContain("amix=inputs=2");
		expect(result.finalLabel).toBe("[finala]");
		expect(result.filter).toMatch(/\[ae0\]\[ae1\]amix=/);
	});

	test("trims pass through to atrim correctly", () => {
		const result = buildAudioMixChain({
			clipChainLabel: null,
			audioElements: [
				{
					mediaId: "a",
					storageKey: "k",
					startTimeSeconds: 0,
					durationSeconds: 2,
					trimStartSeconds: 0.5,
					trimEndSeconds: 0,
					volume: 1,
					role: "voiceover",
				},
			],
			firstAudioInputIndex: 4,
		});
		expect(result.filter).toContain("atrim=start=0.500:duration=2.000");
	});
});

describe("buildVideoFilterGraphFfmpegInvocation with audio elements", () => {
	test("emits N media -i + image -loop 1 -i + audio -i in that order", () => {
		const invocation = buildVideoFilterGraphFfmpegInvocation({
			plan: {
				kind: "video-filter-graph",
				canvasSize: { width: 1080, height: 1920 },
				includeAudio: true,
				format: "mp4",
				quality: "high",
				clips: [
					{
						mediaId: "v_a",
						storageKey: "k_v",
						durationSeconds: 4,
						trimStartSeconds: 0,
						trimEndSeconds: 0,
						transitionInFromPrev: null,
					},
				],
				textOverlays: [],
				imageOverlays: [],
				audioElements: [
					{
						mediaId: "audio_a",
						storageKey: "k_a",
						startTimeSeconds: 0.5,
						durationSeconds: 3,
						trimStartSeconds: 0,
						trimEndSeconds: 0,
						volume: 1,
						role: "music",
					},
				],
			},
			outputPath: "/tmp/out.mp4",
			supportSummary: [],
			mediaInputPaths: ["/tmp/v_a.mp4"],
			audioInputPaths: ["/tmp/audio_a.wav"],
		});
		// Inputs: 1 video + 0 image + 1 audio = 2 -i flags total
		const inputCount = invocation.args.filter((a) => a === "-i").length;
		expect(inputCount).toBe(2);
		const filterValue =
			invocation.args[invocation.args.indexOf("-filter_complex") + 1]!;
		// Audio element is input index 1 → [1:a]
		expect(filterValue).toContain("[1:a]");
		expect(filterValue).toContain("amix=inputs=2");
		// Final audio map should be [finala]
		const mapValues = invocation.args
			.map((a, i) => (a === "-map" ? invocation.args[i + 1] : null))
			.filter((v): v is string => v !== null);
		expect(mapValues).toContain("[finala]");
	});

	test("throws when audioInputPaths length doesn't match audioElements", () => {
		expect(() =>
			buildVideoFilterGraphFfmpegInvocation({
				plan: {
					kind: "video-filter-graph",
					canvasSize: { width: 1080, height: 1920 },
					includeAudio: true,
					format: "mp4",
					quality: "high",
					clips: [
						{
							mediaId: "v_a",
							storageKey: "k_v",
							durationSeconds: 4,
							trimStartSeconds: 0,
							trimEndSeconds: 0,
							transitionInFromPrev: null,
						},
					],
					textOverlays: [],
					imageOverlays: [],
					audioElements: [
						{
							mediaId: "audio_a",
							storageKey: "k_a",
							startTimeSeconds: 0,
							durationSeconds: 3,
							trimStartSeconds: 0,
							trimEndSeconds: 0,
							volume: 1,
							role: "music",
						},
					],
				},
				outputPath: "/tmp/out.mp4",
				supportSummary: [],
				mediaInputPaths: ["/tmp/v_a.mp4"],
				audioInputPaths: [],
			}),
		).toThrow(/expected 1 audio input paths/i);
	});
});

describe("buildAudioMixChain per-element polish (fade, normalization)", () => {
	test("emits afade=t=in for fadeInSeconds > 0", () => {
		const result = buildAudioMixChain({
			clipChainLabel: null,
			audioElements: [
				{
					mediaId: "a",
					storageKey: "k",
					startTimeSeconds: 0,
					durationSeconds: 4,
					trimStartSeconds: 0,
					trimEndSeconds: 0,
					volume: 1,
					role: "voiceover",
					fadeInSeconds: 0.5,
				},
			],
			firstAudioInputIndex: 4,
		});
		expect(result.filter).toContain("afade=t=in:st=0:d=0.500");
	});

	test("emits afade=t=out with start = duration - fadeOut", () => {
		const result = buildAudioMixChain({
			clipChainLabel: null,
			audioElements: [
				{
					mediaId: "a",
					storageKey: "k",
					startTimeSeconds: 0,
					durationSeconds: 6,
					trimStartSeconds: 0,
					trimEndSeconds: 0,
					volume: 1,
					role: "music",
					fadeOutSeconds: 1,
				},
			],
			firstAudioInputIndex: 4,
		});
		expect(result.filter).toContain("afade=t=out:st=5.000:d=1.000");
	});

	test("emits volume=NdB filter for normalizationGainDb", () => {
		const result = buildAudioMixChain({
			clipChainLabel: null,
			audioElements: [
				{
					mediaId: "a",
					storageKey: "k",
					startTimeSeconds: 0,
					durationSeconds: 4,
					trimStartSeconds: 0,
					trimEndSeconds: 0,
					volume: 1,
					role: "voiceover",
					normalizationGainDb: -3,
				},
			],
			firstAudioInputIndex: 4,
		});
		expect(result.filter).toContain("volume=-3.00dB");
	});

	test("does not emit afade or normalization filters when knobs are zero/absent", () => {
		const result = buildAudioMixChain({
			clipChainLabel: null,
			audioElements: [
				{
					mediaId: "a",
					storageKey: "k",
					startTimeSeconds: 0,
					durationSeconds: 4,
					trimStartSeconds: 0,
					trimEndSeconds: 0,
					volume: 1,
					role: "voiceover",
				},
			],
			firstAudioInputIndex: 4,
		});
		expect(result.filter).not.toContain("afade=");
		expect(result.filter).not.toContain("dB");
	});
});

describe("buildAudioMixChain master volume", () => {
	test("appends a final volume= stage when masterVolume !== 1", () => {
		const result = buildAudioMixChain({
			clipChainLabel: "[outa]",
			audioElements: [
				{
					mediaId: "a",
					storageKey: "k",
					startTimeSeconds: 0,
					durationSeconds: 4,
					trimStartSeconds: 0,
					trimEndSeconds: 0,
					volume: 1,
					role: "music",
				},
			],
			firstAudioInputIndex: 4,
			audioSettings: { masterVolume: 0.6, ducking: null },
		});
		// Mix is now [premix], master volume produces [finala]
		expect(result.filter).toContain("amix=inputs=2");
		expect(result.filter).toContain("[premix]volume=0.600[finala]");
		expect(result.finalLabel).toBe("[finala]");
	});

	test("masterVolume = 1 leaves the mix label unchanged", () => {
		const result = buildAudioMixChain({
			clipChainLabel: "[outa]",
			audioElements: [
				{
					mediaId: "a",
					storageKey: "k",
					startTimeSeconds: 0,
					durationSeconds: 4,
					trimStartSeconds: 0,
					trimEndSeconds: 0,
					volume: 1,
					role: "music",
				},
			],
			firstAudioInputIndex: 4,
			audioSettings: { masterVolume: 1, ducking: null },
		});
		expect(result.filter).not.toContain("[premix]");
		expect(result.finalLabel).toBe("[finala]");
	});
});

describe("buildAudioMixChain ducking", () => {
	test("does nothing when ducking enabled but no voiceover present", () => {
		const result = buildAudioMixChain({
			clipChainLabel: null,
			audioElements: [
				{
					mediaId: "a",
					storageKey: "k1",
					startTimeSeconds: 0,
					durationSeconds: 4,
					trimStartSeconds: 0,
					trimEndSeconds: 0,
					volume: 1,
					role: "music",
				},
			],
			firstAudioInputIndex: 4,
			audioSettings: {
				masterVolume: 1,
				ducking: { enabled: true, amount: 0.5, attackMs: 50, releaseMs: 250 },
			},
		});
		expect(result.filter).not.toContain("sidechaincompress=");
	});

	test("does nothing when ducking enabled but only voiceover present", () => {
		const result = buildAudioMixChain({
			clipChainLabel: null,
			audioElements: [
				{
					mediaId: "v",
					storageKey: "kv",
					startTimeSeconds: 0,
					durationSeconds: 4,
					trimStartSeconds: 0,
					trimEndSeconds: 0,
					volume: 1,
					role: "voiceover",
				},
			],
			firstAudioInputIndex: 4,
			audioSettings: {
				masterVolume: 1,
				ducking: { enabled: true, amount: 0.5, attackMs: 50, releaseMs: 250 },
			},
		});
		expect(result.filter).not.toContain("sidechaincompress=");
	});

	test("with one voiceover + one music, applies sidechaincompress on music", () => {
		const result = buildAudioMixChain({
			clipChainLabel: null,
			audioElements: [
				{
					mediaId: "v",
					storageKey: "kv",
					startTimeSeconds: 0,
					durationSeconds: 4,
					trimStartSeconds: 0,
					trimEndSeconds: 0,
					volume: 1,
					role: "voiceover",
				},
				{
					mediaId: "m",
					storageKey: "km",
					startTimeSeconds: 0,
					durationSeconds: 8,
					trimStartSeconds: 0,
					trimEndSeconds: 0,
					volume: 1,
					role: "music",
				},
			],
			firstAudioInputIndex: 4,
			audioSettings: {
				masterVolume: 1,
				ducking: { enabled: true, amount: 0.5, attackMs: 60, releaseMs: 220 },
			},
		});
		expect(result.filter).toContain("asplit=2[voice_main][voice_sc]");
		expect(result.filter).toContain("sidechaincompress=threshold=0.05:ratio=4.50:attack=60:release=220");
		// Final mix combines voice_main + duck0
		expect(result.filter).toMatch(/\[voice_main\]\[duck0\]amix=/);
	});

	test("multiple non-voice elements each get a unique sidechain alias", () => {
		const result = buildAudioMixChain({
			clipChainLabel: null,
			audioElements: [
				{
					mediaId: "v",
					storageKey: "kv",
					startTimeSeconds: 0,
					durationSeconds: 4,
					trimStartSeconds: 0,
					trimEndSeconds: 0,
					volume: 1,
					role: "voiceover",
				},
				{
					mediaId: "m",
					storageKey: "km",
					startTimeSeconds: 0,
					durationSeconds: 8,
					trimStartSeconds: 0,
					trimEndSeconds: 0,
					volume: 1,
					role: "music",
				},
				{
					mediaId: "s",
					storageKey: "ks",
					startTimeSeconds: 1,
					durationSeconds: 2,
					trimStartSeconds: 0,
					trimEndSeconds: 0,
					volume: 1,
					role: "sfx",
				},
			],
			firstAudioInputIndex: 4,
			audioSettings: {
				masterVolume: 1,
				ducking: { enabled: true, amount: 0.5, attackMs: 50, releaseMs: 250 },
			},
		});
		expect(result.filter).toContain("[voice_sc]asplit=2[voice_sc][voice_sc1]");
		expect(result.filter).toContain("[duck0]");
		expect(result.filter).toContain("[duck1]");
	});
});

describe("plan-builder threads project audio settings into video-filter-graph", () => {
	test("non-default masterVolume triggers filter-graph plan and is captured", () => {
		const project = makeProject({
			scenes: [
				makeMainScene({
					elements: [makeVideoElement({ mediaId: "v_a", duration: 4 })],
				}),
			],
		});
		project.settings = {
			...project.settings,
			audio: {
				masterVolume: 0.7,
				duckingEnabled: false,
				duckingAmount: 0,
				duckingAttackMs: 50,
				duckingReleaseMs: 250,
			},
		};
		const input = buildRenderGraphInput({
			project,
			format: "mp4",
			quality: "high",
			includeAudio: true,
			publishDestination: "generic-export",
			mediaRefs: [{ mediaId: "v_a", cloudStorageKey: "k_v" }],
		});
		const plan = buildFfmpegPlan({ input, features: { audioMixing: true } });
		expect(plan.kind).toBe("video-filter-graph");
		if (plan.kind !== "video-filter-graph") return;
		expect(plan.audioSettings?.masterVolume).toBe(0.7);
		expect(plan.audioSettings?.ducking).toBeNull();
	});

	test("ducking enabled in project settings flows into plan with knobs", () => {
		const project = makeProject({
			scenes: [
				makeMainScene({
					elements: [makeVideoElement({ mediaId: "v_a", duration: 4 })],
				}),
			],
		});
		project.settings = {
			...project.settings,
			audio: {
				masterVolume: 1,
				duckingEnabled: true,
				duckingAmount: 0.6,
				duckingAttackMs: 70,
				duckingReleaseMs: 300,
			},
		};
		const input = buildRenderGraphInput({
			project,
			format: "mp4",
			quality: "high",
			includeAudio: true,
			publishDestination: "generic-export",
			mediaRefs: [{ mediaId: "v_a", cloudStorageKey: "k_v" }],
		});
		const plan = buildFfmpegPlan({ input, features: { audioMixing: true } });
		expect(plan.kind).toBe("video-filter-graph");
		if (plan.kind !== "video-filter-graph") return;
		expect(plan.audioSettings?.ducking).toEqual({
			enabled: true,
			amount: 0.6,
			attackMs: 70,
			releaseMs: 300,
		});
	});
});

describe("buildAtempoChain", () => {
	test("returns empty for playbackRate=1", () => {
		expect(buildAtempoChain({ playbackRate: 1 })).toEqual([]);
	});

	test("returns empty for invalid (zero/negative/NaN) playbackRate", () => {
		expect(buildAtempoChain({ playbackRate: 0 })).toEqual([]);
		expect(buildAtempoChain({ playbackRate: -2 })).toEqual([]);
		expect(buildAtempoChain({ playbackRate: Number.NaN })).toEqual([]);
	});

	test("single stage for in-range rate (0.5 ≤ N ≤ 100)", () => {
		expect(buildAtempoChain({ playbackRate: 2 })).toEqual([
			"atempo=2.000000",
		]);
		expect(buildAtempoChain({ playbackRate: 0.75 })).toEqual([
			"atempo=0.750000",
		]);
	});

	test("chains atempo for very-slow rate (< 0.5)", () => {
		const chain = buildAtempoChain({ playbackRate: 0.25 });
		// 0.5 * 0.5 = 0.25
		expect(chain.length).toBe(2);
		expect(chain[0]).toBe("atempo=0.5");
		expect(chain[1]).toBe("atempo=0.500000");
	});

	test("chains atempo for very-fast rate (> 100)", () => {
		const chain = buildAtempoChain({ playbackRate: 200 });
		expect(chain.length).toBe(2);
		expect(chain[0]).toBe("atempo=100");
		expect(chain[1]).toBe("atempo=2.000000");
	});
});

describe("buildXfadeChainFilter applies setpts for playbackRate", () => {
	test("emits setpts=PTS/N when playbackRate ≠ 1, after trim and before scale", () => {
		const result = buildXfadeChainFilter({
			canvasSize: { width: 1080, height: 1920 },
			clips: [
				{
					mediaId: "a",
					storageKey: "k_a",
					durationSeconds: 4,
					trimStartSeconds: 0.5,
					trimEndSeconds: 0,
					transitionInFromPrev: null,
					playbackRate: 2,
				},
			],
		});
		expect(result.filter).toContain("setpts=PTS/2.000000");
		const trimIdx = result.filter.indexOf("trim=");
		const setptsIdx = result.filter.indexOf("setpts=PTS/");
		const scaleIdx = result.filter.indexOf("scale=");
		expect(trimIdx).toBeGreaterThan(-1);
		expect(setptsIdx).toBeGreaterThan(trimIdx);
		expect(scaleIdx).toBeGreaterThan(setptsIdx);
	});

	test("trim duration switches to source-time (timeline duration * playbackRate)", () => {
		const result = buildXfadeChainFilter({
			canvasSize: { width: 1080, height: 1920 },
			clips: [
				{
					mediaId: "a",
					storageKey: "k_a",
					durationSeconds: 4,
					trimStartSeconds: 1,
					trimEndSeconds: 0,
					transitionInFromPrev: null,
					playbackRate: 2,
				},
			],
		});
		// Source duration consumed = 4 * 2 = 8s
		expect(result.filter).toContain("trim=start=1.000:duration=8.000");
	});

	test("playbackRate=1 keeps trim duration at timeline duration and omits setpts", () => {
		const result = buildXfadeChainFilter({
			canvasSize: { width: 1080, height: 1920 },
			clips: [
				{
					mediaId: "a",
					storageKey: "k_a",
					durationSeconds: 4,
					trimStartSeconds: 1,
					trimEndSeconds: 0,
					transitionInFromPrev: null,
				},
			],
		});
		expect(result.filter).toContain("trim=start=1.000:duration=4.000");
		expect(result.filter).not.toContain("setpts=PTS/");
	});
});

describe("buildAcrossfadeChainFilter applies atempo for playbackRate", () => {
	test("emits atempo=N when playbackRate ≠ 1", () => {
		const result = buildAcrossfadeChainFilter({
			clips: [
				{
					mediaId: "a",
					storageKey: "k",
					durationSeconds: 4,
					trimStartSeconds: 0.5,
					trimEndSeconds: 0,
					transitionInFromPrev: null,
					playbackRate: 0.5,
				},
			],
		});
		expect(result.filter).toContain("atempo=0.500000");
		// Source duration = 4 * 0.5 = 2s
		expect(result.filter).toContain("atrim=start=0.500:duration=2.000");
	});

	test("playbackRate=1 emits anull (no trim, no atempo) for untrimmed clip", () => {
		const result = buildAcrossfadeChainFilter({
			clips: [
				{
					mediaId: "a",
					storageKey: "k",
					durationSeconds: 4,
					trimStartSeconds: 0,
					trimEndSeconds: 0,
					transitionInFromPrev: null,
				},
			],
		});
		expect(result.filter).toBe("[0:a]anull[a0]");
	});
});

describe("buildAudioMixChain applies atempo for playbackRate on dedicated audio elements", () => {
	test("emits atempo and adjusts atrim to source-time", () => {
		const result = buildAudioMixChain({
			clipChainLabel: null,
			audioElements: [
				{
					mediaId: "a",
					storageKey: "k",
					startTimeSeconds: 0,
					durationSeconds: 4,
					trimStartSeconds: 0.25,
					trimEndSeconds: 0,
					volume: 1,
					role: "voiceover",
					playbackRate: 2,
				},
			],
			firstAudioInputIndex: 4,
		});
		// Source duration = 4 * 2 = 8s
		expect(result.filter).toContain("atrim=start=0.250:duration=8.000");
		expect(result.filter).toContain("atempo=2.000000");
	});

	test("chained atempo for very-slow rate appears between asetpts and volume/fades", () => {
		const result = buildAudioMixChain({
			clipChainLabel: null,
			audioElements: [
				{
					mediaId: "a",
					storageKey: "k",
					startTimeSeconds: 0,
					durationSeconds: 4,
					trimStartSeconds: 0,
					trimEndSeconds: 0,
					volume: 0.5,
					role: "music",
					playbackRate: 0.25,
				},
			],
			firstAudioInputIndex: 4,
		});
		expect(result.filter).toContain("atempo=0.5,atempo=0.500000");
		const atempoIdx = result.filter.indexOf("atempo=0.5,");
		const volumeIdx = result.filter.indexOf("volume=0.500");
		expect(atempoIdx).toBeGreaterThan(-1);
		expect(volumeIdx).toBeGreaterThan(atempoIdx);
	});
});

describe("buildFfmpegPlan with playbackRate", () => {
	test("video clip with playbackRate ≠ 1 forces filter-graph", () => {
		const input = buildRenderGraphInput({
			project: makeProject({
				scenes: [
					makeMainScene({
						elements: [
							makeVideoElement({
								id: "a",
								mediaId: "v_a",
								duration: 4,
								playbackRate: 2,
							}),
						],
					}),
				],
			}),
			format: "mp4",
			quality: "high",
			includeAudio: false,
			publishDestination: "generic-export",
			mediaRefs: [{ mediaId: "v_a", cloudStorageKey: "k_v" }],
		});
		const plan = buildFfmpegPlan({ input });
		expect(plan.kind).toBe("video-filter-graph");
		if (plan.kind !== "video-filter-graph") return;
		expect(plan.clips[0]!.playbackRate).toBe(2);
	});

	test("audio element with playbackRate ≠ 1 forces filter-graph (with audioMixing on)", () => {
		const input = buildRenderGraphInput({
			project: makeProject({
				scenes: [
					makeSceneWithVideoAndAudio({
						video: [makeVideoElement({ mediaId: "v_a" })],
						audio: [
							makeUploadAudioElement({
								mediaId: "audio_a",
								playbackRate: 0.5,
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
				{ mediaId: "v_a", cloudStorageKey: "k_v" },
				{ mediaId: "audio_a", cloudStorageKey: "k_a" },
			],
		});
		const plan = buildFfmpegPlan({ input, features: { audioMixing: true } });
		expect(plan.kind).toBe("video-filter-graph");
		if (plan.kind !== "video-filter-graph") return;
		expect(plan.audioElements?.[0]!.playbackRate).toBe(0.5);
	});

	test("invalid playbackRate (zero or negative) falls back to 1 and stays video-concat", () => {
		const input = buildRenderGraphInput({
			project: makeProject({
				scenes: [
					makeMainScene({
						elements: [
							makeVideoElement({
								id: "a",
								mediaId: "v_a",
								duration: 4,
								playbackRate: 0,
							}),
						],
					}),
				],
			}),
			format: "mp4",
			quality: "high",
			includeAudio: false,
			publishDestination: "generic-export",
			mediaRefs: [{ mediaId: "v_a", cloudStorageKey: "k_v" }],
		});
		const plan = buildFfmpegPlan({ input });
		expect(plan.kind).toBe("video-concat");
	});
});

function makeLibraryAudioElement(
	overrides: Partial<LibraryAudioElement> = {},
): LibraryAudioElement {
	return {
		id: "lae_1",
		name: "library-sfx.wav",
		type: "audio",
		sourceType: "library",
		sourceUrl: "/library/sfx/click.wav",
		duration: 1.5,
		startTime: 2,
		trimStart: 0,
		trimEnd: 0,
		volume: 0.8,
		role: "sfx",
		...overrides,
	} as LibraryAudioElement;
}

function makeSceneWithLibraryAudio({
	video,
	library,
}: {
	video: VideoElement[];
	library: LibraryAudioElement[];
}): TScene {
	const videoTrack: VideoTrack = {
		id: "track_main",
		name: "Main",
		type: "video",
		isMain: true,
		muted: false,
		hidden: false,
		elements: video,
	};
	const audioTrack: AudioTrack = {
		id: "track_audio_lib",
		name: "Library Audio",
		type: "audio",
		muted: false,
		elements: library,
	};
	return {
		id: "scene_lib",
		name: "library scene",
		isMain: true,
		tracks: [videoTrack, audioTrack],
		bookmarks: [],
		createdAt: new Date(),
		updatedAt: new Date(),
	};
}

describe("buildFfmpegPlan with library audio elements", () => {
	test("library audio elements are skipped when audioMixing flag is off", () => {
		const input = buildRenderGraphInput({
			project: makeProject({
				scenes: [
					makeSceneWithLibraryAudio({
						video: [makeVideoElement({ mediaId: "v_a" })],
						library: [makeLibraryAudioElement()],
					}),
				],
			}),
			format: "mp4",
			quality: "high",
			includeAudio: true,
			publishDestination: "generic-export",
			mediaRefs: [{ mediaId: "v_a", cloudStorageKey: "k_v" }],
		});
		const plan = buildFfmpegPlan({ input });
		expect(plan.kind).toBe("video-concat");
	});

	test("library audio is included when audioMixing flag is on (no missing-media error)", () => {
		const input = buildRenderGraphInput({
			project: makeProject({
				scenes: [
					makeSceneWithLibraryAudio({
						video: [makeVideoElement({ mediaId: "v_a" })],
						library: [
							makeLibraryAudioElement({
								id: "lae_a",
								sourceUrl: "/library/sfx/typing.wav",
								startTime: 1,
								duration: 2,
								volume: 0.5,
								role: "sfx",
							}),
						],
					}),
				],
			}),
			format: "mp4",
			quality: "high",
			includeAudio: true,
			publishDestination: "generic-export",
			mediaRefs: [{ mediaId: "v_a", cloudStorageKey: "k_v" }],
		});
		const plan = buildFfmpegPlan({ input, features: { audioMixing: true } });
		expect(plan.kind).toBe("video-filter-graph");
		if (plan.kind !== "video-filter-graph") return;
		expect(plan.audioElements).toHaveLength(1);
		const audio = plan.audioElements?.[0]!;
		expect(audio.sourceUrl).toBe("/library/sfx/typing.wav");
		expect(audio.storageKey ?? null).toBeNull();
		expect(audio.role).toBe("sfx");
		expect(audio.startTimeSeconds).toBe(1);
	});

	test("muted library audio is dropped (track or element)", () => {
		const input = buildRenderGraphInput({
			project: makeProject({
				scenes: [
					makeSceneWithLibraryAudio({
						video: [makeVideoElement({ mediaId: "v_a" })],
						library: [
							makeLibraryAudioElement({ id: "lae_off", muted: true }),
						],
					}),
				],
			}),
			format: "mp4",
			quality: "high",
			includeAudio: true,
			publishDestination: "generic-export",
			mediaRefs: [{ mediaId: "v_a", cloudStorageKey: "k_v" }],
		});
		const plan = buildFfmpegPlan({ input, features: { audioMixing: true } });
		expect(plan.kind).toBe("video-concat");
	});

	test("mixed upload + library audio both flow into the plan", () => {
		const input = buildRenderGraphInput({
			project: makeProject({
				scenes: [
					{
						id: "scene_mixed",
						name: "mixed",
						isMain: true,
						bookmarks: [],
						createdAt: new Date(),
						updatedAt: new Date(),
						tracks: [
							{
								id: "tv",
								name: "Main",
								type: "video",
								isMain: true,
								muted: false,
								hidden: false,
								elements: [makeVideoElement({ mediaId: "v_a" })],
							},
							{
								id: "ta",
								name: "Audio",
								type: "audio",
								muted: false,
								elements: [
									makeUploadAudioElement({
										id: "voice_one",
										mediaId: "audio_voice",
										role: "voiceover",
									}),
									makeLibraryAudioElement({
										id: "music_lib",
										sourceUrl: "/library/music/upbeat.mp3",
										role: "music",
										startTime: 0,
										duration: 6,
									}),
								],
							},
						],
					},
				],
			}),
			format: "mp4",
			quality: "high",
			includeAudio: true,
			publishDestination: "generic-export",
			mediaRefs: [
				{ mediaId: "v_a", cloudStorageKey: "k_v" },
				{ mediaId: "audio_voice", cloudStorageKey: "k_voice" },
			],
		});
		const plan = buildFfmpegPlan({ input, features: { audioMixing: true } });
		expect(plan.kind).toBe("video-filter-graph");
		if (plan.kind !== "video-filter-graph") return;
		expect(plan.audioElements).toHaveLength(2);
		const upload = plan.audioElements?.find((e) => e.role === "voiceover");
		const library = plan.audioElements?.find((e) => e.role === "music");
		expect(upload?.storageKey).toBe("k_voice");
		expect(upload?.sourceUrl ?? null).toBeNull();
		expect(library?.sourceUrl).toBe("/library/music/upbeat.mp3");
		expect(library?.storageKey ?? null).toBeNull();
	});
});

describe("buildColorBalanceFilter", () => {
	test("returns null when all extra knobs are zero", () => {
		expect(
			buildColorBalanceFilter({
				adjustments: {
					exposure: 0.5,
					contrast: 0.2,
					saturation: 0.1,
					temperature: 0,
					tint: 0,
					highlights: 0,
					shadows: 0,
				},
			}),
		).toBeNull();
	});

	test("returns null when extra knobs are absent (undefined)", () => {
		expect(
			buildColorBalanceFilter({
				adjustments: { exposure: 0.5, contrast: 0, saturation: 0 },
			}),
		).toBeNull();
	});

	test("temperature: positive (warm) emits +rm and -bm in midtones", () => {
		const filter = buildColorBalanceFilter({
			adjustments: {
				exposure: 0,
				contrast: 0,
				saturation: 0,
				temperature: 0.4,
				tint: 0,
				highlights: 0,
				shadows: 0,
			},
		});
		expect(filter).toBe("colorbalance=rm=0.400:bm=-0.400");
	});

	test("temperature: negative (cold) flips the sign", () => {
		const filter = buildColorBalanceFilter({
			adjustments: {
				exposure: 0,
				contrast: 0,
				saturation: 0,
				temperature: -0.6,
				tint: 0,
				highlights: 0,
				shadows: 0,
			},
		});
		expect(filter).toContain("rm=-0.600");
		expect(filter).toContain("bm=0.600");
	});

	test("tint: positive (magenta) emits negative gm in midtones", () => {
		const filter = buildColorBalanceFilter({
			adjustments: {
				exposure: 0,
				contrast: 0,
				saturation: 0,
				temperature: 0,
				tint: 0.3,
				highlights: 0,
				shadows: 0,
			},
		});
		expect(filter).toBe("colorbalance=gm=-0.300");
	});

	test("highlights: shifts every channel in the highlight bucket", () => {
		const filter = buildColorBalanceFilter({
			adjustments: {
				exposure: 0,
				contrast: 0,
				saturation: 0,
				temperature: 0,
				tint: 0,
				highlights: 0.5,
				shadows: 0,
			},
		});
		expect(filter).toBe("colorbalance=rh=0.500:gh=0.500:bh=0.500");
	});

	test("shadows: shifts every channel in the shadow bucket", () => {
		const filter = buildColorBalanceFilter({
			adjustments: {
				exposure: 0,
				contrast: 0,
				saturation: 0,
				temperature: 0,
				tint: 0,
				highlights: 0,
				shadows: -0.4,
			},
		});
		expect(filter).toBe("colorbalance=rs=-0.400:gs=-0.400:bs=-0.400");
	});

	test("clamps each knob to [-1, 1]", () => {
		const filter = buildColorBalanceFilter({
			adjustments: {
				exposure: 0,
				contrast: 0,
				saturation: 0,
				temperature: 5,
				tint: -3,
				highlights: 99,
				shadows: -50,
			},
		});
		// temperature: clamp(5, -1, 1) = 1 → rm=1.000, bm=-1.000
		expect(filter).toContain("rm=1.000");
		expect(filter).toContain("bm=-1.000");
		// tint: clamp(-3, -1, 1) = -1; gm = -tint = 1.000
		expect(filter).toContain("gm=1.000");
		// highlights: clamp(99) = 1 → rh/gh/bh = 1.000
		expect(filter).toContain("rh=1.000");
		// shadows: clamp(-50) = -1 → rs/gs/bs = -1.000
		expect(filter).toContain("rs=-1.000");
	});

	test("combines multiple knobs into a single colorbalance filter", () => {
		const filter = buildColorBalanceFilter({
			adjustments: {
				exposure: 0,
				contrast: 0,
				saturation: 0,
				temperature: 0.2,
				tint: 0.1,
				highlights: 0.3,
				shadows: -0.2,
			},
		});
		expect(filter?.startsWith("colorbalance=")).toBe(true);
		expect(filter).toContain("rm=0.200");
		expect(filter).toContain("gm=-0.100");
		expect(filter).toContain("rh=0.300");
		expect(filter).toContain("rs=-0.200");
	});
});

describe("xfade chain wires colorbalance after eq", () => {
	test("emits eq then colorbalance, both before format=yuv420p", () => {
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
					adjustments: {
						exposure: 0.1,
						contrast: 0,
						saturation: 0,
						temperature: 0.2,
						tint: 0,
						highlights: 0,
						shadows: 0,
					},
					effects: [],
				},
			],
		});
		const eqIdx = result.filter.indexOf("eq=brightness");
		const cbIdx = result.filter.indexOf("colorbalance=");
		const fmtIdx = result.filter.indexOf("format=yuv420p");
		expect(eqIdx).toBeGreaterThan(-1);
		expect(cbIdx).toBeGreaterThan(eqIdx);
		expect(fmtIdx).toBeGreaterThan(cbIdx);
	});

	test("omits colorbalance entirely when only the eq knobs are set", () => {
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
					adjustments: { exposure: 0.1, contrast: 0, saturation: 0 },
					effects: [],
				},
			],
		});
		expect(result.filter).toContain("eq=brightness=0.100");
		expect(result.filter).not.toContain("colorbalance=");
	});
});

describe("buildKeyframeExpression", () => {
	test("returns the fallback when keyframes are empty / missing", () => {
		expect(
			buildKeyframeExpression({ keyframes: [], fallback: "0" }),
		).toBe("0");
		expect(
			buildKeyframeExpression({ keyframes: undefined, fallback: "1" }),
		).toBe("1");
		expect(
			buildKeyframeExpression({ keyframes: null, fallback: "2.5" }),
		).toBe("2.5");
	});

	test("single keyframe collapses to a constant", () => {
		expect(
			buildKeyframeExpression({
				keyframes: [{ timeSeconds: 1, value: 0.7 }],
				fallback: "0",
			}),
		).toBe("0.7");
	});

	test("two keyframes produce a single linear ramp with boundary clamps", () => {
		const expr = buildKeyframeExpression({
			keyframes: [
				{ timeSeconds: 0, value: 0 },
				{ timeSeconds: 2, value: 1 },
			],
			fallback: "0",
		});
		// Below the first keyframe time (0), value clamps to 0.
		expect(expr).toContain("if(lt(t,0),0,");
		// Inside [0, 2], lerp from 0 to 1 over span 2.
		expect(expr).toContain("(0+(1)*((t-0)/2))");
		// Above the last keyframe (t >= 2) the inner branch falls through to 1.
		expect(expr).toContain(",1)");
	});

	test("three keyframes produce two nested segments", () => {
		const expr = buildKeyframeExpression({
			keyframes: [
				{ timeSeconds: 0, value: 0 },
				{ timeSeconds: 1, value: 1 },
				{ timeSeconds: 3, value: 0 },
			],
			fallback: "0",
		});
		expect(expr).toContain("if(lt(t,1)");
		expect(expr).toContain("if(lt(t,3)");
		// First segment ramps 0→1 over span 1
		expect(expr).toContain("(0+(1)*((t-0)/1))");
		// Second segment ramps 1→0 over span 2
		expect(expr).toContain("(1+(-1)*((t-1)/2))");
	});

	test("transformValue is applied per keyframe value (e.g. degrees → radians)", () => {
		const expr = buildKeyframeExpression({
			keyframes: [
				{ timeSeconds: 0, value: 0 },
				{ timeSeconds: 1, value: 180 },
			],
			transformValue: (v) => v * (Math.PI / 180),
			fallback: "0",
		});
		// 180 degrees → π radians ≈ 3.141593
		expect(expr).toContain("3.141593");
	});

	test("unsorted input is sorted before building", () => {
		const expr = buildKeyframeExpression({
			keyframes: [
				{ timeSeconds: 2, value: 1 },
				{ timeSeconds: 0, value: 0 },
			],
			fallback: "0",
		});
		expect(expr).toContain("if(lt(t,0)");
		expect(expr).toContain("(0+(1)*((t-0)/2))");
	});
});

describe("buildRotateKeyframeFilter", () => {
	test("returns null for empty / missing keyframes", () => {
		expect(buildRotateKeyframeFilter({ keyframes: undefined })).toBeNull();
		expect(buildRotateKeyframeFilter({ keyframes: [] })).toBeNull();
	});

	test("emits rotate=… with radians + canvas-stable ow/oh", () => {
		const filter = buildRotateKeyframeFilter({
			keyframes: [
				{ timeSeconds: 0, value: 0 },
				{ timeSeconds: 1, value: 90 },
			],
		});
		expect(filter).not.toBeNull();
		expect(filter).toContain("rotate='");
		// 90 deg → π/2 radians ≈ 1.570796
		expect(filter).toContain("1.570796");
		expect(filter).toContain("fillcolor=black");
		expect(filter).toContain("ow=iw:oh=ih");
	});
});

describe("buildOpacityKeyframeFilter", () => {
	test("returns null when there are no keyframes", () => {
		expect(
			buildOpacityKeyframeFilter({
				keyframes: undefined,
				startTimeSeconds: 0,
			}),
		).toBeNull();
	});

	test("emits colorchannelmixer=aa=… with eval=frame and clamps values to [0,1]", () => {
		const filter = buildOpacityKeyframeFilter({
			keyframes: [
				{ timeSeconds: 0, value: -2 },
				{ timeSeconds: 1, value: 5 },
			],
			startTimeSeconds: 0,
		});
		expect(filter).toContain("colorchannelmixer=aa='");
		expect(filter).toContain(":eval=frame");
		// -2 clamps to 0 and 5 clamps to 1
		expect(filter).toMatch(/0\+\(1\)\*\(\(t-0\)\/1\)/);
	});

	test("shifts keyframe times by startTimeSeconds (canvas-zero coordinates)", () => {
		const filter = buildOpacityKeyframeFilter({
			keyframes: [
				{ timeSeconds: 0, value: 0 },
				{ timeSeconds: 2, value: 1 },
			],
			startTimeSeconds: 5,
		});
		// Keyframes shift to [5, 7]; below 5 clamps to 0, above 7 clamps to 1.
		expect(filter).toContain("if(lt(t,5),0,");
		expect(filter).toContain("if(lt(t,7)");
	});
});

describe("buildXfadeChainFilter applies rotate keyframes per clip", () => {
	test("emits rotate filter only when rotateKeyframes are set", () => {
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
					rotateKeyframes: [
						{ timeSeconds: 0, value: 0 },
						{ timeSeconds: 4, value: 360 },
					],
				},
			],
		});
		expect(result.filter).toContain("rotate='");
		const rotateIdx = result.filter.indexOf("rotate='");
		const formatIdx = result.filter.indexOf("format=yuv420p");
		expect(rotateIdx).toBeLessThan(formatIdx);
	});

	test("omits rotate when no keyframes are present", () => {
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
		expect(result.filter).not.toContain("rotate='");
	});
});

describe("buildOverlayFilterChain applies opacity keyframes for image overlays", () => {
	test("uses animated colorchannelmixer when opacityKeyframes are present", () => {
		const filter = buildOverlayFilterChain({
			textOverlays: [],
			imageOverlays: [
				{
					id: "img1",
					mediaId: "m1",
					storageKey: "k1",
					startTime: 0,
					endTime: 4,
					canvasOffset: { x: 540, y: 960 },
					scale: 1,
					opacity: 1,
					opacityKeyframes: [
						{ timeSeconds: 0, value: 0 },
						{ timeSeconds: 1, value: 1 },
					],
				},
			],
			imageInputs: [
				{
					startInputIndex: 1,
					overlay: {
						id: "img1",
						mediaId: "m1",
						storageKey: "k1",
						startTime: 0,
						endTime: 4,
						canvasOffset: { x: 540, y: 960 },
						scale: 1,
						opacity: 1,
						opacityKeyframes: [
							{ timeSeconds: 0, value: 0 },
							{ timeSeconds: 1, value: 1 },
						],
					},
				},
			],
		});
		expect(filter).toContain("format=rgba,colorchannelmixer=aa='");
		expect(filter).toContain(":eval=frame");
	});

	test("falls back to constant alpha for opacity<1 without keyframes", () => {
		const filter = buildOverlayFilterChain({
			textOverlays: [],
			imageOverlays: [
				{
					id: "img1",
					mediaId: "m1",
					storageKey: "k1",
					startTime: 0,
					endTime: 4,
					canvasOffset: { x: 540, y: 960 },
					scale: 1,
					opacity: 0.5,
				},
			],
			imageInputs: [
				{
					startInputIndex: 1,
					overlay: {
						id: "img1",
						mediaId: "m1",
						storageKey: "k1",
						startTime: 0,
						endTime: 4,
						canvasOffset: { x: 540, y: 960 },
						scale: 1,
						opacity: 0.5,
					},
				},
			],
		});
		expect(filter).toContain("colorchannelmixer=aa=0.5");
		expect(filter).not.toContain("eval=frame");
	});
});

describe("plan-builder routes to filter-graph for keyframe animations", () => {
	test("video clip with rotate keyframes routes to filter-graph and surfaces them", () => {
		const input = buildRenderGraphInput({
			project: makeProject({
				scenes: [
					makeMainScene({
						elements: [
							makeVideoElement({
								id: "a",
								mediaId: "v_a",
								duration: 4,
								keyframes: {
									rotate: [
										{ time: 0, value: 0 },
										{ time: 4, value: 90 },
									],
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
			mediaRefs: [{ mediaId: "v_a", cloudStorageKey: "k_v" }],
		});
		const plan = buildFfmpegPlan({
			input,
			features: { keyframeAnimations: true },
		});
		expect(plan.kind).toBe("video-filter-graph");
		if (plan.kind !== "video-filter-graph") return;
		expect(plan.clips[0]!.rotateKeyframes).toEqual([
			{ timeSeconds: 0, value: 0 },
			{ timeSeconds: 4, value: 90 },
		]);
	});

	test("flag off keeps clip on video-concat path even with keyframes set", () => {
		const input = buildRenderGraphInput({
			project: makeProject({
				scenes: [
					makeMainScene({
						elements: [
							makeVideoElement({
								id: "a",
								mediaId: "v_a",
								duration: 4,
								keyframes: {
									rotate: [
										{ time: 0, value: 0 },
										{ time: 4, value: 90 },
									],
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
			mediaRefs: [{ mediaId: "v_a", cloudStorageKey: "k_v" }],
		});
		const plan = buildFfmpegPlan({ input });
		expect(plan.kind).toBe("video-concat");
	});

	test("scale keyframes are reported as unsupported when flag is on", () => {
		const input = buildRenderGraphInput({
			project: makeProject({
				scenes: [
					makeMainScene({
						elements: [
							makeVideoElement({
								id: "a",
								mediaId: "v_a",
								duration: 4,
								keyframes: {
									scale: [
										{ time: 0, value: 1 },
										{ time: 4, value: 1.5 },
									],
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
			mediaRefs: [{ mediaId: "v_a", cloudStorageKey: "k_v" }],
		});
		// No rotate or supported keyframes → falls back to concat
		const plan = buildFfmpegPlan({
			input,
			features: { keyframeAnimations: true },
		});
		expect(plan.kind).toBe("video-concat");
	});
});
