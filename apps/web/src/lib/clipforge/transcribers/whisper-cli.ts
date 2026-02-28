import type { Transcriber } from "@/lib/clipforge/transcription";

export class WhisperCliTranscriber implements Transcriber {
	async transcribe(input: Parameters<Transcriber["transcribe"]>[0]) {
		const formData = new FormData();
		formData.set("file", input.mediaAsset.file, input.mediaAsset.file.name);
		if (input.language) {
			formData.set("language", input.language);
		}

		const response = await fetch("/api/clipforge/transcribe", {
			method: "POST",
			body: formData,
		});
		if (!response.ok) {
			let message = `Whisper CLI request failed with status ${response.status}`;
			try {
				const payload = (await response.json()) as { error?: string };
				if (payload.error) {
					message = payload.error;
				}
			} catch {}
			throw new Error(message);
		}

		const payload = (await response.json()) as Awaited<
			ReturnType<Transcriber["transcribe"]>
		>;
		return payload;
	}
}
