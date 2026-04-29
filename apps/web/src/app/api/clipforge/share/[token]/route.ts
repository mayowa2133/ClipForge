import { NextResponse } from "next/server";
import { resolveShareLinkByToken } from "@/lib/clipforge/production/server/store";
import { jsonError } from "@/lib/clipforge/production/server/http";

export const runtime = "nodejs";

type RouteContext = {
	params: Promise<{ token: string }>;
};

export async function GET(_request: Request, { params }: RouteContext) {
	try {
		const { token } = await params;
		if (!token) {
			return NextResponse.json({ error: "Token is required." }, { status: 400 });
		}
		const resolved = await resolveShareLinkByToken({ token });
		if (!resolved) {
			return NextResponse.json(
				{ error: "Share link is invalid, expired, or revoked." },
				{ status: 404 },
			);
		}

		return NextResponse.json({
			share: {
				role: resolved.share.role,
				expiresAt: resolved.share.expiresAt,
			},
			project: {
				id: resolved.project.id,
				name: resolved.project.name,
				projectVersion: resolved.project.projectVersion,
				project: resolved.project.project,
				updatedAt: resolved.project.updatedAt,
			},
		});
	} catch (error) {
		return jsonError(error);
	}
}
