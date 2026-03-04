import type { EditorCore } from "@/core";
import type {
	ExportDiagnostics,
	ExportFormat,
	ExportQuality,
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

		try {
			const result = await editor.project.export({
				options: {
					format,
					quality,
					includeAudio: true,
				},
			});
			exportDiagnostics = result.diagnostics;

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
				};
			}
			fallbackReason = result.error || fallbackReason;
		} catch (error) {
			console.warn("Best-effort export fallback triggered:", error);
			fallbackReason =
				error instanceof Error ? error.message : "Export pipeline failed unexpectedly.";
		}

		const activeProject = editor.project.getActive();
		if (!activeProject) {
			throw new Error("No active project to export.");
		}

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
		};
	}
}
