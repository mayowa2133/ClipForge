/**
 * Local filesystem media fetcher for local-mode rendering.
 *
 * Implements the MediaFetcher interface from ffmpeg-engine.ts, resolving
 * media by ID from a local directory or explicit path map instead of
 * downloading from R2 cloud storage.
 */
import { existsSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import type { MediaFetcher } from "./ffmpeg-engine";
import type { RenderGraphMediaRef } from "@/lib/clipforge/production/render-graph";

export interface LocalFileMediaFetcherArgs {
	/**
	 * Explicit mediaId → local file path mapping.
	 * Takes priority over directory scanning.
	 */
	mediaPathMap?: Map<string, string>;
	/**
	 * Directory to scan for media files if not found in the path map.
	 * Files are matched by mediaId (with or without extension).
	 */
	mediaDir?: string;
}

export class LocalFileMediaFetcher implements MediaFetcher {
	private readonly mediaPathMap: Map<string, string>;
	private readonly mediaDir: string | null;

	constructor({ mediaPathMap, mediaDir }: LocalFileMediaFetcherArgs = {}) {
		this.mediaPathMap = mediaPathMap ?? new Map();
		this.mediaDir = mediaDir ?? null;
	}

	async fetchToLocalPath({
		mediaRef,
	}: {
		mediaRef: RenderGraphMediaRef;
		mediaIndex: number;
	}): Promise<{ localPath: string; cleanup?: () => Promise<void> }> {
		// 1. Check explicit path map by mediaId
		const mappedPath = this.mediaPathMap.get(mediaRef.mediaId);
		if (mappedPath && existsSync(mappedPath)) {
			return { localPath: resolve(mappedPath) };
		}

		// 2. If cloudStorageKey looks like an absolute local path, use it directly
		if (
			mediaRef.cloudStorageKey &&
			(mediaRef.cloudStorageKey.startsWith("/") ||
				mediaRef.cloudStorageKey.startsWith("file://"))
		) {
			const localPath = mediaRef.cloudStorageKey.replace(/^file:\/\//, "");
			if (existsSync(localPath)) {
				return { localPath: resolve(localPath) };
			}
		}

		// 3. Scan mediaDir for matching file
		if (this.mediaDir) {
			const candidates = [
				mediaRef.mediaId,
				`${mediaRef.mediaId}.mp4`,
				`${mediaRef.mediaId}.mov`,
				`${mediaRef.mediaId}.webm`,
				`${mediaRef.mediaId}.mp3`,
				`${mediaRef.mediaId}.wav`,
				`${mediaRef.mediaId}.aac`,
				`${mediaRef.mediaId}.png`,
				`${mediaRef.mediaId}.jpg`,
				`${mediaRef.mediaId}.jpeg`,
			];

			for (const candidate of candidates) {
				const fullPath = join(this.mediaDir, candidate);
				if (existsSync(fullPath)) {
					return { localPath: resolve(fullPath) };
				}
			}

			// Also try matching by cloudStorageKey basename
			if (mediaRef.cloudStorageKey) {
				const keyBasename = basename(mediaRef.cloudStorageKey);
				const fullPath = join(this.mediaDir, keyBasename);
				if (existsSync(fullPath)) {
					return { localPath: resolve(fullPath) };
				}
			}
		}

		throw new Error(
			`LocalFileMediaFetcher: could not resolve media "${mediaRef.mediaId}" ` +
				`(cloudStorageKey=${mediaRef.cloudStorageKey ?? "null"}). ` +
				`Checked path map (${this.mediaPathMap.size} entries)` +
				(this.mediaDir ? ` and mediaDir "${this.mediaDir}"` : "") +
				".",
		);
	}

	async fetchUrlToLocalPath({
		sourceUrl,
	}: {
		sourceUrl: string;
		mediaIndex: number;
	}): Promise<{ localPath: string; cleanup?: () => Promise<void> }> {
		// Handle file:// URLs
		if (sourceUrl.startsWith("file://")) {
			const localPath = sourceUrl.replace(/^file:\/\//, "");
			if (existsSync(localPath)) {
				return { localPath: resolve(localPath) };
			}
			throw new Error(
				`LocalFileMediaFetcher: file URL "${sourceUrl}" does not exist on disk.`,
			);
		}

		// Handle absolute paths
		if (sourceUrl.startsWith("/")) {
			if (existsSync(sourceUrl)) {
				return { localPath: resolve(sourceUrl) };
			}
			throw new Error(
				`LocalFileMediaFetcher: path "${sourceUrl}" does not exist on disk.`,
			);
		}

		throw new Error(
			`LocalFileMediaFetcher: cannot fetch remote URL "${sourceUrl}" in local mode. ` +
				"Only file:// URLs and absolute paths are supported.",
		);
	}
}
