import { NextResponse } from "next/server";
import {
	getJobByIdForWorker,
	updateJobStatusAsWorker,
} from "@/lib/clipforge/production/server/store";
import { requireClipForgeWorker } from "@/lib/clipforge/production/server/worker-auth";
import {
	isRecord,
	jsonError,
	readOptionalRecord,
	readString,
} from "@/lib/clipforge/production/server/http";
import type { ClipForgeJobStatus } from "@/types/production";

export const runtime = "nodejs";

type RouteContext = {
	params: Promise<{ jobId: string }>;
};

const JOB_STATUSES = new Set<ClipForgeJobStatus>([
	"queued",
	"processing",
	"completed",
	"failed",
	"cancelled",
]);

export async function GET(request: Request, { params }: RouteContext) {
	try {
		requireClipForgeWorker(request);
		const { jobId } = await params;
		const job = await getJobByIdForWorker({ jobId });
		if (!job) {
			return NextResponse.json({ error: "Job not found." }, { status: 404 });
		}
		return NextResponse.json({ job });
	} catch (error) {
		return jsonError(error);
	}
}

export async function PATCH(request: Request, { params }: RouteContext) {
	try {
		requireClipForgeWorker(request);
		const { jobId } = await params;
		const body = (await request.json()) as unknown;
		if (!isRecord(body)) {
			return NextResponse.json(
				{ error: "Job patch must be an object." },
				{ status: 400 },
			);
		}

		if (
			typeof body.status !== "string" ||
			!JOB_STATUSES.has(body.status as ClipForgeJobStatus)
		) {
			return NextResponse.json({ error: "Invalid job status." }, { status: 400 });
		}

		const updated = await updateJobStatusAsWorker({
			jobId,
			status: body.status as ClipForgeJobStatus,
			progressPct:
				typeof body.progressPct === "number" ? body.progressPct : undefined,
			result:
				body.result === undefined ? undefined : readOptionalRecord(body.result),
			errorMessage:
				body.errorMessage === undefined ? undefined : readString(body.errorMessage),
		});
		if (!updated) {
			return NextResponse.json({ error: "Job not found." }, { status: 404 });
		}
		return NextResponse.json({ job: updated });
	} catch (error) {
		return jsonError(error);
	}
}
