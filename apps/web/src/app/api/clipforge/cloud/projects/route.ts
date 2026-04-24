import { NextResponse } from "next/server";
import {
	createCloudProject,
	listCloudProjects,
} from "@/lib/clipforge/production/server/store";
import { requireClipForgeUser } from "@/lib/clipforge/production/server/auth";
import {
	isRecord,
	jsonError,
	readOptionalRecord,
	readString,
} from "@/lib/clipforge/production/server/http";
import type { TProject } from "@/types/project";

export const runtime = "nodejs";

export async function GET(request: Request) {
	try {
		const user = await requireClipForgeUser(request);
		const projects = await listCloudProjects({ ownerId: user.id });
		return NextResponse.json({ projects });
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
				{ error: "Cloud project payload must be an object." },
				{ status: 400 },
			);
		}

		const projectRecord = readOptionalRecord(body.project);
		const project = projectRecord as TProject | null;
		const projectName =
			readString(body.name) ??
			(projectRecord && isRecord(projectRecord.metadata)
				? readString(projectRecord.metadata.name)
				: null) ??
			"Untitled cloud project";

		const cloudProject = await createCloudProject({
			ownerId: user.id,
			name: projectName,
			project,
		});

		return NextResponse.json({ project: cloudProject }, { status: 201 });
	} catch (error) {
		return jsonError(error);
	}
}
