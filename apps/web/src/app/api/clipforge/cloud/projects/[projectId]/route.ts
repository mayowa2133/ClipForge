import { NextResponse } from "next/server";
import {
	getCloudProject,
	updateCloudProject,
} from "@/lib/clipforge/production/server/store";
import { requireClipForgeUser } from "@/lib/clipforge/production/server/auth";
import {
	isRecord,
	jsonError,
	readOptionalRecord,
	readString,
} from "@/lib/clipforge/production/server/http";
import type { CloudProjectStorageStatus } from "@/types/production";
import type { TProject } from "@/types/project";

export const runtime = "nodejs";

type RouteContext = {
	params: Promise<{ projectId: string }>;
};

const STORAGE_STATUSES = new Set<CloudProjectStorageStatus>([
	"local-only",
	"syncing",
	"synced",
	"attention",
	"blocked",
]);

export async function GET(request: Request, { params }: RouteContext) {
	try {
		const user = await requireClipForgeUser(request);
		const { projectId } = await params;
		const project = await getCloudProject({ ownerId: user.id, projectId });
		if (!project) {
			return NextResponse.json({ error: "Cloud project not found." }, { status: 404 });
		}
		return NextResponse.json({ project });
	} catch (error) {
		return jsonError(error);
	}
}

export async function PATCH(request: Request, { params }: RouteContext) {
	try {
		const user = await requireClipForgeUser(request);
		const { projectId } = await params;
		const body = (await request.json()) as unknown;
		if (!isRecord(body)) {
			return NextResponse.json(
				{ error: "Cloud project patch must be an object." },
				{ status: 400 },
			);
		}

		const storageStatus =
			typeof body.storageStatus === "string" &&
			STORAGE_STATUSES.has(body.storageStatus as CloudProjectStorageStatus)
				? (body.storageStatus as CloudProjectStorageStatus)
				: undefined;

		const project = await updateCloudProject({
			ownerId: user.id,
			projectId,
			name: readString(body.name) ?? undefined,
			project:
				body.project === undefined
					? undefined
					: (readOptionalRecord(body.project) as TProject | null),
			storageStatus,
		});
		if (!project) {
			return NextResponse.json({ error: "Cloud project not found." }, { status: 404 });
		}
		return NextResponse.json({ project });
	} catch (error) {
		return jsonError(error);
	}
}
