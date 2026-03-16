import { ClipForgeManager } from "@/core/managers/clipforge-manager";
import {
	buildProjectSummary,
	buildDefaultClipForgeProjectData,
	buildReferenceVideoAnalysis,
	normalizeChatPlanResult,
	HeuristicChatOpsProvider,
} from "@/lib/clipforge";
import type {
	ChatOpsProvider,
	ChatPlanResult,
	ChatPlannerContext,
	ChatPlannerOverrides,
	ChatClarificationKind,
} from "@/lib/clipforge/chat";
import type { MediaAsset } from "@/types/assets";
import type { TProject } from "@/types/project";
import type {
	ProjectKitTemplate,
	SceneRecipeTemplate,
} from "@/types/templates";
import type {
	TimelineTrack,
	VideoElement,
	TextElement,
	AudioElement,
} from "@/types/timeline";
import type {
	ClipForgeAppliedCommandSummary,
	ClipForgeChatTurnSummary,
	ClipForgeCommandScope,
	ClipForgeEditorCommand,
	TimelineDiffOp,
} from "@/types/clipforge";

type EvalSuiteName =
	| "single-turn"
	| "multi-turn-memory"
	| "creative-direction"
	| "finishing"
	| "reference-video";

interface EvalCommandExpectation {
	commandKinds?: ClipForgeEditorCommand["kind"][];
	opTypes?: TimelineDiffOp["type"][];
	targetIds?: string[];
}

interface EvalClarificationExpectation {
	kind: ChatClarificationKind;
	referenceLabel?: string;
}

interface EvalTurn {
	id: string;
	prompt: string;
	context?: Partial<ChatPlannerContext>;
	overrides?: ChatPlannerOverrides;
	expectation:
		| {
				kind: "plan";
				command: EvalCommandExpectation;
		  }
		| {
				kind: "clarification";
				clarification: EvalClarificationExpectation;
		  };
}

interface EvalScenario {
	id: string;
	suite: EvalSuiteName;
	fixtureId: string;
	turns: EvalTurn[];
}

interface EvalFixture {
	id: string;
	project: TProject;
	mediaAssets: MediaAsset[];
	projectKitTemplates: ProjectKitTemplate[];
	sceneRecipeTemplates: SceneRecipeTemplate[];
	defaultContext: ChatPlannerContext;
}

export interface ClipForgeChatEvalTurnResult {
	suite: EvalSuiteName;
	scenarioId: string;
	turnId: string;
	prompt: string;
	pass: boolean;
	unsafeApplyFailure: boolean;
	provider: ChatPlanResult["provider"];
	commandKinds: ClipForgeEditorCommand["kind"][];
	opTypes: TimelineDiffOp["type"][];
	clarificationKind: ChatClarificationKind | null;
	reasons: string[];
}

export interface ClipForgeChatEvalSuiteReport {
	suite: EvalSuiteName;
	totalPrompts: number;
	passedPrompts: number;
	failedPrompts: number;
	passRate: number;
	unsafeApplyFailures: number;
}

export interface ClipForgeChatEvalReport {
	suites: Record<EvalSuiteName, ClipForgeChatEvalSuiteReport>;
	turns: ClipForgeChatEvalTurnResult[];
}

export interface ClipForgeChatEvalThresholds {
	singleTurnMinPassRate: number;
	multiTurnMinPassRate: number;
	creativeDirectionMinPassRate: number;
	finishingMinPassRate: number;
	referenceVideoMinPassRate: number;
	maxUnsafeApplyFailures: number;
	expectedSingleTurnPrompts: number;
	expectedMultiTurnPrompts: number;
	expectedCreativeDirectionPrompts: number;
	expectedFinishingPrompts: number;
	expectedReferenceVideoPrompts: number;
}

export const DEFAULT_CLIPFORGE_CHAT_EVAL_THRESHOLDS: ClipForgeChatEvalThresholds = {
	singleTurnMinPassRate: 0.9,
	multiTurnMinPassRate: 0.8,
	creativeDirectionMinPassRate: 0.8,
	finishingMinPassRate: 0.8,
	referenceVideoMinPassRate: 0.8,
	maxUnsafeApplyFailures: 0,
	expectedSingleTurnPrompts: 60,
	expectedMultiTurnPrompts: 30,
	expectedCreativeDirectionPrompts: 20,
	expectedFinishingPrompts: 12,
	expectedReferenceVideoPrompts: 8,
};

export async function runClipForgeChatEvaluationHarness({
	provider = new HeuristicChatOpsProvider(),
}: {
	provider?: ChatOpsProvider;
} = {}): Promise<ClipForgeChatEvalReport> {
	const fixtures = new Map(buildEvaluationFixtures().map((fixture) => [fixture.id, fixture]));
	const turns: ClipForgeChatEvalTurnResult[] = [];

	for (const scenario of buildEvaluationScenarios()) {
		const baseFixture = fixtures.get(scenario.fixtureId);
		if (!baseFixture) {
			throw new Error(`Missing evaluation fixture: ${scenario.fixtureId}`);
		}

		const fixture = cloneFixture(baseFixture);
		for (const turn of scenario.turns) {
			const context: ChatPlannerContext = {
				...fixture.defaultContext,
				...turn.context,
			};
			const summary = buildProjectSummary({
				project: fixture.project,
				mediaAssets: fixture.mediaAssets,
				playheadMs: context.playhead_ms,
				selectedSegmentIds: context.selected_segment_ids,
				projectKitTemplates: fixture.projectKitTemplates,
				sceneRecipeTemplates: fixture.sceneRecipeTemplates,
			});
			const rawResult = await provider.proposeEdits({
				userText: turn.prompt,
				projectSummary: summary,
				context,
				overrides: turn.overrides,
			});
			const result = normalizeChatPlanResult(rawResult);
			const manager = new ClipForgeManager(
				createEvaluationEditor({
				project: fixture.project,
				mediaAssets: fixture.mediaAssets,
				projectKitTemplates: fixture.projectKitTemplates,
				sceneRecipeTemplates: fixture.sceneRecipeTemplates,
				selectedSegmentIds: context.selected_segment_ids,
			}),
		);

			const turnResult = evaluateTurnResult({
				suite: scenario.suite,
				scenarioId: scenario.id,
				turn,
				result,
				manager,
				summary,
				context,
			});
			turns.push(turnResult);

			if (turnResult.pass && !turnResult.unsafeApplyFailure) {
				persistEvaluationMemory({
					project: fixture.project,
					prompt: turn.prompt,
					commands: result.commands,
				});
			}
		}
	}

	return {
		suites: buildSuiteReports({ turns }),
		turns,
	};
}

export function assertClipForgeChatEvalThresholds({
	report,
	thresholds = DEFAULT_CLIPFORGE_CHAT_EVAL_THRESHOLDS,
}: {
	report: ClipForgeChatEvalReport;
	thresholds?: ClipForgeChatEvalThresholds;
}): void {
	const singleTurn = report.suites["single-turn"];
	const multiTurn = report.suites["multi-turn-memory"];
	const creative = report.suites["creative-direction"];
	const finishing = report.suites.finishing;
	const referenceVideo = report.suites["reference-video"];
	const unsafeApplyFailures = report.turns.filter(
		(turn) => turn.unsafeApplyFailure,
	).length;

	const errors: string[] = [];
	if (singleTurn.totalPrompts !== thresholds.expectedSingleTurnPrompts) {
		errors.push(
			`Expected ${thresholds.expectedSingleTurnPrompts} single-turn prompts, received ${singleTurn.totalPrompts}.`,
		);
	}
	if (multiTurn.totalPrompts !== thresholds.expectedMultiTurnPrompts) {
		errors.push(
			`Expected ${thresholds.expectedMultiTurnPrompts} multi-turn prompts, received ${multiTurn.totalPrompts}.`,
		);
	}
	if (
		creative.totalPrompts !== thresholds.expectedCreativeDirectionPrompts
	) {
		errors.push(
			`Expected ${thresholds.expectedCreativeDirectionPrompts} creative-direction prompts, received ${creative.totalPrompts}.`,
		);
	}
	if (finishing.totalPrompts !== thresholds.expectedFinishingPrompts) {
		errors.push(
			`Expected ${thresholds.expectedFinishingPrompts} finishing prompts, received ${finishing.totalPrompts}.`,
		);
	}
	if (referenceVideo.totalPrompts !== thresholds.expectedReferenceVideoPrompts) {
		errors.push(
			`Expected ${thresholds.expectedReferenceVideoPrompts} reference-video prompts, received ${referenceVideo.totalPrompts}.`,
		);
	}
	if (singleTurn.passRate < thresholds.singleTurnMinPassRate) {
		errors.push(
			`Single-turn pass rate ${formatRate(singleTurn.passRate)} is below ${formatRate(thresholds.singleTurnMinPassRate)}.`,
		);
	}
	if (multiTurn.passRate < thresholds.multiTurnMinPassRate) {
		errors.push(
			`Multi-turn pass rate ${formatRate(multiTurn.passRate)} is below ${formatRate(thresholds.multiTurnMinPassRate)}.`,
		);
	}
	if (creative.passRate < thresholds.creativeDirectionMinPassRate) {
		errors.push(
			`Creative-direction pass rate ${formatRate(creative.passRate)} is below ${formatRate(thresholds.creativeDirectionMinPassRate)}.`,
		);
	}
	if (finishing.passRate < thresholds.finishingMinPassRate) {
		errors.push(
			`Finishing pass rate ${formatRate(finishing.passRate)} is below ${formatRate(thresholds.finishingMinPassRate)}.`,
		);
	}
	if (referenceVideo.passRate < thresholds.referenceVideoMinPassRate) {
		errors.push(
			`Reference-video pass rate ${formatRate(referenceVideo.passRate)} is below ${formatRate(thresholds.referenceVideoMinPassRate)}.`,
		);
	}
	if (unsafeApplyFailures > thresholds.maxUnsafeApplyFailures) {
		errors.push(
			`Unsafe-apply failures ${unsafeApplyFailures} exceed ${thresholds.maxUnsafeApplyFailures}.`,
		);
	}

	if (errors.length > 0) {
		throw new Error(errors.join("\n"));
	}
}

export function formatClipForgeChatEvalReport({
	report,
}: {
	report: ClipForgeChatEvalReport;
}): string {
	const lines = ["ClipForge Chat Evaluation"];
	for (const suiteName of [
		"single-turn",
		"multi-turn-memory",
		"creative-direction",
		"finishing",
		"reference-video",
	] as const) {
		const suite = report.suites[suiteName];
		lines.push(
			`${suiteName}: ${suite.passedPrompts}/${suite.totalPrompts} (${formatRate(suite.passRate)}) unsafe=${suite.unsafeApplyFailures}`,
		);
	}
	const failedTurns = report.turns.filter((turn) => !turn.pass);
	if (failedTurns.length > 0) {
		lines.push("failures:");
		for (const turn of failedTurns.slice(0, 10)) {
			lines.push(
				`- ${turn.suite}/${turn.scenarioId}/${turn.turnId}: ${turn.reasons.join("; ")}`,
			);
		}
	}
	return lines.join("\n");
}

function evaluateTurnResult({
	suite,
	scenarioId,
	turn,
	result,
	manager,
	summary,
	context,
}: {
	suite: EvalSuiteName;
	scenarioId: string;
	turn: EvalTurn;
	result: ReturnType<typeof normalizeChatPlanResult>;
	manager: ClipForgeManager;
	summary: ReturnType<typeof buildProjectSummary>;
	context: ChatPlannerContext;
}): ClipForgeChatEvalTurnResult {
	const reasons: string[] = [];
	let pass = false;
	let unsafeApplyFailure = false;

	if (turn.expectation.kind === "clarification") {
		const clarification = result.clarification;
		if (!clarification) {
			reasons.push("Expected clarification, but planner returned a plan.");
		} else {
			if (clarification.kind !== turn.expectation.clarification.kind) {
				reasons.push(
					`Expected clarification kind ${turn.expectation.clarification.kind}, received ${clarification.kind}.`,
				);
			}
			if (
				turn.expectation.clarification.referenceLabel &&
				clarification.referenceLabel !==
					turn.expectation.clarification.referenceLabel
			) {
				reasons.push(
					`Expected clarification reference ${turn.expectation.clarification.referenceLabel}, received ${clarification.referenceLabel}.`,
				);
			}
		}
		pass = reasons.length === 0;
	} else {
		if (result.clarification) {
			reasons.push(
				`Expected a plan, but planner requested ${result.clarification.kind} clarification.`,
			);
		} else {
			const reconciled = manager.reconcileAndValidateCommands({
				userText: turn.prompt,
				projectSummary: summary,
				context,
				overrides: turn.overrides,
				commands: result.commands,
			});
			unsafeApplyFailure = reconciled.blocked || reconciled.safety.blocked;
			if (unsafeApplyFailure) {
				reasons.push("Plan failed command validation or safety reconciliation.");
			}
			if (
				!matchesCommandExpectation({
					expectation: turn.expectation.command,
					commands: reconciled.commands,
				})
			) {
				reasons.push("Plan did not match the expected command or op shape.");
			}
		}
		pass = reasons.length === 0;
	}

	return {
		suite,
		scenarioId,
		turnId: turn.id,
		prompt: turn.prompt,
		pass,
		unsafeApplyFailure,
		provider: result.provider,
		commandKinds: result.commands.map((command) => command.kind),
		opTypes: result.ops.map((op) => op.type),
		clarificationKind: result.clarification?.kind ?? null,
		reasons,
	};
}

function matchesCommandExpectation({
	expectation,
	commands,
}: {
	expectation: EvalCommandExpectation;
	commands: ClipForgeEditorCommand[];
}): boolean {
	if (expectation.commandKinds) {
		const receivedCommandKinds = commands.map((command) => command.kind);
		if (
			receivedCommandKinds.length !== expectation.commandKinds.length ||
			receivedCommandKinds.some(
				(kind, index) => kind !== expectation.commandKinds?.[index],
			)
		) {
			return false;
		}
	}

	if (expectation.opTypes) {
		const receivedOpTypes = commands
			.flatMap((command) => (command.kind === "timeline-op" ? [command.op.type] : []));
		if (
			receivedOpTypes.length !== expectation.opTypes.length ||
			receivedOpTypes.some((type, index) => type !== expectation.opTypes?.[index])
		) {
			return false;
		}
	}

	if (expectation.targetIds) {
		const receivedTargets = extractCommandTargetIds({ commands });
		if (
			receivedTargets.length !== expectation.targetIds.length ||
			receivedTargets.some((id, index) => id !== expectation.targetIds?.[index])
		) {
			return false;
		}
	}

	return true;
}

function extractCommandTargetIds({
	commands,
}: {
	commands: ClipForgeEditorCommand[];
}): string[] {
	return commands.flatMap((command) => {
		switch (command.kind) {
			case "timeline-op":
				return [];
			case "set-clip-speed":
			case "separate-audio":
			case "set-transition-in":
			case "apply-finishing-look":
			case "apply-effect-preset":
				return command.target_segment_ids;
			case "insert-freeze-frame":
				return [command.target_segment_id];
			case "apply-overlay-style":
			case "apply-motion-preset":
			case "apply-sound-sync":
				return command.target_element_ids;
			case "insert-overlay-preset":
			case "set-audio-mix":
			case "apply-music-track":
			case "replace-music-track":
			case "insert-sfx-preset":
			case "apply-polish-profile":
			case "apply-caption-reveal":
			case "apply-project-kit":
			case "set-version-pack":
			case "auto-reframe-selection":
			case "set-publish-destination":
			case "run-export-preflight-fixes":
			case "set-active-reference-video":
			case "clear-active-reference-video":
			case "apply-reference-finish-pass":
			case "match-reference-captions":
			case "match-reference-audio-profile":
			case "match-reference-packaging":
			case "match-reference-pacing":
				return [];
		}
	});
}

function buildSuiteReports({
	turns,
}: {
	turns: ClipForgeChatEvalTurnResult[];
}): Record<EvalSuiteName, ClipForgeChatEvalSuiteReport> {
	const suites = {} as Record<EvalSuiteName, ClipForgeChatEvalSuiteReport>;
	for (const suiteName of [
		"single-turn",
		"multi-turn-memory",
		"creative-direction",
		"finishing",
		"reference-video",
	] as const) {
		const suiteTurns = turns.filter((turn) => turn.suite === suiteName);
		const passedPrompts = suiteTurns.filter((turn) => turn.pass).length;
		const unsafeApplyFailures = suiteTurns.filter(
			(turn) => turn.unsafeApplyFailure,
		).length;
		suites[suiteName] = {
			suite: suiteName,
			totalPrompts: suiteTurns.length,
			passedPrompts,
			failedPrompts: suiteTurns.length - passedPrompts,
			passRate: suiteTurns.length === 0 ? 0 : passedPrompts / suiteTurns.length,
			unsafeApplyFailures,
		};
	}
	return suites;
}

function formatRate(value: number): string {
	return `${Math.round(value * 100)}%`;
}

function cloneFixture(fixture: EvalFixture): EvalFixture {
	return structuredClone(fixture);
}

function createEvaluationEditor({
	project,
	mediaAssets,
	projectKitTemplates,
	sceneRecipeTemplates,
	selectedSegmentIds,
}: {
	project: TProject;
	mediaAssets: MediaAsset[];
	projectKitTemplates: ProjectKitTemplate[];
	sceneRecipeTemplates: SceneRecipeTemplate[];
	selectedSegmentIds: string[];
}) {
	return {
		project: {
			getActive: () => project,
			getActiveOrNull: () => project,
			findTemplateById: ({ templateId }: { templateId: string }) =>
				projectKitTemplates.find((template) => template.id === templateId) ?? null,
			getProjectKitTemplates: () => projectKitTemplates,
			getSceneRecipeTemplates: () => sceneRecipeTemplates,
		},
		timeline: {
			findTrackIdForElement: ({ elementId }: { elementId: string }) =>
				findTrackIdForElement({ project, elementId }),
			getTrackById: ({ trackId }: { trackId: string }) =>
				project.scenes
					.find((scene) => scene.id === project.currentSceneId)
					?.tracks.find((track) => track.id === trackId) ?? null,
			getTracks: () =>
				project.scenes.find((scene) => scene.id === project.currentSceneId)?.tracks ?? [],
		},
		selection: {
			getSelectedElements: () =>
				selectedSegmentIds.map((elementId) => ({
					elementId,
					trackId: findTrackIdForElement({ project, elementId }) ?? "",
				})),
		},
		media: {
			getAssets: () => mediaAssets,
		},
		playback: {
			getCurrentTime: () => 1.6,
		},
	} as any;
}

function findTrackIdForElement({
	project,
	elementId,
}: {
	project: TProject;
	elementId: string;
}): string | null {
	const activeScene = project.scenes.find((scene) => scene.id === project.currentSceneId);
	for (const track of activeScene?.tracks ?? []) {
		if (track.elements.some((element) => element.id === elementId)) {
			return track.id;
		}
	}
	return null;
}

function persistEvaluationMemory({
	project,
	prompt,
	commands,
}: {
	project: TProject;
	prompt: string;
	commands: ClipForgeEditorCommand[];
}): void {
	const clipforge = project.clipforge ?? buildDefaultClipForgeProjectData();
	const now = new Date("2026-03-13T12:00:00.000Z").toISOString();
	const summaries = commands.map((command) =>
		buildAppliedCommandSummaryForEval({
			command,
			sceneId: project.currentSceneId,
			createdAt: now,
		}),
	);
	const nextTurn: ClipForgeChatTurnSummary = {
		prompt,
		summary: `${prompt} -> ${summaries.map((summary) => summary.summary).join(" ")}`.trim(),
		commandKinds: commands.map((command) => command.kind),
		createdAt: now,
	};
	project.clipforge = {
		...clipforge,
		chatMemory: {
			...clipforge.chatMemory,
			activeTargets: [
				...new Set(summaries.flatMap((summary) => summary.targetSegmentIds)),
			].slice(-6),
			styleIntent: clipforge.chatMemory.styleIntent,
			publishIntent: clipforge.chatMemory.publishIntent,
			finishIntent: clipforge.chatMemory.finishIntent,
			destinationIntent: clipforge.chatMemory.destinationIntent,
			referenceIntent:
				commands.some((command) => command.kind === "apply-reference-finish-pass") ||
				commands.some((command) => command.kind === "match-reference-captions") ||
				commands.some((command) => command.kind === "match-reference-audio-profile") ||
				commands.some((command) => command.kind === "match-reference-packaging") ||
				commands.some((command) => command.kind === "match-reference-pacing")
					? {
							referenceAssetId:
								clipforge.activeReferenceVideoAssetId ??
								clipforge.chatMemory.referenceIntent?.referenceAssetId ??
								null,
							referenceMode: "exact-recreation" as const,
					  }
					: clipforge.chatMemory.referenceIntent,
			recentTurnSummaries: [...clipforge.chatMemory.recentTurnSummaries, nextTurn].slice(
				-12,
			),
			recentAppliedCommandSummaries: [
				...clipforge.chatMemory.recentAppliedCommandSummaries,
				...summaries,
			].slice(-20),
			recentAssetChoices: clipforge.chatMemory.recentAssetChoices,
			recentReferenceComparisons: [
				...clipforge.chatMemory.recentReferenceComparisons,
				...commands.flatMap((command) => {
					switch (command.kind) {
						case "apply-reference-finish-pass":
							return ["finish pass closer to active reference"];
						case "match-reference-captions":
							return ["matched captions to active reference"];
						case "match-reference-audio-profile":
							return ["matched audio feel to active reference"];
						case "match-reference-packaging":
							return ["matched packaging to active reference"];
						case "match-reference-pacing":
							return ["matched pacing to active reference"];
						default:
							return [];
					}
				}),
			].slice(-12),
		},
	};
}

function buildAppliedCommandSummaryForEval({
	command,
	sceneId,
	createdAt,
}: {
	command: ClipForgeEditorCommand;
	sceneId: string;
	createdAt: string;
}): ClipForgeAppliedCommandSummary {
	return {
		kind: command.kind,
		summary: summarizeCommandForEval({ command }),
		targetSegmentIds: extractSummarySegmentTargets({ command }),
		targetElementIds: extractSummaryElementTargets({ command }),
		sceneId,
		scope:
			("scope" in command ? command.scope : null) ??
			("selection" satisfies ClipForgeCommandScope),
		createdAt,
	};
}

function summarizeCommandForEval({
	command,
}: {
	command: ClipForgeEditorCommand;
}): string {
	switch (command.kind) {
		case "timeline-op":
			return `Applied ${command.op.type}.`;
		case "set-clip-speed":
			return `Set clip speed to ${Math.round(command.playback_rate * 100)}%.`;
		case "separate-audio":
			return "Separated clip audio.";
		case "insert-freeze-frame":
			return `Inserted freeze frame for ${command.duration_ms}ms.`;
		case "set-transition-in":
			return `Applied ${command.preset} transitions at ${command.duration_ms}ms.`;
		case "apply-finishing-look":
			return `Applied ${command.preset_id} finishing look.`;
		case "apply-effect-preset":
			return `Applied ${command.effect_kind} effect.`;
		case "insert-overlay-preset":
			return `Inserted ${command.preset_id} overlay preset.`;
		case "apply-overlay-style":
			return `Applied ${command.variant_id} overlay style.`;
		case "apply-motion-preset":
			return `Applied ${command.motion_preset_id} motion preset.`;
		case "apply-sound-sync":
			return `Applied ${command.pairing_id} sound sync.`;
		case "set-audio-mix":
			return `Updated audio mix ducking to ${command.settings.duckingAmount ?? 0}.`;
		case "apply-music-track":
			return `Applied music ${command.music_asset_id}.`;
		case "replace-music-track":
			return `Replaced music with ${command.music_asset_id}.`;
		case "insert-sfx-preset":
			return `Inserted SFX ${command.sfx_asset_id}.`;
		case "apply-polish-profile":
			return `Applied polish profile ${command.profile_id}.`;
		case "apply-caption-reveal":
			return `Applied caption reveal ${command.preset_id}.`;
		case "apply-project-kit":
			return `Applied project kit ${command.kit_id}.`;
		case "set-version-pack":
			return `Enabled version targets ${command.target_ids.join(", ")}.`;
		case "auto-reframe-selection":
			return `Auto reframed for ${command.target_version_id}.`;
		case "set-publish-destination":
			return `Set publish destination to ${command.publish_destination}.`;
		case "run-export-preflight-fixes":
			return "Applied export preflight fixes.";
		case "set-active-reference-video":
			return `Set reference video to ${command.asset_id}.`;
		case "clear-active-reference-video":
			return "Cleared the reference video.";
		case "apply-reference-finish-pass":
			return "Applied a reference-guided finish pass.";
		case "match-reference-captions":
			return "Matched captions to the reference.";
		case "match-reference-audio-profile":
			return "Matched audio feel to the reference.";
		case "match-reference-packaging":
			return "Matched packaging to the reference.";
		case "match-reference-pacing":
			return "Matched pacing to the reference.";
	}
}

function extractSummarySegmentTargets({
	command,
}: {
	command: ClipForgeEditorCommand;
}): string[] {
	switch (command.kind) {
		case "timeline-op":
			return [];
		case "set-clip-speed":
		case "separate-audio":
			case "set-transition-in":
			case "apply-finishing-look":
			case "apply-effect-preset":
				return command.target_segment_ids;
			case "insert-freeze-frame":
				return [command.target_segment_id];
			case "apply-music-track":
			case "replace-music-track":
			case "insert-sfx-preset":
			case "apply-polish-profile":
			case "apply-caption-reveal":
			case "insert-overlay-preset":
			case "apply-overlay-style":
			case "apply-motion-preset":
			case "apply-sound-sync":
			case "set-audio-mix":
			case "apply-project-kit":
			case "set-version-pack":
			case "auto-reframe-selection":
			case "set-publish-destination":
			case "run-export-preflight-fixes":
			case "set-active-reference-video":
			case "clear-active-reference-video":
			case "apply-reference-finish-pass":
			case "match-reference-captions":
			case "match-reference-audio-profile":
			case "match-reference-packaging":
			case "match-reference-pacing":
				return [];
		}
	}

function extractSummaryElementTargets({
	command,
}: {
	command: ClipForgeEditorCommand;
}): string[] {
	switch (command.kind) {
		case "apply-overlay-style":
		case "apply-motion-preset":
		case "apply-sound-sync":
			return command.target_element_ids;
		case "timeline-op":
		case "set-clip-speed":
		case "separate-audio":
		case "insert-freeze-frame":
		case "set-transition-in":
		case "apply-finishing-look":
		case "apply-effect-preset":
		case "insert-overlay-preset":
			case "set-audio-mix":
			case "apply-music-track":
			case "replace-music-track":
			case "insert-sfx-preset":
			case "apply-polish-profile":
			case "apply-caption-reveal":
			case "apply-project-kit":
			case "set-version-pack":
			case "auto-reframe-selection":
			case "set-publish-destination":
			case "run-export-preflight-fixes":
			case "set-active-reference-video":
			case "clear-active-reference-video":
			case "apply-reference-finish-pass":
			case "match-reference-captions":
			case "match-reference-audio-profile":
			case "match-reference-packaging":
			case "match-reference-pacing":
				return [];
		}
	}

function buildEvaluationFixtures(): EvalFixture[] {
	return [
		{
			id: "creator-studio",
			project: createFrozenProject(),
			mediaAssets: createFrozenMediaAssets(),
			projectKitTemplates: createProjectKitTemplates(),
			sceneRecipeTemplates: createSceneRecipeTemplates(),
			defaultContext: {
				playhead_ms: 1600,
				selected_segment_ids: [],
				active_scene_id: "scene-main",
			},
		},
	];
}

function buildEvaluationScenarios(): EvalScenario[] {
	return [
		...buildSingleTurnScenarios(),
		...buildMultiTurnMemoryScenarios(),
		...buildCreativeDirectionScenarios(),
		...buildFinishingScenarios(),
		...buildReferenceVideoScenarios(),
	];
}

function buildSingleTurnScenarios(): EvalScenario[] {
	const prompts: Array<{
		id: string;
		prompt: string;
		expectation: EvalTurn["expectation"];
		context?: Partial<ChatPlannerContext>;
		overrides?: ChatPlannerOverrides;
	}> = [
		{
			id: "legacy-make-version-1",
			prompt: "make it faster",
			expectation: { kind: "plan", command: { commandKinds: ["timeline-op"], opTypes: ["MAKE_VERSION"] } },
		},
		{
			id: "legacy-make-version-2",
			prompt: "make it faster",
			expectation: { kind: "plan", command: { commandKinds: ["timeline-op"], opTypes: ["MAKE_VERSION"] } },
		},
		{
			id: "legacy-remove-silence-1",
			prompt: "remove more pauses",
			expectation: { kind: "plan", command: { commandKinds: ["timeline-op"], opTypes: ["REMOVE_SILENCE"] } },
		},
		{
			id: "legacy-remove-silence-2",
			prompt: "remove more pauses",
			expectation: { kind: "plan", command: { commandKinds: ["timeline-op"], opTypes: ["REMOVE_SILENCE"] } },
		},
		{
			id: "legacy-caption-tone-1",
			prompt: "use bold center captions",
			expectation: { kind: "plan", command: { commandKinds: ["timeline-op"], opTypes: ["SET_CAPTION_STYLE"] } },
		},
		{
			id: "legacy-caption-tone-2",
			prompt: "make the captions softer",
			expectation: { kind: "plan", command: { commandKinds: ["timeline-op"], opTypes: ["SET_CAPTION_STYLE"] } },
		},
		{
			id: "legacy-overlay-1",
			prompt: 'add text at the top that says "watch this"',
			expectation: { kind: "plan", command: { commandKinds: ["timeline-op"], opTypes: ["ADD_TEXT_OVERLAY"] } },
		},
		{
			id: "legacy-overlay-2",
			prompt: 'put "don\'t skip" here',
			context: { playhead_ms: 4200 },
			expectation: { kind: "plan", command: { commandKinds: ["timeline-op"], opTypes: ["ADD_TEXT_OVERLAY"] } },
		},
		{
			id: "legacy-cut-range-1",
			prompt: 'cut where i say "summer"',
			expectation: { kind: "plan", command: { commandKinds: ["timeline-op"], opTypes: ["CUT_RANGE"] } },
		},
		{
			id: "legacy-cut-range-2",
			prompt: 'cut where i say "welcome"',
			expectation: { kind: "plan", command: { commandKinds: ["timeline-op"], opTypes: ["CUT_RANGE"] } },
		},
		{
			id: "legacy-broll-1",
			prompt: "add b-roll using beach from 2s to 5s",
			expectation: { kind: "plan", command: { commandKinds: ["timeline-op"], opTypes: ["INSERT_BROLL"] } },
		},
		{
			id: "legacy-broll-2",
			prompt: 'add b-roll using beach when i say "summer" for 2s',
			expectation: { kind: "plan", command: { commandKinds: ["timeline-op"], opTypes: ["INSERT_BROLL"] } },
		},
		{
			id: "legacy-trim-1",
			prompt: "move the first clip to 5s",
			expectation: { kind: "plan", command: { commandKinds: ["timeline-op"], opTypes: ["MOVE_SEGMENT"] } },
		},
		{
			id: "legacy-trim-2",
			prompt: "move the second clip earlier by 1s",
			expectation: { kind: "plan", command: { commandKinds: ["timeline-op"], opTypes: ["MOVE_SEGMENT"] } },
		},
		{
			id: "legacy-move-1",
			prompt: "move the second clip to 5s",
			expectation: { kind: "plan", command: { commandKinds: ["timeline-op"], opTypes: ["MOVE_SEGMENT"] } },
		},
		{
			id: "legacy-move-2",
			prompt: "move this earlier by 1s",
			context: { playhead_ms: 4700 },
			expectation: { kind: "plan", command: { commandKinds: ["timeline-op"], opTypes: ["MOVE_SEGMENT"] } },
		},
		{
			id: "legacy-swap-1",
			prompt: "swap the first and second clips",
			expectation: { kind: "plan", command: { commandKinds: ["timeline-op"], opTypes: ["SWAP_SEGMENTS"] } },
		},
		{
			id: "legacy-swap-2",
			prompt: "swap the first and second clips",
			expectation: { kind: "plan", command: { commandKinds: ["timeline-op"], opTypes: ["SWAP_SEGMENTS"] } },
		},
		{
			id: "legacy-delete-1",
			prompt: 'delete the clip where i say "summer"',
			expectation: { kind: "plan", command: { commandKinds: ["timeline-op"], opTypes: ["DELETE_SEGMENT"] } },
		},
		{
			id: "legacy-delete-2",
			prompt: "delete the second clip",
			expectation: { kind: "plan", command: { commandKinds: ["timeline-op"], opTypes: ["DELETE_SEGMENT"] } },
		},
		{
			id: "legacy-duplicate-1",
			prompt: "duplicate the first clip after itself",
			expectation: { kind: "plan", command: { commandKinds: ["timeline-op"], opTypes: ["DUPLICATE_SEGMENT"] } },
		},
		{
			id: "legacy-duplicate-2",
			prompt: "duplicate the first clip after itself",
			expectation: { kind: "plan", command: { commandKinds: ["timeline-op"], opTypes: ["DUPLICATE_SEGMENT"] } },
		},
		{
			id: "legacy-fix-caption-1",
			prompt: 'replace "teh" with "the" in captions',
			expectation: { kind: "plan", command: { commandKinds: ["timeline-op"], opTypes: ["FIX_CAPTION_TEXT"] } },
		},
		{
			id: "legacy-fix-caption-2",
			prompt: 'replace "teh" with "the" in captions',
			expectation: { kind: "plan", command: { commandKinds: ["timeline-op"], opTypes: ["FIX_CAPTION_TEXT"] } },
		},
		{
			id: "direct-speed-1",
			prompt: "speed up the opener 15%",
			expectation: { kind: "plan", command: { commandKinds: ["set-clip-speed"], targetIds: ["clip-a"] } },
		},
		{
			id: "direct-speed-2",
			prompt: "speed up the first clip 10%",
			expectation: { kind: "plan", command: { commandKinds: ["set-clip-speed"], targetIds: ["clip-a"] } },
		},
		{
			id: "direct-speed-3",
			prompt: "speed up the second clip 20%",
			expectation: { kind: "plan", command: { commandKinds: ["set-clip-speed"], targetIds: ["clip-b"] } },
		},
		{
			id: "direct-separate-1",
			prompt: "separate audio from the opener",
			expectation: { kind: "plan", command: { commandKinds: ["separate-audio"], targetIds: ["clip-a"] } },
		},
		{
			id: "direct-separate-2",
			prompt: "split audio from the second clip",
			expectation: { kind: "plan", command: { commandKinds: ["separate-audio"], targetIds: ["clip-b"] } },
		},
		{
			id: "direct-freeze-1",
			prompt: "freeze opener for 1.2s",
			context: { playhead_ms: 1600 },
			expectation: { kind: "plan", command: { commandKinds: ["insert-freeze-frame"], targetIds: ["clip-a"] } },
		},
		{
			id: "direct-freeze-2",
			prompt: "freeze the second clip for 0.8s",
			context: { playhead_ms: 4300 },
			expectation: { kind: "plan", command: { commandKinds: ["insert-freeze-frame"], targetIds: ["clip-b"] } },
		},
		{
			id: "direct-transition-1",
			prompt: "add a slide transition into the second clip",
			expectation: { kind: "plan", command: { commandKinds: ["set-transition-in"], targetIds: ["clip-b"] } },
		},
		{
			id: "direct-transition-2",
			prompt: "add a slide transition into the second clip",
			expectation: { kind: "plan", command: { commandKinds: ["set-transition-in"], targetIds: ["clip-b"] } },
		},
		{
			id: "direct-transition-3",
			prompt: "add a subtle transition into the second clip",
			expectation: { kind: "plan", command: { commandKinds: ["set-transition-in"], targetIds: ["clip-b"] } },
			context: { playhead_ms: 3000 },
			overrides: { forced_segment_ids_by_reference: {}, forced_choice_values_by_reference: { "preset:transition": "cross-dissolve" } },
		},
		{
			id: "direct-transition-4",
			prompt: "add a subtle transition into the second clip",
			expectation: { kind: "plan", command: { commandKinds: ["set-transition-in"], targetIds: ["clip-b"] } },
			context: { playhead_ms: 3000 },
			overrides: { forced_segment_ids_by_reference: {}, forced_choice_values_by_reference: { "preset:transition": "cross-dissolve" } },
		},
		{
			id: "direct-look-1",
			prompt: "apply a warm finishing look to the opener",
			expectation: { kind: "plan", command: { commandKinds: ["apply-finishing-look"], targetIds: ["clip-a"] } },
		},
		{
			id: "direct-look-2",
			prompt: "apply a mono finishing look to the second clip",
			expectation: { kind: "plan", command: { commandKinds: ["apply-finishing-look"], targetIds: ["clip-b"] } },
		},
		{
			id: "direct-look-3",
			prompt: "apply a vintage finishing look to the third clip",
			expectation: { kind: "plan", command: { commandKinds: ["apply-finishing-look"], targetIds: ["clip-c"] } },
		},
		{
			id: "direct-effect-1",
			prompt: "add a blur effect to the opener",
			expectation: { kind: "plan", command: { commandKinds: ["apply-effect-preset"], targetIds: ["clip-a"] } },
		},
		{
			id: "direct-effect-2",
			prompt: "add a vignette effect to the second clip",
			expectation: { kind: "plan", command: { commandKinds: ["apply-effect-preset"], targetIds: ["clip-b"] } },
		},
		{
			id: "direct-effect-3",
			prompt: "add a sharpen effect to the third clip",
			expectation: { kind: "plan", command: { commandKinds: ["apply-effect-preset"], targetIds: ["clip-c"] } },
		},
		{
			id: "direct-overlay-preset-1",
			prompt: "add a timestamp card for 3s",
			context: { playhead_ms: 2400 },
			expectation: { kind: "plan", command: { commandKinds: ["insert-overlay-preset"] } },
		},
		{
			id: "direct-overlay-preset-2",
			prompt: "add a chapter card for 2.5s",
			context: { playhead_ms: 5100 },
			expectation: { kind: "plan", command: { commandKinds: ["insert-overlay-preset"] } },
		},
		{
			id: "direct-overlay-preset-3",
			prompt: "add a quote card for 4s",
			context: { playhead_ms: 6500 },
			expectation: { kind: "plan", command: { commandKinds: ["insert-overlay-preset"] } },
		},
		{
			id: "direct-overlay-preset-4",
			prompt: "add a stat card for 3.5s",
			context: { playhead_ms: 7200 },
			expectation: { kind: "plan", command: { commandKinds: ["insert-overlay-preset"] } },
		},
		{
			id: "direct-overlay-style-1",
			prompt: "make the overlays bold",
			expectation: { kind: "plan", command: { commandKinds: ["apply-overlay-style"], targetIds: ["overlay-1", "overlay-2"] } },
		},
		{
			id: "direct-overlay-style-2",
			prompt: "make the overlays minimal",
			expectation: { kind: "plan", command: { commandKinds: ["apply-overlay-style"], targetIds: ["overlay-1", "overlay-2"] } },
		},
		{
			id: "direct-motion-1",
			prompt: "make the overlays drift in",
			expectation: { kind: "plan", command: { commandKinds: ["apply-motion-preset"], targetIds: ["overlay-1", "overlay-2"] } },
		},
		{
			id: "direct-motion-2",
			prompt: "make the overlays slide up",
			expectation: { kind: "plan", command: { commandKinds: ["apply-motion-preset"], targetIds: ["overlay-1", "overlay-2"] } },
		},
		{
			id: "direct-motion-3",
			prompt: "make the overlays pop in",
			expectation: { kind: "plan", command: { commandKinds: ["apply-motion-preset"], targetIds: ["overlay-1", "overlay-2"] } },
		},
		{
			id: "direct-sound-sync-1",
			prompt: "use whoosh pop on graphics",
			expectation: { kind: "plan", command: { commandKinds: ["apply-sound-sync"], targetIds: ["overlay-1", "overlay-2"] } },
		},
		{
			id: "direct-sound-sync-2",
			prompt: "use whoosh pop on graphics",
			expectation: { kind: "plan", command: { commandKinds: ["apply-sound-sync"], targetIds: ["overlay-1", "overlay-2"] } },
		},
		{
			id: "direct-audio-mix-1",
			prompt: "duck the music more",
			expectation: { kind: "plan", command: { commandKinds: ["set-audio-mix"] } },
		},
		{
			id: "direct-audio-mix-2",
			prompt: "duck the music to 70%",
			expectation: { kind: "plan", command: { commandKinds: ["set-audio-mix"] } },
		},
		{
			id: "direct-kit-1",
			prompt: "apply clean vlog kit",
			expectation: { kind: "plan", command: { commandKinds: ["apply-project-kit"] } },
		},
		{
			id: "direct-kit-2",
			prompt: "apply luxury creator kit",
			expectation: { kind: "plan", command: { commandKinds: ["apply-project-kit"] } },
		},
		{
			id: "direct-version-pack-1",
			prompt: "set versions to 9:16, 1:1",
			expectation: { kind: "plan", command: { commandKinds: ["set-version-pack"] } },
		},
		{
			id: "direct-version-pack-2",
			prompt: "set versions to 16:9",
			expectation: { kind: "plan", command: { commandKinds: ["set-version-pack"] } },
		},
		{
			id: "direct-reframe-1",
			prompt: "reframe for 9:16",
			expectation: { kind: "plan", command: { commandKinds: ["auto-reframe-selection"] } },
			context: { selected_segment_ids: ["clip-a"] },
		},
		{
			id: "direct-reframe-2",
			prompt: "reframe for 1:1",
			expectation: { kind: "plan", command: { commandKinds: ["auto-reframe-selection"] } },
			context: { selected_segment_ids: ["clip-b"] },
		},
	];

	if (prompts.length !== 60) {
		throw new Error(`Single-turn eval suite must contain 60 prompts. Found ${prompts.length}.`);
	}

	return prompts.map((prompt) => ({
		id: prompt.id,
		suite: "single-turn" as const,
		fixtureId: "creator-studio",
		turns: [
			{
				id: prompt.id,
				prompt: prompt.prompt,
				context: prompt.context,
				overrides: prompt.overrides,
				expectation: prompt.expectation,
			},
		],
	}));
}

function buildMultiTurnMemoryScenarios(): EvalScenario[] {
	const conversations: EvalScenario[] = [];
	for (let index = 0; index < 6; index += 1) {
		const openerId = index % 2 === 0 ? "clip-a" : "clip-b";
		const playhead = openerId === "clip-a" ? 1600 : 4300;
		const speedPrompt =
			openerId === "clip-a"
				? "speed up the opener 15%"
				: "speed up the second clip 15%";
		const transitionTurnTargets =
			openerId === "clip-a" ? ["clip-b"] : ["clip-c"];
		const repeatTargets =
			openerId === "clip-a" ? ["clip-c", "clip-d"] : ["clip-d"];

		conversations.push({
			id: `memory-flow-${index + 1}`,
			suite: "multi-turn-memory",
			fixtureId: "creator-studio",
			turns: [
				{
					id: "turn-1",
					prompt: speedPrompt,
					context: { playhead_ms: playhead },
					expectation: {
						kind: "plan",
						command: {
							commandKinds: ["set-clip-speed"],
							targetIds: [openerId],
						},
					},
				},
				{
					id: "turn-2",
					prompt: "add a subtle transition into the next shot",
					expectation: {
						kind: "plan",
						command: {
							commandKinds: ["set-transition-in"],
							targetIds: transitionTurnTargets,
						},
					},
				},
				{
					id: "turn-3",
					prompt: openerId === "clip-a" ? "do that to the next two cuts" : "do that to the next cut",
					expectation: {
						kind: "plan",
						command: {
							commandKinds: ["set-transition-in"],
							targetIds: repeatTargets,
						},
					},
				},
				{
					id: "turn-4",
					prompt: "make the captions softer",
					expectation: {
						kind: "plan",
						command: {
							commandKinds: ["timeline-op"],
							opTypes: ["SET_CAPTION_STYLE"],
						},
					},
				},
				{
					id: "turn-5",
					prompt: "duck the music more",
					expectation: {
						kind: "plan",
						command: {
							commandKinds: ["set-audio-mix"],
						},
					},
				},
			],
		});
	}

	const totalTurns = conversations.reduce(
		(sum, scenario) => sum + scenario.turns.length,
		0,
	);
	if (totalTurns !== 30) {
		throw new Error(`Multi-turn eval suite must contain 30 prompts. Found ${totalTurns}.`);
	}
	return conversations;
}

function buildCreativeDirectionScenarios(): EvalScenario[] {
	const prompts: Array<{ id: string; prompt: string; expectation: EvalTurn["expectation"]; context?: Partial<ChatPlannerContext> }> = [
		{
			id: "creative-kit-clean",
			prompt: "apply clean vlog kit",
			expectation: { kind: "plan", command: { commandKinds: ["apply-project-kit"] } },
		},
		{
			id: "creative-kit-luxury",
			prompt: "apply luxury creator kit",
			expectation: { kind: "plan", command: { commandKinds: ["apply-project-kit"] } },
		},
		{
			id: "creative-overlays-bold",
			prompt: "make the overlays bold",
			expectation: { kind: "plan", command: { commandKinds: ["apply-overlay-style"] } },
		},
		{
			id: "creative-overlays-minimal",
			prompt: "make the overlays minimal",
			expectation: { kind: "plan", command: { commandKinds: ["apply-overlay-style"] } },
		},
		{
			id: "creative-motion-drift",
			prompt: "make the overlays drift in",
			expectation: { kind: "plan", command: { commandKinds: ["apply-motion-preset"] } },
		},
		{
			id: "creative-motion-slide",
			prompt: "make the overlays slide up",
			expectation: { kind: "plan", command: { commandKinds: ["apply-motion-preset"] } },
		},
		{
			id: "creative-sound-sync",
			prompt: "use whoosh pop on graphics",
			expectation: { kind: "plan", command: { commandKinds: ["apply-sound-sync"] } },
		},
		{
			id: "creative-overlay-card",
			prompt: "add a quote card for 4s",
			context: { playhead_ms: 6800 },
			expectation: { kind: "plan", command: { commandKinds: ["insert-overlay-preset"] } },
		},
		{
			id: "creative-overlay-timestamp",
			prompt: "add a timestamp card for 3s",
			context: { playhead_ms: 2200 },
			expectation: { kind: "plan", command: { commandKinds: ["insert-overlay-preset"] } },
		},
		{
			id: "creative-warm-look",
			prompt: "apply a warm finishing look to the opener",
			expectation: { kind: "plan", command: { commandKinds: ["apply-finishing-look"] } },
		},
		{
			id: "creative-mono-look",
			prompt: "apply a mono finishing look to the second clip",
			expectation: { kind: "plan", command: { commandKinds: ["apply-finishing-look"] } },
		},
		{
			id: "creative-vintage-look",
			prompt: "apply a vintage finishing look to the third clip",
			expectation: { kind: "plan", command: { commandKinds: ["apply-finishing-look"] } },
		},
		{
			id: "creative-audio-polish",
			prompt: "duck the music more",
			expectation: { kind: "plan", command: { commandKinds: ["set-audio-mix"] } },
		},
		{
			id: "creative-captions-soft",
			prompt: "make the captions softer",
			expectation: { kind: "plan", command: { commandKinds: ["timeline-op"], opTypes: ["SET_CAPTION_STYLE"] } },
		},
		{
			id: "creative-version-pack",
			prompt: "set versions to 9:16, 1:1",
			expectation: { kind: "plan", command: { commandKinds: ["set-version-pack"] } },
		},
		{
			id: "creative-reframe",
			prompt: "reframe for 9:16",
			context: { selected_segment_ids: ["clip-a"] },
			expectation: { kind: "plan", command: { commandKinds: ["auto-reframe-selection"] } },
		},
		{
			id: "creative-transition-clarify",
			prompt: "add a transition into the opener",
			expectation: { kind: "clarification", clarification: { kind: "preset", referenceLabel: "preset:transition" } },
		},
		{
			id: "creative-reframe-clarify",
			prompt: "reframe this",
			expectation: { kind: "clarification", clarification: { kind: "version-target", referenceLabel: "version-target:auto-reframe" } },
		},
		{
			id: "creative-overlay-scope-clarify",
			prompt: "make the overlays clean",
			context: { selected_segment_ids: ["overlay-1"] },
			expectation: { kind: "clarification", clarification: { kind: "scope", referenceLabel: "scope:overlay-style" } },
		},
		{
			id: "creative-project-kit-preset",
			prompt: "apply clean vlog kit",
			expectation: { kind: "plan", command: { commandKinds: ["apply-project-kit"] } },
		},
	];

	if (prompts.length !== 20) {
		throw new Error(`Creative-direction eval suite must contain 20 prompts. Found ${prompts.length}.`);
	}

	return prompts.map((prompt) => ({
		id: prompt.id,
		suite: "creative-direction" as const,
		fixtureId: "creator-studio",
		turns: [
			{
				id: prompt.id,
				prompt: prompt.prompt,
				context: prompt.context,
				expectation: prompt.expectation,
			},
		],
	}));
}

function buildFinishingScenarios(): EvalScenario[] {
	const prompts: Array<{
		id: string;
		prompt: string;
		expectation: EvalTurn["expectation"];
		context?: Partial<ChatPlannerContext>;
	}> = [
		{
			id: "finishing-tiktok-1",
			prompt: "Finish this for TikTok",
			expectation: {
				kind: "plan",
				command: {
					commandKinds: [
						"set-publish-destination",
						"set-version-pack",
						"apply-polish-profile",
						"apply-caption-reveal",
						"replace-music-track",
						"insert-sfx-preset",
						"run-export-preflight-fixes",
					],
				},
			},
		},
		{
			id: "finishing-tiktok-2",
			prompt: "finish this for tiktok",
			expectation: {
				kind: "plan",
				command: {
					commandKinds: [
						"set-publish-destination",
						"set-version-pack",
						"apply-polish-profile",
						"apply-caption-reveal",
						"replace-music-track",
						"insert-sfx-preset",
						"run-export-preflight-fixes",
					],
				},
			},
		},
		{
			id: "finishing-shorts-1",
			prompt: "Polish this for Shorts",
			expectation: {
				kind: "plan",
				command: {
					commandKinds: [
						"set-publish-destination",
						"set-version-pack",
						"apply-polish-profile",
						"apply-caption-reveal",
						"replace-music-track",
						"insert-sfx-preset",
						"run-export-preflight-fixes",
					],
				},
			},
		},
		{
			id: "finishing-shorts-2",
			prompt: "polish this for shorts",
			expectation: {
				kind: "plan",
				command: {
					commandKinds: [
						"set-publish-destination",
						"set-version-pack",
						"apply-polish-profile",
						"apply-caption-reveal",
						"replace-music-track",
						"insert-sfx-preset",
						"run-export-preflight-fixes",
					],
				},
			},
		},
		{
			id: "finishing-music-sfx-1",
			prompt: "Add clean music and subtle SFX",
			expectation: {
				kind: "plan",
				command: {
					commandKinds: ["replace-music-track", "insert-sfx-preset"],
				},
			},
		},
		{
			id: "finishing-music-sfx-2",
			prompt: "add clean music and subtle sfx",
			expectation: {
				kind: "plan",
				command: {
					commandKinds: ["replace-music-track", "insert-sfx-preset"],
				},
			},
		},
		{
			id: "finishing-track-1",
			prompt: "Use a more energetic track",
			expectation: {
				kind: "plan",
				command: {
					commandKinds: ["replace-music-track"],
				},
			},
		},
		{
			id: "finishing-track-2",
			prompt: "use a more energetic track",
			expectation: {
				kind: "plan",
				command: {
					commandKinds: ["replace-music-track"],
				},
			},
		},
		{
			id: "finishing-captions-1",
			prompt: "Make the captions pop more",
			expectation: {
				kind: "plan",
				command: {
					commandKinds: ["apply-caption-reveal"],
				},
			},
		},
		{
			id: "finishing-captions-2",
			prompt: "make the captions pop more",
			expectation: {
				kind: "plan",
				command: {
					commandKinds: ["apply-caption-reveal"],
				},
			},
		},
		{
			id: "finishing-destination-1",
			prompt: "Set this up for Reels",
			expectation: {
				kind: "plan",
				command: {
					commandKinds: ["set-publish-destination"],
				},
			},
		},
		{
			id: "finishing-destination-2",
			prompt: "set this up for reels",
			expectation: {
				kind: "plan",
				command: {
					commandKinds: ["set-publish-destination"],
				},
			},
		},
	];

	if (prompts.length !== 12) {
		throw new Error(`Finishing eval suite must contain 12 prompts. Found ${prompts.length}.`);
	}

	return prompts.map((prompt) => ({
		id: prompt.id,
		suite: "finishing" as const,
		fixtureId: "creator-studio",
		turns: [
			{
				id: prompt.id,
				prompt: prompt.prompt,
				context: prompt.context,
				expectation: prompt.expectation,
			},
		],
	}));
}

function buildReferenceVideoScenarios(): EvalScenario[] {
	const scenarios: EvalScenario[] = [
		{
			id: "reference-finish-single",
			suite: "reference-video",
			fixtureId: "creator-studio",
			turns: [
				{
					id: "turn-1",
					prompt: "Finish this like the reference",
					expectation: {
						kind: "plan",
						command: {
							commandKinds: ["apply-reference-finish-pass"],
						},
					},
				},
			],
		},
		{
			id: "reference-captions-single",
			suite: "reference-video",
			fixtureId: "creator-studio",
			turns: [
				{
					id: "turn-1",
					prompt: "Match the captions from the example",
					expectation: {
						kind: "plan",
						command: {
							commandKinds: ["match-reference-captions"],
						},
					},
				},
			],
		},
		{
			id: "reference-audio-single",
			suite: "reference-video",
			fixtureId: "creator-studio",
			turns: [
				{
					id: "turn-1",
					prompt: "Match the audio profile from the example",
					expectation: {
						kind: "plan",
						command: {
							commandKinds: ["match-reference-audio-profile"],
						},
					},
				},
			],
		},
		{
			id: "reference-pacing-single",
			suite: "reference-video",
			fixtureId: "creator-studio",
			turns: [
				{
					id: "turn-1",
					prompt: "Match the pacing from the example",
					expectation: {
						kind: "plan",
						command: {
							commandKinds: ["match-reference-pacing"],
						},
					},
				},
			],
		},
		{
			id: "reference-followup-flow",
			suite: "reference-video",
			fixtureId: "creator-studio",
			turns: [
				{
					id: "turn-1",
					prompt: "Finish this like the reference",
					expectation: {
						kind: "plan",
						command: {
							commandKinds: ["apply-reference-finish-pass"],
						},
					},
				},
				{
					id: "turn-2",
					prompt: "make it even closer to the reference",
					expectation: {
						kind: "plan",
						command: {
							commandKinds: ["apply-reference-finish-pass"],
						},
					},
				},
				{
					id: "turn-3",
					prompt: "only match the captions",
					expectation: {
						kind: "plan",
						command: {
							commandKinds: ["match-reference-captions"],
						},
					},
				},
				{
					id: "turn-4",
					prompt: "match the packaging from the example",
					expectation: {
						kind: "plan",
						command: {
							commandKinds: ["match-reference-packaging"],
						},
					},
				},
			],
		},
	];

	const totalTurns = scenarios.reduce((sum, scenario) => sum + scenario.turns.length, 0);
	if (totalTurns !== 8) {
		throw new Error(`Reference-video eval suite must contain 8 prompts. Found ${totalTurns}.`);
	}
	return scenarios;
}

function createFrozenProject(): TProject {
	const project = {
		metadata: {
			id: "eval-project-1",
			name: "ClipForge Eval Studio",
			duration: 12,
			createdAt: new Date("2026-03-10T10:00:00.000Z"),
			updatedAt: new Date("2026-03-10T10:00:00.000Z"),
		},
		scenes: [
			{
				id: "scene-main",
				name: "Main",
				isMain: true,
				bookmarks: [],
				createdAt: new Date("2026-03-10T10:00:00.000Z"),
				updatedAt: new Date("2026-03-10T10:00:00.000Z"),
				tracks: [
					createVideoTrack(),
					createCaptionTrack(),
					createOverlayTrack(),
					createAudioTrack(),
				],
			},
			{
				id: "scene-b",
				name: "Outro",
				isMain: false,
				bookmarks: [],
				createdAt: new Date("2026-03-10T10:00:00.000Z"),
				updatedAt: new Date("2026-03-10T10:00:00.000Z"),
				tracks: [],
			},
		],
		currentSceneId: "scene-main",
		settings: {
			fps: 30,
			canvasSize: { width: 1080, height: 1920 },
			background: { type: "color" as const, color: "#0B0F1A" },
			audio: {
				masterVolume: 1,
				duckingEnabled: true,
				duckingAmount: 0.45,
				duckingAttackMs: 120,
				duckingReleaseMs: 280,
				audioPolishPresetId: "none",
				softLimiterEnabled: false,
			},
			overlayDefaults: {
				variantId: "clean-vlog",
				motionPresetId: "fade-up",
			},
			versionPack: {
				targets: [
					{
						id: "9:16",
						enabled: true,
						canvasSize: { width: 1080, height: 1920 },
					},
					{
						id: "1:1",
						enabled: true,
						canvasSize: { width: 1080, height: 1080 },
					},
					{
						id: "16:9",
						enabled: true,
						canvasSize: { width: 1920, height: 1080 },
					},
				],
				activeTargetId: "9:16",
			},
			libraryDefaults: {
				captionStyleId: "clean-bottom",
				titlePresetId: "hero-title",
				musicMood: "clean",
			},
		},
		version: 13,
		clipforge: {
			...buildDefaultClipForgeProjectData(),
			activeCaptionStyleId: "clean-bottom",
			activeReferenceVideoAssetId: "ref-style-1",
			mediaMetadataById: {
				"clip-1": createTranscriptMetadata({
					words: [
						{ text: "hey", start_ms: 0, end_ms: 200 },
						{ text: "bro", start_ms: 200, end_ms: 420 },
						{ text: "welcome", start_ms: 420, end_ms: 780 },
					],
				}),
				"clip-2": createTranscriptMetadata({
					words: [
						{ text: "summer", start_ms: 0, end_ms: 280 },
						{ text: "vibes", start_ms: 280, end_ms: 540 },
						{ text: "here", start_ms: 540, end_ms: 760 },
					],
				}),
				"clip-3": createTranscriptMetadata({
					words: [
						{ text: "third", start_ms: 0, end_ms: 240 },
						{ text: "shot", start_ms: 240, end_ms: 480 },
					],
				}),
				"clip-4": createTranscriptMetadata({
					words: [
						{ text: "final", start_ms: 0, end_ms: 250 },
						{ text: "cut", start_ms: 250, end_ms: 500 },
					],
				}),
				"ref-style-1": createTranscriptMetadata({
					words: [
						{ text: "watch", start_ms: 0, end_ms: 240 },
						{ text: "this", start_ms: 240, end_ms: 420 },
						{ text: "right", start_ms: 420, end_ms: 620 },
						{ text: "now", start_ms: 620, end_ms: 820 },
					],
				}),
			},
			referenceAnalysisByAssetId: {
				"ref-style-1": createReferenceVideoAnalysisFixture(),
			},
		},
	} satisfies TProject;

	return project;
}

function createTranscriptMetadata({
	words,
}: {
	words: Array<{ text: string; start_ms: number; end_ms: number }>;
}) {
	return {
		words,
		segments: [],
		silenceRegions: [],
		transcriptionStatus: "ready" as const,
		transcriptionProvider: "browser-whisper" as const,
		transcriptionLanguage: "en",
		transcriptionError: null,
		indexedAt: "2026-03-10T10:00:00.000Z",
	};
}

function createVideoTrack(): TimelineTrack {
	const makeVideo = ({
		id,
		name,
		mediaId,
		startTime,
		duration,
	}: {
		id: string;
		name: string;
		mediaId: string;
		startTime: number;
		duration: number;
	}): VideoElement => ({
		id,
		name,
		type: "video",
		mediaId,
		startTime,
		duration,
		trimStart: 0,
		trimEnd: 0,
		transform: {
			scale: 1,
			position: { x: 0, y: 0 },
			rotate: 0,
		},
		opacity: 1,
		effects: [],
		adjustments: null,
		keyframes: null,
		transitionIn: null,
		playbackRate: 1,
	});

	return {
		id: "track-video",
		name: "Main Video",
		type: "video",
		isMain: true,
		muted: false,
		hidden: false,
		elements: [
			makeVideo({ id: "clip-a", name: "Opener", mediaId: "clip-1", startTime: 1, duration: 2 }),
			makeVideo({ id: "clip-b", name: "Body", mediaId: "clip-2", startTime: 3, duration: 3 }),
			makeVideo({ id: "clip-c", name: "Third", mediaId: "clip-3", startTime: 6, duration: 2.5 }),
			makeVideo({ id: "clip-d", name: "Closer", mediaId: "clip-4", startTime: 8.5, duration: 2.5 }),
		],
	};
}

function createCaptionTrack(): TimelineTrack {
	const makeCaption = ({
		id,
		content,
		startTime,
		duration,
	}: {
		id: string;
		content: string;
		startTime: number;
		duration: number;
	}): TextElement => ({
		id,
		name: id,
		type: "text",
		role: "caption",
		content,
		startTime,
		duration,
		trimStart: 0,
		trimEnd: 0,
		fontSize: 56,
		fontFamily: "DM Sans",
		color: "#FFFFFF",
		background: {
			color: "transparent",
		},
		textAlign: "center",
		fontWeight: "normal",
		fontStyle: "normal",
		textDecoration: "none",
		transform: {
			scale: 1,
			position: { x: 0, y: 0 },
			rotate: 0,
		},
		opacity: 1,
		captionTiming: null,
		keyframes: null,
		overlayMeta: null,
	});

	return {
		id: "track-captions",
		name: "Captions",
		type: "text",
		hidden: false,
		elements: [
			makeCaption({
				id: "caption-1",
				content: "teh hook demo",
				startTime: 1.2,
				duration: 0.8,
			}),
			makeCaption({
				id: "caption-2",
				content: "demo again",
				startTime: 3.4,
				duration: 0.8,
			}),
		],
	};
}

function createOverlayTrack(): TimelineTrack {
	const makeOverlay = ({
		id,
		content,
		startTime,
		duration,
		variantId,
	}: {
		id: string;
		content: string;
		startTime: number;
		duration: number;
		variantId: TextElement["overlayMeta"] extends infer Meta
			? Meta extends { variantId: infer Variant }
				? Variant
				: never
			: never;
	}): TextElement => ({
		id,
		name: id,
		type: "text",
		role: "text",
		content,
		startTime,
		duration,
		trimStart: 0,
		trimEnd: 0,
		fontSize: 48,
		fontFamily: "DM Sans",
		color: "#FFFFFF",
		background: {
			color: "rgba(0,0,0,0.65)",
			cornerRadius: 16,
			paddingX: 18,
			paddingY: 10,
		},
		textAlign: "center",
		fontWeight: "bold",
		fontStyle: "normal",
		textDecoration: "none",
		transform: {
			scale: 1,
			position: { x: 0, y: 0 },
			rotate: 0,
		},
		opacity: 1,
		keyframes: null,
		overlayMeta: {
			kind: "quote-card-social",
			variantId,
			slot: "primary",
		},
	});

	return {
		id: "track-overlays",
		name: "Overlays",
		type: "text",
		hidden: false,
		elements: [
			makeOverlay({
				id: "overlay-1",
				content: "watch this",
				startTime: 6.5,
				duration: 2.5,
				variantId: "clean-vlog",
			}),
			makeOverlay({
				id: "overlay-2",
				content: "second overlay",
				startTime: 9.1,
				duration: 2.1,
				variantId: "clean-vlog",
			}),
		],
	};
}

function createAudioTrack(): TimelineTrack {
	const makeAudio = ({
		id,
		name,
		mediaId,
		role,
		startTime,
		duration,
	}: {
		id: string;
		name: string;
		mediaId: string;
		role: AudioElement["role"];
		startTime: number;
		duration: number;
	}): AudioElement => ({
		id,
		name,
		type: "audio",
		sourceType: "upload",
		mediaId,
		role,
		startTime,
		duration,
		trimStart: 0,
		trimEnd: 0,
		volume: 1,
	});

	return {
		id: "track-audio",
		name: "Audio",
		type: "audio",
		muted: false,
		volume: 1,
		elements: [
			makeAudio({
				id: "music-bed",
				name: "Music",
				mediaId: "music-bed",
				role: "music",
				startTime: 0,
				duration: 12,
			}),
			makeAudio({
				id: "voiceover-1",
				name: "Voiceover",
				mediaId: "voiceover-1",
				role: "voiceover",
				startTime: 1,
				duration: 2,
			}),
		],
	};
}

function createFrozenMediaAssets(): MediaAsset[] {
	const make = ({
		id,
		name,
		type,
		duration,
	}: {
		id: string;
		name: string;
		type: MediaAsset["type"];
		duration: number;
	}): MediaAsset => ({
		id,
		name,
		type,
		duration,
		file: new File([type], `${name}.${type === "image" ? "png" : "mp4"}`, {
			type: type === "image" ? "image/png" : type === "audio" ? "audio/mpeg" : "video/mp4",
		}),
	});

	return [
		make({ id: "clip-1", name: "opener", type: "video", duration: 2 }),
		make({ id: "clip-2", name: "body", type: "video", duration: 3 }),
		make({ id: "clip-3", name: "third", type: "video", duration: 2.5 }),
		make({ id: "clip-4", name: "closer", type: "video", duration: 2.5 }),
		{
			...make({ id: "ref-style-1", name: "reference-style", type: "video", duration: 6 }),
			width: 1080,
			height: 1920,
			beatAnalysis: {
				bpm: 126,
				downbeats: [0, 1.9, 3.8],
				beats: [0, 0.48, 0.96, 1.44, 1.9, 2.38, 2.86, 3.34],
				analyzedAt: "2026-03-10T10:00:00.000Z",
				version: 1,
			},
			visualAnalysis: {
				sceneCuts: [0.7, 1.5, 2.3, 3.1, 4.2, 5.1],
				activityWindows: [
					{ startTime: 0, endTime: 1.4, score: 0.82 },
					{ startTime: 1.4, endTime: 3.2, score: 0.76 },
					{ startTime: 3.2, endTime: 6, score: 0.68 },
				],
				analyzedAt: "2026-03-10T10:00:00.000Z",
				version: 1,
			},
		},
		make({ id: "beach-1", name: "beach", type: "video", duration: 4 }),
		make({ id: "city-1", name: "city", type: "image", duration: 4 }),
		make({ id: "music-bed", name: "music-bed", type: "audio", duration: 12 }),
		make({ id: "voiceover-1", name: "voiceover-1", type: "audio", duration: 2 }),
	];
}

function createReferenceVideoAnalysisFixture() {
	return buildReferenceVideoAnalysis({
		asset: {
			id: "ref-style-1",
			name: "reference-style",
			type: "video",
			duration: 6,
			width: 1080,
			height: 1920,
			file: new File(["video"], "reference-style.mp4", { type: "video/mp4" }),
			beatAnalysis: {
				bpm: 126,
				downbeats: [0, 1.9, 3.8],
				beats: [0, 0.48, 0.96, 1.44, 1.9, 2.38, 2.86, 3.34],
				analyzedAt: "2026-03-10T10:00:00.000Z",
				version: 1,
			},
			visualAnalysis: {
				sceneCuts: [0.7, 1.5, 2.3, 3.1, 4.2, 5.1],
				activityWindows: [
					{ startTime: 0, endTime: 1.4, score: 0.82 },
					{ startTime: 1.4, endTime: 3.2, score: 0.76 },
					{ startTime: 3.2, endTime: 6, score: 0.68 },
				],
				analyzedAt: "2026-03-10T10:00:00.000Z",
				version: 1,
			},
		},
		metadata: createTranscriptMetadata({
			words: [
				{ text: "watch", start_ms: 0, end_ms: 240 },
				{ text: "this", start_ms: 240, end_ms: 420 },
				{ text: "right", start_ms: 420, end_ms: 620 },
				{ text: "now", start_ms: 620, end_ms: 820 },
			],
		}),
	});
}

function createProjectKitTemplates(): ProjectKitTemplate[] {
	return [
		{
			id: "kit-clean",
			name: "Clean Vlog Kit",
			kind: "project-kit",
			version: 1,
			createdAt: new Date("2026-03-10T10:00:00.000Z"),
			updatedAt: new Date("2026-03-10T10:00:00.000Z"),
			payload: {},
		},
		{
			id: "kit-luxury",
			name: "Luxury Creator Kit",
			kind: "project-kit",
			version: 1,
			createdAt: new Date("2026-03-10T10:00:00.000Z"),
			updatedAt: new Date("2026-03-10T10:00:00.000Z"),
			payload: {},
		},
	];
}

function createSceneRecipeTemplates(): SceneRecipeTemplate[] {
	return [
		{
			id: "recipe-hook",
			name: "Hook Scene",
			kind: "scene-recipe",
			version: 1,
			createdAt: new Date("2026-03-10T10:00:00.000Z"),
			updatedAt: new Date("2026-03-10T10:00:00.000Z"),
			payload: {
				elements: [],
				duration: 4,
				defaults: {},
			},
		},
	];
}
