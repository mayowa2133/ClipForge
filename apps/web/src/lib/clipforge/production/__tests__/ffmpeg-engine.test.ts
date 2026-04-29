import { describe, expect, test } from "bun:test";
import { buildFfmpegPlan } from "@/lib/clipforge/production/worker/ffmpeg-plan";
import { buildRenderGraphInput } from "@/lib/clipforge/production/render-graph";
import {
	FfmpegRenderEngine,
	type FfmpegRunner,
	type FileSystemAdapter,
	type MediaFetcher,
} from "@/lib/clipforge/production/worker/ffmpeg-engine";
import type { TProject } from "@/types/project";
import type { TScene, VideoElement, VideoTrack } from "@/types/timeline";

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
	elements: VideoElement[];
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
