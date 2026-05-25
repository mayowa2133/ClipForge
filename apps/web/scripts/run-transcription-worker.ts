import {
	StubTranscriptionEngine,
	type TranscriptionEngine,
	runTranscriptionWorkerLoop,
} from "../src/lib/clipforge/production/worker/transcription-worker";
import { ModalTranscriptionEngine } from "../src/lib/clipforge/production/worker/transcription-modal";
import { WhisperCliTranscriptionEngine } from "../src/lib/clipforge/production/worker/transcription-whisper-cli";
import { HttpWorkerClient } from "../src/lib/clipforge/production/worker/http-client";

function readEnv(name: string): string | null {
	const value = process.env[name];
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function isPlaceholderUrl(value: string): boolean {
	const lower = value.toLowerCase();
	return (
		lower.includes("placeholder") ||
		lower.includes("your-") ||
		lower === "https://example.com" ||
		lower.startsWith("https://placeholder.")
	);
}

async function main() {
	const baseUrl = readEnv("CLIPFORGE_WORKER_BASE_URL") ?? "http://localhost:3000";
	const bearerSecret = readEnv("CLIPFORGE_WORKER_SECRET");
	const workerId =
		readEnv("CLIPFORGE_WORKER_ID") ?? `transcription-${process.pid}-${Date.now()}`;
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
		`[transcription-worker] starting; base=${baseUrl} workerId=${workerId} pollMs=${pollIntervalMs} maxJobs=${maxJobs}`,
	);

	const controller = new AbortController();
	process.on("SIGINT", () => {
		console.log("[transcription-worker] SIGINT received, shutting down...");
		controller.abort();
	});
	process.on("SIGTERM", () => {
		console.log("[transcription-worker] SIGTERM received, shutting down...");
		controller.abort();
	});

	const http = new HttpWorkerClient({ baseUrl, bearerSecret, workerId });
	const engine = buildEngine();
	console.log(`[transcription-worker] engine=${engine.id}`);

	const summary = await runTranscriptionWorkerLoop({
		http,
		engine,
		pollIntervalMs,
		maxJobs,
		signal: controller.signal,
	});
	console.log(
		`[transcription-worker] processed ${summary.processed} jobs.`,
	);
}

function buildEngine(): TranscriptionEngine {
	const provider = (
		readEnv("CLIPFORGE_TRANSCRIBER") ?? "stub"
	).toLowerCase();
	if (provider === "stub") return new StubTranscriptionEngine();
	if (provider === "modal") {
		const endpoint = readEnv("MODAL_TRANSCRIPTION_URL");
		if (!endpoint || isPlaceholderUrl(endpoint)) {
			throw new Error(
				"CLIPFORGE_TRANSCRIBER=modal requires MODAL_TRANSCRIPTION_URL to be a real endpoint, not a placeholder.",
			);
		}
		const apiKey = readEnv("MODAL_TRANSCRIPTION_API_KEY");
		const timeoutMs = Number.parseInt(
			readEnv("CLIPFORGE_TRANSCRIBER_TIMEOUT_MS") ?? "300000",
			10,
		);
		return new ModalTranscriptionEngine({
			endpoint,
			apiKey: apiKey ?? null,
			timeoutMs,
		});
	}
	if (provider === "whisper-cli") {
		const model = readEnv("CLIPFORGE_WHISPER_CLI_MODEL") ?? "base";
		return new WhisperCliTranscriptionEngine({ model });
	}
	throw new Error(
		`Unknown CLIPFORGE_TRANSCRIBER=${provider}. Supported: stub, modal, whisper-cli.`,
	);
}

main().catch((error) => {
	console.error("[transcription-worker] fatal error:", error);
	process.exit(1);
});
