import {
	buildBlackVideoFfmpegInvocation,
	buildConcatListFileContents,
	buildFfmpegPlan,
	buildVideoConcatFfmpegInvocation,
	buildVideoFilterGraphFfmpegInvocation,
	type FfmpegFeatureFlags,
	type FfmpegPlan,
	type PlanFilterGraphClip,
	type PlanImageOverlay,
} from "./ffmpeg-plan";
import type { RenderEngine } from "./export-worker";
import type {
	RenderGraphInput,
	RenderGraphMediaRef,
} from "@/lib/clipforge/production/render-graph";

export interface MediaFetcher {
	fetchToLocalPath(args: {
		mediaRef: RenderGraphMediaRef;
		mediaIndex: number;
	}): Promise<{ localPath: string; cleanup?: () => Promise<void> }>;
}

export interface FfmpegRunner {
	run(args: {
		ffmpegArgs: string[];
		onProgress: (pct: number) => Promise<void>;
	}): Promise<void>;
}

export interface FileSystemAdapter {
	makeTempDir(prefix: string): Promise<string>;
	writeTextFile(path: string, contents: string): Promise<void>;
	readBinaryFile(path: string): Promise<Uint8Array>;
	removeDir(path: string): Promise<void>;
	join(...parts: string[]): string;
}

export interface FfmpegRenderEngineArgs {
	ffmpegRunner: FfmpegRunner;
	mediaFetcher: MediaFetcher;
	fs: FileSystemAdapter;
	id?: string;
	features?: FfmpegFeatureFlags;
	fontFile?: string | null;
}

export class FfmpegRenderEngine implements RenderEngine {
	readonly id: string;
	private readonly ffmpegRunner: FfmpegRunner;
	private readonly mediaFetcher: MediaFetcher;
	private readonly fs: FileSystemAdapter;
	private readonly features: FfmpegFeatureFlags;
	private readonly fontFile: string | null;

	constructor({
		ffmpegRunner,
		mediaFetcher,
		fs,
		id = "clipforge-ffmpeg-renderer",
		features,
		fontFile = null,
	}: FfmpegRenderEngineArgs) {
		this.ffmpegRunner = ffmpegRunner;
		this.mediaFetcher = mediaFetcher;
		this.fs = fs;
		this.id = id;
		this.features = features ?? {};
		this.fontFile = fontFile;
	}

	async render({
		input,
		onProgress,
	}: {
		input: RenderGraphInput;
		onProgress: (pct: number) => Promise<void>;
	}): Promise<{
		body: BodyInit;
		bytes: number;
		contentType: string;
		stub: boolean;
		durationSeconds: number;
	}> {
		const plan = buildFfmpegPlan({ input, features: this.features });

		if (plan.kind === "unsupported") {
			throw new Error(
				`ffmpeg renderer cannot render this project yet: ${plan.reasons.join("; ")}`,
			);
		}

		const workDir = await this.fs.makeTempDir(`clipforge-render-${input.projectId}-`);
		const cleanups: Array<() => Promise<void>> = [
			async () => this.fs.removeDir(workDir),
		];

		try {
			await onProgress(10);
			const supportSummary = collectSupportSummary({ input, plan });
			let invocation: ReturnType<typeof buildBlackVideoFfmpegInvocation>;
			let durationSeconds: number;

			const imageInputPaths = await this.materializeImageOverlays({
				overlays: plan.imageOverlays,
				cleanups,
			});

			if (plan.kind === "black-video") {
				const outputPath = this.fs.join(workDir, outputFileNameForFormat(plan.format));
				invocation = buildBlackVideoFfmpegInvocation({
					plan,
					outputPath,
					supportSummary,
					imageInputPaths,
					fontFile: this.fontFile,
				});
				durationSeconds = plan.durationSeconds;
			} else if (plan.kind === "video-filter-graph") {
				const localClips = await this.materializeFilterGraphClips({
					clips: plan.clips,
					cleanups,
				});
				const outputPath = this.fs.join(workDir, outputFileNameForFormat(plan.format));
				invocation = buildVideoFilterGraphFfmpegInvocation({
					plan,
					outputPath,
					supportSummary,
					imageInputPaths,
					mediaInputPaths: localClips.map((c) => c.localPath),
					fontFile: this.fontFile,
				});
				durationSeconds = computeFilterGraphDuration(plan.clips);
			} else {
				const localClips = await this.materializeConcatClips({
					plan,
					workDir,
					cleanups,
				});
				const concatListPath = this.fs.join(workDir, "concat.txt");
				await this.fs.writeTextFile(
					concatListPath,
					buildConcatListFileContents({ clips: localClips }),
				);
				const outputPath = this.fs.join(workDir, outputFileNameForFormat(plan.format));
				invocation = buildVideoConcatFfmpegInvocation({
					plan,
					outputPath,
					concatListPath,
					supportSummary,
					imageInputPaths,
					fontFile: this.fontFile,
				});
				durationSeconds = localClips.reduce(
					(total, clip) => total + clip.durationSeconds,
					0,
				);
			}

			await onProgress(30);
			await this.ffmpegRunner.run({
				ffmpegArgs: invocation.args,
				onProgress: async (pct) => {
					await onProgress(Math.max(30, Math.min(90, 30 + Math.round(pct * 0.6))));
				},
			});
			await onProgress(95);

			const bytes = await this.fs.readBinaryFile(invocation.outputPath);
			return {
				body: bytes,
				bytes: bytes.byteLength,
				contentType: invocation.contentType,
				stub: false,
				durationSeconds,
			};
		} finally {
			for (const cleanup of cleanups.reverse()) {
				try {
					await cleanup();
				} catch {}
			}
		}
	}

	private async materializeImageOverlays({
		overlays,
		cleanups,
	}: {
		overlays: PlanImageOverlay[];
		cleanups: Array<() => Promise<void>>;
	}): Promise<string[]> {
		const paths: string[] = [];
		for (let i = 0; i < overlays.length; i += 1) {
			const overlay = overlays[i]!;
			const fetched = await this.mediaFetcher.fetchToLocalPath({
				mediaRef: {
					mediaId: overlay.mediaId,
					cloudStorageKey: overlay.storageKey,
				},
				mediaIndex: 1000 + i,
			});
			if (fetched.cleanup) cleanups.push(fetched.cleanup);
			paths.push(fetched.localPath);
		}
		return paths;
	}

	private async materializeFilterGraphClips({
		clips,
		cleanups,
	}: {
		clips: PlanFilterGraphClip[];
		cleanups: Array<() => Promise<void>>;
	}): Promise<Array<{ localPath: string; durationSeconds: number }>> {
		const localClips: Array<{ localPath: string; durationSeconds: number }> = [];
		for (let i = 0; i < clips.length; i += 1) {
			const clip = clips[i]!;
			const fetched = await this.mediaFetcher.fetchToLocalPath({
				mediaRef: {
					mediaId: clip.mediaId,
					cloudStorageKey: clip.storageKey,
				},
				mediaIndex: i,
			});
			if (fetched.cleanup) cleanups.push(fetched.cleanup);
			localClips.push({
				localPath: fetched.localPath,
				durationSeconds: clip.durationSeconds,
			});
		}
		return localClips;
	}

	private async materializeConcatClips({
		plan,
		workDir,
		cleanups,
	}: {
		plan: Extract<FfmpegPlan, { kind: "video-concat" }>;
		workDir: string;
		cleanups: Array<() => Promise<void>>;
	}): Promise<Array<{ localPath: string; durationSeconds: number }>> {
		const localClips: Array<{ localPath: string; durationSeconds: number }> = [];
		for (let i = 0; i < plan.clips.length; i += 1) {
			const clip = plan.clips[i]!;
			const fetched = await this.mediaFetcher.fetchToLocalPath({
				mediaRef: {
					mediaId: clip.mediaId,
					cloudStorageKey: clip.storageKey,
				},
				mediaIndex: i,
			});
			if (fetched.cleanup) cleanups.push(fetched.cleanup);
			localClips.push({
				localPath: fetched.localPath,
				durationSeconds: clip.durationSeconds,
			});
			void workDir;
		}
		return localClips;
	}
}

function outputFileNameForFormat(format: string): string {
	return format === "webm" ? "out.webm" : "out.mp4";
}

function collectSupportSummary({
	input,
	plan,
}: {
	input: RenderGraphInput;
	plan: FfmpegPlan;
}): string[] {
	if (plan.kind === "unsupported") return plan.reasons;
	const summary: string[] = [];
	if (plan.kind === "black-video" && input.project.scenes.length > 0) {
		summary.push("Project has scenes but no usable video clips on the main video track; rendered as black video.");
	}
	return summary;
}

function computeFilterGraphDuration(clips: PlanFilterGraphClip[]): number {
	if (clips.length === 0) return 0;
	let total = clips[0]!.durationSeconds;
	for (let i = 1; i < clips.length; i += 1) {
		const transition = clips[i]!.transitionInFromPrev;
		total += clips[i]!.durationSeconds - (transition?.durationSeconds ?? 0);
	}
	return total;
}
