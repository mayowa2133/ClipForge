import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type {
	FileSystemAdapter,
	FfmpegRunner,
	MediaFetcher,
} from "./ffmpeg-engine";
import type { WorkerHttpClient } from "./export-worker";

export class NodeFileSystemAdapter implements FileSystemAdapter {
	async makeTempDir(prefix: string): Promise<string> {
		await mkdir(tmpdir(), { recursive: true });
		return await mkdtemp(join(tmpdir(), prefix));
	}

	async writeTextFile(path: string, contents: string): Promise<void> {
		await writeFile(path, contents, "utf8");
	}

	async readBinaryFile(path: string): Promise<Uint8Array> {
		const buffer = await readFile(path);
		return new Uint8Array(buffer);
	}

	async removeDir(path: string): Promise<void> {
		await rm(path, { recursive: true, force: true });
	}

	join(...parts: string[]): string {
		return join(...parts);
	}
}

export class SpawnFfmpegRunner implements FfmpegRunner {
	constructor(
		private readonly options: {
			ffmpegBinary?: string;
			logger?: (line: string) => void;
		} = {},
	) {}

	async run({
		ffmpegArgs,
		onProgress,
	}: {
		ffmpegArgs: string[];
		onProgress: (pct: number) => Promise<void>;
	}): Promise<void> {
		const binary = this.options.ffmpegBinary ?? "ffmpeg";
		await new Promise<void>((resolve, reject) => {
			const child = spawn(binary, ffmpegArgs, { stdio: ["ignore", "pipe", "pipe"] });
			let errBuffer = "";
			child.stderr?.setEncoding("utf8");
			child.stderr?.on("data", (chunk: string) => {
				errBuffer += chunk;
				if (this.options.logger) this.options.logger(chunk.trimEnd());
				const match = chunk.match(/time=(\d{2}):(\d{2}):(\d{2})\.(\d{2})/);
				if (match) {
					const [, hh, mm, ss] = match;
					const seconds =
						Number.parseInt(hh!, 10) * 3600 +
						Number.parseInt(mm!, 10) * 60 +
						Number.parseInt(ss!, 10);
					void onProgress(Math.min(95, seconds % 100));
				}
			});
			child.on("error", reject);
			child.on("close", (code) => {
				if (code === 0) {
					resolve();
				} else {
					reject(
						new Error(
							`ffmpeg exited with code ${code}: ${errBuffer.split("\n").slice(-5).join("\n")}`,
						),
					);
				}
			});
		});
	}
}

export class HttpMediaFetcher implements MediaFetcher {
	constructor(
		private readonly args: {
			workerHttp: WorkerHttpClient;
			downloadFetch?: typeof fetch;
			fs: NodeFileSystemAdapter;
			workDir: string;
		},
	) {}

	async fetchToLocalPath({
		mediaRef,
		mediaIndex,
	}: {
		mediaRef: { mediaId: string; cloudStorageKey: string | null };
		mediaIndex: number;
	}): Promise<{ localPath: string; cleanup?: () => Promise<void> }> {
		if (!mediaRef.cloudStorageKey) {
			throw new Error(
				`Media ${mediaRef.mediaId} is missing a cloudStorageKey; upload it to cloud first.`,
			);
		}
		const downloadUrl = await resolveDownloadUrl({
			workerHttp: this.args.workerHttp,
			mediaRef,
		});
		const callFetch = this.args.downloadFetch ?? fetch;
		const response = await callFetch(downloadUrl);
		if (!response.ok || !response.body) {
			throw new Error(
				`Failed to download ${mediaRef.cloudStorageKey}: HTTP ${response.status}`,
			);
		}
		const localPath = this.args.fs.join(
			this.args.workDir,
			`media-${mediaIndex.toString().padStart(4, "0")}.bin`,
		);
		await pipeline(
			Readable.fromWeb(response.body as never),
			createWriteStream(localPath),
		);
		return { localPath };
	}
}

async function resolveDownloadUrl({
	workerHttp,
	mediaRef,
}: {
	workerHttp: WorkerHttpClient;
	mediaRef: { cloudStorageKey: string | null };
}): Promise<string> {
	if (!mediaRef.cloudStorageKey) {
		throw new Error("Cannot resolve download URL: missing storage key.");
	}
	if (!workerHttp.presignMediaDownload) {
		throw new Error(
			"WorkerHttpClient does not implement presignMediaDownload (cannot fetch cloud media).",
		);
	}
	const presigned = await workerHttp.presignMediaDownload({
		storageKey: mediaRef.cloudStorageKey,
	});
	return presigned.url;
}
