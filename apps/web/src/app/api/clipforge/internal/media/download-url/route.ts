import { NextResponse } from "next/server";
import { requireClipForgeWorker } from "@/lib/clipforge/production/server/worker-auth";
import { getCloudStorageClient } from "@/lib/clipforge/production/server/cloud-storage";
import {
	isRecord,
	jsonError,
	readString,
} from "@/lib/clipforge/production/server/http";

export const runtime = "nodejs";

export async function POST(request: Request) {
	try {
		requireClipForgeWorker(request);
		const body = (await request.json()) as unknown;
		if (!isRecord(body)) {
			return NextResponse.json(
				{ error: "Body must be an object." },
				{ status: 400 },
			);
		}
		const storageKey = readString(body.storageKey);
		if (!storageKey) {
			return NextResponse.json(
				{ error: "storageKey is required." },
				{ status: 400 },
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
		return NextResponse.json({ download });
	} catch (error) {
		return jsonError(error);
	}
}
