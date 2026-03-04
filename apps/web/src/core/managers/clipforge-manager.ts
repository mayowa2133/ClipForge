import type { EditorCore } from "@/core";
import {
	BestEffortExportIntegration,
	buildClipIndex,
	buildEmptyMediaMetadata,
	type ClipForgeExportArtifact,
	detectSilenceRegions,
	ensureClipForgeProjectData,
	resolveClipForgeTranscriber,
	resolveMediaAssetByName,
	SrtImportTranscriber,
	validateTimelineDiffOps,
} from "@/lib/clipforge";
import { extractMediaAssetAudioToFloat32 } from "@/lib/media/audio";
import {
	ApplyTimelineDiffOpsCommand,
	AutoEditTikTokDraftCommand,
} from "@/lib/commands";
import type { MediaAsset } from "@/types/assets";
import type {
	ClipMediaMetadata,
	TimelineDiffOp,
	TimelineDiffOpSource,
} from "@/types/clipforge";

export class ClipForgeManager {
	private exportIntegration = new BestEffortExportIntegration();

	constructor(private editor: EditorCore) {}

	autoEditTikTokDraft(): void {
		const videoAssets = this.editor.media
			.getAssets()
			.filter((asset) => asset.type === "video" && !asset.ephemeral);

		if (videoAssets.length === 0) {
			throw new Error("Import at least one video clip before auto editing.");
		}

		const command = new AutoEditTikTokDraftCommand(videoAssets);
		this.editor.command.execute({ command });
		this.stabilizePreview();
	}

	initializeMediaMetadata({
		mediaAssets,
	}: {
		mediaAssets: MediaAsset[];
	}): void {
		if (mediaAssets.length === 0) return;

		const activeProject = this.editor.project.getActive();
		if (!activeProject) return;

		const projectWithClipForge = ensureClipForgeProjectData({
			project: activeProject,
		});
		const nextMediaMetadataById = {
			...projectWithClipForge.clipforge.mediaMetadataById,
		};

		let didChange = false;
		for (const mediaAsset of mediaAssets) {
			if (nextMediaMetadataById[mediaAsset.id]) continue;
			nextMediaMetadataById[mediaAsset.id] = buildEmptyMediaMetadata();
			didChange = true;
		}

		if (!didChange) return;

		this.editor.project.setActiveProject({
			project: {
				...projectWithClipForge,
				metadata: {
					...projectWithClipForge.metadata,
					updatedAt: new Date(),
				},
				clipforge: {
					...projectWithClipForge.clipforge,
					mediaMetadataById: nextMediaMetadataById,
				},
			},
		});
		this.editor.save.markDirty();
	}

	upsertMediaMetadata({
		mediaId,
		metadata,
	}: {
		mediaId: string;
		metadata: ClipMediaMetadata;
	}): void {
		const activeProject = this.editor.project.getActive();
		if (!activeProject) return;

		const projectWithClipForge = ensureClipForgeProjectData({
			project: activeProject,
		});

		this.editor.project.setActiveProject({
			project: {
				...projectWithClipForge,
				metadata: {
					...projectWithClipForge.metadata,
					updatedAt: new Date(),
				},
				clipforge: {
					...projectWithClipForge.clipforge,
					mediaMetadataById: {
						...projectWithClipForge.clipforge.mediaMetadataById,
						[mediaId]: metadata,
					},
				},
			},
		});
		this.editor.save.markDirty();
	}

	getMediaMetadata({ mediaId }: { mediaId: string }): ClipMediaMetadata | null {
		const activeProject = this.editor.project.getActive();
		if (!activeProject) return null;

		const projectWithClipForge = ensureClipForgeProjectData({
			project: activeProject,
		});

		return projectWithClipForge.clipforge.mediaMetadataById[mediaId] ?? null;
	}

	async indexMediaAsset({
		mediaId,
		language,
	}: {
		mediaId: string;
		language?: string;
	}): Promise<ClipMediaMetadata> {
		const mediaAsset = this.editor.media.getAssets().find((asset) => asset.id === mediaId);
		if (!mediaAsset) {
			throw new Error("Media asset not found.");
		}

		const existing = this.getMediaMetadata({ mediaId }) ?? buildEmptyMediaMetadata();
		if (mediaAsset.type !== "video" && mediaAsset.type !== "audio") {
			return existing;
		}

		this.upsertMediaMetadata({
			mediaId,
			metadata: {
				...existing,
				transcriptionStatus: "processing",
				transcriptionError: null,
			},
		});

		try {
			const transcriber = resolveClipForgeTranscriber();
			const indexed = await buildClipIndex({
				mediaAsset,
				language,
				transcriber,
				extractAudio: extractMediaAssetAudioToFloat32,
			});

			this.upsertMediaMetadata({
				mediaId,
				metadata: indexed,
			});
			return indexed;
		} catch (error) {
			const failedMetadata: ClipMediaMetadata = {
				...existing,
				transcriptionStatus: "error",
				transcriptionError:
					error instanceof Error ? error.message : "Clip indexing failed.",
			};
			this.upsertMediaMetadata({
				mediaId,
				metadata: failedMetadata,
			});
			return failedMetadata;
		}
	}

	async indexMediaAssets({
		mediaIds,
		language,
	}: {
		mediaIds?: string[];
		language?: string;
	} = {}): Promise<{ completed: string[]; failed: string[] }> {
		const targetIds = new Set(mediaIds ?? []);
		const selectedAssets = this.editor.media
			.getAssets()
			.filter((asset) => !asset.ephemeral)
			.filter((asset) =>
				targetIds.size === 0 ? true : targetIds.has(asset.id),
			)
			.filter((asset) => asset.type === "video" || asset.type === "audio");

		const completed: string[] = [];
		const failed: string[] = [];

		for (const asset of selectedAssets) {
			const existing = this.getMediaMetadata({ mediaId: asset.id });
			if (existing?.transcriptionStatus === "ready") {
				completed.push(asset.id);
				continue;
			}

			const metadata = await this.indexMediaAsset({
				mediaId: asset.id,
				language,
			});
			if (metadata.transcriptionStatus === "ready") {
				completed.push(asset.id);
			} else {
				failed.push(asset.id);
			}
		}

		return { completed, failed };
	}

	async importSrtForMedia({
		mediaId,
		srtText,
		language,
	}: {
		mediaId: string;
		srtText: string;
		language?: string;
	}): Promise<ClipMediaMetadata> {
		const mediaAsset = this.editor.media.getAssets().find((asset) => asset.id === mediaId);
		if (!mediaAsset) {
			throw new Error("Media asset not found.");
		}

		const existing = this.getMediaMetadata({ mediaId }) ?? buildEmptyMediaMetadata();
		const transcriber = new SrtImportTranscriber();
		const transcript = await transcriber.transcribe({
			mediaAsset,
			language,
			srtText,
		});

		const metadata: ClipMediaMetadata = {
			...existing,
			words: transcript.words,
			segments: transcript.segments,
			transcriptionStatus: "ready",
			transcriptionProvider: transcript.provider,
			transcriptionLanguage: transcript.language ?? language ?? null,
			transcriptionError: null,
			indexedAt: new Date().toISOString(),
		};

		this.upsertMediaMetadata({
			mediaId,
			metadata,
		});

		return metadata;
	}

	detectAndStoreSilenceMap({
		mediaId,
		samples,
		sampleRate,
	}: {
		mediaId: string;
		samples: Float32Array;
		sampleRate: number;
	}): void {
		const activeProject = this.editor.project.getActive();
		if (!activeProject) return;

		const projectWithClipForge = ensureClipForgeProjectData({
			project: activeProject,
		});

		const existing =
			projectWithClipForge.clipforge.mediaMetadataById[mediaId] ??
			buildEmptyMediaMetadata();
		const silenceRegions = detectSilenceRegions({
			samples,
			sampleRate,
		});

		this.upsertMediaMetadata({
			mediaId,
			metadata: {
				...existing,
				silenceRegions,
			},
		});
	}

	validateOps({
		ops,
	}: {
		ops: unknown[];
	}): ReturnType<typeof validateTimelineDiffOps> {
		const activeProject = this.editor.project.getActive();
		if (!activeProject) {
			return {
				valid: false,
				ops: [],
				errors: [
					{
						opIndex: -1,
						code: "no_active_project",
						message: "No active project.",
					},
				],
			};
		}

		return validateTimelineDiffOps({
			project: activeProject,
			ops,
			mediaAssets: this.editor.media.getAssets(),
		});
	}

	applyOps({
		ops,
		source = "manual",
	}: {
		ops: unknown[];
		source?: TimelineDiffOpSource;
	}): {
		applied: boolean;
		ops: TimelineDiffOp[];
		errors: ReturnType<typeof validateTimelineDiffOps>["errors"];
	} {
		const validation = this.validateOps({ ops });
		if (!validation.valid) {
			return {
				applied: false,
				ops: [],
				errors: validation.errors,
			};
		}

		const command = new ApplyTimelineDiffOpsCommand(validation.ops, source);
		this.editor.command.execute({ command });
		this.stabilizePreview();

		return {
			applied: true,
			ops: validation.ops,
			errors: [],
		};
	}

	async exportBestEffort(): Promise<ClipForgeExportArtifact> {
		return this.exportIntegration.exportBestEffort({
			editor: this.editor,
		});
	}

	resolveMediaAssetByName(
		query: string,
	): { assetId: string; matchedName: string } | null {
		return resolveMediaAssetByName({
			query,
			mediaAssets: this.editor.media.getAssets(),
		});
	}

	private stabilizePreview(): void {
		const currentTime = this.editor.playback.getCurrentTime();
		const totalDuration = this.editor.timeline.getTotalDuration();
		this.editor.playback.seek({
			time: Math.min(Math.max(currentTime, 0), totalDuration),
		});
	}
}
