import { NextResponse } from "next/server";
import {
	createRightsReceipt,
	listRightsReceipts,
} from "@/lib/clipforge/production/server/store";
import { requireClipForgeUser } from "@/lib/clipforge/production/server/auth";
import {
	isRecord,
	jsonError,
	readOptionalRecord,
	readString,
} from "@/lib/clipforge/production/server/http";
import type { PublishDestination } from "@/types/export";
import type { RightsSourceKind } from "@/types/production";

export const runtime = "nodejs";

const SOURCE_KINDS = new Set<RightsSourceKind>([
	"bundled",
	"licensed",
	"imported-user-managed",
	"trend-reference",
]);

const DESTINATIONS = new Set<PublishDestination>([
	"generic-export",
	"tiktok",
	"instagram",
	"youtube",
]);

export async function GET(request: Request) {
	try {
		const user = await requireClipForgeUser(request);
		const url = new URL(request.url);
		const receipts = await listRightsReceipts({
			ownerId: user.id,
			projectId: url.searchParams.get("projectId"),
		});
		return NextResponse.json({ receipts });
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
				{ error: "Rights receipt payload must be an object." },
				{ status: 400 },
			);
		}

		if (
			typeof body.sourceKind !== "string" ||
			!SOURCE_KINDS.has(body.sourceKind as RightsSourceKind)
		) {
			return NextResponse.json(
				{ error: "Rights receipt sourceKind is invalid." },
				{ status: 400 },
			);
		}

		const assetId = readString(body.assetId);
		const licenseLabel = readString(body.licenseLabel);
		if (!assetId || !licenseLabel) {
			return NextResponse.json(
				{ error: "Rights receipt requires assetId and licenseLabel." },
				{ status: 400 },
			);
		}

		const destination =
			typeof body.destination === "string" &&
			DESTINATIONS.has(body.destination as PublishDestination)
				? (body.destination as PublishDestination)
				: null;

		const receipt = await createRightsReceipt({
			ownerId: user.id,
			projectId: readString(body.projectId),
			assetId,
			sourceKind: body.sourceKind as RightsSourceKind,
			licenseLabel,
			destination,
			receipt: readOptionalRecord(body.receipt) ?? {},
		});
		return NextResponse.json({ receipt }, { status: 201 });
	} catch (error) {
		return jsonError(error);
	}
}
