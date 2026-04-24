import type { ProductionCapability } from "@/types/production";

export const CLIPFORGE_PRODUCTION_CAPABILITIES: ProductionCapability[] = [
	{
		id: "cloud-projects",
		label: "Cloud projects",
		status: "scaffolded",
		description:
			"Authenticated project records, local/cloud mode metadata, and project JSON persistence APIs are available.",
		nextStep: "Attach encrypted media upload and restore flows to cloud projects.",
	},
	{
		id: "media-sync",
		label: "Media sync",
		status: "scaffolded",
		description:
			"Media object records can track upload/storage state, checksums, and encrypted object keys.",
		nextStep: "Implement resumable object-storage uploads and browser restore.",
	},
	{
		id: "managed-transcription",
		label: "Managed transcription",
		status: "needs-provider",
		description:
			"Transcription jobs can be queued and tracked; local/browser transcription remains the active provider.",
		nextStep: "Connect a worker/provider that writes native word timestamps and diarization metadata.",
	},
	{
		id: "server-export",
		label: "Server export",
		status: "needs-provider",
		description:
			"Export jobs can be queued and tracked; browser export remains the active renderer.",
		nextStep: "Connect render workers that consume serialized render graphs and upload artifacts.",
	},
	{
		id: "collaboration",
		label: "Collaboration",
		status: "scaffolded",
		description:
			"Share-link records with viewer/commenter/editor roles are available for cloud projects.",
		nextStep: "Add public share resolution, comments, and conflict-aware editing sessions.",
	},
	{
		id: "ai-creative-scoring",
		label: "AI creative scoring",
		status: "planned",
		description:
			"Creative briefs and deterministic evals exist; hook/pacing/platform scoring is not yet implemented.",
		nextStep: "Add scored draft-review models with editable assumptions and regression evals.",
	},
	{
		id: "publishing",
		label: "Publishing",
		status: "scaffolded",
		description:
			"Publish jobs can be represented with destinations and metadata, but platform OAuth/posting is not connected.",
		nextStep: "Add destination account connections, scheduled publish jobs, and status callbacks.",
	},
	{
		id: "rights-ledger",
		label: "Rights ledger",
		status: "scaffolded",
		description:
			"Rights receipts can record asset source, license label, destination, and receipt metadata.",
		nextStep: "Generate receipts automatically from bundled/licensed libraries and publish flows.",
	},
	{
		id: "release-gates",
		label: "Release gates",
		status: "available",
		description:
			"Required CI now covers typecheck, unit tests, ClipForge evals, and production build.",
		nextStep: "Burn down the Biome lint baseline and promote lint to a required gate.",
	},
];

export function getProductionCapabilitySnapshot(): ProductionCapability[] {
	return CLIPFORGE_PRODUCTION_CAPABILITIES.map((capability) => ({
		...capability,
	}));
}
