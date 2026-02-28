import { Button } from "@/components/ui/button";
import { PanelView } from "@/components/editor/panels/assets/views/base-view";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { useState, useRef } from "react";
import { extractTimelineAudio } from "@/lib/media/mediabunny";
import { useEditor } from "@/hooks/use-editor";
import { DEFAULT_TEXT_ELEMENT } from "@/constants/text-constants";
import { TRANSCRIPTION_LANGUAGES } from "@/constants/transcription-constants";
import type {
	TranscriptionLanguage,
	TranscriptionProgress,
} from "@/types/transcription";
import { transcriptionService } from "@/services/transcription/service";
import { decodeAudioToFloat32 } from "@/lib/media/audio";
import {
	buildTimelineTranscriptSegments,
	generateCaptionChunks,
	getCaptionTemplate,
} from "@/lib/clipforge";
import { Spinner } from "@/components/ui/spinner";
import { Label } from "@/components/ui/label";

export function Captions() {
	const [selectedLanguage, setSelectedLanguage] =
		useState<TranscriptionLanguage>("auto");
	const [selectedTemplate, setSelectedTemplate] = useState<
		"clean-bottom" | "bold-center"
	>("clean-bottom");
	const [isProcessing, setIsProcessing] = useState(false);
	const [processingStep, setProcessingStep] = useState("");
	const [error, setError] = useState<string | null>(null);
	const containerRef = useRef<HTMLDivElement>(null);
	const editor = useEditor();

	const handleProgress = (progress: TranscriptionProgress) => {
		if (progress.status === "loading-model") {
			setProcessingStep(`Loading model ${Math.round(progress.progress)}%`);
		} else if (progress.status === "transcribing") {
			setProcessingStep("Transcribing...");
		}
	};

	const handleGenerateTranscript = async () => {
		try {
			setIsProcessing(true);
			setError(null);
			setProcessingStep("Collecting indexed transcripts...");

			const activeProject = editor.project.getActive();
			let captionSegments = activeProject
				? buildTimelineTranscriptSegments({
					project: activeProject,
				})
				: [];

			if (captionSegments.length === 0) {
				setProcessingStep("Extracting audio...");

				const audioBlob = await extractTimelineAudio({
					tracks: editor.timeline.getTracks(),
					mediaAssets: editor.media.getAssets(),
					totalDuration: editor.timeline.getTotalDuration(),
				});

				setProcessingStep("Preparing audio...");
				const { samples } = await decodeAudioToFloat32({ audioBlob });

				const result = await transcriptionService.transcribe({
					audioData: samples,
					language: selectedLanguage === "auto" ? undefined : selectedLanguage,
					onProgress: handleProgress,
				});
				captionSegments = result.segments;
			}

			setProcessingStep("Generating captions...");
			const captionChunks = generateCaptionChunks({
				segments: captionSegments,
				options: {
					maxCharsPerLine: selectedTemplate === "bold-center" ? 22 : 30,
					maxLines: 2,
					minDisplaySeconds: 0.85,
					maxWordsPerChunk: 10,
				},
			});
			const template = getCaptionTemplate({ styleId: selectedTemplate });
			const canvasHeight = activeProject?.settings.canvasSize.height ?? 1080;
			const positionY =
				template.position === "bottom" ? Math.round(canvasHeight * 0.35) : 0;

			const captionTrackId = editor.timeline.addTrack({
				type: "text",
				index: 0,
			});

			for (let i = 0; i < captionChunks.length; i++) {
				const caption = captionChunks[i];
				editor.timeline.insertElement({
					placement: { mode: "explicit", trackId: captionTrackId },
					element: {
						...DEFAULT_TEXT_ELEMENT,
						name: `Caption ${i + 1}`,
						content: caption.text,
						duration: caption.duration,
						startTime: caption.startTime,
						fontFamily: template.font,
						fontSize: template.size,
						fontWeight:
							template.style_id === "bold-center" ? "bold" : "normal",
						textAlign: "center",
						background: {
							...DEFAULT_TEXT_ELEMENT.background,
							color: template.outline ? "#000000" : "transparent",
							paddingX: template.outline ? 24 : 0,
							paddingY: template.outline ? 12 : 0,
						},
						transform: {
							...DEFAULT_TEXT_ELEMENT.transform,
							position: {
								...DEFAULT_TEXT_ELEMENT.transform.position,
								y: positionY,
							},
						},
					},
				});
			}

			editor.clipforge.applyOps({
				source: "manual",
				ops: [
					{
						type: "SET_CAPTION_STYLE",
						style_id: template.style_id,
						font: template.font,
						size: template.size,
						position: template.position,
						outline: template.outline,
						highlight_mode: template.highlight_mode,
					},
				],
			});
		} catch (error) {
			console.error("Transcription failed:", error);
			setError(
				error instanceof Error ? error.message : "An unexpected error occurred",
			);
		} finally {
			setIsProcessing(false);
			setProcessingStep("");
		}
	};

	const handleLanguageChange = ({ value }: { value: string }) => {
		if (value === "auto") {
			setSelectedLanguage("auto");
			return;
		}

		const matchedLanguage = TRANSCRIPTION_LANGUAGES.find(
			(language) => language.code === value,
		);
		if (!matchedLanguage) return;
		setSelectedLanguage(matchedLanguage.code);
	};

	return (
		<PanelView title="Captions" ref={containerRef}>
			<div className="flex flex-col gap-3">
				<Label>Language</Label>
				<Select
					value={selectedLanguage}
					onValueChange={(value) => handleLanguageChange({ value })}
				>
					<SelectTrigger>
						<SelectValue placeholder="Select a language" />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="auto">Auto detect</SelectItem>
						{TRANSCRIPTION_LANGUAGES.map((language) => (
							<SelectItem key={language.code} value={language.code}>
								{language.name}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>

			<div className="flex flex-col gap-3">
				<Label>Template</Label>
				<Select
					value={selectedTemplate}
					onValueChange={(value) =>
						setSelectedTemplate(value as "clean-bottom" | "bold-center")
					}
				>
					<SelectTrigger>
						<SelectValue placeholder="Select template" />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="clean-bottom">Clean Bottom</SelectItem>
						<SelectItem value="bold-center">Bold Center</SelectItem>
					</SelectContent>
				</Select>
			</div>

			<div className="flex flex-col gap-4">
				{error && (
					<div className="bg-destructive/10 border-destructive/20 rounded-md border p-3">
						<p className="text-destructive text-sm">{error}</p>
					</div>
				)}

				<Button
					className="w-full"
					onClick={handleGenerateTranscript}
					disabled={isProcessing}
				>
					{isProcessing && <Spinner className="mr-1" />}
					{isProcessing ? processingStep : "Generate transcript"}
				</Button>
			</div>
		</PanelView>
	);
}
