import type { TProject } from "@/types/project";
import type {
	ExportDiagnostics,
	ExportFormat,
	ExportIncidentAttempt,
	ExportIncidentBundle,
	ExportPreflightResult,
	ExportQuality,
	ExportRecoveryRecommendation,
	ExportRetryProfile,
} from "@/types/export";

interface RuntimeExportOptions {
	format: ExportFormat;
	quality: ExportQuality;
	includeAudio: boolean;
}

export function getExportRecoveryRecommendation({
	diagnostics,
	options,
}: {
	diagnostics?: ExportDiagnostics;
	options: RuntimeExportOptions;
}): ExportRecoveryRecommendation {
	const isMp4Medium =
		options.format === "mp4" && options.quality === "medium";
	const isMp4MediumNoAudio = isMp4Medium && options.includeAudio === false;

	if (diagnostics?.failureCode === "cancelled") {
		return {
			recommendedProfile: null,
			reason: "Export was cancelled. Restart manually when ready.",
			canRetry: false,
		};
	}

	if (diagnostics?.failureCode === "audio-mix-failed") {
		if (isMp4MediumNoAudio) {
			return {
				recommendedProfile: null,
				reason:
					"Audio is already disabled on the safest runtime profile; no additional deterministic retry is available.",
				canRetry: false,
			};
		}
		return {
			recommendedProfile: "safe-mp4-medium-no-audio",
			reason: "Audio mix failed. Retry with audio disabled on MP4/Medium.",
			canRetry: true,
		};
	}

	if (
		diagnostics?.failureCode === "encoder-init-failed" ||
		diagnostics?.failureCode === "encoder-finalize-failed" ||
		diagnostics?.failureCode === "render-frame-failed" ||
		diagnostics?.failureCode === "unknown"
	) {
		if (!isMp4Medium) {
			return {
				recommendedProfile: "safe-mp4-medium",
				reason: "Retry with MP4/Medium to maximize export compatibility.",
				canRetry: true,
			};
		}
		if (options.includeAudio) {
			return {
				recommendedProfile: "safe-mp4-medium-no-audio",
				reason:
					"MP4/Medium still failed. Retry with audio disabled to reduce runtime complexity.",
				canRetry: true,
			};
		}
		return {
			recommendedProfile: null,
			reason:
				"Safest deterministic retry profile already used. Export diagnostics bundle is recommended.",
			canRetry: false,
		};
	}

	if (!diagnostics) {
		if (!isMp4Medium) {
			return {
				recommendedProfile: "safe-mp4-medium",
				reason:
					"No diagnostics were available. Retry once with MP4/Medium deterministic safe profile.",
				canRetry: true,
			};
		}
		return {
			recommendedProfile: null,
			reason:
				"No diagnostics available and safe profile already active. No further deterministic retry profile.",
			canRetry: false,
		};
	}

	return {
		recommendedProfile: null,
		reason: "No deterministic safe retry profile is required for this failure type.",
		canRetry: false,
	};
}

export function applyRetryProfile({
	profile,
	options,
}: {
	profile: ExportRetryProfile;
	options: RuntimeExportOptions;
}): RuntimeExportOptions {
	switch (profile) {
		case "same-settings":
			return {
				...options,
			};
		case "safe-mp4-medium":
			return {
				format: "mp4",
				quality: "medium",
				includeAudio: options.includeAudio,
			};
		case "safe-mp4-medium-no-audio":
			return {
				format: "mp4",
				quality: "medium",
				includeAudio: false,
			};
		default: {
			const exhaustiveCheck: never = profile;
			return exhaustiveCheck;
		}
	}
}

export function buildExportIncidentBundle({
	project,
	preflightResult,
	attempts,
	finalFailure,
}: {
	project: TProject | null;
	preflightResult?: ExportPreflightResult | null;
	attempts: ExportIncidentAttempt[];
	finalFailure?: { error: string; diagnostics?: ExportDiagnostics } | null;
}): ExportIncidentBundle {
	return {
		bundleVersion: 1,
		projectId: project?.metadata.id ?? null,
		projectName: project?.metadata.name ?? null,
		preflightResult: preflightResult ?? null,
		attempts,
		finalFailure: finalFailure ?? null,
		generatedAt: new Date().toISOString(),
	};
}

export function formatRetryProfileLabel({
	profile,
}: {
	profile: ExportRetryProfile | null;
}): string {
	switch (profile) {
		case "safe-mp4-medium":
			return "MP4 / Medium";
		case "safe-mp4-medium-no-audio":
			return "MP4 / Medium / No audio";
		case "same-settings":
			return "Same settings";
		default:
			return "No safe profile";
	}
}
