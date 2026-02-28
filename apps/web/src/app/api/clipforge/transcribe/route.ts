import { NextResponse } from "next/server";
import {
	runWhisperCliTranscription,
} from "@/lib/clipforge/transcribers/whisper-cli-server";

export const runtime = "nodejs";

export async function POST(request: Request) {
	try {
		const formData = await request.formData();
		const file = formData.get("file");
		const language = formData.get("language");

		if (!(file instanceof File)) {
			return NextResponse.json(
				{ error: "Missing media file for transcription." },
				{ status: 400 },
			);
		}

		const result = await runWhisperCliTranscription({
			file,
			language: typeof language === "string" ? language : undefined,
		});
		return NextResponse.json(result);
	} catch (error) {
		const message =
			error instanceof Error ? error.message : "Whisper CLI transcription failed.";
		const status =
			message.includes("disabled") || message.includes("not found") ? 503 : 500;

		return NextResponse.json({ error: message }, { status });
	}
}
