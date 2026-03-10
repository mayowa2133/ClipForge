import {
	buildDefaultProjectVersionPack,
	detectVersionTargetFromCanvasSize,
	getCanvasSizeForVersionTarget,
} from "@/constants/project-constants";
import { FONT_SIZE_SCALE_REFERENCE } from "@/constants/text-constants";
import type {
	ProjectVersionPack,
	ProjectVersionTarget,
	TCanvasSize,
	TProject,
} from "@/types/project";
import type {
	ImageElement,
	StickerElement,
	TextElement,
	TimelineElement,
	TimelineTrack,
	VideoElement,
	VisualVersionOverride,
} from "@/types/timeline";

export interface VersionLayoutWarning {
	code:
		| "version-safe-area-warning"
		| "version-text-overflow-warning"
		| "version-hidden-warning";
	message: string;
	trackId?: string | null;
	segmentId?: string | null;
	targetVersionId: ProjectVersionTarget;
}

type VersionAdaptableElement = VideoElement | ImageElement | TextElement | StickerElement;

const TARGET_SAFE_MARGIN_RATIO: Record<"tight" | "standard", number> = {
	tight: 0.04,
	standard: 0.08,
};

export function resolveProjectVersionPack({
	project,
}: {
	project: TProject;
}): ProjectVersionPack {
	const fallback = buildDefaultProjectVersionPack({
		canvasSize: project.settings.canvasSize,
	});
	const stored = project.settings.versionPack;
	if (!stored) {
		return fallback;
	}

	const currentTargetId = detectVersionTargetFromCanvasSize({
		canvasSize: project.settings.canvasSize,
	});
	const targets = fallback.targets.map((fallbackTarget) => {
		const existing = stored.targets.find((target) => target.id === fallbackTarget.id);
		return {
			id: fallbackTarget.id,
			enabled: existing?.enabled ?? fallbackTarget.enabled,
			canvasSize:
				existing?.canvasSize ??
				(fallbackTarget.id === currentTargetId
					? project.settings.canvasSize
					: getCanvasSizeForVersionTarget({
							baseCanvasSize: project.settings.canvasSize,
							targetId: fallbackTarget.id,
					  })),
		};
	});

	return {
		targets,
		activeTargetId:
			stored.activeTargetId ??
			targets.find((target) => target.enabled)?.id ??
			currentTargetId,
	};
}

export function getEnabledVersionTargets({
	project,
}: {
	project: TProject;
}): ProjectVersionPack["targets"] {
	return resolveProjectVersionPack({ project }).targets.filter(
		(target) => target.enabled,
	);
}

export function getActiveVersionTargetId({
	project,
}: {
	project: TProject;
}): ProjectVersionTarget {
	const versionPack = resolveProjectVersionPack({ project });
	return (
		versionPack.activeTargetId ??
		versionPack.targets.find((target) => target.enabled)?.id ??
		detectVersionTargetFromCanvasSize({ canvasSize: project.settings.canvasSize })
	);
}

export function getVersionCanvasSize({
	project,
	targetVersionId,
}: {
	project: TProject;
	targetVersionId?: ProjectVersionTarget | null;
}): TCanvasSize {
	if (!targetVersionId) {
		return project.settings.canvasSize;
	}
	const versionPack = resolveProjectVersionPack({ project });
	return (
		versionPack.targets.find((target) => target.id === targetVersionId)?.canvasSize ??
		project.settings.canvasSize
	);
}

export function applyVersionOverridesToTracks({
	tracks,
	targetVersionId,
}: {
	tracks: TimelineTrack[];
	targetVersionId?: ProjectVersionTarget | null;
}): TimelineTrack[] {
	if (!targetVersionId) {
		return tracks;
	}
	return tracks.map((track) => ({
		...track,
		elements: track.elements
			.map((element) => applyVersionOverrideToElement({ element, targetVersionId }))
			.filter((element): element is TimelineElement => element !== null),
	})) as TimelineTrack[];
}

export function applyVersionOverrideToElement({
	element,
	targetVersionId,
}: {
	element: TimelineElement;
	targetVersionId: ProjectVersionTarget;
}): TimelineElement | null {
	if (!hasVersionOverrides(element)) {
		return element;
	}
	const override = element.versionOverrides?.[targetVersionId] ?? null;
	if (!override) {
		return element;
	}
	if (override.hidden) {
		return null;
	}
	const transform =
		"transform" in element
			? mergeTransformOverride({
					base: element.transform,
					override: override.transform,
			  })
			: undefined;
	if (element.type === "text") {
		return {
			...element,
			transform: transform ?? element.transform,
			background: override.background ?? element.background,
		};
	}
	if (
		element.type === "video" ||
		element.type === "image" ||
		element.type === "sticker"
	) {
		return {
			...element,
			transform: transform ?? element.transform,
		};
	}
	return element;
}

export function createVersionOverrideForAutoReframe({
	element,
	targetCanvasSize,
	baseCanvasSize,
}: {
	element: VideoElement | ImageElement;
	targetCanvasSize: TCanvasSize;
	baseCanvasSize: TCanvasSize;
}): VisualVersionOverride {
	const widthRatio = targetCanvasSize.width / Math.max(1, baseCanvasSize.width);
	const heightRatio = targetCanvasSize.height / Math.max(1, baseCanvasSize.height);
	return {
		transform: {
			scale: 1,
			position: {
				x: element.transform.position.x * widthRatio,
				y: element.transform.position.y * heightRatio,
			},
			rotate: element.transform.rotate,
		},
	};
}

export function createSafeLayoutOverrides({
	tracks,
	targetCanvasSize,
	targetVersionId,
	safeMarginPreset,
}: {
	tracks: TimelineTrack[];
	targetCanvasSize: TCanvasSize;
	targetVersionId: ProjectVersionTarget;
	safeMarginPreset: "tight" | "standard";
}): Map<string, VisualVersionOverride> {
	const overrides = new Map<string, VisualVersionOverride>();
	const marginRatio = TARGET_SAFE_MARGIN_RATIO[safeMarginPreset] ?? TARGET_SAFE_MARGIN_RATIO.standard;
	const safeRect = {
		left: targetCanvasSize.width * marginRatio,
		right: targetCanvasSize.width * (1 - marginRatio),
		top: targetCanvasSize.height * marginRatio,
		bottom: targetCanvasSize.height * (1 - marginRatio),
	};

	for (const track of tracks) {
		const groups = new Map<string, Array<ImageElement | TextElement | StickerElement>>();
		for (const element of track.elements) {
			if (!isLayoutManagedElement(element)) continue;
			const groupId =
				("linkedGroupId" in element && element.linkedGroupId) ||
				`${track.id}:${element.id}`;
			const group = groups.get(groupId) ?? [];
			group.push(element);
			groups.set(groupId, group);
		}

		for (const elements of groups.values()) {
			const bounds = elements.map((element) =>
				estimateElementBounds({
					element,
					targetCanvasSize,
					targetVersionId,
				}),
			);
			const groupBounds = bounds.reduce(
				(acc, bound) => ({
					left: Math.min(acc.left, bound.left),
					right: Math.max(acc.right, bound.right),
					top: Math.min(acc.top, bound.top),
					bottom: Math.max(acc.bottom, bound.bottom),
				}),
				{
					left: Number.POSITIVE_INFINITY,
					right: Number.NEGATIVE_INFINITY,
					top: Number.POSITIVE_INFINITY,
					bottom: Number.NEGATIVE_INFINITY,
				},
			);
			const groupWidth = Math.max(1, groupBounds.right - groupBounds.left);
			const groupHeight = Math.max(1, groupBounds.bottom - groupBounds.top);
			const scaleFactor = Math.min(
				1,
				(safeRect.right - safeRect.left) / groupWidth,
				(safeRect.bottom - safeRect.top) / groupHeight,
			);
			const groupCenterX = (groupBounds.left + groupBounds.right) / 2;
			const groupCenterY = (groupBounds.top + groupBounds.bottom) / 2;
			const scaledLeft = groupCenterX - (groupWidth * scaleFactor) / 2;
			const scaledRight = groupCenterX + (groupWidth * scaleFactor) / 2;
			const scaledTop = groupCenterY - (groupHeight * scaleFactor) / 2;
			const scaledBottom = groupCenterY + (groupHeight * scaleFactor) / 2;
			const deltaX =
				scaledLeft < safeRect.left
					? safeRect.left - scaledLeft
					: scaledRight > safeRect.right
						? safeRect.right - scaledRight
						: 0;
			const deltaY =
				scaledTop < safeRect.top
					? safeRect.top - scaledTop
					: scaledBottom > safeRect.bottom
						? safeRect.bottom - scaledBottom
						: 0;

			for (const element of elements) {
				const effective = getEffectiveTransform({
					element,
					targetVersionId,
				});
				const absoluteX = targetCanvasSize.width / 2 + effective.position.x;
				const absoluteY = targetCanvasSize.height / 2 + effective.position.y;
				const nextAbsoluteX =
					groupCenterX + (absoluteX - groupCenterX) * scaleFactor + deltaX;
				const nextAbsoluteY =
					groupCenterY + (absoluteY - groupCenterY) * scaleFactor + deltaY;
				const nextBackground =
					element.type === "text" && scaleFactor < 1 && element.background
						? {
								...element.background,
								paddingX: shrinkPadding(element.background.paddingX, scaleFactor),
								paddingY: shrinkPadding(element.background.paddingY, scaleFactor),
						  }
						: undefined;

				overrides.set(element.id, {
					transform: {
						scale: effective.scale * scaleFactor,
						position: {
							x: nextAbsoluteX - targetCanvasSize.width / 2,
							y: nextAbsoluteY - targetCanvasSize.height / 2,
						},
						rotate: effective.rotate,
					},
					...(nextBackground ? { background: nextBackground } : {}),
				});
			}
		}
	}

	return overrides;
}

export function collectVersionLayoutWarnings({
	tracks,
	targetCanvasSize,
	targetVersionId,
	safeMarginPreset,
}: {
	tracks: TimelineTrack[];
	targetCanvasSize: TCanvasSize;
	targetVersionId: ProjectVersionTarget;
	safeMarginPreset: "tight" | "standard";
}): VersionLayoutWarning[] {
	const warnings: VersionLayoutWarning[] = [];
	const marginRatio = TARGET_SAFE_MARGIN_RATIO[safeMarginPreset] ?? TARGET_SAFE_MARGIN_RATIO.standard;
	const safeRect = {
		left: targetCanvasSize.width * marginRatio,
		right: targetCanvasSize.width * (1 - marginRatio),
		top: targetCanvasSize.height * marginRatio,
		bottom: targetCanvasSize.height * (1 - marginRatio),
	};

	for (const track of tracks) {
		for (const element of track.elements) {
			if (!hasVersionOverrides(element)) continue;
			const override = element.versionOverrides?.[targetVersionId] ?? null;
			if (override?.hidden) {
				warnings.push({
					code: "version-hidden-warning",
					message: `${element.name} is hidden in ${targetVersionId}.`,
					trackId: track.id,
					segmentId: element.id,
					targetVersionId,
				});
				continue;
			}
			if (!isLayoutManagedElement(element)) {
				continue;
			}
			const bounds = estimateElementBounds({
				element,
				targetCanvasSize,
				targetVersionId,
			});
			const isOutsideSafeArea =
				bounds.left < safeRect.left ||
				bounds.right > safeRect.right ||
				bounds.top < safeRect.top ||
				bounds.bottom > safeRect.bottom;
			if (isOutsideSafeArea) {
				warnings.push({
					code:
						element.type === "text"
							? "version-text-overflow-warning"
							: "version-safe-area-warning",
					message:
						element.type === "text"
							? `${element.name} may overflow the ${targetVersionId} safe area.`
							: `${element.name} sits outside the ${targetVersionId} safe area.`,
					trackId: track.id,
					segmentId: element.id,
					targetVersionId,
				});
			}
		}
	}

	return warnings;
}

export function mergeTransformOverride({
	base,
	override,
}: {
	base: VersionAdaptableElement["transform"];
	override?: Partial<VersionAdaptableElement["transform"]> | null;
}): VersionAdaptableElement["transform"] {
	if (!override) {
		return base;
	}
	return {
		scale: override.scale ?? base.scale,
		rotate: override.rotate ?? base.rotate,
		position: {
			x: override.position?.x ?? base.position.x,
			y: override.position?.y ?? base.position.y,
		},
	};
}

export function cloneVersionOverrides({
	value,
}: {
	value?: Partial<Record<ProjectVersionTarget, VisualVersionOverride>> | null;
}): Partial<Record<ProjectVersionTarget, VisualVersionOverride>> | null {
	if (!value) {
		return null;
	}
	return Object.fromEntries(
		Object.entries(value).map(([targetId, override]) => [
			targetId,
			{
				hidden: override?.hidden,
				transform: override?.transform
					? {
							scale: override.transform.scale,
							rotate: override.transform.rotate,
							position: override.transform.position
								? {
										x: override.transform.position.x,
										y: override.transform.position.y,
								  }
								: undefined,
					  }
					: undefined,
				background: override?.background
					? {
							...override.background,
					  }
					: override?.background ?? undefined,
			},
		]),
	) as Partial<Record<ProjectVersionTarget, VisualVersionOverride>>;
}

function hasVersionOverrides(
	element: TimelineElement,
): element is VersionAdaptableElement {
	return (
		element.type === "video" ||
		element.type === "image" ||
		element.type === "text" ||
		element.type === "sticker"
	);
}

function isLayoutManagedElement(
	element: TimelineElement,
): element is ImageElement | TextElement | StickerElement {
	return (
		element.type === "text" ||
		element.type === "sticker" ||
		(element.type === "image" && Boolean(element.overlayMeta))
	);
}

function getEffectiveTransform({
	element,
	targetVersionId,
}: {
	element: VersionAdaptableElement;
	targetVersionId: ProjectVersionTarget;
}) {
	return mergeTransformOverride({
		base: element.transform,
		override: element.versionOverrides?.[targetVersionId]?.transform,
	});
}

function estimateElementBounds({
	element,
	targetCanvasSize,
	targetVersionId,
}: {
	element: ImageElement | TextElement | StickerElement;
	targetCanvasSize: TCanvasSize;
	targetVersionId: ProjectVersionTarget;
}) {
	const transform = getEffectiveTransform({ element, targetVersionId });
	const centerX = targetCanvasSize.width / 2 + transform.position.x;
	const centerY = targetCanvasSize.height / 2 + transform.position.y;
	const scale = transform.scale || 1;
	if (element.type === "text") {
		const lines = element.content.split("\n");
		const longestLine = lines.reduce(
			(max, line) => Math.max(max, line.length),
			0,
		);
		const scaledFontSize =
			(element.fontSize * targetCanvasSize.height) / FONT_SIZE_SCALE_REFERENCE;
		const paddingX = element.background.paddingX ?? 0;
		const paddingY = element.background.paddingY ?? 0;
		const width = Math.max(
			scaledFontSize * 0.56 * longestLine * scale + paddingX * 2 * scale,
			scaledFontSize * 1.2,
		);
		const height =
			scaledFontSize *
				(element.lineHeight ?? 1.2) *
				Math.max(1, lines.length) *
				scale +
			paddingY * 2 * scale;
		return {
			left: centerX - width / 2,
			right: centerX + width / 2,
			top: centerY - height / 2,
			bottom: centerY + height / 2,
		};
	}

	const targetMin = Math.min(targetCanvasSize.width, targetCanvasSize.height);
	const baseSize = element.type === "image" ? targetMin * 0.24 : targetMin * 0.18;
	const width = baseSize * scale;
	const height = baseSize * scale;
	return {
		left: centerX - width / 2,
		right: centerX + width / 2,
		top: centerY - height / 2,
		bottom: centerY + height / 2,
	};
}

function shrinkPadding(value: number | undefined, factor: number): number | undefined {
	if (typeof value !== "number") {
		return value;
	}
	return Math.max(0, Math.round(value * factor));
}
