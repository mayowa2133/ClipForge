"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import {
	CloudIcon,
	CloudServerIcon,
	CloudUploadIcon,
	Copy01Icon,
	Delete02Icon,
	Link01Icon,
	Upload01Icon,
} from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useEditor } from "@/hooks/use-editor";
import { useSession } from "@/lib/auth/client";
import {
	CloudApiError,
	createCloudProjectFromLocal,
	createShareLinkForCloudProject,
	listCloudProjectShareLinks,
	listCloudProjects,
	revokeCloudProjectShareLink,
	uploadMediaAssetToCloud,
} from "@/lib/clipforge/production/cloud-projects-client";
import type {
	ClipForgeShareLinkRecord,
	CloudProjectListItem,
	CloudProjectStorageStatus,
} from "@/types/production";
import { formatDate } from "@/utils/date";

const STORAGE_STATUS_LABELS: Record<CloudProjectStorageStatus, string> = {
	"local-only": "Local only",
	syncing: "Syncing",
	synced: "Synced",
	attention: "Needs attention",
	blocked: "Blocked",
};

const STORAGE_STATUS_VARIANT: Record<
	CloudProjectStorageStatus,
	"default" | "secondary" | "destructive" | "outline"
> = {
	"local-only": "outline",
	syncing: "secondary",
	synced: "default",
	attention: "secondary",
	blocked: "destructive",
};

function buildShareUrl(token: string): string {
	if (typeof window === "undefined") return `/share/${token}`;
	return `${window.location.origin}/share/${token}`;
}

export function CloudProjectsPanel() {
	const session = useSession();
	const editor = useEditor();
	const isSignedIn = Boolean(session.data?.user?.id);
	const [cloudProjects, setCloudProjects] = useState<CloudProjectListItem[] | null>(
		null,
	);
	const [isLoadingProjects, setIsLoadingProjects] = useState(false);
	const [unauthorized, setUnauthorized] = useState(false);
	const [pendingPromote, setPendingPromote] = useState(false);

	const refresh = useCallback(async () => {
		if (!isSignedIn) {
			setCloudProjects(null);
			return;
		}
		setIsLoadingProjects(true);
		try {
			const projects = await listCloudProjects();
			setCloudProjects(projects);
			setUnauthorized(false);
		} catch (error) {
			if (error instanceof CloudApiError && error.status === 401) {
				setUnauthorized(true);
				setCloudProjects(null);
				return;
			}
			toast.error("Failed to load cloud projects", {
				description: error instanceof Error ? error.message : "Please try again.",
			});
		} finally {
			setIsLoadingProjects(false);
		}
	}, [isSignedIn]);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	if (!isSignedIn || unauthorized) return null;

	const localProjects = editor.project.getFilteredAndSortedProjects({
		searchQuery: "",
		sortOption: "updatedAt-desc",
	});

	const handlePromoteCurrent = async () => {
		const candidate = localProjects[0];
		if (!candidate) {
			toast.info("Create a local project first to save it to the cloud.");
			return;
		}
		setPendingPromote(true);
		try {
			await createCloudProjectFromLocal({
				name: candidate.name,
				project: null,
			});
			toast.success(`Created cloud entry for "${candidate.name}".`, {
				description:
					"Project metadata and edits will sync once cloud sync ships in a follow-up.",
			});
			await refresh();
		} catch (error) {
			toast.error("Failed to create cloud project", {
				description: error instanceof Error ? error.message : "Please try again.",
			});
		} finally {
			setPendingPromote(false);
		}
	};

	return (
		<Card className="mx-4 border bg-muted/10">
			<CardContent className="flex flex-col gap-4 p-5">
				<div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
					<div className="flex items-center gap-2">
						<HugeiconsIcon icon={CloudServerIcon} className="size-4 text-muted-foreground" />
						<p className="text-sm font-medium">Cloud projects</p>
						<Badge variant="outline" className="text-xs">
							Preview
						</Badge>
					</div>
					<div className="flex flex-wrap gap-2">
						<Button
							size="sm"
							variant="outline"
							onClick={() => void refresh()}
							disabled={isLoadingProjects}
						>
							Refresh
						</Button>
						<Button
							size="sm"
							onClick={() => void handlePromoteCurrent()}
							disabled={pendingPromote || localProjects.length === 0}
						>
							<HugeiconsIcon icon={CloudUploadIcon} className="size-4" />
							{pendingPromote ? "Saving…" : "Save latest local project"}
						</Button>
					</div>
				</div>
				<p className="text-muted-foreground text-xs">
					Account-backed project records. Media upload pipeline activates once R2
					credentials are configured server-side.
				</p>
				{isLoadingProjects && cloudProjects === null ? (
					<div className="flex flex-col gap-2">
						<Skeleton className="h-10 w-full" />
						<Skeleton className="h-10 w-full" />
					</div>
				) : !cloudProjects || cloudProjects.length === 0 ? (
					<p className="text-muted-foreground text-sm">
						No cloud projects yet. Save a local project to back it up.
					</p>
				) : (
					<ul className="flex flex-col divide-y">
						{cloudProjects.map((project) => (
							<CloudProjectRow
								key={project.id}
								project={project}
								onChanged={() => void refresh()}
							/>
						))}
					</ul>
				)}
			</CardContent>
		</Card>
	);
}

function CloudProjectRow({
	project,
	onChanged,
}: {
	project: CloudProjectListItem;
	onChanged: () => void;
}) {
	const [shareLinks, setShareLinks] = useState<ClipForgeShareLinkRecord[] | null>(
		null,
	);
	const [shareLinksLoaded, setShareLinksLoaded] = useState(false);
	const [pendingShare, setPendingShare] = useState(false);
	const [uploadingCount, setUploadingCount] = useState(0);
	const fileInputRef = useRef<HTMLInputElement | null>(null);

	const loadShareLinks = useCallback(async () => {
		try {
			const links = await listCloudProjectShareLinks({ projectId: project.id });
			setShareLinks(links);
			setShareLinksLoaded(true);
		} catch (error) {
			toast.error("Failed to load share links", {
				description: error instanceof Error ? error.message : "Please try again.",
			});
		}
	}, [project.id]);

	useEffect(() => {
		if (!shareLinksLoaded) {
			void loadShareLinks();
		}
	}, [shareLinksLoaded, loadShareLinks]);

	const activeShareLinks = (shareLinks ?? []).filter(
		(link) =>
			!link.revokedAt && (!link.expiresAt || new Date(link.expiresAt) > new Date()),
	);

	const handleCreateShareLink = async () => {
		setPendingShare(true);
		try {
			const link = await createShareLinkForCloudProject({
				projectId: project.id,
				role: "viewer",
			});
			setShareLinks((current) => [link, ...(current ?? [])]);
			void copyShareUrl(link.token);
			onChanged();
		} catch (error) {
			toast.error("Failed to create share link", {
				description: error instanceof Error ? error.message : "Please try again.",
			});
		} finally {
			setPendingShare(false);
		}
	};

	const handleUploadFiles = async (files: FileList | null) => {
		if (!files || files.length === 0) return;
		const list = Array.from(files);
		setUploadingCount(list.length);
		let succeeded = 0;
		let failed = 0;
		for (const file of list) {
			const mediaId = `media_${crypto.randomUUID().replaceAll("-", "")}`;
			try {
				await uploadMediaAssetToCloud({
					projectId: project.id,
					mediaId,
					file,
				});
				succeeded += 1;
			} catch (error) {
				failed += 1;
				toast.error(`Upload failed for ${file.name}`, {
					description:
						error instanceof Error ? error.message : "Please try again.",
				});
			}
		}
		setUploadingCount(0);
		if (succeeded > 0) {
			toast.success(`Uploaded ${succeeded} file${succeeded === 1 ? "" : "s"} to cloud`);
			onChanged();
		}
		if (failed === 0 && succeeded === 0) {
			toast.info("No files were uploaded.");
		}
	};

	const handleRevokeShareLink = async (linkId: string) => {
		try {
			const revoked = await revokeCloudProjectShareLink({
				projectId: project.id,
				shareLinkId: linkId,
			});
			setShareLinks((current) =>
				(current ?? []).map((link) => (link.id === linkId ? revoked : link)),
			);
		} catch (error) {
			toast.error("Failed to revoke share link", {
				description: error instanceof Error ? error.message : "Please try again.",
			});
		}
	};

	return (
		<li className="flex flex-col gap-3 py-3 md:flex-row md:items-center md:justify-between">
			<div className="flex items-center gap-3 min-w-0">
				<HugeiconsIcon icon={CloudIcon} className="size-4 text-muted-foreground" />
				<div className="min-w-0">
					<p className="text-sm font-medium truncate">{project.name}</p>
					<p className="text-muted-foreground text-xs">
						Updated {formatDate({ date: new Date(project.updatedAt) })} · v
						{project.projectVersion}
					</p>
				</div>
			</div>
			<div className="flex flex-wrap items-center gap-2">
				<Badge variant={STORAGE_STATUS_VARIANT[project.storageStatus]}>
					{STORAGE_STATUS_LABELS[project.storageStatus]}
				</Badge>
				<input
					ref={fileInputRef}
					type="file"
					multiple
					className="hidden"
					onChange={(event) => {
						void handleUploadFiles(event.target.files);
						event.target.value = "";
					}}
				/>
				<Button
					size="sm"
					variant="outline"
					onClick={() => fileInputRef.current?.click()}
					disabled={uploadingCount > 0}
					aria-label="Upload media to cloud project"
				>
					<HugeiconsIcon icon={Upload01Icon} className="size-4" />
					{uploadingCount > 0
						? `Uploading ${uploadingCount}…`
						: "Upload media"}
				</Button>
				{activeShareLinks.length > 0 ? (
					<div className="flex items-center gap-1">
						<Button
							size="sm"
							variant="outline"
							onClick={() => void copyShareUrl(activeShareLinks[0].token)}
							aria-label="Copy share link"
						>
							<HugeiconsIcon icon={Copy01Icon} className="size-4" />
							Copy link
						</Button>
						<Button
							size="sm"
							variant="ghost"
							onClick={() => void handleRevokeShareLink(activeShareLinks[0].id)}
							aria-label="Revoke share link"
						>
							<HugeiconsIcon icon={Delete02Icon} className="size-4" />
						</Button>
					</div>
				) : (
					<Button
						size="sm"
						variant="outline"
						onClick={() => void handleCreateShareLink()}
						disabled={pendingShare}
					>
						<HugeiconsIcon icon={Link01Icon} className="size-4" />
						{pendingShare ? "Creating…" : "Create share link"}
					</Button>
				)}
			</div>
		</li>
	);
}

async function copyShareUrl(token: string): Promise<void> {
	const url = buildShareUrl(token);
	try {
		await navigator.clipboard.writeText(url);
		toast.success("Share link copied to clipboard");
	} catch {
		toast.info(url, {
			description: "Copy this share URL manually.",
			duration: 10_000,
		});
	}
}
