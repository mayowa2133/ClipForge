"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { TransitionTopIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/utils/ui";
import { getExportMimeType, getExportFileExtension } from "@/lib/export";
import { processMediaAssets } from "@/lib/media/processing";
import {
	applyRetryProfile,
	buildExportIncidentBundle,
	formatRetryProfileLabel,
	getExportRecoveryRecommendation,
} from "@/lib/clipforge/export-recovery";
import { Check, Copy, Download, RotateCcw } from "lucide-react";
import {
	EXPORT_FORMAT_VALUES,
	EXPORT_QUALITY_VALUES,
	type ExportDiagnostics,
	type ExportFormat,
	type ExportIncidentAttempt,
	type ExportPreflightAction,
	type ExportPreflightIssue,
	type ExportPreflightResult,
	type ExportQuality,
	type PublishDestination,
	type ExportRecoveryRecommendation,
	type ExportResult,
	type ExportRetryProfile,
} from "@/types/export";
import {
	Section,
	SectionContent,
	SectionHeader,
} from "@/components/editor/panels/properties/section";
import { useEditor } from "@/hooks/use-editor";
import { useExportPreflight } from "@/hooks/use-export-preflight";
import { usePreviewFidelity } from "@/hooks/use-preview-fidelity";
import { usePreviewStore } from "@/stores/preview-store";
import { useClipForgeOnboardingStore } from "@/stores/clipforge-onboarding-store";
import { DEFAULT_EXPORT_OPTIONS } from "@/constants/export-constants";
import type { PreviewFidelityReport } from "@/services/renderer/types";
import {
	getActiveVersionTargetId,
	getEnabledVersionTargets,
} from "@/lib/timeline";
import { getVersionTargetLabel } from "@/constants/project-constants";
import { formatPublishDestination } from "@/lib/library";
import type { ProjectVersionTarget } from "@/types/project";
import {
	formatPreviewFidelityStatusLabel,
	getPreviewFidelityDetailLine,
	getPreviewFidelityStatus,
} from "@/components/editor/panels/preview/toolbar";

export function ExportButton() {
	const [isExportPopoverOpen, setIsExportPopoverOpen] = useState(false);
	const editor = useEditor();

	const handleExport = () => {
		setIsExportPopoverOpen(true);
	};

	const hasProject = !!editor.project.getActive();

	return (
		<Popover open={isExportPopoverOpen} onOpenChange={setIsExportPopoverOpen}>
			<PopoverTrigger asChild>
				<button
					type="button"
					className={cn(
						"flex items-center gap-1.5 rounded-md bg-[#38BDF8] px-[0.12rem] py-[0.12rem] text-white",
						hasProject ? "cursor-pointer" : "cursor-not-allowed opacity-50",
					)}
					onClick={hasProject ? handleExport : undefined}
					disabled={!hasProject}
					onKeyDown={(event) => {
						if (hasProject && (event.key === "Enter" || event.key === " ")) {
							event.preventDefault();
							handleExport();
						}
					}}
				>
					<div className="relative flex items-center gap-1.5 rounded-[0.6rem] bg-linear-270 from-[#2567EC] to-[#37B6F7] px-4 py-1 shadow-[0_1px_3px_0px_rgba(0,0,0,0.65)]">
						<HugeiconsIcon icon={TransitionTopIcon} className="z-50 size-4" />
						<span className="z-50 text-[0.875rem]">Export</span>
						<div className="absolute top-0 left-0 z-10 flex size-full items-center justify-center rounded-[0.6rem] bg-linear-to-t from-white/0 to-white/50">
							<div className="absolute top-[0.08rem] z-50 h-[calc(100%-2px)] w-[calc(100%-2px)] rounded-[0.6rem] bg-linear-270 from-[#2567EC] to-[#37B6F7]"></div>
						</div>
					</div>
				</button>
			</PopoverTrigger>
			{hasProject && (
				<ExportPopover
					isOpen={isExportPopoverOpen}
					onOpenChange={setIsExportPopoverOpen}
				/>
			)}
		</Popover>
	);
}

function ExportPopover({
	isOpen,
	onOpenChange,
}: {
	isOpen: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const editor = useEditor();
	const markFirstExportCompleted = useClipForgeOnboardingStore(
		(state) => state.markFirstExportCompleted,
	);
	const previewMode = usePreviewStore((state) => state.previewMode);
	const activeProject = editor.project.getActive();
	const enabledVersionTargets = activeProject
		? getEnabledVersionTargets({ project: activeProject })
		: [];
	const activeVersionTargetId = activeProject
		? getActiveVersionTargetId({ project: activeProject })
		: null;
	const [exportScope, setExportScope] = useState<"current" | "all">("current");
	const [format, setFormat] = useState<ExportFormat>(
		DEFAULT_EXPORT_OPTIONS.format,
	);
	const [quality, setQuality] = useState<ExportQuality>(
		DEFAULT_EXPORT_OPTIONS.quality,
	);
	const [includeAudio, setIncludeAudio] = useState<boolean>(
		DEFAULT_EXPORT_OPTIONS.includeAudio ?? true,
	);
	const [publishDestination, setPublishDestination] =
		useState<PublishDestination>("generic-export");
	const [isExporting, setIsExporting] = useState(false);
	const [preflightMessages, setPreflightMessages] = useState<string[]>([]);
	const [progress, setProgress] = useState(0);
	const [exportResult, setExportResult] = useState<ExportResult | null>(null);
	const [attempts, setAttempts] = useState<ExportIncidentAttempt[]>([]);
	const [pendingRelinkIssue, setPendingRelinkIssue] =
		useState<ExportPreflightIssue | null>(null);
	const [isRelinking, setIsRelinking] = useState(false);
	const [isScanningCompatibility, setIsScanningCompatibility] = useState(false);
	const cancelRequestedRef = useRef(false);
	const relinkInputRef = useRef<HTMLInputElement>(null);
	const {
		result: preflightResult,
		isRunning: isPreflightRunning,
		isFresh: isPreflightFresh,
		refresh: refreshPreflight,
	} = useExportPreflight({
		isOpen,
		format,
		quality,
		includeAudio,
		targetVersionId: activeVersionTargetId,
		publishDestination,
	});
	const {
		report: previewFidelityReport,
		isChecking: isPreviewFidelityChecking,
		refresh: refreshPreviewFidelity,
	} = usePreviewFidelity();

	useEffect(() => {
		if (isOpen) return;
		setAttempts([]);
		setExportResult(null);
		setPreflightMessages([]);
		setProgress(0);
		setPendingRelinkIssue(null);
		setIsRelinking(false);
		setIsScanningCompatibility(false);
		setExportScope("current");
		setPublishDestination("generic-export");
	}, [isOpen]);

	const blockingFixActions = useMemo(
		() => getFixAllActions({ preflightResult }),
		[preflightResult],
	);
	const isExportActionDisabled = isExportBlocked({
		hasProject: !!activeProject,
		isExporting,
		isPreflightRunning:
			isPreflightRunning || isRelinking || isScanningCompatibility,
		isPreflightFresh,
		preflightResult,
	});
	const isAnyPreflightRunning =
		isPreflightRunning || isRelinking || isScanningCompatibility;
	const previewFidelityStatus = getPreviewFidelityStatus({
		report: previewFidelityReport,
		isChecking: isPreviewFidelityChecking,
	});

	const applyPreflightActions = async ({
		actions,
	}: {
		actions: ExportPreflightAction[];
	}) => {
		if (actions.length === 0) {
			return;
		}

		const dedupedActions = [...new Set(actions)];
		let nextFormat = format;
		let nextQuality = quality;
		let nextIncludeAudio = includeAudio;
		const managerActions: ExportPreflightAction[] = [];
		const messages: string[] = [];
		let shouldScanCompatibility = false;

		for (const action of dedupedActions) {
			switch (action) {
				case "switch-format-mp4":
					if (nextFormat !== "mp4") {
						nextFormat = "mp4";
						messages.push("Switched export format to MP4.");
					}
					break;
				case "switch-quality-medium":
					if (nextQuality === "low") {
						nextQuality = "medium";
						messages.push("Switched export quality to Medium.");
					}
					break;
				case "disable-export-audio":
					if (nextIncludeAudio) {
						nextIncludeAudio = false;
						messages.push("Disabled export audio.");
					}
					break;
				case "scan-media-compatibility":
					shouldScanCompatibility = true;
					break;
				default:
					managerActions.push(action);
			}
		}

		if (managerActions.length > 0) {
			const repairResult = editor.clipforge.applyExportPreflightFixes({
				actions: managerActions,
			});
			messages.push(...repairResult.messages);
		}

		setFormat(nextFormat);
		setQuality(nextQuality);
		setIncludeAudio(nextIncludeAudio);

		if (shouldScanCompatibility) {
			setIsScanningCompatibility(true);
			const scanResult = await editor.clipforge.scanReferencedMediaCompatibility({
				includeAudio: nextIncludeAudio,
			});
			messages.push(
				`Scanned ${scanResult.scanned} referenced media asset(s); updated ${scanResult.updated}.`,
			);
			if (scanResult.failed > 0) {
				messages.push(
					`${scanResult.failed} media asset(s) failed compatibility probing.`,
				);
			}
			setIsScanningCompatibility(false);
		}

		refreshPreflight();
		setPreflightMessages(messages);
	};

	const handleIssueFix = async ({ issue }: { issue: ExportPreflightIssue }) => {
		if (!issue.actionable || !issue.action) {
			return;
		}
		await applyPreflightActions({ actions: [issue.action] });
	};

	const openRelinkPicker = ({ issue }: { issue: ExportPreflightIssue }) => {
		if (!issue.mediaId || !relinkInputRef.current) {
			return;
		}

		relinkInputRef.current.accept = buildRelinkAccept({
			allowedReplacementTypes: issue.allowedReplacementTypes ?? null,
		});
		relinkInputRef.current.multiple = false;
		setPendingRelinkIssue(issue);
		relinkInputRef.current.click();
	};

	const handleRelinkInputChange = async (
		event: React.ChangeEvent<HTMLInputElement>,
	) => {
		const file = event.target.files?.[0];
		event.currentTarget.value = "";
		const issue = pendingRelinkIssue;
		setPendingRelinkIssue(null);
		if (!file || !issue?.mediaId) {
			return;
		}

		setIsRelinking(true);
		setPreflightMessages([]);

		try {
			const processed = await processMediaAssets({
				files: [file],
			});
			const replacementAsset = processed[0];
			if (!replacementAsset) {
				throw new Error("Failed to process the replacement media file.");
			}

			const relinkResult = await editor.clipforge.relinkMissingMediaReference({
				mediaId: issue.mediaId,
				replacementAsset,
			});
			setPreflightMessages([
				`Relinked ${relinkResult.restoredReferences} segment(s) for media ${relinkResult.mediaId}.`,
			]);
		} catch (error) {
			setPreflightMessages([
				error instanceof Error
					? error.message
					: "Failed to relink missing media reference.",
			]);
		} finally {
			refreshPreflight();
			setIsRelinking(false);
		}
	};

	const handleRemoveAffectedSegments = ({
		mediaId,
	}: {
		mediaId: string;
	}) => {
		const result = editor.clipforge.removeSegmentsReferencingMedia({
			mediaId,
		});
		if (!result.applied) {
			setPreflightMessages([
				result.errors[0]?.message ??
					`Failed to remove segments referencing missing media ${mediaId}.`,
			]);
		} else if (result.removed > 0) {
			setPreflightMessages([
				`Removed ${result.removed} segment(s) referencing missing media ${mediaId}.`,
			]);
		} else {
			setPreflightMessages([
				`No segments referencing missing media ${mediaId} were found.`,
			]);
		}

		refreshPreflight();
	};

	const handleScanCompatibility = async ({ includeAudio }: { includeAudio: boolean }) => {
		setIsScanningCompatibility(true);
		setPreflightMessages([]);
		try {
			const scanResult = await editor.clipforge.scanReferencedMediaCompatibility({
				includeAudio,
			});
			setPreflightMessages([
				`Scanned ${scanResult.scanned} referenced media asset(s); updated ${scanResult.updated}.`,
				...(scanResult.failed > 0
					? [`${scanResult.failed} media asset(s) failed compatibility probing.`]
					: []),
			]);
		} catch (error) {
			setPreflightMessages([
				error instanceof Error
					? error.message
					: "Failed to scan media compatibility.",
			]);
		} finally {
			setIsScanningCompatibility(false);
			refreshPreflight();
		}
	};

	const executeExportAttempt = async ({
		attemptFormat = format,
		attemptQuality = quality,
		attemptIncludeAudio = includeAudio,
		targetVersionId = activeVersionTargetId,
		attemptPublishDestination = publishDestination,
		closeOnSuccess = true,
	}: {
		attemptFormat?: ExportFormat;
		attemptQuality?: ExportQuality;
		attemptIncludeAudio?: boolean;
		targetVersionId?: ProjectVersionTarget | null;
		attemptPublishDestination?: PublishDestination;
		closeOnSuccess?: boolean;
	} = {}): Promise<ExportResult | null> => {
		const currentProject = editor.project.getActive();
		if (!currentProject) return null;
		const finalPreflight = editor.clipforge.runExportPreflight({
			format: attemptFormat,
			quality: attemptQuality,
			includeAudio: attemptIncludeAudio,
			targetVersionId,
			publishDestination: attemptPublishDestination,
		});
		if (!finalPreflight.ready) {
			refreshPreflight();
			return null;
		}

		cancelRequestedRef.current = false;
		setIsExporting(true);
		setProgress(0);
		setExportResult(null);
		setPreflightMessages([]);

		const result = await editor.project.export({
			options: {
				format: attemptFormat,
				quality: attemptQuality,
				fps: currentProject.settings.fps,
				includeAudio: attemptIncludeAudio,
				targetVersionId,
				publishDestination: attemptPublishDestination,
				onProgress: ({ progress }) => setProgress(progress),
				onCancel: () => cancelRequestedRef.current,
			},
		});

		setIsExporting(false);

		setAttempts((previousAttempts) => [
			...previousAttempts,
			{
				attemptIndex: previousAttempts.length + 1,
				timestamp: new Date().toISOString(),
				format: attemptFormat,
				quality: attemptQuality,
				includeAudio: attemptIncludeAudio,
				result: result.cancelled
					? "cancelled"
					: result.success
						? "success"
						: "failed",
				error: result.error,
				diagnostics: result.diagnostics,
			},
		]);

		if (result.cancelled) {
			setExportResult(null);
			setProgress(0);
			return result;
		}

		setExportResult(result);

		if (result.success && result.buffer) {
			markFirstExportCompleted();
			const mimeType = getExportMimeType({ format: attemptFormat });
			const extension = getExportFileExtension({ format: attemptFormat });
			const blob = new Blob([result.buffer], { type: mimeType });
			const url = URL.createObjectURL(blob);
			const suffix = targetVersionId
				? `_${getVersionTargetLabel({ targetId: targetVersionId }).replaceAll(":", "x")}`
				: "";

			const a = document.createElement("a");
			a.href = url;
			a.download = `${currentProject.metadata.name}${suffix}${extension}`;
			document.body.appendChild(a);
			a.click();
			document.body.removeChild(a);
			URL.revokeObjectURL(url);

			if (closeOnSuccess) {
				onOpenChange(false);
				setExportResult(null);
				setProgress(0);
				setAttempts([]);
			}
		}
		return result;
	};

	const handleExport = async () => {
		if (exportScope === "all" && enabledVersionTargets.length > 0) {
			for (const target of enabledVersionTargets) {
				const finalPreflight = editor.clipforge.runExportPreflight({
					format,
					quality,
					includeAudio,
					targetVersionId: target.id,
					publishDestination,
				});
				if (!finalPreflight.ready) {
					setPreflightMessages([
						`Export blocked for ${getVersionTargetLabel({ targetId: target.id })}. Resolve its preflight issues first.`,
					]);
					refreshPreflight();
					return;
				}
			}
			for (const target of enabledVersionTargets) {
				const result = await executeExportAttempt({
					targetVersionId: target.id,
					closeOnSuccess: false,
				});
				if (!result || !result.success) {
					return;
				}
			}
			onOpenChange(false);
			setExportResult(null);
			setProgress(0);
			setAttempts([]);
			return;
		}

		await executeExportAttempt({
			targetVersionId: activeVersionTargetId,
		});
	};

	const latestAttemptOptions =
		attempts.length > 0
			? {
					format: attempts[attempts.length - 1].format,
					quality: attempts[attempts.length - 1].quality,
					includeAudio: attempts[attempts.length - 1].includeAudio,
				}
			: {
					format,
					quality,
					includeAudio,
				};

	const retryRecommendation = useMemo<ExportRecoveryRecommendation | null>(() => {
		if (!exportResult || exportResult.success) {
			return null;
		}
		return getExportRecoveryRecommendation({
			diagnostics: exportResult.diagnostics,
			options: latestAttemptOptions,
		});
	}, [
		exportResult,
		latestAttemptOptions.format,
		latestAttemptOptions.quality,
		latestAttemptOptions.includeAudio,
	]);
	const recommendedSafeProfile = getSafeRetryProfile({
		recommendation: retryRecommendation,
	});

	const handleRetryWithProfile = async ({
		profile,
	}: {
		profile: ExportRetryProfile;
	}) => {
		const nextOptions = applyRetryProfile({
			profile,
			options: latestAttemptOptions,
		});
		setFormat(nextOptions.format);
		setQuality(nextOptions.quality);
		setIncludeAudio(nextOptions.includeAudio);
		await executeExportAttempt({
			attemptFormat: nextOptions.format,
			attemptQuality: nextOptions.quality,
			attemptIncludeAudio: nextOptions.includeAudio,
		});
	};

	const handleDownloadDiagnostics = () => {
		const currentProject = editor.project.getActive();
		const finalFailureMessage =
			exportResult?.error || "Export failed without an explicit error message.";
		const bundle = buildExportIncidentBundle({
			project: currentProject,
			preflightResult,
			attempts,
			finalFailure: exportResult
				? {
						error: finalFailureMessage,
						diagnostics: exportResult.diagnostics,
					}
				: null,
		});
		const fileName = `clipforge_export_incident_${Date.now()}.json`;
		const mimeType = "application/json";
		const url = URL.createObjectURL(
			new Blob([JSON.stringify(bundle, null, 2)], { type: mimeType }),
		);
		const anchor = document.createElement("a");
		anchor.href = url;
		anchor.download = fileName;
		document.body.appendChild(anchor);
		anchor.click();
		document.body.removeChild(anchor);
		URL.revokeObjectURL(url);
	};

	const handleCancel = () => {
		cancelRequestedRef.current = true;
	};

	return (
		<PopoverContent className="bg-background mr-4 flex w-80 flex-col p-0">
			<input
				ref={relinkInputRef}
				type="file"
				className="hidden"
				onChange={handleRelinkInputChange}
			/>
			{exportResult && !exportResult.success ? (
				<ExportError
					error={exportResult.error || "Unknown error occurred"}
					diagnostics={exportResult.diagnostics}
					recommendation={retryRecommendation}
					onRetrySameSettings={() => handleRetryWithProfile({ profile: "same-settings" })}
					onRetrySafeProfile={
						recommendedSafeProfile
							? () =>
									handleRetryWithProfile({
										profile: recommendedSafeProfile,
									})
							: undefined
					}
					onDownloadDiagnostics={handleDownloadDiagnostics}
				/>
			) : (
				<>
					<div className="flex items-center justify-between p-3 border-b">
						<h3 className="font-medium text-sm">
							{isExporting ? "Exporting video" : "Export"}
						</h3>
					</div>

					<div className="flex flex-col gap-4">
						{!isExporting && (
							<>
								<div className="flex flex-col">
									<Section hasBorderTop={false}>
										<SectionHeader title="Format" />
										<SectionContent>
											<RadioGroup
												value={format}
												onValueChange={(value) => {
													if (isExportFormat(value)) {
														setFormat(value);
													}
												}}
											>
												<div className="flex items-center space-x-2">
													<RadioGroupItem value="mp4" id="mp4" />
													<Label htmlFor="mp4">
														MP4 (H.264) - Better compatibility
													</Label>
												</div>
												<div className="flex items-center space-x-2">
													<RadioGroupItem value="webm" id="webm" />
													<Label htmlFor="webm">
														WebM (VP9) - Smaller file size
													</Label>
												</div>
											</RadioGroup>
										</SectionContent>
									</Section>

									<Section>
										<SectionHeader title="Quality" />
										<SectionContent>
											<RadioGroup
												value={quality}
												onValueChange={(value) => {
													if (isExportQuality(value)) {
														setQuality(value);
													}
												}}
											>
												<div className="flex items-center space-x-2">
													<RadioGroupItem value="low" id="low" />
													<Label htmlFor="low">Low - Smallest file size</Label>
												</div>
												<div className="flex items-center space-x-2">
													<RadioGroupItem value="medium" id="medium" />
													<Label htmlFor="medium">Medium - Balanced</Label>
												</div>
												<div className="flex items-center space-x-2">
													<RadioGroupItem value="high" id="high" />
													<Label htmlFor="high">High - Recommended</Label>
												</div>
												<div className="flex items-center space-x-2">
													<RadioGroupItem value="very_high" id="very_high" />
													<Label htmlFor="very_high">
														Very High - Largest file size
													</Label>
												</div>
											</RadioGroup>
										</SectionContent>
									</Section>

									<Section>
										<SectionHeader title="Audio" />
										<SectionContent>
											<div className="flex items-center space-x-2">
												<Checkbox
													id="include-audio"
													checked={includeAudio}
													onCheckedChange={(checked) =>
														setIncludeAudio(!!checked)
													}
												/>
												<Label htmlFor="include-audio">
													Include audio in export
												</Label>
											</div>
										</SectionContent>
									</Section>

									<Section>
										<SectionHeader title="Destination" />
										<SectionContent>
											<RadioGroup
												value={publishDestination}
												onValueChange={(value) => {
													if (
														value === "generic-export" ||
														value === "tiktok" ||
														value === "instagram" ||
														value === "youtube"
													) {
														setPublishDestination(value);
													}
												}}
											>
												<div className="flex items-center space-x-2">
													<RadioGroupItem value="generic-export" id="publish-generic-export" />
													<Label htmlFor="publish-generic-export">Generic export</Label>
												</div>
												<div className="flex items-center space-x-2">
													<RadioGroupItem value="tiktok" id="publish-tiktok" />
													<Label htmlFor="publish-tiktok">TikTok</Label>
												</div>
												<div className="flex items-center space-x-2">
													<RadioGroupItem value="instagram" id="publish-instagram" />
													<Label htmlFor="publish-instagram">Instagram</Label>
												</div>
												<div className="flex items-center space-x-2">
													<RadioGroupItem value="youtube" id="publish-youtube" />
													<Label htmlFor="publish-youtube">YouTube</Label>
												</div>
											</RadioGroup>
											<p className="text-muted-foreground text-[10px]">
												Music rights warnings are checked against{" "}
												{formatPublishDestination({ publishDestination })}.
											</p>
										</SectionContent>
									</Section>

									<Section>
										<SectionHeader title="Version" />
										<SectionContent>
											<div className="space-y-2">
												<p className="text-muted-foreground text-xs">
													Current target:{" "}
													{activeVersionTargetId
														? getVersionTargetLabel({
																targetId: activeVersionTargetId,
														  })
														: "Base canvas"}
												</p>
												<RadioGroup
													value={exportScope}
													onValueChange={(value) => {
														if (value === "current" || value === "all") {
															setExportScope(value);
														}
													}}
												>
													<div className="flex items-center space-x-2">
														<RadioGroupItem value="current" id="export-current-version" />
														<Label htmlFor="export-current-version">
															Export current version
														</Label>
													</div>
													<div className="flex items-center space-x-2">
														<RadioGroupItem value="all" id="export-all-versions" />
														<Label htmlFor="export-all-versions">
															Export all enabled versions
														</Label>
													</div>
												</RadioGroup>
												{exportScope === "all" ? (
													<p className="text-muted-foreground text-[10px]">
														Exports {enabledVersionTargets.length} enabled target
														{enabledVersionTargets.length === 1 ? "" : "s"} with
														target-specific preflight checks.
													</p>
												) : null}
											</div>
										</SectionContent>
									</Section>

									<Section>
										<SectionHeader title="Preflight" />
										<SectionContent>
											<div className="space-y-2">
												<div className="flex items-center justify-between">
													<p className="text-muted-foreground text-xs">Status</p>
													<span
														className={cn(
															"rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
															isAnyPreflightRunning
																? "bg-muted text-muted-foreground"
																: preflightResult?.ready
																	? "bg-green-500/10 text-green-600"
																	: "bg-red-500/10 text-red-600",
														)}
													>
														{isAnyPreflightRunning
															? "Refreshing"
															: preflightResult?.ready
																? "Ready"
																: "Blocked"}
													</span>
												</div>
												<p className="text-muted-foreground text-[10px]">
													Check:{" "}
													{isAnyPreflightRunning || !isPreflightFresh
														? "Refreshing"
														: "Up to date"}
													{preflightResult?.computedAt
														? ` • ${new Date(preflightResult.computedAt).toLocaleTimeString()}`
														: ""}
												</p>
												{isAnyPreflightRunning ? (
													<p className="text-muted-foreground text-xs">
														Refreshing export readiness...
													</p>
												) : null}
												{preflightResult ? (
													<div className="space-y-2">
														{preflightResult.issues.length === 0 ? (
															<p className="text-muted-foreground text-xs">
																No preflight issues detected.
															</p>
														) : (
															<div className="space-y-2">
																{preflightResult.issues.map((issue) => (
																	<div
																		key={issue.id}
																		className={cn(
																			"rounded border p-2",
																			issue.severity === "error"
																				? "border-red-500/30 bg-red-500/5"
																				: "border-yellow-500/30 bg-yellow-500/5",
																		)}
																		>
																		<div className="flex flex-col gap-2">
																			<div className="space-y-1">
																				<p className="text-xs font-medium leading-4">
																					{getExportIssueTitle({ issue })}
																				</p>
																				<p className="text-xs leading-4">{issue.message}</p>
																			</div>
																			{issue.code === "missing-media-asset" && issue.mediaId ? (
																				<div className="flex gap-1.5">
																					<Button
																						variant="outline"
																						size="sm"
																						className="h-6 flex-1 px-2 text-[10px]"
																						onClick={() => openRelinkPicker({ issue })}
																						disabled={
																							isRelinking ||
																							(issue.allowedReplacementTypes?.length ?? 0) ===
																								0
																						}
																					>
																						Relink
																					</Button>
																					<Button
																						variant="outline"
																						size="sm"
																						className="h-6 flex-1 px-2 text-[10px]"
																						onClick={() =>
																							handleRemoveAffectedSegments({
																								mediaId: issue.mediaId as string,
																							})
																						}
																						disabled={isRelinking}
																					>
																						Remove Affected Segments
																					</Button>
																				</div>
																			) : isCompatibilityIssue({ issue }) && issue.mediaId ? (
																				<div className="flex gap-1.5">
																					<Button
																						variant="outline"
																						size="sm"
																						className="h-6 flex-1 px-2 text-[10px]"
																						onClick={() => openRelinkPicker({ issue })}
																						disabled={
																							isRelinking ||
																							(issue.allowedReplacementTypes?.length ?? 0) ===
																								0
																						}
																					>
																						Relink
																					</Button>
																					<Button
																						variant="outline"
																						size="sm"
																						className="h-6 flex-1 px-2 text-[10px]"
																						onClick={() =>
																							handleRemoveAffectedSegments({
																								mediaId: issue.mediaId as string,
																							})
																						}
																						disabled={isRelinking}
																					>
																						Remove Affected Segments
																					</Button>
																					{issue.code === "media-compatibility-unverified" ? (
																						<Button
																							variant="outline"
																							size="sm"
																							className="h-6 flex-1 px-2 text-[10px]"
																							onClick={() =>
																								void handleScanCompatibility({
																									includeAudio,
																								})
																							}
																							disabled={isScanningCompatibility}
																						>
																							Scan
																						</Button>
																					) : null}
																					{issue.action === "disable-export-audio" ? (
																						<Button
																							variant="outline"
																							size="sm"
																							className="h-6 flex-1 px-2 text-[10px]"
																							onClick={() =>
																								void handleIssueFix({
																									issue,
																								})
																							}
																						>
																							Disable Audio
																						</Button>
																					) : null}
																				</div>
																			) : issue.actionable && issue.action ? (
																				<div className="flex justify-end">
																					<Button
																						variant="outline"
																						size="sm"
																						className="h-6 px-2 text-[10px]"
																						onClick={() => void handleIssueFix({ issue })}
																					>
																						Fix
																					</Button>
																				</div>
																			) : null}
																		</div>
																		<details className="mt-2">
																			<summary className="text-muted-foreground cursor-pointer text-[10px]">
																				Technical details
																			</summary>
																			<p className="text-muted-foreground mt-1 text-[10px]">
																				{buildExportIssueTechnicalDetails({ issue })}
																			</p>
																		</details>
																	</div>
																))}
															</div>
														)}
														{blockingFixActions.length > 0 ? (
															<Button
																variant="outline"
																size="sm"
																className="h-7 w-full text-xs"
																onClick={() =>
																	void applyPreflightActions({
																		actions: blockingFixActions,
																	})
																}
															>
																Fix all blocking issues
															</Button>
														) : null}
													</div>
												) : null}
												{preflightMessages.length > 0 ? (
													<div className="rounded border border-border/60 bg-muted/20 p-2">
														{preflightMessages.map((message) => (
															<p key={message} className="text-muted-foreground text-[10px]">
																{message}
															</p>
														))}
													</div>
												) : null}
											</div>
										</SectionContent>
									</Section>

									<Section>
										<SectionHeader title="Preview fidelity" />
										<SectionContent>
											<div className="space-y-2">
												<div className="flex items-center justify-between">
													<div>
														<p className="text-muted-foreground text-xs">Status</p>
														<p className="text-muted-foreground text-[10px]">
															{previewMode === "project"
																? "Project preview"
																: "Scene preview"}
														</p>
													</div>
													<span
														className={cn(
															"rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
															previewFidelityStatus === "exact"
																? "bg-green-500/10 text-green-600"
																: previewFidelityStatus === "unsupported"
																	? "bg-red-500/10 text-red-600"
																	: previewFidelityStatus === "approximate"
																		? "bg-yellow-500/10 text-yellow-600"
																		: "bg-muted text-muted-foreground",
														)}
													>
														{formatPreviewFidelityStatusLabel({
															status: previewFidelityStatus,
														})}
													</span>
												</div>
												<p className="text-muted-foreground text-[10px]">
													{getPreviewFidelitySummary({
														report: previewFidelityReport,
														status: previewFidelityStatus,
													})}
												</p>
												{previewFidelityReport?.issues.length ? (
													<div className="space-y-1">
														{previewFidelityReport.issues.map((issue, index) => (
															<p
																key={`${issue.code}-${issue.time ?? "none"}-${index}`}
																className="text-xs leading-4"
															>
																{issue.message}
															</p>
														))}
													</div>
												) : null}
												<div className="flex justify-end">
													<Button
														variant="outline"
														size="sm"
														className="h-6 px-2 text-[10px]"
														onClick={refreshPreviewFidelity}
													>
														Check parity
													</Button>
												</div>
											</div>
										</SectionContent>
									</Section>
								</div>

								<div className="p-3 pt-0">
									<Button
										onClick={handleExport}
										className="w-full gap-2"
										disabled={isExportActionDisabled}
									>
										<Download className="size-4" />
										Export
									</Button>
								</div>
							</>
						)}

						{isExporting && (
							<div className="space-y-4 p-3">
								<div className="flex flex-col">
									<div className="flex items-center justify-between text-center">
										<p className="text-muted-foreground mb-2 text-sm">
											{Math.round(progress * 100)}%
										</p>
										<p className="text-muted-foreground mb-2 text-sm">100%</p>
									</div>
									<Progress value={progress * 100} className="w-full" />
								</div>

								<Button
									variant="outline"
									className="w-full rounded-md"
									onClick={handleCancel}
								>
									Cancel
								</Button>
							</div>
						)}
					</div>
				</>
			)}
		</PopoverContent>
	);
}

export function getFixAllActions({
	preflightResult,
}: {
	preflightResult: ExportPreflightResult | null;
}): ExportPreflightAction[] {
	if (!preflightResult) {
		return [];
	}
	return [
		...new Set(
			preflightResult.issues
				.filter(
					(issue) =>
						issue.severity === "error" &&
						issue.actionable &&
						!!issue.action &&
						issue.action !== "remove-missing-segments",
				)
				.map((issue) => issue.action as ExportPreflightAction),
		),
	];
}

export function isExportBlocked({
	hasProject,
	isExporting,
	isPreflightRunning,
	isPreflightFresh,
	preflightResult,
}: {
	hasProject: boolean;
	isExporting: boolean;
	isPreflightRunning: boolean;
	isPreflightFresh: boolean;
	preflightResult: ExportPreflightResult | null;
}): boolean {
	if (!hasProject || isExporting || isPreflightRunning || !isPreflightFresh) {
		return true;
	}
	if (!preflightResult) {
		return true;
	}
	return preflightResult.blockingCount > 0;
}

export function getSafeRetryProfile({
	recommendation,
}: {
	recommendation: ExportRecoveryRecommendation | null;
}): ExportRetryProfile | null {
	return recommendation?.recommendedProfile ?? null;
}

export function getPreviewFidelitySummary({
	report,
	status,
}: {
	report: PreviewFidelityReport | null;
	status: ReturnType<typeof getPreviewFidelityStatus>;
}): string {
	if (status === "checking") {
		return "Running deterministic sampled parity checks for the current preview graph.";
	}
	if (!report) {
		return "No preview fidelity report is available yet.";
	}
	return `${getPreviewFidelityDetailLine({
		report,
		status,
	})}${
		report.checkedAt
			? ` • Checked ${new Date(report.checkedAt).toLocaleTimeString()}`
			: ""
	}`;
}

function isExportFormat(value: string): value is ExportFormat {
	return EXPORT_FORMAT_VALUES.some((formatValue) => formatValue === value);
}

function isExportQuality(value: string): value is ExportQuality {
	return EXPORT_QUALITY_VALUES.some((qualityValue) => qualityValue === value);
}

function buildRelinkAccept({
	allowedReplacementTypes,
}: {
	allowedReplacementTypes: Array<"video" | "image" | "audio"> | null;
}): string {
	if (!allowedReplacementTypes || allowedReplacementTypes.length === 0) {
		return "*";
	}

	return allowedReplacementTypes
		.flatMap((type) => (type === "audio" ? ["audio/*", "video/*"] : [`${type}/*`]))
		.filter((value, index, values) => values.indexOf(value) === index)
		.join(",");
}

function isCompatibilityIssue({
	issue,
}: {
	issue: ExportPreflightIssue;
}): boolean {
	return (
		issue.code === "media-compatibility-unverified" ||
		issue.code === "unsupported-media-codec" ||
		issue.code === "unsupported-audio-decode"
	);
}

function ExportError({
	error,
	diagnostics,
	recommendation,
	onRetrySameSettings,
	onRetrySafeProfile,
	onDownloadDiagnostics,
}: {
	error: string;
	diagnostics?: ExportDiagnostics;
	recommendation?: ExportRecoveryRecommendation | null;
	onRetrySameSettings: () => void;
	onRetrySafeProfile?: () => void;
	onDownloadDiagnostics: () => void;
}) {
	const [copied, setCopied] = useState(false);
	const diagnosticsLine = formatExportDiagnostics({ diagnostics });
	const safeRetryLabel = formatRetryProfileLabel({
		profile: recommendation?.recommendedProfile ?? null,
	});

	const handleCopy = async () => {
		await navigator.clipboard.writeText(
			diagnosticsLine ? `${error}\n${diagnosticsLine}` : error,
		);
		setCopied(true);
		setTimeout(() => setCopied(false), 1000);
	};

	return (
		<div className="space-y-4">
			<div className="flex flex-col gap-1.5">
				<p className="text-destructive text-sm font-medium">Export failed</p>
				<p className="text-muted-foreground text-xs">{error}</p>
				{diagnosticsLine ? (
					<p className="text-muted-foreground text-[11px]">{diagnosticsLine}</p>
				) : null}
				{recommendation ? (
					<p className="text-muted-foreground text-[11px]">
						Recommended retry:{" "}
						{recommendation.recommendedProfile
							? `${safeRetryLabel} (${recommendation.reason})`
							: recommendation.reason}
					</p>
				) : null}
			</div>

			<div className="flex gap-2">
				<Button
					variant="outline"
					size="sm"
					className="h-8 flex-1 text-xs"
					onClick={handleCopy}
				>
					{copied ? <Check className="text-constructive" /> : <Copy />}
					Copy
				</Button>
				<Button
					variant="outline"
					size="sm"
					className="h-8 flex-1 text-xs"
					onClick={onRetrySameSettings}
				>
					<RotateCcw />
					Retry same settings
				</Button>
			</div>
			<div className="flex gap-2">
				<Button
					variant="outline"
					size="sm"
					className="h-8 flex-1 text-xs"
					onClick={onRetrySafeProfile}
					disabled={!recommendation?.recommendedProfile || !onRetrySafeProfile}
				>
					<RotateCcw />
					Retry safe profile
				</Button>
				<Button
					variant="outline"
					size="sm"
					className="h-8 flex-1 text-xs"
					onClick={onDownloadDiagnostics}
				>
					<Download className="size-3.5" />
					Download diagnostics
				</Button>
			</div>
		</div>
	);
}

function formatExportDiagnostics({
	diagnostics,
}: {
	diagnostics?: ExportDiagnostics;
}): string | null {
	if (!diagnostics) {
		return null;
	}

	const parts = [
		diagnostics.failureCode ? `code=${diagnostics.failureCode}` : null,
		typeof diagnostics.failedFrameIndex === "number"
			? `frame=${diagnostics.failedFrameIndex}`
			: null,
		typeof diagnostics.failedTimeSeconds === "number"
			? `time=${diagnostics.failedTimeSeconds.toFixed(2)}s`
			: null,
		`backend=${diagnostics.backendUsed}`,
		diagnostics.audioIncluded ? "audio=on" : "audio=off",
		`format=${diagnostics.format}`,
		`quality=${diagnostics.quality}`,
	].filter(Boolean);

	return parts.join(" • ");
}

export function getExportIssueTitle({
	issue,
}: {
	issue: ExportPreflightIssue;
}): string {
	switch (issue.code) {
		case "missing-media-asset":
			return "Missing media file";
		case "media-compatibility-unverified":
			return "Media compatibility has not been checked";
		case "unsupported-media-codec":
		case "unsupported-audio-decode":
			return "Media format needs attention";
		case "invalid-segment-range":
			return "A clip range is out of bounds";
		case "music-rights-unknown-warning":
		case "music-platform-limited-warning":
		case "music-attribution-required-warning":
			return "Music rights may need review";
		case "audio-disabled-warning":
			return "Audio is turned off for export";
		default:
			return issue.severity === "error" ? "Blocking export issue" : "Export warning";
	}
}

export function buildExportIssueTechnicalDetails({
	issue,
}: {
	issue: ExportPreflightIssue;
}): string {
	return [
		issue.code,
		issue.mediaId ? `media=${issue.mediaId}` : null,
		typeof issue.referenceCount === "number" ? `refs=${issue.referenceCount}` : null,
		issue.compatibilityStatus ? `compat=${issue.compatibilityStatus}` : null,
		issue.compatibilityReason ? `reason=${issue.compatibilityReason}` : null,
		issue.allowedReplacementTypes && issue.allowedReplacementTypes.length > 0
			? `allowed=${issue.allowedReplacementTypes.join("/")}`
			: null,
		issue.trackId ? `track=${issue.trackId}` : null,
		issue.segmentId ? `segment=${issue.segmentId}` : null,
	]
		.filter(Boolean)
		.join(" • ");
}
