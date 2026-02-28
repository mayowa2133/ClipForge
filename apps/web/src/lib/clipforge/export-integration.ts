import type { EditorCore } from "@/core";
import type { ExportFormat, ExportQuality } from "@/types/export";
import { buildProjectSummary } from "./chat/project-summarizer";

export interface ClipForgeExportArtifact {
	status: "exported" | "preview-artifact";
	url: string;
	fileName: string;
	mimeType: string;
	message: string;
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
		try {
			const result = await editor.project.export({
				options: {
					format,
					quality,
					includeAudio: true,
				},
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
				};
			}
		} catch (error) {
			console.warn("Best-effort export fallback triggered:", error);
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
		};
		const fileName = `clipforge_preview_artifact_${Date.now()}.json`;
		const mimeType = "application/json";
		const url = URL.createObjectURL(
			new Blob([JSON.stringify(payload, null, 2)], { type: mimeType }),
		);

		return {
			status: "preview-artifact",
			url,
			fileName,
			mimeType,
			message:
				"Export pipeline unavailable. Generated preview artifact with timeline metadata.",
		};
	}
}
