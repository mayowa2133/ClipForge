import { ALL_FORMATS, BlobSource, Input } from "mediabunny";
import type { MediaAsset, MediaCompatibilitySnapshot } from "@/types/assets";

interface DecodableTrack {
	canDecode: () => Promise<boolean>;
}

interface InputLike {
	getPrimaryVideoTrack: () => Promise<DecodableTrack | null>;
	getPrimaryAudioTrack: () => Promise<DecodableTrack | null>;
	dispose?: () => void;
}

function createInput({ asset }: { asset: MediaAsset }): InputLike {
	return new Input({
		source: new BlobSource(asset.file),
		formats: ALL_FORMATS,
	});
}

export function buildUnknownMediaCompatibilitySnapshot(): MediaCompatibilitySnapshot {
	return {
		status: "unknown",
		videoDecode: "unknown",
		audioDecode: "unknown",
		reason: null,
		checkedAt: null,
		version: 1,
	};
}

export function buildPendingMediaCompatibilitySnapshot(): MediaCompatibilitySnapshot {
	return {
		status: "pending",
		videoDecode: "unknown",
		audioDecode: "unknown",
		reason: null,
		checkedAt: null,
		version: 1,
	};
}

export async function probeAssetCompatibility({
	asset,
}: {
	asset: MediaAsset;
}): Promise<MediaCompatibilitySnapshot> {
	const checkedAt = new Date().toISOString();

	if (asset.type === "image") {
		return {
			status: "compatible",
			videoDecode: "not-applicable",
			audioDecode: "not-applicable",
			reason: null,
			checkedAt,
			version: 1,
		};
	}

	const input = createInput({ asset });
	try {
		if (asset.type === "video") {
			const videoTrack = await input.getPrimaryVideoTrack();
			if (!videoTrack) {
				return {
					status: "incompatible",
					videoDecode: "unsupported",
					audioDecode: "unknown",
					reason: "no-video-track",
					checkedAt,
					version: 1,
				};
			}

			const canDecodeVideo = await videoTrack.canDecode();
			const audioTrack = await input.getPrimaryAudioTrack();
			let audioDecode: MediaCompatibilitySnapshot["audioDecode"] = "not-applicable";
			if (audioTrack) {
				audioDecode = (await audioTrack.canDecode()) ? "supported" : "unsupported";
			}

			const hasUnsupportedDecode = !canDecodeVideo || audioDecode === "unsupported";
			return {
				status: hasUnsupportedDecode ? "incompatible" : "compatible",
				videoDecode: canDecodeVideo ? "supported" : "unsupported",
				audioDecode,
				reason: !canDecodeVideo
					? "video-decode-unsupported"
					: audioDecode === "unsupported"
						? "audio-decode-unsupported"
						: null,
				checkedAt,
				version: 1,
			};
		}

		if (asset.type === "audio") {
			const audioTrack = await input.getPrimaryAudioTrack();
			if (!audioTrack) {
				return {
					status: "incompatible",
					videoDecode: "not-applicable",
					audioDecode: "unsupported",
					reason: "no-audio-track",
					checkedAt,
					version: 1,
				};
			}

			const canDecodeAudio = await audioTrack.canDecode();
			return {
				status: canDecodeAudio ? "compatible" : "incompatible",
				videoDecode: "not-applicable",
				audioDecode: canDecodeAudio ? "supported" : "unsupported",
				reason: canDecodeAudio ? null : "audio-decode-unsupported",
				checkedAt,
				version: 1,
			};
		}

		return {
			status: "error",
			videoDecode: "unknown",
			audioDecode: "unknown",
			reason: `unsupported-media-type:${asset.type}`,
			checkedAt,
			version: 1,
		};
	} catch (error) {
		return {
			status: "error",
			videoDecode: asset.type === "audio" ? "not-applicable" : "unknown",
			audioDecode: "unknown",
			reason: normalizeProbeError({
				error,
			}),
			checkedAt,
			version: 1,
		};
	} finally {
		input.dispose?.();
	}
}

export function isMediaCompatibilityResolved(
	snapshot: MediaCompatibilitySnapshot | null | undefined,
): boolean {
	if (!snapshot) return false;
	return snapshot.status === "compatible" || snapshot.status === "incompatible";
}

export function isMediaCompatibleForReference({
	snapshot,
	requiresVideoDecode,
	requiresAudioDecode,
}: {
	snapshot: MediaCompatibilitySnapshot | null | undefined;
	requiresVideoDecode: boolean;
	requiresAudioDecode: boolean;
}): boolean {
	if (!snapshot) return false;
	if (snapshot.status === "unknown" || snapshot.status === "pending" || snapshot.status === "error") {
		return false;
	}
	if (requiresVideoDecode && snapshot.videoDecode !== "supported") {
		return false;
	}
	if (requiresAudioDecode && snapshot.audioDecode !== "supported") {
		return false;
	}
	return true;
}

export function areMediaCompatibilitySnapshotsEqual({
	a,
	b,
}: {
	a: MediaCompatibilitySnapshot | null | undefined;
	b: MediaCompatibilitySnapshot | null | undefined;
}): boolean {
	if (!a && !b) return true;
	if (!a || !b) return false;
	return (
		a.status === b.status &&
		a.videoDecode === b.videoDecode &&
		a.audioDecode === b.audioDecode &&
		(a.reason ?? null) === (b.reason ?? null) &&
		a.version === b.version
	);
}

function normalizeProbeError({ error }: { error: unknown }): string {
	if (error instanceof Error && error.message.trim().length > 0) {
		return `probe-failed:${error.message.trim().slice(0, 160)}`;
	}
	return "probe-failed:unknown";
}
