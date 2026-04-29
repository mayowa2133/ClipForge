"use client";

import { use, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import {
	CloudIcon,
	Calendar04Icon,
	Video01Icon,
} from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate } from "@/utils/date";
import { formatTimeCode } from "@/lib/time";
import type { TProject } from "@/types/project";
import type { ClipForgeShareRole } from "@/types/production";

interface ShareResponse {
	share: { role: ClipForgeShareRole; expiresAt: string | null };
	project: {
		id: string;
		name: string;
		projectVersion: number;
		project: TProject | null;
		updatedAt: string;
	};
}

interface ShareErrorResponse {
	error: string;
}

type ShareState =
	| { status: "loading" }
	| { status: "ready"; data: ShareResponse }
	| { status: "error"; message: string; httpStatus: number };

export default function ShareViewerPage({
	params,
}: {
	params: Promise<{ token: string }>;
}) {
	const { token } = use(params);
	const [state, setState] = useState<ShareState>({ status: "loading" });

	useEffect(() => {
		let cancelled = false;
		(async () => {
			try {
				const response = await fetch(
					`/api/clipforge/share/${encodeURIComponent(token)}`,
					{ cache: "no-store" },
				);
				if (!response.ok) {
					const body = (await response
						.json()
						.catch(() => ({ error: "Share link is unavailable." }))) as ShareErrorResponse;
					if (cancelled) return;
					setState({
						status: "error",
						message: body.error ?? "Share link is unavailable.",
						httpStatus: response.status,
					});
					return;
				}
				const body = (await response.json()) as ShareResponse;
				if (cancelled) return;
				setState({ status: "ready", data: body });
			} catch (error) {
				if (cancelled) return;
				setState({
					status: "error",
					message:
						error instanceof Error ? error.message : "Network error loading share.",
					httpStatus: 0,
				});
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [token]);

	return (
		<main className="bg-background min-h-screen">
			<header className="border-b">
				<div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
					<Link href="/" className="flex items-center gap-2 text-sm font-medium">
						<HugeiconsIcon icon={CloudIcon} className="size-4" />
						ClipForge share
					</Link>
					<Button asChild size="sm" variant="outline">
						<Link href="/projects">Open ClipForge</Link>
					</Button>
				</div>
			</header>
			<section className="mx-auto max-w-3xl px-6 py-8">
				{state.status === "loading" ? <SharePageSkeleton /> : null}
				{state.status === "error" ? (
					<ShareError message={state.message} httpStatus={state.httpStatus} />
				) : null}
				{state.status === "ready" ? <ShareSummary data={state.data} /> : null}
			</section>
		</main>
	);
}

function SharePageSkeleton() {
	return (
		<div className="flex flex-col gap-4">
			<Skeleton className="h-8 w-2/3" />
			<Skeleton className="h-4 w-1/3" />
			<Skeleton className="h-32 w-full" />
		</div>
	);
}

function ShareError({
	message,
	httpStatus,
}: {
	message: string;
	httpStatus: number;
}) {
	const isMissing = httpStatus === 404;
	return (
		<Card>
			<CardContent className="flex flex-col gap-3 p-6">
				<p className="text-lg font-medium">
					{isMissing ? "Share link is unavailable" : "Could not load share"}
				</p>
				<p className="text-muted-foreground text-sm">{message}</p>
				<p className="text-muted-foreground text-xs">
					Share links expire, can be revoked by the project owner, or may not yet
					exist for this URL.
				</p>
			</CardContent>
		</Card>
	);
}

function ShareSummary({ data }: { data: ShareResponse }) {
	const { share, project } = data;
	const summary = useMemo(() => summarizeProject(project.project), [project.project]);
	return (
		<div className="flex flex-col gap-6">
			<div className="flex flex-col gap-2">
				<div className="flex items-center gap-2">
					<HugeiconsIcon icon={CloudIcon} className="size-4 text-muted-foreground" />
					<h1 className="text-2xl font-semibold">{project.name}</h1>
					<Badge variant="outline">{share.role}</Badge>
				</div>
				<p className="text-muted-foreground text-sm">
					Last updated {formatDate({ date: new Date(project.updatedAt) })} · v
					{project.projectVersion}
					{share.expiresAt
						? ` · expires ${formatDate({ date: new Date(share.expiresAt) })}`
						: " · no expiration"}
				</p>
			</div>
			<Card>
				<CardContent className="flex flex-col gap-3 p-6">
					<p className="text-sm font-medium">Project summary</p>
					{summary ? (
						<dl className="grid grid-cols-2 gap-3 text-sm">
							<div className="flex items-center gap-2">
								<HugeiconsIcon icon={Video01Icon} className="size-4 text-muted-foreground" />
								<dt className="text-muted-foreground">Scenes</dt>
								<dd>{summary.sceneCount}</dd>
							</div>
							<div className="flex items-center gap-2">
								<HugeiconsIcon icon={Calendar04Icon} className="size-4 text-muted-foreground" />
								<dt className="text-muted-foreground">Duration</dt>
								<dd>{summary.durationDisplay}</dd>
							</div>
							<div className="col-span-2">
								<dt className="text-muted-foreground">Canvas</dt>
								<dd>{summary.canvasDisplay}</dd>
							</div>
						</dl>
					) : (
						<p className="text-muted-foreground text-sm">
							This share does not include the editable project payload yet.
							Project metadata sync will populate it once cloud project save ships.
						</p>
					)}
				</CardContent>
			</Card>
			<Card>
				<CardContent className="flex flex-col gap-2 p-6">
					<p className="text-sm font-medium">What you can do</p>
					<ul className="text-muted-foreground text-sm list-disc pl-6 space-y-1">
						<li>
							{share.role === "viewer"
								? "Read-only preview of the project state."
								: share.role === "commenter"
									? "Read-only preview today; commenting will land with the collaboration milestone."
									: "Read-only preview today; editor sessions will land with the collaboration milestone."}
						</li>
						<li>
							To edit, the project owner can invite you to their workspace from
							the cloud projects panel.
						</li>
					</ul>
				</CardContent>
			</Card>
		</div>
	);
}

function summarizeProject(project: TProject | null): {
	sceneCount: number;
	durationDisplay: string;
	canvasDisplay: string;
} | null {
	if (!project) return null;
	const totalDuration = project.metadata?.duration ?? 0;
	const canvas = project.settings?.canvasSize;
	return {
		sceneCount: project.scenes?.length ?? 0,
		durationDisplay: formatTimeCode({
			timeInSeconds: totalDuration,
			format: totalDuration >= 3600 ? "HH:MM:SS" : "MM:SS",
		}),
		canvasDisplay: canvas
			? `${canvas.width} × ${canvas.height}`
			: "Unknown canvas",
	};
}
