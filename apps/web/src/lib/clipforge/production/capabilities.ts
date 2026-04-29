import type { ProductionCapability } from "@/types/production";

export const CLIPFORGE_PRODUCTION_CAPABILITIES: ProductionCapability[] = [
	{
		id: "cloud-projects",
		label: "Cloud projects",
		status: "available",
		description:
			"Authenticated project records expose list/create endpoints, and the projects page now renders signed-in cloud project entries with share-link controls.",
		nextStep: "Attach delta sync of project JSON and resumable media uploads.",
	},
	{
		id: "media-sync",
		label: "Media sync",
		status: "needs-provider",
		description:
			"Media object records track status (queued/uploading/stored/failed), and POST returns a presigned R2 URL when CLOUDFLARE/R2 env vars are configured.",
		nextStep: "Add browser-side upload pipeline that consumes the presigned URL and PATCHes status to stored.",
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
		status: "scaffolded",
		description:
			"Worker auth, job claim, render-graph serializer, and artifact upload pipeline are wired end-to-end. A stub renderer ships in apps/web/scripts/run-export-worker.ts; replace with an ffmpeg-based engine for playable video.",
		nextStep: "Implement an ffmpeg/Mediabunny-equivalent RenderEngine that produces real video artifacts.",
	},
	{
		id: "collaboration",
		label: "Collaboration",
		status: "scaffolded",
		description:
			"Share-link records with viewer/commenter/editor roles can be created, listed, revoked, and resolved publicly via /api/clipforge/share/[token].",
		nextStep: "Add comments, conflict-aware editing sessions, and a hosted share-viewer page.",
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
		status: "available",
		description:
			"Rights receipts auto-record on successful export for bundled and royalty-free assets, scoped to the active publish destination.",
		nextStep: "Extend coverage to direct-publish flows once platform OAuth ships and add per-receipt revocation/audit UI.",
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
