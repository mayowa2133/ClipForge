import { NextResponse } from "next/server";
import {
	createMediaObjectRecord,
	listMediaObjects,
} from "@/lib/clipforge/production/server/store";
import { requireClipForgeUser } from "@/lib/clipforge/production/server/auth";
import {
	isRecord,
	jsonError,
	readString,
} from "@/lib/clipforge/production/server/http";
import {
	buildStorageKey,
	getCloudStorageClient,
} from "@/lib/clipforge/production/server/cloud-storage";
import type { CloudMediaObjectStatus } from "@/types/production";

export const runtime = "nodejs";

type RouteContext = {
	params: Promise<{ projectId: string }>;
};

const MEDIA_STATUSES = new Set<CloudMediaObjectStatus>([
	"queued",
	"uploading",
	"stored",
	"failed",
	"deleted",
]);

export async function GET(request: Request, { params }: RouteContext) {
	try {
		const user = await requireClipForgeUser(request);
		const { projectId } = await params;
		const mediaObjects = await listMediaObjects({
			ownerId: user.id,
			projectId,
		});
		return NextResponse.json({ mediaObjects });
	} catch (error) {
		return jsonError(error);
	}
}

export async function POST(request: Request, { params }: RouteContext) {
	try {
		const user = await requireClipForgeUser(request);
		const { projectId } = await params;
		const body = (await request.json()) as unknown;
		if (!isRecord(body)) {
			return NextResponse.json(
				{ error: "Media object payload must be an object." },
				{ status: 400 },
			);
		}
		const mediaId = readString(body.mediaId);
		if (!mediaId) {
			return NextResponse.json(
				{ error: "Media object requires mediaId." },
				{ status: 400 },
			);
		}

		const storage = getCloudStorageClient();
		const explicitStorageKey = readString(body.storageKey);
		const storageKey =
			explicitStorageKey ??
			buildStorageKey({ ownerId: user.id, projectId, mediaId });

		const requestedStatus =
			typeof body.status === "string" &&
			MEDIA_STATUSES.has(body.status as CloudMediaObjectStatus)
				? (body.status as CloudMediaObjectStatus)
				: storage
					? "uploading"
					: "queued";

		const mediaObject = await createMediaObjectRecord({
			ownerId: user.id,
			projectId,
			mediaId,
			storageKey,
			bytes:
				typeof body.bytes === "number" ? Math.max(0, Math.round(body.bytes)) : 0,
			sha256: readString(body.sha256),
			status: requestedStatus,
			encrypted: body.encrypted === undefined ? true : body.encrypted !== false,
		});

		const upload = storage
			? await storage.presignedPut({
					storageKey,
					contentType: readString(body.contentType),
				})
			: null;

		return NextResponse.json({ mediaObject, upload }, { status: 201 });
	} catch (error) {
		return jsonError(error);
	}
}
