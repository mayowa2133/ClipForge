import { NextResponse } from "next/server";
import {
	createShareLink,
	listShareLinks,
} from "@/lib/clipforge/production/server/store";
import { requireClipForgeUser } from "@/lib/clipforge/production/server/auth";
import { isRecord, jsonError } from "@/lib/clipforge/production/server/http";
import type { ClipForgeShareRole } from "@/types/production";

export const runtime = "nodejs";

type RouteContext = {
	params: Promise<{ projectId: string }>;
};

const SHARE_ROLES = new Set<ClipForgeShareRole>([
	"viewer",
	"commenter",
	"editor",
]);

export async function GET(request: Request, { params }: RouteContext) {
	try {
		const user = await requireClipForgeUser(request);
		const { projectId } = await params;
		const shareLinks = await listShareLinks({ ownerId: user.id, projectId });
		return NextResponse.json({ shareLinks });
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
				{ error: "Share-link payload must be an object." },
				{ status: 400 },
			);
		}
		const role =
			typeof body.role === "string" && SHARE_ROLES.has(body.role as ClipForgeShareRole)
				? (body.role as ClipForgeShareRole)
				: "viewer";
		const expiresAt =
			typeof body.expiresAt === "string" ? new Date(body.expiresAt) : null;
		const shareLink = await createShareLink({
			ownerId: user.id,
			projectId,
			role,
			expiresAt:
				expiresAt && Number.isFinite(expiresAt.getTime()) ? expiresAt : null,
		});
		return NextResponse.json({ shareLink }, { status: 201 });
	} catch (error) {
		return jsonError(error);
	}
}
