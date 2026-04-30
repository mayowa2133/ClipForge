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
	let cachedMediaByProject = new Map<string, CloudMediaObjectRecord[]>();

	async function getCloudProjectIdByActiveName(): Promise<string | null> {
		const active = getActiveProject();
		if (!active) return null;
		if (!cachedProjectIdByName) {
			try {
				const projects = await listCloudProjects();
				cachedProjectIdByName = new Map(projects.map((p) => [p.name, p.id]));
			} catch {
				cachedProjectIdByName = new Map();
				return null;
			}
		}
		return cachedProjectIdByName.get(active.metadata.name) ?? null;
	}

	return {
		pollIntervalMs,
		pollTimeoutMs,
		resolveCloudProjectId: async () => getCloudProjectIdByActiveName(),
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
