import { NextResponse } from "next/server";
import { revokeShareLink } from "@/lib/clipforge/production/server/store";
import { requireClipForgeUser } from "@/lib/clipforge/production/server/auth";
import { jsonError } from "@/lib/clipforge/production/server/http";

export const runtime = "nodejs";

type RouteContext = {
	params: Promise<{ projectId: string; shareLinkId: string }>;
};

export async function DELETE(request: Request, { params }: RouteContext) {
	try {
		const user = await requireClipForgeUser(request);
		const { shareLinkId } = await params;
		const revoked = await revokeShareLink({
			ownerId: user.id,
			shareLinkId,
		});
		if (!revoked) {
			return NextResponse.json(
				{ error: "Share link not found." },
				{ status: 404 },
			);
		}
		return NextResponse.json({ shareLink: revoked });
	} catch (error) {
		return jsonError(error);
	}
}
