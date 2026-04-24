import { NextResponse } from "next/server";
import { getProductionCapabilitySnapshot } from "@/lib/clipforge/production/capabilities";

export async function GET() {
	return NextResponse.json({
		capabilities: getProductionCapabilitySnapshot(),
	});
}
