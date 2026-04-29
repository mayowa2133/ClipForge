import { NextResponse } from "next/server";
import { getJobByIdForWorker } from "@/lib/clipforge/production/server/store";
import { requireClipForgeWorker } from "@/lib/clipforge/production/server/worker-auth";
import {
	getCloudStorageClient,
	buildStorageKey,
} from "@/lib/clipforge/production/server/cloud-storage";
import {
	isRecord,
	jsonError,
	readString,
} from "@/lib/clipforge/production/server/http";

export const runtime = "nodejs";

type RouteContext = {
	params: Promise<{ jobId: string }>;
};

export async function POST(request: Request, { params }: RouteContext) {
	try {
		requireClipForgeWorker(request);
		const { jobId } = await params;
		const job = await getJobByIdForWorker({ jobId });
		if (!job) {
			return NextResponse.json({ error: "Job not found." }, { status: 404 });
		}

		const body = (await request.json()) as unknown;
		if (!isRecord(body)) {
			return NextResponse.json(
				{ error: "Artifact request must be an object." },
				{ status: 400 },
			);
		}

		const contentType = readString(body.contentType) ?? "application/octet-stream";
		const fileName = readString(body.fileName) ?? `job-${jobId}.bin`;

		const storage = getCloudStorageClient();
		if (!storage) {
			return NextResponse.json(
				{
					error:
						"Cloud storage is not configured (CLOUDFLARE_ACCOUNT_ID/R2_* env vars).",
				},
				{ status: 503 },
			);
		}

		const storageKey = buildStorageKey({
			ownerId: job.ownerId,
			projectId: job.projectId ?? "no-project",
			mediaId: `job-${jobId}-${fileName}`,
		});

		const upload = await storage.presignedPut({ storageKey, contentType });
		return NextResponse.json({
			storageKey,
			upload,
		});
	} catch (error) {
		return jsonError(error);
	}
}

export async function GET(request: Request, { params }: RouteContext) {
	try {
		requireClipForgeWorker(request);
		const { jobId } = await params;
		const job = await getJobByIdForWorker({ jobId });
		if (!job) {
			return NextResponse.json({ error: "Job not found." }, { status: 404 });
		}

		const result = job.result;
		const storageKey =
			result && typeof result === "object" && "storageKey" in result
				? String(result.storageKey)
				: null;
		if (!storageKey) {
			return NextResponse.json(
				{ error: "Job result does not include an artifact storageKey." },
				{ status: 404 },
			);
		}

		const storage = getCloudStorageClient();
		if (!storage) {
			return NextResponse.json(
				{ error: "Cloud storage is not configured." },
				{ status: 503 },
			);
		}

		const download = await storage.presignedGet({ storageKey });
		return NextResponse.json({ storageKey, download });
	} catch (error) {
		return jsonError(error);
	}
}
