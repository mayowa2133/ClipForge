import { NextResponse } from "next/server";
import {
	getMediaObject,
	updateMediaObjectStatus,
} from "@/lib/clipforge/production/server/store";
import { requireClipForgeUser } from "@/lib/clipforge/production/server/auth";
import {
	isRecord,
	jsonError,
	readString,
} from "@/lib/clipforge/production/server/http";
import { getCloudStorageClient } from "@/lib/clipforge/production/server/cloud-storage";
import type { CloudMediaObjectStatus } from "@/types/production";

export const runtime = "nodejs";

type RouteContext = {
	params: Promise<{ projectId: string; mediaObjectId: string }>;
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
		const { mediaObjectId } = await params;
		const mediaObject = await getMediaObject({
			ownerId: user.id,
			mediaObjectId,
		});
		if (!mediaObject) {
			return NextResponse.json(
				{ error: "Media object not found." },
				{ status: 404 },
			);
		}

		const storage = getCloudStorageClient();
		const download =
			storage && mediaObject.status === "stored"
				? await storage.presignedGet({ storageKey: mediaObject.storageKey })
				: null;
		return NextResponse.json({ mediaObject, download });
	} catch (error) {
		return jsonError(error);
	}
}

export async function PATCH(request: Request, { params }: RouteContext) {
	try {
		const user = await requireClipForgeUser(request);
		const { mediaObjectId } = await params;
		const body = (await request.json()) as unknown;
		if (!isRecord(body)) {
			return NextResponse.json(
				{ error: "Media update payload must be an object." },
				{ status: 400 },
			);
		}

		const status = readString(body.status);
		if (!status || !MEDIA_STATUSES.has(status as CloudMediaObjectStatus)) {
			return NextResponse.json(
				{ error: "Status must be one of queued/uploading/stored/failed/deleted." },
				{ status: 400 },
			);
		}

		const updated = await updateMediaObjectStatus({
			ownerId: user.id,
			mediaObjectId,
			status: status as CloudMediaObjectStatus,
			bytes:
				typeof body.bytes === "number" ? Math.max(0, Math.round(body.bytes)) : undefined,
			sha256:
				body.sha256 === null
					? null
					: typeof body.sha256 === "string"
						? body.sha256
						: undefined,
		});
		if (!updated) {
			return NextResponse.json(
				{ error: "Media object not found." },
				{ status: 404 },
			);
		}
		return NextResponse.json({ mediaObject: updated });
	} catch (error) {
		return jsonError(error);
	}
}
