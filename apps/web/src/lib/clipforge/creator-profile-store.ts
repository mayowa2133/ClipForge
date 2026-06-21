import type { CreatorStyleProfile } from "@/types/clipforge";

export const CREATOR_PROFILE_STORAGE_KEY = "clipforge:creator-style-profile:v1";

export interface CreatorProfileStorage {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
}

function resolveStorage(
	storage?: CreatorProfileStorage | null,
): CreatorProfileStorage | null {
	if (storage !== undefined) return storage;
	if (typeof window === "undefined") return null;
	return window.localStorage;
}

function isCreatorStyleProfile(value: unknown): value is CreatorStyleProfile {
	if (!value || typeof value !== "object") return false;
	const profile = value as Partial<CreatorStyleProfile>;
	return (
		profile.version === 1 &&
		typeof profile.learnedAt === "string" &&
		typeof profile.rawDurationS === "number" &&
		typeof profile.finishedDurationS === "number" &&
		typeof profile.targetKeepRatio === "number" &&
		profile.targetKeepRatio > 0 &&
		profile.targetKeepRatio <= 1 &&
		typeof profile.captionStyleId === "string" &&
		typeof profile.titleEnabled === "boolean" &&
		typeof profile.musicVolumeRatio === "number"
	);
}

export function readPersistedCreatorStyleProfile({
	storage,
}: {
	storage?: CreatorProfileStorage | null;
} = {}): CreatorStyleProfile | null {
	const resolved = resolveStorage(storage);
	if (!resolved) return null;
	try {
		const serialized = resolved.getItem(CREATOR_PROFILE_STORAGE_KEY);
		if (!serialized) return null;
		const parsed: unknown = JSON.parse(serialized);
		return isCreatorStyleProfile(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

export function persistCreatorStyleProfile({
	profile,
	storage,
}: {
	profile: CreatorStyleProfile | null | undefined;
	storage?: CreatorProfileStorage | null;
}): boolean {
	if (!profile || !isCreatorStyleProfile(profile)) return false;
	const resolved = resolveStorage(storage);
	if (!resolved) return false;
	try {
		const existing = readPersistedCreatorStyleProfile({ storage: resolved });
		if (
			existing &&
			Date.parse(existing.learnedAt) > Date.parse(profile.learnedAt)
		) {
			return false;
		}
		resolved.setItem(CREATOR_PROFILE_STORAGE_KEY, JSON.stringify(profile));
		return true;
	} catch {
		return false;
	}
}
