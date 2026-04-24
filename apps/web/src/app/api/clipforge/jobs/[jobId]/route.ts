import { NextResponse } from "next/server";
import { updateJobStatus } from "@/lib/clipforge/production/server/store";
import { requireClipForgeUser } from "@/lib/clipforge/production/server/auth";
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

export async function PATCH(request: Request, { params }: RouteContext) {
	try {
		const user = await requireClipForgeUser(request);
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
		const job = await updateJobStatus({
			ownerId: user.id,
			jobId,
			status: body.status as ClipForgeJobStatus,
			progressPct:
				typeof body.progressPct === "number" ? body.progressPct : undefined,
			result:
				body.result === undefined ? undefined : readOptionalRecord(body.result),
			errorMessage:
				body.errorMessage === undefined ? undefined : readString(body.errorMessage),
		});
		if (!job) {
			return NextResponse.json({ error: "Job not found." }, { status: 404 });
		}
		return NextResponse.json({ job });
	} catch (error) {
		return jsonError(error);
	}
}
