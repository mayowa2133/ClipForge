import {
	type RenderEngine,
	StubRenderEngine,
	runExportWorkerLoop,
} from "../src/lib/clipforge/production/worker/export-worker";
import { FfmpegRenderEngine } from "../src/lib/clipforge/production/worker/ffmpeg-engine";
import {
	HttpMediaFetcher,
	NodeFileSystemAdapter,
	SpawnFfmpegRunner,
} from "../src/lib/clipforge/production/worker/ffmpeg-node-adapters";
import { HttpWorkerClient } from "../src/lib/clipforge/production/worker/http-client";

function readEnv(name: string): string | null {
	const value = process.env[name];
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

async function main() {
	const baseUrl = readEnv("CLIPFORGE_WORKER_BASE_URL") ?? "http://localhost:3000";
	const bearerSecret = readEnv("CLIPFORGE_WORKER_SECRET");
	const workerId =
		readEnv("CLIPFORGE_WORKER_ID") ?? `worker-${process.pid}-${Date.now()}`;
	const pollIntervalMs = Number.parseInt(
		readEnv("CLIPFORGE_WORKER_POLL_MS") ?? "2000",
		10,
	);
	const maxJobsRaw = readEnv("CLIPFORGE_WORKER_MAX_JOBS");
	const maxJobs = maxJobsRaw ? Number.parseInt(maxJobsRaw, 10) : Infinity;

	if (!bearerSecret) {
		console.error(
			"CLIPFORGE_WORKER_SECRET is required. Set it on both the Next.js server and the worker.",
		);
		process.exit(1);
	}

	console.log(
		`[export-worker] starting; base=${baseUrl} workerId=${workerId} pollMs=${pollIntervalMs} maxJobs=${maxJobs}`,
	);

	const controller = new AbortController();
	process.on("SIGINT", () => {
		console.log("[export-worker] SIGINT received, shutting down...");
		controller.abort();
	});
	process.on("SIGTERM", () => {
		console.log("[export-worker] SIGTERM received, shutting down...");
		controller.abort();
	});

	const http = new HttpWorkerClient({ baseUrl, bearerSecret, workerId });
	const rendererKind = (readEnv("CLIPFORGE_RENDERER") ?? "stub").toLowerCase();
	const engine: RenderEngine = await buildRenderEngine({
		kind: rendererKind,
		http,
	});
	console.log(`[export-worker] renderer=${engine.id}`);

	const summary = await runExportWorkerLoop({
		http,
		engine,
		pollIntervalMs,
		maxJobs,
		signal: controller.signal,
	});
	console.log(`[export-worker] processed ${summary.processed} jobs.`);
}

function parseFeatureFlags(raw: string | null): {
	textOverlays: boolean;
	imageOverlays: boolean;
	captionWordReveals: boolean;
	transitions: boolean;
} {
	const set = new Set(
		(raw ?? "")
			.split(",")
			.map((part) => part.trim().toLowerCase())
			.filter(Boolean),
	);
	const all = set.has("all");
	return {
		textOverlays: all || set.has("text") || set.has("text-overlays"),
		imageOverlays: all || set.has("image") || set.has("image-overlays"),
		captionWordReveals:
			all || set.has("captions") || set.has("caption-words") || set.has("words"),
		transitions: all || set.has("transitions") || set.has("xfade"),
	};
}

async function buildRenderEngine({
	kind,
	http,
}: {
	kind: string;
	http: HttpWorkerClient;
}): Promise<RenderEngine> {
	if (kind === "stub") return new StubRenderEngine();
	if (kind === "ffmpeg") {
		const fs = new NodeFileSystemAdapter();
		const workDir = await fs.makeTempDir("clipforge-worker-");
		const features = parseFeatureFlags(readEnv("CLIPFORGE_FFMPEG_FEATURES"));
		const fontFile = readEnv("CLIPFORGE_FFMPEG_DEFAULT_FONT");
		console.log(
			`[export-worker] ffmpeg features=${JSON.stringify(features)} font=${fontFile ?? "<system default>"}`,
		);
		return new FfmpegRenderEngine({
			ffmpegRunner: new SpawnFfmpegRunner({
				ffmpegBinary: readEnv("CLIPFORGE_FFMPEG_BIN") ?? "ffmpeg",
				logger: (line) => console.log(`[ffmpeg] ${line}`),
			}),
			mediaFetcher: new HttpMediaFetcher({ workerHttp: http, fs, workDir }),
			fs,
			features,
			fontFile,
		});
	}
	throw new Error(
		`Unknown CLIPFORGE_RENDERER=${kind}. Supported: stub, ffmpeg.`,
	);
}

main().catch((error) => {
	console.error("[export-worker] fatal error:", error);
	process.exit(1);
});
