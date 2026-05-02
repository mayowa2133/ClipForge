import type { ManagedCloudTranscriberArgs } from "@/lib/clipforge/transcribers/managed-cloud";
import type { CloudMediaObjectRecord } from "@/types/production";
import { listCloudProjects } from "@/lib/clipforge/production/cloud-projects-client";
import type { TProject } from "@/types/project";

export interface BuildEditorManagedCloudConfigArgs {
	getActiveProject: () => TProject | null;
	pollIntervalMs?: number;
	pollTimeoutMs?: number;
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
	if (!response.ok) return [];
	const body = (await response.json()) as { mediaObjects?: CloudMediaObjectRecord[] };
	return body.mediaObjects ?? [];
}

export function buildEditorManagedCloudConfig({
	getActiveProject,
	pollIntervalMs,
	pollTimeoutMs,
}: BuildEditorManagedCloudConfigArgs): ManagedCloudTranscriberArgs {
	let cachedProjectIdByName: Map<string, string> | null = null;
	let cachedKnownIds: Set<string> | null = null;
	let cachedMediaByProject = new Map<string, CloudMediaObjectRecord[]>();

	async function ensureCloudProjectsCache(): Promise<void> {
		if (cachedProjectIdByName !== null) return;
		try {
			const projects = await listCloudProjects();
			cachedProjectIdByName = new Map(projects.map((p) => [p.name, p.id]));
			cachedKnownIds = new Set(projects.map((p) => p.id));
		} catch {
			cachedProjectIdByName = new Map();
			cachedKnownIds = new Set();
		}
	}

	async function resolveActiveCloudProjectId(): Promise<string | null> {
		const active = getActiveProject();
		if (!active) return null;
		// 1. Stored linkage on the project takes precedence (survives renames).
		//    If the stored ID is broken we return null rather than silently
		//    using a same-name cloud project — see computeCloudReadiness for
		//    the same rationale.
		const stored = active.clipforge?.cloudProjectId ?? null;
		if (stored) {
			await ensureCloudProjectsCache();
			return cachedKnownIds?.has(stored) ? stored : null;
		}
		// 2. No link stored → fall back to name match.
		await ensureCloudProjectsCache();
		return cachedProjectIdByName?.get(active.metadata.name) ?? null;
	}

	return {
		pollIntervalMs,
		pollTimeoutMs,
		resolveCloudProjectId: async () => resolveActiveCloudProjectId(),
		resolveExistingMedia: async ({ cloudProjectId, mediaAsset }) => {
			let media = cachedMediaByProject.get(cloudProjectId);
			if (!media) {
				media = await fetchCloudMediaForProject({ projectId: cloudProjectId });
				cachedMediaByProject.set(cloudProjectId, media);
			}
			const stored = media.find(
				(record) => record.mediaId === mediaAsset.id && record.status === "stored",
			);
			if (!stored) return null;
			return { mediaId: stored.mediaId, storageKey: stored.storageKey };
		},
	};
}
