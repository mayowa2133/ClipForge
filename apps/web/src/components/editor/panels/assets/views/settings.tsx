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
import { FPS_PRESETS } from "@/constants/project-constants";
import { useEditor } from "@/hooks/use-editor";
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
import { fetchChatPlannerHealth } from "@/lib/clipforge/chat";
import type { ChatPlannerHealth, ChatPlannerMode } from "@/lib/clipforge/chat";
import { useClipForgeChatSettingsStore } from "@/stores/clipforge-chat-settings-store";
import { useEffect, useState } from "react";

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
				{ENABLE_CLIPFORGE_CHAT && (
					<Section>
						<SectionContent>
							<PlannerSettingsContent />
						</SectionContent>
					</Section>
				)}
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
	const defaultModel = health?.defaultModel ?? null;

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
						<SelectItem value="openai">OpenAI</SelectItem>
						<SelectItem value="heuristic">Heuristic</SelectItem>
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
				{defaultModel && (
					<p className="text-muted-foreground text-xs">
						Default model: {defaultModel}
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
				settings: { canvasSize },
			});
			return;
		}
		const index = parseInt(value, 10);
		const preset = canvasPresets[index];
		if (preset) {
			editor.project.updateSettings({ settings: { canvasSize: preset } });
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
