import { NextResponse } from "next/server";
import { claimNextQueuedJob } from "@/lib/clipforge/production/server/store";
import { requireClipForgeWorker } from "@/lib/clipforge/production/server/worker-auth";
import { jsonError } from "@/lib/clipforge/production/server/http";
import type { ClipForgeJobKind } from "@/types/production";

export const runtime = "nodejs";

const JOB_KINDS = new Set<ClipForgeJobKind>([
	"transcription",
	"export",
	"publish",
	"media-sync",
]);

export async function POST(request: Request) {
	try {
		const { workerId } = requireClipForgeWorker(request);
		const body = (await request
			.json()
			.catch(() => ({}))) as { kind?: string };
		const kind = body.kind;
		if (!kind || !JOB_KINDS.has(kind as ClipForgeJobKind)) {
			return NextResponse.json(
				{ error: "Body must include kind (transcription/export/publish/media-sync)." },
				{ status: 400 },
			);
		}

		const job = await claimNextQueuedJob({
			kind: kind as ClipForgeJobKind,
			workerId,
		});
		if (!job) return NextResponse.json({ job: null });
		return NextResponse.json({ job });
	} catch (error) {
		return jsonError(error);
	}
}
