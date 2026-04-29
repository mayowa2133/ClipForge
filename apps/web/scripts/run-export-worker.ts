import {
	StubRenderEngine,
	runExportWorkerLoop,
} from "../src/lib/clipforge/production/worker/export-worker";
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
	const engine = new StubRenderEngine();

	const summary = await runExportWorkerLoop({
		http,
		engine,
		pollIntervalMs,
		maxJobs,
		signal: controller.signal,
	});
	console.log(`[export-worker] processed ${summary.processed} jobs.`);
}

main().catch((error) => {
	console.error("[export-worker] fatal error:", error);
	process.exit(1);
});
