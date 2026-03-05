import type { EditorCore } from "@/core";
import { evaluateExportPreflight } from "@/lib/clipforge/export-preflight";
import { getExportRecoveryRecommendation } from "@/lib/clipforge/export-recovery";
import type {
	ExportDiagnostics,
	ExportFormat,
	ExportIncidentAttempt,
	ExportPreflightResult,
	ExportQuality,
	ExportRecoveryRecommendation,
} from "@/types/export";
import { buildProjectSummary } from "./chat/project-summarizer";

export interface ClipForgeExportArtifact {
	status: "exported" | "preview-artifact";
	url: string;
	fileName: string;
	mimeType: string;
	message: string;
	diagnostics?: ExportDiagnostics;
	fallbackReason?: string;
	preflightResult?: ExportPreflightResult | null;
	attempts?: ExportIncidentAttempt[];
	recoveryRecommendation?: ExportRecoveryRecommendation | null;
}

export interface ClipForgeExportIntegration {
	exportBestEffort({
		editor,
		format,
		quality,
	}: {
		editor: EditorCore;
		format?: ExportFormat;
		quality?: ExportQuality;
	}): Promise<ClipForgeExportArtifact>;
}

export class BestEffortExportIntegration implements ClipForgeExportIntegration {
	async exportBestEffort({
		editor,
		format = "mp4",
		quality = "high",
	}: {
		editor: EditorCore;
		format?: ExportFormat;
		quality?: ExportQuality;
	}): Promise<ClipForgeExportArtifact> {
		let exportDiagnostics: ExportDiagnostics | undefined;
		let fallbackReason = "Export pipeline unavailable.";
		const attempts: ExportIncidentAttempt[] = [];
		const activeProject = editor.project.getActive();
		const preflightResult = activeProject
			? evaluateExportPreflight({
					project: activeProject,
					mediaAssets:
						typeof (editor as Partial<EditorCore>).media?.getAssets === "function"
							? editor.media.getAssets()
							: [],
					format,
					quality,
					includeAudio: true,
				})
			: null;

		try {
			const result = await editor.project.export({
				options: {
					format,
					quality,
					includeAudio: true,
				},
			});
			exportDiagnostics = result.diagnostics;
			attempts.push({
				attemptIndex: 1,
				timestamp: new Date().toISOString(),
				format,
				quality,
				includeAudio: true,
				result: result.cancelled
					? "cancelled"
					: result.success
						? "success"
						: "failed",
				error: result.error,
				diagnostics: result.diagnostics,
			});

			if (result.success && result.buffer) {
				const mimeType = format === "webm" ? "video/webm" : "video/mp4";
				const fileName = `clipforge_export_${Date.now()}.${format}`;
				const url = URL.createObjectURL(
					new Blob([result.buffer], { type: mimeType }),
				);
				return {
					status: "exported",
					url,
					fileName,
					mimeType,
					message: "Export completed using OpenCut renderer.",
					diagnostics: result.diagnostics,
					preflightResult,
					attempts,
					recoveryRecommendation: null,
				};
			}
			fallbackReason = result.error || fallbackReason;
		} catch (error) {
			console.warn("Best-effort export fallback triggered:", error);
			fallbackReason =
				error instanceof Error ? error.message : "Export pipeline failed unexpectedly.";
			attempts.push({
				attemptIndex: 1,
				timestamp: new Date().toISOString(),
				format,
				quality,
				includeAudio: true,
				result: "failed",
				error: fallbackReason,
			});
		}

		if (!activeProject) {
			throw new Error("No active project to export.");
		}

		const recoveryRecommendation = getExportRecoveryRecommendation({
			diagnostics: exportDiagnostics,
			options: {
				format,
				quality,
				includeAudio: true,
			},
		});

		const payload = {
			kind: "clipforge-preview-artifact",
			generated_at: new Date().toISOString(),
			project_id: activeProject.metadata.id,
			project_name: activeProject.metadata.name,
			project_summary: buildProjectSummary({
				project: activeProject,
				mediaAssets:
					typeof (editor as Partial<EditorCore>).media?.getAssets === "function"
						? editor.media.getAssets()
						: [],
			}),
			ops_audit_count: activeProject.clipforge?.opsAudit.length ?? 0,
			preflight_result: preflightResult,
			export_attempts: attempts,
			recovery_recommendation: recoveryRecommendation,
			export_diagnostics: exportDiagnostics ?? null,
			fallback_reason: fallbackReason,
		};
		const fileName = `clipforge_preview_artifact_${Date.now()}.json`;
		const mimeType = "application/json";
		const url = URL.createObjectURL(
			new Blob([JSON.stringify(payload, null, 2)], { type: mimeType }),
		);

		const artifactMessage = `${fallbackReason} Generated preview artifact with timeline metadata and diagnostics.`;

		return {
			status: "preview-artifact",
			url,
			fileName,
			mimeType,
			message: artifactMessage,
			diagnostics: exportDiagnostics,
			fallbackReason,
			preflightResult,
			attempts,
			recoveryRecommendation,
		};
	}
}
