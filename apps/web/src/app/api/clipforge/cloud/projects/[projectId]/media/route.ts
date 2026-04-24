import { NextResponse } from "next/server";
import { createMediaObjectRecord } from "@/lib/clipforge/production/server/store";
import { requireClipForgeUser } from "@/lib/clipforge/production/server/auth";
import {
	isRecord,
	jsonError,
	readString,
} from "@/lib/clipforge/production/server/http";
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
		const storageKey = readString(body.storageKey);
		if (!mediaId || !storageKey) {
			return NextResponse.json(
				{ error: "Media object requires mediaId and storageKey." },
				{ status: 400 },
			);
		}
		const mediaObject = await createMediaObjectRecord({
			ownerId: user.id,
			projectId,
			mediaId,
			storageKey,
			bytes: typeof body.bytes === "number" ? Math.max(0, Math.round(body.bytes)) : 0,
			sha256: readString(body.sha256),
			status:
				typeof body.status === "string" &&
				MEDIA_STATUSES.has(body.status as CloudMediaObjectStatus)
					? (body.status as CloudMediaObjectStatus)
					: "queued",
			encrypted: body.encrypted === undefined ? true : body.encrypted !== false,
		});
		return NextResponse.json({ mediaObject }, { status: 201 });
	} catch (error) {
		return jsonError(error);
	}
}
