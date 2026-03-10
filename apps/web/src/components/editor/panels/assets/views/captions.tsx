import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NumberField } from "@/components/ui/number-field";
import { PanelView } from "@/components/editor/panels/assets/views/base-view";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { TRANSCRIPTION_LANGUAGES } from "@/constants/transcription-constants";
import { useEditor } from "@/hooks/use-editor";
import { getBuiltInCaptionStyleLabel } from "@/lib/clipforge/caption-style-library";
import type { CaptionSegmentView } from "@/types/clipforge";
import type { TranscriptionLanguage } from "@/types/transcription";
import { cn } from "@/utils/ui";

const TIMING_STEP = 0.05;

function formatSeconds(value: number): string {
	return value.toFixed(2);
}

export function Captions() {
	const [selectedLanguage, setSelectedLanguage] =
		useState<TranscriptionLanguage>("auto");
	const [isProcessing, setIsProcessing] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const containerRef = useRef<HTMLDivElement>(null);
	const editor = useEditor();
	const activeProject = editor.project.getActive();
	const captions = editor.clipforge.getSceneCaptions();
	const selectedElementIds = new Set(
		editor.selection.getSelectedElements().map((element) => element.elementId),
	);
	const styles = useMemo(() => {
		if (!activeProject?.clipforge) return [];
		return Object.values(activeProject.clipforge.captionStylesById).sort((a, b) =>
			a.style_id.localeCompare(b.style_id),
		);
	}, [activeProject]);
	const activeStyleId = activeProject?.clipforge?.activeCaptionStyleId ?? null;
	const projectDefaultStyleId =
		activeProject?.settings.libraryDefaults?.captionStyleId ??
		activeStyleId ??
		"clean-bottom";
	const [selectedTemplate, setSelectedTemplate] = useState<string>(
		projectDefaultStyleId,
	);

	useEffect(() => {
		setSelectedTemplate(projectDefaultStyleId);
	}, [projectDefaultStyleId]);

	const handleLanguageChange = (value: string) => {
		if (value === "auto") {
			setSelectedLanguage("auto");
			return;
		}
		const matchedLanguage = TRANSCRIPTION_LANGUAGES.find(
			(language) => language.code === value,
		);
		if (matchedLanguage) {
			setSelectedLanguage(matchedLanguage.code);
		}
	};

	const runGeneration = async (overwriteExisting: boolean) => {
		try {
			setIsProcessing(true);
			setError(null);
			const result = editor.clipforge.generateSceneCaptions({
				language: selectedLanguage,
				template: selectedTemplate,
				overwriteExisting,
			});
			toast(
				result.generated === 1
					? "Generated 1 caption segment."
					: `Generated ${result.generated} caption segments.`,
			);
		} catch (cause) {
			const message =
				cause instanceof Error ? cause.message : "Failed to generate captions.";
			setError(message);
			toast.error(message);
		} finally {
			setIsProcessing(false);
		}
	};

	const clearCaptions = () => {
		try {
			setError(null);
			const result = editor.clipforge.clearSceneCaptions();
			toast(
				result.cleared === 1
					? "Cleared 1 caption segment."
					: `Cleared ${result.cleared} caption segments.`,
			);
		} catch (cause) {
			const message =
				cause instanceof Error ? cause.message : "Failed to clear captions.";
			setError(message);
			toast.error(message);
		}
	};

	const selectCaption = (segment: CaptionSegmentView) => {
		editor.playback.seek({ time: segment.startTime });
		editor.selection.setSelectedElements({
			elements: [{ trackId: segment.trackId, elementId: segment.elementId }],
			expandLinkedGroups: false,
		});
	};

	return (
		<PanelView title="Captions" ref={containerRef} contentClassName="pb-4">
			<div className="flex flex-col gap-4 p-2">
				<div className="rounded-lg border px-3 py-3">
					<div className="flex items-center justify-between gap-3">
						<div>
							<p className="text-sm font-medium">Scene captions</p>
							<p className="text-muted-foreground text-xs">
								{captions.length} segment{captions.length === 1 ? "" : "s"}
							</p>
						</div>
						<div className="flex items-center gap-2">
							<Button
								variant="outline"
								size="sm"
								onClick={() => runGeneration(captions.length > 0)}
								disabled={isProcessing}
							>
								{isProcessing && <Spinner className="mr-1" />}
								{captions.length > 0 ? "Regenerate" : "Generate"}
							</Button>
							<Button
								variant="ghost"
								size="sm"
								onClick={clearCaptions}
								disabled={captions.length === 0 || isProcessing}
							>
								Clear
							</Button>
						</div>
					</div>
					<div className="mt-3 grid grid-cols-2 gap-3">
						<div className="flex flex-col gap-2">
							<Label>Language</Label>
							<Select value={selectedLanguage} onValueChange={handleLanguageChange}>
								<SelectTrigger>
									<SelectValue placeholder="Language" />
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
						<div className="flex flex-col gap-2">
							<Label>Style</Label>
							<Select
								value={selectedTemplate}
								onValueChange={setSelectedTemplate}
							>
								<SelectTrigger>
									<SelectValue placeholder="Style" />
								</SelectTrigger>
								<SelectContent>
									{styles.map((style) => (
										<SelectItem key={style.style_id} value={style.style_id}>
											{getBuiltInCaptionStyleLabel({ styleId: style.style_id })}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
					</div>
					{error ? (
						<p className="text-destructive mt-3 text-xs">{error}</p>
					) : (
						<p className="text-muted-foreground mt-3 text-xs">
							Generate or regenerate caption rows for the active scene. Edits here only touch caption-role text.
						</p>
					)}
				</div>

				<div className="rounded-lg border px-3 py-3">
					<div className="mb-3 flex items-center justify-between gap-3">
						<div>
							<p className="text-sm font-medium">Style</p>
							<p className="text-muted-foreground text-xs">
								Apply a caption style to this scene only.
							</p>
						</div>
						{activeStyleId ? (
							<p className="text-muted-foreground text-xs">Active: {activeStyleId}</p>
						) : null}
					</div>
					<div className="grid grid-cols-1 gap-2">
						{styles.map((style) => {
							const isActive = style.style_id === activeStyleId;
							return (
								<button
									key={style.style_id}
									type="button"
									onClick={() => {
										try {
											editor.clipforge.applySceneCaptionStyle({ styleId: style.style_id });
											toast(`Applied ${style.style_id} to this scene.`);
										} catch (cause) {
											const message =
												cause instanceof Error ? cause.message : "Failed to apply caption style.";
											setError(message);
											toast.error(message);
										}
									}}
									className={cn(
										"flex items-center justify-between rounded-md border px-3 py-2 text-left transition-colors",
										isActive ? "border-primary bg-primary/5" : "hover:bg-accent",
									)}
								>
									<div>
										<p className="text-sm font-medium">
											{getBuiltInCaptionStyleLabel({ styleId: style.style_id })}
										</p>
										<p className="text-muted-foreground text-xs">
											{style.position} · {style.highlight_mode} highlight
										</p>
									</div>
									<span className="text-muted-foreground text-xs">
										{isActive ? "Applied" : "Apply"}
									</span>
								</button>
							);
						})}
					</div>
					{captions.length === 0 ? (
						<p className="text-muted-foreground mt-3 text-xs">
							Generate captions first, then tune text and timing below.
						</p>
					) : null}
				</div>

				<div className="flex flex-col gap-2">
					{captions.length === 0 ? (
						<div className="text-muted-foreground rounded-lg border border-dashed px-4 py-6 text-sm">
							Generate captions to edit text, timing, and scene style here.
						</div>
					) : (
						captions.map((segment, index) => (
							<CaptionRow
								key={segment.elementId}
								segment={segment}
								isSelected={selectedElementIds.has(segment.elementId)}
								onSelect={() => selectCaption(segment)}
								onUpdateText={(text) => {
									try {
										editor.clipforge.updateCaptionText({ elementId: segment.elementId, text });
									} catch (cause) {
										toast.error(cause instanceof Error ? cause.message : "Failed to update caption text.");
									}
								}}
								onRetime={({ startTime, duration }) => {
									try {
										editor.clipforge.retimeCaption({
											elementId: segment.elementId,
											startTime,
											duration,
										});
									} catch (cause) {
										toast.error(cause instanceof Error ? cause.message : "Failed to retime caption.");
									}
								}}
								onSplit={
									segment.words && segment.words.length > 1
										? () => {
											try {
												const splitWordIndex = Math.ceil(
													(segment.words?.length ?? 0) / 2,
												);
												editor.clipforge.splitCaption({
													elementId: segment.elementId,
													splitWordIndex,
												});
											} catch (cause) {
												toast.error(cause instanceof Error ? cause.message : "Failed to split caption.");
											}
										}
										: null
								}
								onMergeWithNext={
									captions[index + 1]
										? () => {
											try {
												editor.clipforge.mergeCaptions({
													firstElementId: segment.elementId,
													secondElementId: captions[index + 1].elementId,
												});
											} catch (cause) {
												toast.error(cause instanceof Error ? cause.message : "Failed to merge captions.");
											}
										}
										: null
								}
							/>
						))
					)}
				</div>
			</div>
		</PanelView>
	);
}

function CaptionRow({
	segment,
	isSelected,
	onSelect,
	onUpdateText,
	onRetime,
	onSplit,
	onMergeWithNext,
}: {
	segment: CaptionSegmentView;
	isSelected: boolean;
	onSelect: () => void;
	onUpdateText: (text: string) => void;
	onRetime: (next: { startTime: number; duration: number }) => void;
	onSplit: (() => void) | null;
	onMergeWithNext: (() => void) | null;
}) {
	const [textDraft, setTextDraft] = useState(segment.text);
	const [startDraft, setStartDraft] = useState(formatSeconds(segment.startTime));
	const [durationDraft, setDurationDraft] = useState(formatSeconds(segment.duration));

	useEffect(() => {
		setTextDraft(segment.text);
	}, [segment.text]);

	useEffect(() => {
		setStartDraft(formatSeconds(segment.startTime));
	}, [segment.startTime]);

	useEffect(() => {
		setDurationDraft(formatSeconds(segment.duration));
	}, [segment.duration]);

	return (
		<div
			className={cn(
				"rounded-lg border px-3 py-3 transition-colors",
				isSelected ? "border-primary bg-primary/5" : "hover:bg-accent/40",
			)}
			onClick={onSelect}
		>
			<div className="mb-3 flex items-center justify-between gap-3">
				<div>
					<p className="text-sm font-medium">{formatSeconds(segment.startTime)}s → {formatSeconds(segment.endTime)}s</p>
					<p className="text-muted-foreground text-xs">
						{segment.words?.length ?? 0} word{(segment.words?.length ?? 0) === 1 ? "" : "s"}
					</p>
				</div>
				<div className="flex items-center gap-2">
					<Button
						variant="ghost"
						size="sm"
						onClick={(event) => {
							event.stopPropagation();
							onSplit?.();
						}}
						disabled={!onSplit}
					>
						Split
					</Button>
					<Button
						variant="ghost"
						size="sm"
						onClick={(event) => {
							event.stopPropagation();
							onMergeWithNext?.();
						}}
						disabled={!onMergeWithNext}
					>
						Merge next
					</Button>
				</div>
			</div>
			<div className="mb-3" onClick={(event) => event.stopPropagation()}>
				<Input
					value={textDraft}
					onChange={(event) => setTextDraft(event.target.value)}
					onBlur={() => {
						if (textDraft !== segment.text) {
							onUpdateText(textDraft);
						}
					}}
					size="sm"
				/>
			</div>
			<div className="grid grid-cols-2 gap-3" onClick={(event) => event.stopPropagation()}>
				<div className="flex flex-col gap-1.5">
					<Label>Start</Label>
					<NumberField
						value={startDraft}
						onChange={(event) => setStartDraft(event.target.value)}
						onBlur={() => {
							const parsed = Number.parseFloat(startDraft);
							if (Number.isFinite(parsed)) {
								onRetime({ startTime: parsed, duration: segment.duration });
							}
							setStartDraft(formatSeconds(segment.startTime));
						}}
						allowExpressions={false}
						min={0}
					/>
					<div className="flex items-center gap-2">
						<Button
							variant="ghost"
							size="sm"
							onClick={() =>
								onRetime({
									startTime: Math.max(0, segment.startTime - TIMING_STEP),
									duration: segment.duration,
								})
							}
						>
							-0.05
						</Button>
						<Button
							variant="ghost"
							size="sm"
							onClick={() =>
								onRetime({
									startTime: segment.startTime + TIMING_STEP,
									duration: segment.duration,
								})
							}
						>
							+0.05
						</Button>
					</div>
				</div>
				<div className="flex flex-col gap-1.5">
					<Label>Duration</Label>
					<NumberField
						value={durationDraft}
						onChange={(event) => setDurationDraft(event.target.value)}
						onBlur={() => {
							const parsed = Number.parseFloat(durationDraft);
							if (Number.isFinite(parsed)) {
								onRetime({ startTime: segment.startTime, duration: parsed });
							}
							setDurationDraft(formatSeconds(segment.duration));
						}}
						allowExpressions={false}
						min={0.05}
					/>
					<div className="flex items-center gap-2">
						<Button
							variant="ghost"
							size="sm"
							onClick={() =>
								onRetime({
									startTime: segment.startTime,
									duration: Math.max(0.05, segment.duration - TIMING_STEP),
								})
							}
						>
							-0.05
						</Button>
						<Button
							variant="ghost"
							size="sm"
							onClick={() =>
								onRetime({
									startTime: segment.startTime,
									duration: segment.duration + TIMING_STEP,
								})
							}
						>
							+0.05
						</Button>
					</div>
				</div>
			</div>
		</div>
	);
}
