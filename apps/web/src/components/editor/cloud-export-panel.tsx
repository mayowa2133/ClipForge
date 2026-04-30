"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import { CloudServerIcon, CloudUploadIcon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { useEditor } from "@/hooks/use-editor";
import {
	CloudApiError,
	listCloudProjects,
} from "@/lib/clipforge/production/cloud-projects-client";
import {
	computeCloudReadiness,
	pollCloudExportJob,
	submitCloudExportJob,
} from "@/lib/clipforge/production/cloud-export-client";
import type {
	ExportFormat,
	ExportQuality,
	PublishDestination,
} from "@/types/export";
import type {
	ClipForgeJobRecord,
	CloudMediaObjectRecord,
	CloudProjectListItem,
} from "@/types/production";

interface CloudExportPanelProps {
	format: ExportFormat;
	quality: ExportQuality;
	includeAudio: boolean;
	publishDestination: PublishDestination;
	disabled?: boolean;
}

type CloudExportPhase =
	| { kind: "idle" }
	| { kind: "submitting" }
	| { kind: "polling"; job: ClipForgeJobRecord; pct: number }
	| { kind: "completed"; job: ClipForgeJobRecord; downloadUrl: string | null }
	| { kind: "failed"; message: string };

interface CloudReadiness {
	loading: boolean;
	error: string | null;
	cloudProject: CloudProjectListItem | null;
	allCloudProjects: CloudProjectListItem[];
	mediaObjects: CloudMediaObjectRecord[];
	referencedMediaIds: string[];
	missingMediaIds: string[];
}

async function fetchCloudMediaForProject({
	projectId,
}: {
	projectId: string;
}): Promise<CloudMediaObjectRecord[]> {
	const response = await fetch(
		`/api/clipforge/cloud/projects/${encodeURIComponent(projectId)}/media`,
		{ credentials: "include", cache: "no-store" },
	);
	if (!response.ok) {
		throw new CloudApiError(
			`Failed to load cloud media (status ${response.status})`,
			response.status,
		);
	}
	const body = (await response.json()) as { mediaObjects: CloudMediaObjectRecord[] };
	return body.mediaObjects ?? [];
}

export function CloudExportPanel({
	format,
	quality,
	includeAudio,
	publishDestination,
	disabled = false,
}: CloudExportPanelProps) {
	const editor = useEditor();
	const [enabled, setEnabled] = useState(false);
	const [unauthorized, setUnauthorized] = useState(false);
	const [readiness, setReadiness] = useState<CloudReadiness>({
		loading: false,
		error: null,
		cloudProject: null,
		allCloudProjects: [],
		mediaObjects: [],
		referencedMediaIds: [],
		missingMediaIds: [],
	});
	const [phase, setPhase] = useState<CloudExportPhase>({ kind: "idle" });

	const isSignedIn = !unauthorized;
	const activeProject = editor.project.getActive();

	const projectName = activeProject?.metadata.name ?? null;

	const refreshReadiness = useCallback(async () => {
		if (!enabled || !activeProject) return;
		setReadiness((current) => ({ ...current, loading: true, error: null }));
		try {
			const allCloudProjects = await listCloudProjects();
			setUnauthorized(false);
			const matching =
				allCloudProjects.find((cp) => cp.name === activeProject.metadata.name) ?? null;
			const mediaObjects = matching
				? await fetchCloudMediaForProject({ projectId: matching.id })
				: [];
			const summary = computeCloudReadiness({
				project: activeProject,
				allCloudProjects,
				mediaObjects,
			});
			setReadiness({
				loading: false,
				error: null,
				cloudProject: summary.cloudProject,
				allCloudProjects,
				mediaObjects,
				referencedMediaIds: summary.referencedMediaIds,
				missingMediaIds: summary.missingMediaIds,
			});
		} catch (error) {
			if (error instanceof CloudApiError && error.status === 401) {
				setUnauthorized(true);
				setReadiness((current) => ({ ...current, loading: false, error: null }));
				return;
			}
			setReadiness((current) => ({
				...current,
				loading: false,
				error:
					error instanceof Error
						? error.message
						: "Failed to load cloud project state.",
			}));
		}
	}, [enabled, activeProject]);

	useEffect(() => {
		if (enabled) {
			void refreshReadiness();
		}
	}, [enabled, refreshReadiness]);

	const submitDisabledReason = useMemo(() => {
		if (!isSignedIn) return "Sign in to use cloud render.";
		if (!activeProject) return "Open a project to render.";
		if (readiness.loading) return "Loading cloud project state…";
		if (!readiness.cloudProject)
			return `No cloud project found named "${projectName}". Save it from the Projects page first.`;
		if (
			readiness.referencedMediaIds.length > 0 &&
			readiness.missingMediaIds.length > 0
		)
			return `${readiness.missingMediaIds.length} referenced media asset(s) are not uploaded to cloud yet.`;
		return null;
	}, [
		activeProject,
		isSignedIn,
		projectName,
		readiness.cloudProject,
		readiness.loading,
		readiness.missingMediaIds.length,
		readiness.referencedMediaIds.length,
	]);

	const handleSubmit = async () => {
		if (!activeProject) return;
		setPhase({ kind: "submitting" });
		try {
			const job = await submitCloudExportJob({
				project: activeProject,
				cloudProjectId: readiness.cloudProject?.id ?? null,
				format,
				quality,
				includeAudio,
				publishDestination,
				cloudMediaObjects: readiness.mediaObjects,
				provider: "ffmpeg",
			});
			toast.success("Cloud render job submitted", {
				description: `Job ${job.id.slice(0, 12)}… is queued for the worker.`,
			});
			setPhase({ kind: "polling", job, pct: 0 });
			const result = await pollCloudExportJob({
				jobId: job.id,
				onProgress: (current) => {
					setPhase({
						kind: "polling",
						job: current,
						pct: current.progressPct ?? 0,
					});
				},
			});
			if (result.job.status === "completed") {
				setPhase({
					kind: "completed",
					job: result.job,
					downloadUrl: result.download?.url ?? null,
				});
			} else {
				setPhase({
					kind: "failed",
					message:
						result.job.errorMessage ??
						`Job ended with status ${result.job.status}.`,
				});
			}
		} catch (error) {
			setPhase({
				kind: "failed",
				message:
					error instanceof Error ? error.message : "Cloud render failed.",
			});
		}
	};

	if (!isSignedIn) return null;

	return (
		<div className="flex flex-col gap-3 border-t pt-3">
			<div className="flex items-start gap-2">
				<Checkbox
					id="cloud-render"
					checked={enabled}
					onCheckedChange={(value) => setEnabled(value === true)}
					disabled={disabled || phase.kind === "polling" || phase.kind === "submitting"}
				/>
				<div className="flex-1">
					<Label
						htmlFor="cloud-render"
						className="flex items-center gap-2 text-sm"
					>
						<HugeiconsIcon
							icon={CloudServerIcon}
							className="size-4 text-muted-foreground"
						/>
						Render in cloud
						<Badge variant="outline" className="text-xs">
							Preview
						</Badge>
					</Label>
					<p className="text-muted-foreground text-xs mt-1">
						Submit this project to the ClipForge worker queue. Requires the
						project to be saved to cloud and any referenced media uploaded.
					</p>
				</div>
			</div>

			{enabled ? (
				<div className="flex flex-col gap-3 rounded-md border bg-muted/30 p-3 text-sm">
					{readiness.loading ? (
						<p className="text-muted-foreground">Checking cloud state…</p>
					) : readiness.error ? (
						<p className="text-destructive">{readiness.error}</p>
					) : (
						<dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
							<dt className="text-muted-foreground">Cloud project</dt>
							<dd>
								{readiness.cloudProject
									? readiness.cloudProject.name
									: "Not saved"}
							</dd>
							<dt className="text-muted-foreground">Referenced media</dt>
							<dd>{readiness.referencedMediaIds.length}</dd>
							<dt className="text-muted-foreground">Missing in cloud</dt>
							<dd
								className={
									readiness.missingMediaIds.length > 0 ? "text-destructive" : ""
								}
							>
								{readiness.missingMediaIds.length}
							</dd>
						</dl>
					)}

					{phase.kind === "polling" ? (
						<div className="flex flex-col gap-2">
							<div className="text-muted-foreground text-xs">
								Job {phase.job.id.slice(0, 12)}… · {phase.job.status} ·{" "}
								{phase.pct}%
							</div>
							<Progress value={phase.pct} className="w-full" />
						</div>
					) : null}

					{phase.kind === "completed" ? (
						<div className="flex flex-col gap-2">
							<p className="text-xs">Cloud render completed.</p>
							{phase.downloadUrl ? (
								<Button asChild size="sm" className="w-full">
									<a
										href={phase.downloadUrl}
										target="_blank"
										rel="noreferrer"
										download
									>
										<HugeiconsIcon icon={CloudUploadIcon} className="size-4" />
										Download artifact
									</a>
								</Button>
							) : (
								<p className="text-muted-foreground text-xs">
									Job completed but no presigned download URL was returned. Try
									again from the Projects page.
								</p>
							)}
						</div>
					) : null}

					{phase.kind === "failed" ? (
						<p className="text-destructive text-xs">{phase.message}</p>
					) : null}

					{phase.kind !== "polling" && phase.kind !== "submitting" ? (
						<Button
							size="sm"
							onClick={() => void handleSubmit()}
							disabled={
								disabled ||
								submitDisabledReason !== null ||
								phase.kind === "completed"
							}
							className="w-full"
						>
							{phase.kind === "completed" ? "Submitted" : "Submit cloud render"}
						</Button>
					) : null}
					{submitDisabledReason ? (
						<p className="text-muted-foreground text-xs">
							{submitDisabledReason}
						</p>
					) : null}
				</div>
			) : null}
		</div>
	);
}
