"use client";

import { PanelView } from "@/components/editor/panels/assets/views/base-view";
import {
	CLIPFORGE_CHAT_PLANNER_MODE,
	ENABLE_CLIPFORGE_CHAT,
} from "@/constants/feature-flags";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	FPS_PRESETS,
	buildDefaultProjectVersionPack,
	getVersionTargetLabel,
} from "@/constants/project-constants";
import { useEditor } from "@/hooks/use-editor";
import { CREATIVE_LIBRARY_PACKS } from "@/lib/library";
import { useEditorStore } from "@/stores/editor-store";
import { dimensionToAspectRatio } from "@/utils/geometry";
import {
	Section,
	SectionContent,
	SectionHeader,
} from "@/components/editor/panels/properties/section";
import { Label } from "@/components/ui/label";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { fetchChatPlannerHealth } from "@/lib/clipforge/chat";
import type { ChatPlannerHealth, ChatPlannerMode } from "@/lib/clipforge/chat";
import { useClipForgeChatSettingsStore } from "@/stores/clipforge-chat-settings-store";
import { useClipForgeTranscriptionSettingsStore } from "@/stores/clipforge-transcription-settings-store";
import { CLIPFORGE_MANAGED_TRANSCRIBER_DEFAULT } from "@/constants/feature-flags";
import { useEffect, useState } from "react";
import { resolveProjectVersionPack } from "@/lib/timeline";
import type { ProjectVersionTarget } from "@/types/project";
import {
	Accordion,
	AccordionContent,
	AccordionItem,
	AccordionTrigger,
} from "@/components/ui/accordion";
import { getProductionCapabilitySnapshot } from "@/lib/clipforge/production/capabilities";

export function SettingsView() {
	const [open, setOpen] = useState(false);

	return (
		<PanelView contentClassName="px-0" hideHeader>
			<div className="flex flex-col">
				<Section hasBorderTop={false}>
					<SectionContent>
						<ProjectInfoContent />
					</SectionContent>
				</Section>
				<Section>
					<SectionContent>
						<VersionPackContent />
					</SectionContent>
				</Section>
				<Section>
					<SectionContent>
						<Accordion type="single" collapsible className="w-full">
							<AccordionItem value="advanced" className="border-none">
								<AccordionTrigger className="py-2 hover:no-underline">
									<div className="text-left">
										<p className="text-sm font-medium">Advanced</p>
										<p className="text-muted-foreground text-xs font-normal">
											Planner diagnostics and bundled creative-library details.
										</p>
									</div>
								</AccordionTrigger>
								<AccordionContent className="space-y-4 pb-0">
									{ENABLE_CLIPFORGE_CHAT ? <PlannerSettingsContent /> : null}
									<TranscriptionSettingsContent />
									<ProductionReadinessContent />
									<CreativeLibraryContent />
								</AccordionContent>
							</AccordionItem>
						</Accordion>
					</SectionContent>
				</Section>
				<Popover open={open} onOpenChange={setOpen}>
					<Section className="cursor-pointer">
						<PopoverTrigger asChild>
							<div>
								<SectionHeader title="Background">
									<div className="size-4 rounded-sm bg-red-500" />
								</SectionHeader>
							</div>
						</PopoverTrigger>
					</Section>
					<PopoverContent>
						<div className="size-4 rounded-sm bg-red-500" />
					</PopoverContent>
				</Popover>
			</div>
		</PanelView>
	);
}

function ProductionReadinessContent() {
	const capabilities = getProductionCapabilitySnapshot();
	const statusLabels = {
		available: "Available",
		scaffolded: "Scaffolded",
		"needs-provider": "Needs provider",
		planned: "Planned",
	} as const;

	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-col gap-1">
				<Label>Production capabilities</Label>
				<p className="text-muted-foreground text-xs">
					Server-backed foundations are tracked separately from local editing tools.
				</p>
			</div>
			<div className="space-y-2">
				{capabilities.map((capability) => (
					<div key={capability.id} className="rounded-md border p-3">
						<div className="flex items-center justify-between gap-3">
							<p className="text-sm font-medium">{capability.label}</p>
							<span className="text-muted-foreground rounded border px-2 py-0.5 text-[11px]">
								{statusLabels[capability.status]}
							</span>
						</div>
						<p className="text-muted-foreground mt-1 text-xs">
							{capability.nextStep}
						</p>
					</div>
				))}
			</div>
		</div>
	);
}

function CreativeLibraryContent() {
	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-col gap-1">
				<Label>Creative library</Label>
				<p className="text-muted-foreground text-xs">
					Bundled starter packs are local, free-first, and licensed for redistribution.
				</p>
			</div>
			<div className="space-y-3">
				{CREATIVE_LIBRARY_PACKS.map((pack) => (
					<div
						key={pack.id}
						className="flex items-center justify-between gap-3 rounded-md border p-3"
					>
						<div className="min-w-0">
							<p className="text-sm font-medium">{pack.name}</p>
							<p className="text-muted-foreground text-xs">
								{pack.items.length} items · {pack.license}
							</p>
						</div>
						<div className="text-muted-foreground text-xs uppercase tracking-wide">
							{pack.kind}
						</div>
					</div>
				))}
			</div>
			<p className="text-muted-foreground text-xs">
				User-imported media still works normally. Bundled content is a starter library, not a closed platform.
			</p>
		</div>
	);
}

function VersionPackContent() {
	const editor = useEditor();
	const activeProject = editor.project.getActive();
	const versionPack = resolveProjectVersionPack({ project: activeProject });
	const activeTargetId = versionPack.activeTargetId;

	const updateVersionPack = async ({
		targetId,
		enabled,
	}: {
		targetId: ProjectVersionTarget;
		enabled: boolean;
	}) => {
		const currentlyEnabled = versionPack.targets.filter((target) => target.enabled);
		if (!enabled && currentlyEnabled.length === 1 && currentlyEnabled[0]?.id === targetId) {
			return;
		}
		const nextVersionPack = {
			...versionPack,
			targets: versionPack.targets.map((target) =>
				target.id === targetId ? { ...target, enabled } : target,
			),
			activeTargetId: activeTargetId,
		};
		const nextEnabledTargets = nextVersionPack.targets.filter((target) => target.enabled);
		nextVersionPack.activeTargetId =
			nextEnabledTargets.find((target) => target.id === activeTargetId)?.id ??
			nextEnabledTargets[0]?.id ??
			targetId;
		await editor.project.updateVersionPack({ versionPack: nextVersionPack });
	};

	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-col gap-1">
				<Label>Version pack</Label>
				<p className="text-muted-foreground text-xs">
					Enable publish targets and apply target-specific adaptation without
					changing the base edit.
				</p>
			</div>
			<div className="space-y-3">
				{versionPack.targets.map((target) => (
					<div
						key={target.id}
						className="flex items-center justify-between gap-3 rounded-md border p-3"
					>
						<div className="flex flex-col gap-1">
							<p className="text-sm font-medium">
								{getVersionTargetLabel({ targetId: target.id })}
							</p>
							<p className="text-muted-foreground text-xs">
								{target.canvasSize.width}x{target.canvasSize.height}
							</p>
						</div>
						<div className="flex items-center gap-2">
							<Checkbox
								id={`version-target-${target.id}`}
								checked={target.enabled}
								onCheckedChange={(checked) =>
									void updateVersionPack({
										targetId: target.id,
										enabled: !!checked,
									})
								}
							/>
							<Button
								variant={activeTargetId === target.id ? "secondary" : "outline"}
								size="sm"
								onClick={() =>
									void editor.project.setActiveVersionTarget({
										targetId: target.id,
									})
								}
							>
								Preview
							</Button>
						</div>
					</div>
				))}
			</div>
			<div className="flex flex-wrap gap-2">
				<Button
					size="sm"
					variant="outline"
					onClick={() => {
						if (!activeTargetId) return;
						editor.timeline.applyAutoReframeToSelection({
							targetVersionId: activeTargetId,
						});
					}}
				>
					Auto reframe selection
				</Button>
				<Button
					size="sm"
					variant="outline"
					onClick={() => {
						if (!activeTargetId) return;
						editor.timeline.applySafeLayoutToScene({
							targetVersionId: activeTargetId,
						});
					}}
				>
					Apply safe layout
				</Button>
				<Button
					size="sm"
					variant="ghost"
					onClick={() => {
						if (!activeTargetId) return;
						editor.timeline.resetVersionOverrides({
							targetVersionId: activeTargetId,
							scope: "scene",
						});
					}}
				>
					Reset target
				</Button>
			</div>
		</div>
	);
}

function PlannerSettingsContent() {
	const plannerMode = useClipForgeChatSettingsStore((state) => state.plannerMode);
	const setPlannerMode = useClipForgeChatSettingsStore(
		(state) => state.setPlannerMode,
	);
	const resetPlannerMode = useClipForgeChatSettingsStore(
		(state) => state.resetPlannerMode,
	);
	const [health, setHealth] = useState<ChatPlannerHealth | null>(null);
	const [healthError, setHealthError] = useState<string | null>(null);
	const [isCheckingHealth, setIsCheckingHealth] = useState(false);

	const refreshHealth = async () => {
		setIsCheckingHealth(true);
		setHealthError(null);
		try {
			const nextHealth = await fetchChatPlannerHealth();
			setHealth(nextHealth);
		} catch (error) {
			setHealth(null);
			setHealthError(
				error instanceof Error
					? error.message
					: "Unable to check planner health.",
			);
		} finally {
			setIsCheckingHealth(false);
		}
	};

	useEffect(() => {
		void refreshHealth();
	}, []);

	const badgeLabel = health?.status ?? "unavailable";
	const badgeClassName =
		badgeLabel === "ready"
			? "border-emerald-400/40 bg-emerald-500/10 text-emerald-600"
			: badgeLabel === "degraded"
				? "border-amber-400/40 bg-amber-500/10 text-amber-600"
				: "border-red-400/40 bg-red-500/10 text-red-600";
	const healthMessage = healthError ?? health?.message ?? "Unable to check planner health.";
	const activeProvider = health?.activeProvider ?? null;

	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-col gap-1">
				<Label>AI Planner</Label>
				<p className="text-muted-foreground text-xs">
					Choose which planner powers chat edits.
				</p>
			</div>
			<div className="flex flex-col gap-2">
				<Label>Mode</Label>
				<Select
					value={plannerMode}
					onValueChange={(value) => setPlannerMode(value as ChatPlannerMode)}
				>
					<SelectTrigger className="w-fit min-w-40">
						<SelectValue placeholder="Select a planner mode" />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="auto">Auto (Recommended)</SelectItem>
						<SelectItem value="anthropic">Anthropic Claude</SelectItem>
						<SelectItem value="openai">OpenAI</SelectItem>
						<SelectItem value="heuristic">Heuristic (Offline)</SelectItem>
					</SelectContent>
				</Select>
				<Button
					type="button"
					variant="ghost"
					className="h-auto w-fit px-0 text-xs"
					onClick={resetPlannerMode}
					disabled={plannerMode === CLIPFORGE_CHAT_PLANNER_MODE}
				>
					Reset to default
				</Button>
			</div>
			<div className="flex flex-col gap-2 rounded-md border p-3">
				<div className="flex items-center justify-between gap-3">
					<Label>Planner health</Label>
					<span
						className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${badgeClassName}`}
					>
						{badgeLabel}
					</span>
				</div>
				<p className="text-muted-foreground text-xs">{healthMessage}</p>
				{activeProvider && (
					<p className="text-muted-foreground text-xs">
						Active provider: {activeProvider === "anthropic" ? "Anthropic Claude" : "OpenAI"}
					</p>
				)}
				<Button
					type="button"
					variant="outline"
					className="w-fit"
					size="sm"
					onClick={() => void refreshHealth()}
					disabled={isCheckingHealth}
				>
					{isCheckingHealth ? "Refreshing..." : "Refresh"}
				</Button>
			</div>
		</div>
	);
}

function TranscriptionSettingsContent() {
	const useManagedCloud = useClipForgeTranscriptionSettingsStore(
		(state) => state.useManagedCloud,
	);
	const setUseManagedCloud = useClipForgeTranscriptionSettingsStore(
		(state) => state.setUseManagedCloud,
	);
	const resetUseManagedCloud = useClipForgeTranscriptionSettingsStore(
		(state) => state.resetUseManagedCloud,
	);

	return (
		<div className="flex flex-col gap-3">
			<div className="flex flex-col gap-1">
				<Label>Transcription</Label>
				<p className="text-muted-foreground text-xs">
					Choose where indexing runs when you import or re-index a clip.
				</p>
			</div>
			<div className="flex items-start gap-2">
				<Checkbox
					id="managed-cloud-transcription"
					checked={useManagedCloud}
					onCheckedChange={(value) => setUseManagedCloud(value === true)}
				/>
				<div className="flex-1">
					<Label
						htmlFor="managed-cloud-transcription"
						className="text-sm cursor-pointer"
					>
						Use managed cloud transcription
					</Label>
					<p className="text-muted-foreground text-xs mt-1">
						When on, indexing uploads the clip to your cloud project (if it
						exists) and runs through the ClipForge worker before falling back
						to the local browser/CLI provider. Requires
						MODAL_TRANSCRIPTION_URL to be configured server-side.
					</p>
				</div>
			</div>
			<Button
				type="button"
				variant="ghost"
				className="h-auto w-fit px-0 text-xs"
				onClick={resetUseManagedCloud}
				disabled={useManagedCloud === CLIPFORGE_MANAGED_TRANSCRIBER_DEFAULT}
			>
				Reset to default
			</Button>
		</div>
	);
}

function ProjectInfoContent() {
	const editor = useEditor();
	const activeProject = editor.project.getActive();
	const { canvasPresets } = useEditorStore();

	const findPresetIndexByAspectRatio = ({
		presets,
		targetAspectRatio,
	}: {
		presets: Array<{ width: number; height: number }>;
		targetAspectRatio: string;
	}) => {
		for (let index = 0; index < presets.length; index++) {
			const preset = presets[index];
			const presetAspectRatio = dimensionToAspectRatio({
				width: preset.width,
				height: preset.height,
			});
			if (presetAspectRatio === targetAspectRatio) {
				return index;
			}
		}
		return -1;
	};

	const currentCanvasSize = activeProject.settings.canvasSize;
	const currentAspectRatio = dimensionToAspectRatio(currentCanvasSize);
	const originalCanvasSize = activeProject.settings.originalCanvasSize ?? null;
	const presetIndex = findPresetIndexByAspectRatio({
		presets: canvasPresets,
		targetAspectRatio: currentAspectRatio,
	});
	const originalPresetValue = "original";
	const selectedPresetValue =
		presetIndex !== -1 ? presetIndex.toString() : originalPresetValue;

	const handleAspectRatioChange = ({ value }: { value: string }) => {
		if (value === originalPresetValue) {
			const canvasSize = originalCanvasSize ?? currentCanvasSize;
			editor.project.updateSettings({
				settings: {
					canvasSize,
					versionPack: buildDefaultProjectVersionPack({ canvasSize }),
				},
			});
			return;
		}
		const index = parseInt(value, 10);
		const preset = canvasPresets[index];
		if (preset) {
			editor.project.updateSettings({
				settings: {
					canvasSize: preset,
					versionPack: buildDefaultProjectVersionPack({ canvasSize: preset }),
				},
			});
		}
	};

	const handleFpsChange = (value: string) => {
		const fps = parseFloat(value);
		editor.project.updateSettings({ settings: { fps } });
	};

	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-col gap-2">
				<Label>Name</Label>
				<span className="leading-none text-sm">
					{activeProject.metadata.name}
				</span>
			</div>
			<div className="flex flex-col gap-2">
				<Label>Aspect ratio</Label>
				<Select
					value={selectedPresetValue}
					onValueChange={(value) => handleAspectRatioChange({ value })}
				>
					<SelectTrigger className="w-fit">
						<SelectValue placeholder="Select an aspect ratio" />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value={originalPresetValue}>Original</SelectItem>
						{canvasPresets.map((preset, index) => {
							const label = dimensionToAspectRatio({
								width: preset.width,
								height: preset.height,
							});
							return (
								<SelectItem key={label} value={index.toString()}>
									{label}
								</SelectItem>
							);
						})}
					</SelectContent>
				</Select>
			</div>
			<div className="flex flex-col gap-2">
				<Label>Frame rate</Label>
				<Select
					value={activeProject.settings.fps.toString()}
					onValueChange={handleFpsChange}
				>
					<SelectTrigger className="w-fit">
						<SelectValue placeholder="Select a frame rate" />
					</SelectTrigger>
					<SelectContent>
						{FPS_PRESETS.map((preset) => (
							<SelectItem key={preset.value} value={preset.value}>
								{preset.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>
		</div>
	);
}
