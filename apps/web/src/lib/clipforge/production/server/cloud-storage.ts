import { AwsClient } from "aws4fetch";

export interface PresignedUpload {
	url: string;
	method: "PUT";
	headers: Record<string, string>;
	expiresAt: string;
}

export interface PresignedDownload {
	url: string;
	expiresAt: string;
}

export interface CloudStorageClient {
	readonly kind: "r2" | "memory";
	presignedPut(args: {
		storageKey: string;
		contentType?: string | null;
		expiresInSeconds?: number;
	}): Promise<PresignedUpload>;
	presignedGet(args: {
		storageKey: string;
		expiresInSeconds?: number;
	}): Promise<PresignedDownload>;
	delete(args: { storageKey: string }): Promise<void>;
}

const DEFAULT_EXPIRY_SECONDS = 60 * 15;

export function buildStorageKey(args: {
	ownerId: string;
	projectId: string;
	mediaId: string;
}): string {
	const safe = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, "");
	return `clipforge/${safe(args.ownerId)}/${safe(args.projectId)}/${safe(args.mediaId)}`;
}

class R2CloudStorageClient implements CloudStorageClient {
	readonly kind = "r2" as const;
	private readonly client: AwsClient;
	private readonly endpoint: string;
	private readonly bucket: string;

	constructor(args: {
		accountId: string;
		accessKeyId: string;
		secretAccessKey: string;
		bucket: string;
	}) {
		this.client = new AwsClient({
			accessKeyId: args.accessKeyId,
			secretAccessKey: args.secretAccessKey,
			service: "s3",
			region: "auto",
		});
		this.endpoint = `https://${args.accountId}.r2.cloudflarestorage.com`;
		this.bucket = args.bucket;
	}

	private buildObjectUrl(storageKey: string): string {
		const encodedKey = storageKey
			.split("/")
			.map((part) => encodeURIComponent(part))
			.join("/");
		return `${this.endpoint}/${this.bucket}/${encodedKey}`;
	}

	async presignedPut({
		storageKey,
		contentType,
		expiresInSeconds = DEFAULT_EXPIRY_SECONDS,
	}: {
		storageKey: string;
		contentType?: string | null;
		expiresInSeconds?: number;
	}): Promise<PresignedUpload> {
		const url = new URL(this.buildObjectUrl(storageKey));
		url.searchParams.set("X-Amz-Expires", String(expiresInSeconds));
		const headers: Record<string, string> = {};
		if (contentType) headers["content-type"] = contentType;
		const signed = await this.client.sign(
			new Request(url.toString(), { method: "PUT", headers }),
			{ aws: { signQuery: true } },
		);
		return {
			url: signed.url,
			method: "PUT",
			headers,
			expiresAt: new Date(Date.now() + expiresInSeconds * 1000).toISOString(),
		};
	}

	async presignedGet({
		storageKey,
		expiresInSeconds = DEFAULT_EXPIRY_SECONDS,
	}: {
		storageKey: string;
		expiresInSeconds?: number;
	}): Promise<PresignedDownload> {
		const url = new URL(this.buildObjectUrl(storageKey));
		url.searchParams.set("X-Amz-Expires", String(expiresInSeconds));
		const signed = await this.client.sign(
			new Request(url.toString(), { method: "GET" }),
			{ aws: { signQuery: true } },
		);
		return {
			url: signed.url,
			expiresAt: new Date(Date.now() + expiresInSeconds * 1000).toISOString(),
		};
	}

	async delete({ storageKey }: { storageKey: string }): Promise<void> {
		const response = await this.client.fetch(this.buildObjectUrl(storageKey), {
			method: "DELETE",
		});
		if (!response.ok && response.status !== 404) {
			throw new Error(
				`R2 delete failed for ${storageKey}: ${response.status} ${response.statusText}`,
			);
		}
	}
}

class InMemoryCloudStorageClient implements CloudStorageClient {
	readonly kind = "memory" as const;
	private readonly objects = new Map<string, Uint8Array>();
	private readonly baseUrl: string;

	constructor(baseUrl = "http://localhost:0/clipforge-test-storage") {
		this.baseUrl = baseUrl;
	}

	async presignedPut({
		storageKey,
		expiresInSeconds = DEFAULT_EXPIRY_SECONDS,
	}: {
		storageKey: string;
		contentType?: string | null;
		expiresInSeconds?: number;
	}): Promise<PresignedUpload> {
		return {
			url: `${this.baseUrl}/${storageKey}?signed=memory`,
			method: "PUT",
			headers: {},
			expiresAt: new Date(Date.now() + expiresInSeconds * 1000).toISOString(),
		};
	}

	async presignedGet({
		storageKey,
		expiresInSeconds = DEFAULT_EXPIRY_SECONDS,
	}: {
		storageKey: string;
		expiresInSeconds?: number;
	}): Promise<PresignedDownload> {
		return {
			url: `${this.baseUrl}/${storageKey}?signed=memory`,
			expiresAt: new Date(Date.now() + expiresInSeconds * 1000).toISOString(),
		};
	}

	async delete({ storageKey }: { storageKey: string }): Promise<void> {
		this.objects.delete(storageKey);
	}

	__set(storageKey: string, bytes: Uint8Array): void {
		this.objects.set(storageKey, bytes);
	}

	__get(storageKey: string): Uint8Array | undefined {
		return this.objects.get(storageKey);
	}
}

let cachedClient: CloudStorageClient | null | undefined;

function readEnv(name: string): string | null {
	const value = process.env[name];
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function isPlaceholder(value: string): boolean {
	const lower = value.toLowerCase();
	return (
		lower === "placeholder" ||
		lower.startsWith("placeholder.") ||
		lower.includes("your-") ||
		lower.includes("changeme")
	);
}

export function getCloudStorageClient(): CloudStorageClient | null {
	if (cachedClient !== undefined) return cachedClient;

	const accountId = readEnv("CLOUDFLARE_ACCOUNT_ID");
	const accessKeyId = readEnv("R2_ACCESS_KEY_ID");
	const secretAccessKey = readEnv("R2_SECRET_ACCESS_KEY");
	const bucket = readEnv("R2_BUCKET_NAME");

	if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
		cachedClient = null;
		return cachedClient;
	}

	if (
		isPlaceholder(accountId) ||
		isPlaceholder(accessKeyId) ||
		isPlaceholder(secretAccessKey) ||
		isPlaceholder(bucket)
	) {
		cachedClient = null;
		return cachedClient;
	}

	cachedClient = new R2CloudStorageClient({
		accountId,
		accessKeyId,
		secretAccessKey,
		bucket,
	});
	return cachedClient;
}

export function __setCloudStorageClientForTesting(
	client: CloudStorageClient | null,
): void {
	cachedClient = client;
}

export function __resetCloudStorageClientForTesting(): void {
	cachedClient = undefined;
}

export { InMemoryCloudStorageClient };
