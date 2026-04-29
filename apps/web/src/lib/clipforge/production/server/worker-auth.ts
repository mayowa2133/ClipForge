export class ClipForgeWorkerAuthError extends Error {
	status = 401;
}

export function requireClipForgeWorker(request: Request): { workerId: string } {
	const expected = process.env.CLIPFORGE_WORKER_SECRET?.trim();
	if (!expected) {
		const error = new ClipForgeWorkerAuthError(
			"Worker endpoints are disabled (CLIPFORGE_WORKER_SECRET not set).",
		);
		error.status = 503;
		throw error;
	}

	const header = request.headers.get("authorization");
	if (!header || !header.startsWith("Bearer ")) {
		throw new ClipForgeWorkerAuthError("Missing worker bearer token.");
	}

	const token = header.slice("Bearer ".length).trim();
	if (token !== expected) {
		throw new ClipForgeWorkerAuthError("Invalid worker bearer token.");
	}

	const workerId = request.headers.get("x-clipforge-worker-id") ?? "unknown-worker";
	return { workerId };
}
