import type {
	ClipForgeShareLinkRecord,
	ClipForgeShareRole,
	CloudMediaObjectRecord,
	CloudMediaObjectStatus,
	CloudProjectListItem,
	CloudProjectRecord,
} from "@/types/production";
import type { TProject } from "@/types/project";

export class CloudApiError extends Error {
	constructor(message: string, readonly status: number) {
		super(message);
	}
}

async function readJson<T>(response: Response): Promise<T> {
	if (!response.ok) {
		let message = `Request failed with status ${response.status}`;
		try {
			const body = (await response.json()) as { error?: string };
			if (body && typeof body.error === "string") message = body.error;
		} catch {}
		throw new CloudApiError(message, response.status);
	}
	return (await response.json()) as T;
}

export async function listCloudProjects(): Promise<CloudProjectListItem[]> {
	const response = await fetch("/api/clipforge/cloud/projects", {
		credentials: "include",
	});
	const body = await readJson<{ projects: CloudProjectListItem[] }>(response);
	return body.projects;
}

export async function createCloudProjectFromLocal({
	name,
	project,
}: {
	name: string;
	project: TProject | null;
}): Promise<CloudProjectRecord> {
	const response = await fetch("/api/clipforge/cloud/projects", {
		method: "POST",
		credentials: "include",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ name, project }),
	});
	const body = await readJson<{ project: CloudProjectRecord }>(response);
	return body.project;
}

export async function listCloudProjectShareLinks({
	projectId,
}: {
	projectId: string;
}): Promise<ClipForgeShareLinkRecord[]> {
	const response = await fetch(
		`/api/clipforge/cloud/projects/${encodeURIComponent(projectId)}/share-links`,
		{ credentials: "include" },
	);
	const body = await readJson<{ shareLinks: ClipForgeShareLinkRecord[] }>(response);
	return body.shareLinks;
}

export async function createShareLinkForCloudProject({
	projectId,
	role,
	expiresAt,
}: {
	projectId: string;
	role: ClipForgeShareRole;
	expiresAt?: string | null;
}): Promise<ClipForgeShareLinkRecord> {
	const response = await fetch(
		`/api/clipforge/cloud/projects/${encodeURIComponent(projectId)}/share-links`,
		{
			method: "POST",
			credentials: "include",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ role, expiresAt: expiresAt ?? null }),
		},
	);
	const body = await readJson<{ shareLink: ClipForgeShareLinkRecord }>(response);
	return body.shareLink;
}

export async function revokeCloudProjectShareLink({
	projectId,
	shareLinkId,
}: {
	projectId: string;
	shareLinkId: string;
}): Promise<ClipForgeShareLinkRecord> {
	const response = await fetch(
		`/api/clipforge/cloud/projects/${encodeURIComponent(projectId)}/share-links/${encodeURIComponent(shareLinkId)}`,
		{ method: "DELETE", credentials: "include" },
	);
	const body = await readJson<{ shareLink: ClipForgeShareLinkRecord }>(response);
	return body.shareLink;
}

export interface CreateMediaObjectResult {
	mediaObject: CloudMediaObjectRecord;
	upload: {
		url: string;
		method: "PUT";
		headers: Record<string, string>;
		expiresAt: string;
	} | null;
}

export async function createCloudMediaObject({
	projectId,
	mediaId,
	bytes,
	sha256,
	contentType,
}: {
	projectId: string;
	mediaId: string;
	bytes?: number;
	sha256?: string | null;
	contentType?: string | null;
}): Promise<CreateMediaObjectResult> {
	const response = await fetch(
		`/api/clipforge/cloud/projects/${encodeURIComponent(projectId)}/media`,
		{
			method: "POST",
			credentials: "include",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ mediaId, bytes, sha256, contentType }),
		},
	);
	return await readJson<CreateMediaObjectResult>(response);
}

export type UploadFetch = (
	input: string,
	init?: { method?: string; headers?: Record<string, string>; body?: BodyInit | null },
) => Promise<Response>;

export interface UploadProgressEvent {
	phase: "creating" | "uploading" | "confirming" | "done" | "error";
	mediaObject?: CloudMediaObjectRecord;
	error?: string;
}

export async function uploadMediaAssetToCloud({
	projectId,
	mediaId,
	file,
	contentType,
	onProgress,
	uploadFetchImpl,
}: {
	projectId: string;
	mediaId: string;
	file: Blob;
	contentType?: string | null;
	onProgress?: (event: UploadProgressEvent) => void;
	uploadFetchImpl?: UploadFetch;
}): Promise<CloudMediaObjectRecord> {
	const callUpload: UploadFetch =
		uploadFetchImpl ?? ((input, init) => fetch(input, init));

	onProgress?.({ phase: "creating" });
	const initial = await createCloudMediaObject({
		projectId,
		mediaId,
		bytes: file.size,
		contentType: contentType ?? file.type ?? null,
	});

	if (!initial.upload) {
		const failed = await updateCloudMediaObjectStatus({
			projectId,
			mediaObjectId: initial.mediaObject.id,
			status: "failed",
		});
		const message =
			"Cloud storage is not configured on this deployment. Set CLOUDFLARE_ACCOUNT_ID and R2_* env vars to enable uploads.";
		onProgress?.({ phase: "error", mediaObject: failed, error: message });
		throw new CloudApiError(message, 501);
	}

	onProgress?.({ phase: "uploading", mediaObject: initial.mediaObject });
	const putResponse = await callUpload(initial.upload.url, {
		method: initial.upload.method,
		headers: initial.upload.headers,
		body: file,
	});
	if (!putResponse.ok) {
		const failed = await updateCloudMediaObjectStatus({
			projectId,
			mediaObjectId: initial.mediaObject.id,
			status: "failed",
		});
		const message = `Upload failed with status ${putResponse.status}`;
		onProgress?.({ phase: "error", mediaObject: failed, error: message });
		throw new CloudApiError(message, putResponse.status);
	}

	onProgress?.({ phase: "confirming", mediaObject: initial.mediaObject });
	const stored = await updateCloudMediaObjectStatus({
		projectId,
		mediaObjectId: initial.mediaObject.id,
		status: "stored",
		bytes: file.size,
	});

	onProgress?.({ phase: "done", mediaObject: stored });
	return stored;
}

export async function updateCloudMediaObjectStatus({
	projectId,
	mediaObjectId,
	status,
	bytes,
	sha256,
}: {
	projectId: string;
	mediaObjectId: string;
	status: CloudMediaObjectStatus;
	bytes?: number;
	sha256?: string | null;
}): Promise<CloudMediaObjectRecord> {
	const response = await fetch(
		`/api/clipforge/cloud/projects/${encodeURIComponent(projectId)}/media/${encodeURIComponent(mediaObjectId)}`,
		{
			method: "PATCH",
			credentials: "include",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ status, bytes, sha256 }),
		},
	);
	const body = await readJson<{ mediaObject: CloudMediaObjectRecord }>(response);
	return body.mediaObject;
}
