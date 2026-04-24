import { NextResponse } from "next/server";
import { createJob, listJobs } from "@/lib/clipforge/production/server/store";
import { requireClipForgeUser } from "@/lib/clipforge/production/server/auth";
import {
	isRecord,
	jsonError,
	readOptionalRecord,
	readString,
} from "@/lib/clipforge/production/server/http";
import type { ClipForgeJobKind } from "@/types/production";

export const runtime = "nodejs";

const JOB_KINDS = new Set<ClipForgeJobKind>([
	"transcription",
	"export",
	"publish",
	"media-sync",
]);

export async function GET(request: Request) {
	try {
		const user = await requireClipForgeUser(request);
		const url = new URL(request.url);
		const jobs = await listJobs({
			ownerId: user.id,
			projectId: url.searchParams.get("projectId"),
		});
		return NextResponse.json({ jobs });
	} catch (error) {
		return jsonError(error);
	}
}

export async function POST(request: Request) {
	try {
		const user = await requireClipForgeUser(request);
		const body = (await request.json()) as unknown;
		if (!isRecord(body)) {
			return NextResponse.json(
				{ error: "Job payload must be an object." },
				{ status: 400 },
			);
		}

		if (typeof body.kind !== "string" || !JOB_KINDS.has(body.kind as ClipForgeJobKind)) {
			return NextResponse.json(
				{ error: "Job kind must be transcription, export, publish, or media-sync." },
				{ status: 400 },
			);
		}

		const job = await createJob({
			ownerId: user.id,
			projectId: readString(body.projectId),
			kind: body.kind as ClipForgeJobKind,
			provider: readString(body.provider),
			input: readOptionalRecord(body.input) ?? {},
		});
		return NextResponse.json({ job }, { status: 201 });
	} catch (error) {
		return jsonError(error);
	}
}
