"use client";

import { useEditor } from "@/hooks/use-editor";
import { usePreviewFidelity } from "@/hooks/use-preview-fidelity";
import { formatTimeCode } from "@/lib/time";
import { invokeAction } from "@/lib/actions";
import { EditableTimecode } from "@/components/editable-timecode";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import {
	FullScreenIcon,
	PauseIcon,
	PlayIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { OcSocialIcon } from "@opencut/ui/icons";
import { Separator } from "@/components/ui/separator";
import type { PreviewFidelityReport, PreviewFidelityStatus } from "@/services/renderer/types";

export function PreviewToolbar({
	isFullscreen,
	onToggleFullscreen,
}: {
	isFullscreen: boolean;
	onToggleFullscreen: () => void;
}) {
	const editor = useEditor();
	const isPlaying = editor.playback.getIsPlaying();
	const currentTime = editor.playback.getCurrentTime();
	const totalDuration = editor.timeline.getTotalDuration();
	const fps = editor.project.getActive().settings.fps;
	const { report, isChecking, refresh } = usePreviewFidelity();
	const status = getPreviewFidelityStatus({
		report,
		isChecking,
	});

	return (
		<div className="grid grid-cols-[1fr_auto_1fr] items-center pb-3 pt-5 px-5">
			<div className="flex items-center gap-2">
				<EditableTimecode
					time={currentTime}
					duration={totalDuration}
					format="HH:MM:SS:FF"
					fps={fps}
					onTimeChange={({ time }) => editor.playback.seek({ time })}
					className="text-center"
				/>
				<span className="text-muted-foreground px-2 font-mono text-xs">/</span>
				<span className="text-muted-foreground font-mono text-xs">
					{formatTimeCode({
						timeInSeconds: totalDuration,
						format: "HH:MM:SS:FF",
						fps,
					})}
				</span>
				<PreviewFidelityChip
					report={report}
					status={status}
					onRefresh={refresh}
				/>
			</div>

			<Button
				variant="text"
				size="icon"
				onClick={() => invokeAction("toggle-play")}
			>
				<HugeiconsIcon icon={isPlaying ? PauseIcon : PlayIcon} />
			</Button>

			<div className="justify-self-end flex items-center gap-2.5">
				<Button
					variant="secondary"
					size="sm"
					className="[&_svg]:size-auto px-1 h-7"
					onClick={onToggleFullscreen}
					title={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
				>
					<OcSocialIcon size={20} />
				</Button>
				<Separator orientation="vertical" className="h-4" />
				<Button
					variant="text"
					onClick={onToggleFullscreen}
					title={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
				>
					<HugeiconsIcon icon={FullScreenIcon} />
				</Button>
			</div>
		</div>
	);
}

function PreviewFidelityChip({
	report,
	status,
	onRefresh,
}: {
	report: PreviewFidelityReport | null;
	status: PreviewFidelityStatus;
	onRefresh: () => void;
}) {
	return (
		<Popover>
			<PopoverTrigger asChild>
				<button type="button" className="cursor-pointer">
					<Badge
						variant="outline"
						className={getPreviewFidelityBadgeClassName({ status })}
					>
						Preview: {formatPreviewFidelityStatusLabel({ status })}
					</Badge>
				</button>
			</PopoverTrigger>
			<PopoverContent align="start" className="w-80 space-y-3">
				<div className="space-y-1">
					<p className="text-sm font-medium">
						Preview fidelity: {formatPreviewFidelityStatusLabel({ status })}
					</p>
					<p className="text-muted-foreground text-xs">
						{getPreviewFidelityDetailLine({ report, status })}
					</p>
				</div>
				{report?.issues.length ? (
					<div className="space-y-2">
						{report.issues.map((issue, index) => (
							<p
								key={`${issue.code}-${issue.time ?? "none"}-${index}`}
								className="text-xs leading-4"
							>
								{issue.message}
								{typeof issue.time === "number"
									? ` (${issue.time.toFixed(2)}s)`
									: ""}
							</p>
						))}
					</div>
				) : (
					<p className="text-muted-foreground text-xs">
						{status === "checking"
							? "Running deterministic parity samples."
							: "Preview and export samples currently agree for this graph."}
					</p>
				)}
				{report?.samples.length ? (
					<div className="space-y-1">
						<p className="text-muted-foreground text-[10px] uppercase tracking-wide">
							Sampled frames
						</p>
						{report.samples.map((sample) => (
							<p
								key={`${sample.time}-${sample.previewHash}-${sample.exportHash}`}
								className="text-muted-foreground text-[10px]"
							>
								{sample.time.toFixed(2)}s •{" "}
								{sample.match ? "match" : "mismatch"} • {sample.previewHash} /{" "}
								{sample.exportHash}
							</p>
						))}
					</div>
				) : null}
				<div className="flex justify-end">
					<Button variant="outline" size="sm" className="h-7 text-xs" onClick={onRefresh}>
						Check parity
					</Button>
				</div>
			</PopoverContent>
		</Popover>
	);
}

export function formatPreviewFidelityStatusLabel({
	status,
}: {
	status: PreviewFidelityStatus;
}): string {
	switch (status) {
		case "exact":
			return "Exact";
		case "approximate":
			return "Approximate";
		case "unsupported":
			return "Unsupported";
		default:
			return "Checking";
	}
}

export function getPreviewFidelityStatus({
	report,
	isChecking,
}: {
	report: PreviewFidelityReport | null;
	isChecking: boolean;
}): PreviewFidelityStatus {
	if (isChecking) {
		return "checking";
	}
	return report?.status ?? "checking";
}

export function getPreviewFidelityBadgeClassName({
	status,
}: {
	status: PreviewFidelityStatus;
}): string {
	switch (status) {
		case "exact":
			return "border-green-500/40 bg-green-500/10 text-green-700";
		case "approximate":
			return "border-yellow-500/40 bg-yellow-500/10 text-yellow-700";
		case "unsupported":
			return "border-red-500/40 bg-red-500/10 text-red-700";
		default:
			return "border-border bg-muted text-muted-foreground";
	}
}

export function getPreviewFidelityDetailLine({
	report,
	status,
}: {
	report: PreviewFidelityReport | null;
	status: PreviewFidelityStatus;
}): string {
	if (!report) {
		return "Evaluating sampled preview/export parity...";
	}

	const checkedBackends =
		report.exportBackend && report.previewBackend !== report.exportBackend;
	if (status === "exact" && checkedBackends) {
		return `Sampled parity matched across different backends (preview ${report.previewBackend}, export ${report.exportBackend}).`;
	}

	return `Preview backend ${report.previewBackend}${
		report.exportBackend ? ` • Export backend ${report.exportBackend}` : ""
	}`;
}
