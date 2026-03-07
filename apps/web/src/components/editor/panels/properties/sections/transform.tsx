"use client";

import { useMemo, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
	ArrowExpandIcon,
	Link05Icon,
	RotateClockwiseIcon,
} from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { NumberField } from "@/components/ui/number-field";
import { DEFAULT_TRANSFORM } from "@/constants/timeline-constants";
import { useEditor } from "@/hooks/use-editor";
import {
	getEffectiveVisualStateAtTime,
	getElementLocalTime,
	getKeyframesForProperty,
	hasAnyVisualKeyframes,
	hasPropertyKeyframes,
	type AnimatableVisualProperty,
	type VisualElement,
} from "@/lib/timeline";
import type { ElementType, Transform, VisualKeyframeMap } from "@/types/timeline";
import { clamp } from "@/utils/math";
import { usePropertyDraft } from "../hooks/use-property-draft";
import {
	Section,
	SectionContent,
	SectionField,
	SectionFields,
	SectionHeader,
} from "../section";
import { KeyframeButton, SectionKeyframeNavigation } from "./keyframe-controls";

type TransformElement = Pick<
	VisualElement,
	"id" | "type" | "startTime" | "duration" | "transform" | "opacity" | "keyframes"
> & {
	transform: Transform;
	type: ElementType;
};

const KEYFRAME_EPSILON = 1 / 1000;
const TRANSFORM_PROPERTIES: AnimatableVisualProperty[] = [
	"positionX",
	"positionY",
	"scale",
	"rotate",
];

function parseFloat_({ input }: { input: string }): number | null {
	const parsed = parseFloat(input);
	return Number.isNaN(parsed) ? null : parsed;
}

function getPropertyTimes({
	keyframes,
	properties,
}: {
	keyframes: VisualKeyframeMap | null | undefined;
	properties: AnimatableVisualProperty[];
}): number[] {
	const times = new Set<number>();
	for (const property of properties) {
		for (const keyframe of keyframes?.[property] ?? []) {
			times.add(keyframe.time);
		}
	}
	return Array.from(times).sort((a, b) => a - b);
}

function hasKeyframeAtTime({
	element,
	property,
	localTime,
}: {
	element: TransformElement;
	property: AnimatableVisualProperty;
	localTime: number;
}): boolean {
	return getKeyframesForProperty({
		element: element as unknown as VisualElement,
		property,
	}).some(
		(keyframe) => Math.abs(keyframe.time - localTime) <= KEYFRAME_EPSILON,
	);
}

export function TransformSection({
	element,
	trackId,
}: {
	element: TransformElement;
	trackId: string;
}) {
	const editor = useEditor();
	const [isScaleLocked, setIsScaleLocked] = useState(false);
	const currentTime = editor.playback.getCurrentTime();
	const currentLocalTime = getElementLocalTime({ element, time: currentTime });
	const effectiveState = getEffectiveVisualStateAtTime({
		element: element as unknown as VisualElement,
		time: currentTime,
	});
	const transform = effectiveState.transform;
	const transformKeyframeTimes = useMemo(
		() => getPropertyTimes({ keyframes: element.keyframes, properties: TRANSFORM_PROPERTIES }),
		[element.keyframes],
	);

	const previewTransform = (updates: Partial<Transform>) => {
		editor.timeline.previewElements({
			updates: [
				{
					trackId,
					elementId: element.id,
					updates: {
						transform: {
							...element.transform,
							...updates,
							position: {
								...element.transform.position,
								...(updates.position ?? {}),
							},
						},
					},
				},
			],
		});
	};

	const commitPreview = () => editor.timeline.commitPreview();

	const seekToKeyframe = ({ direction }: { direction: "previous" | "next" }) => {
		if (transformKeyframeTimes.length === 0) return;
		const target =
			direction === "previous"
				? [...transformKeyframeTimes]
						.reverse()
						.find((time) => time < currentLocalTime - KEYFRAME_EPSILON)
				: transformKeyframeTimes.find((time) => time > currentLocalTime + KEYFRAME_EPSILON);
		if (typeof target !== "number") return;
		editor.playback.seek({ time: element.startTime + target });
	};

	const toggleKeyframe = ({
		property,
		value,
	}: {
		property: AnimatableVisualProperty;
		value: number;
	}) => {
		if (hasKeyframeAtTime({ element, property, localTime: currentLocalTime })) {
			editor.timeline.removeElementKeyframe({
				trackId,
				elementId: element.id,
				property,
				time: currentTime,
			});
			return;
		}
		editor.timeline.setElementKeyframe({
			trackId,
			elementId: element.id,
			property,
			time: currentTime,
			value,
		});
	};

	const updateAnimatedOrStaticProperty = ({
		property,
		value,
		applyStatic,
	}: {
		property: AnimatableVisualProperty;
		value: number;
		applyStatic: () => void;
	}) => {
		if (hasPropertyKeyframes({ element: element as unknown as VisualElement, property })) {
			editor.timeline.setElementKeyframe({
				trackId,
				elementId: element.id,
				property,
				time: currentTime,
				value,
			});
			return;
		}
		applyStatic();
	};

	const buildEndAdornment = ({
		property,
		value,
	}: {
		property: AnimatableVisualProperty;
		value: number;
	}) => (
		<KeyframeButton
			isActive={hasKeyframeAtTime({ element, property, localTime: currentLocalTime })}
			onClick={() => toggleKeyframe({ property, value })}
			label={`Toggle ${property} keyframe`}
		/>
	);

	const positionX = usePropertyDraft({
		displayValue: Math.round(transform.position.x).toString(),
		parse: (input) => parseFloat_({ input }),
		onPreview: (value) =>
			previewTransform({
				position: { ...element.transform.position, x: value },
			}),
		onCommit: commitPreview,
	});

	const positionY = usePropertyDraft({
		displayValue: Math.round(transform.position.y).toString(),
		parse: (input) => parseFloat_({ input }),
		onPreview: (value) =>
			previewTransform({
				position: { ...element.transform.position, y: value },
			}),
		onCommit: commitPreview,
	});

	const scale = usePropertyDraft({
		displayValue: Math.round(transform.scale * 100).toString(),
		parse: (input) => {
			const parsed = parseFloat_({ input });
			if (parsed === null) return null;
			return Math.max(parsed, 1) / 100;
		},
		onPreview: (value) => previewTransform({ scale: value }),
		onCommit: commitPreview,
	});

	const rotation = usePropertyDraft({
		displayValue: Math.round(transform.rotate).toString(),
		parse: (input) => {
			const parsed = parseFloat_({ input });
			if (parsed === null) return null;
			return clamp({ value: parsed, min: -360, max: 360 });
		},
		onPreview: (value) => previewTransform({ rotate: value }),
		onCommit: commitPreview,
	});

	const scaleIsAnimated = hasPropertyKeyframes({
		element: element as unknown as VisualElement,
		property: "scale",
	});
	const positionXAnimated = hasPropertyKeyframes({
		element: element as unknown as VisualElement,
		property: "positionX",
	});
	const positionYAnimated = hasPropertyKeyframes({
		element: element as unknown as VisualElement,
		property: "positionY",
	});
	const rotateAnimated = hasPropertyKeyframes({
		element: element as unknown as VisualElement,
		property: "rotate",
	});

	return (
		<Section collapsible sectionKey={`${element.type}:transform`}>
			<SectionHeader
				title="Transform"
				children={
					<SectionKeyframeNavigation
						hasAnimatedValues={hasAnyVisualKeyframes({
							element: element as unknown as VisualElement,
						})}
						onPrevious={() => seekToKeyframe({ direction: "previous" })}
						onNext={() => seekToKeyframe({ direction: "next" })}
					/>
				}
			/>
			<SectionContent>
				<SectionFields>
					<SectionField label="Scale">
						<div className="flex items-center gap-2">
							{isScaleLocked ? (
								<>
									<NumberField
										icon="W"
										className="flex-1"
										value={scale.displayValue}
										onFocus={scale.onFocus}
										onChange={scale.onChange}
										onBlur={() => {
											const parsed = parseFloat(scale.currentValue);
											scale.onBlur();
											if (Number.isNaN(parsed)) return;
											updateAnimatedOrStaticProperty({
												property: "scale",
												value: Math.max(parsed, 1) / 100,
												applyStatic: () => editor.timeline.updateElements({
													updates: [
														{
															trackId,
															elementId: element.id,
															updates: {
																transform: {
																	...element.transform,
																	scale: Math.max(parsed, 1) / 100,
																},
															},
														},
													],
												}),
											});
										}}
										dragSensitivity="slow"
										onScrub={
											scaleIsAnimated ? undefined : scale.scrubTo
										}
										onScrubEnd={
											scaleIsAnimated ? undefined : scale.commitScrub
										}
										onReset={() =>
											updateAnimatedOrStaticProperty({
												property: "scale",
												value: DEFAULT_TRANSFORM.scale,
												applyStatic: () =>
													editor.timeline.updateElements({
														updates: [
															{
																trackId,
																elementId: element.id,
																updates: {
																	transform: {
																		...element.transform,
																		scale: DEFAULT_TRANSFORM.scale,
																	},
																},
															},
														],
													}),
											})
										}
										isDefault={transform.scale === DEFAULT_TRANSFORM.scale}
										endAdornment={buildEndAdornment({
											property: "scale",
											value: transform.scale,
										})}
									/>
									<NumberField
										icon="H"
										className="flex-1"
										value={scale.displayValue}
										onFocus={scale.onFocus}
										onChange={scale.onChange}
										onBlur={() => {
											const parsed = parseFloat(scale.currentValue);
											scale.onBlur();
											if (Number.isNaN(parsed)) return;
											updateAnimatedOrStaticProperty({
												property: "scale",
												value: Math.max(parsed, 1) / 100,
												applyStatic: () => editor.timeline.updateElements({
													updates: [
														{
															trackId,
															elementId: element.id,
															updates: {
																transform: {
																	...element.transform,
																	scale: Math.max(parsed, 1) / 100,
																},
															},
														},
													],
												}),
											});
										}}
										dragSensitivity="slow"
										onScrub={
											scaleIsAnimated ? undefined : scale.scrubTo
										}
										onScrubEnd={
											scaleIsAnimated ? undefined : scale.commitScrub
										}
										isDefault={transform.scale === DEFAULT_TRANSFORM.scale}
									/>
								</>
							) : (
								<NumberField
									icon={<HugeiconsIcon icon={ArrowExpandIcon} />}
									className="flex-1"
									value={scale.displayValue}
									onFocus={scale.onFocus}
									onChange={scale.onChange}
									onBlur={() => {
										const parsed = parseFloat(scale.currentValue);
										scale.onBlur();
										if (Number.isNaN(parsed)) return;
										updateAnimatedOrStaticProperty({
											property: "scale",
											value: Math.max(parsed, 1) / 100,
											applyStatic: () => editor.timeline.updateElements({
												updates: [
													{
														trackId,
														elementId: element.id,
														updates: {
															transform: {
																...element.transform,
																scale: Math.max(parsed, 1) / 100,
															},
														},
													},
												],
											}),
										});
									}}
									dragSensitivity="slow"
									onScrub={scaleIsAnimated ? undefined : scale.scrubTo}
									onScrubEnd={scaleIsAnimated ? undefined : scale.commitScrub}
									onReset={() =>
										updateAnimatedOrStaticProperty({
											property: "scale",
											value: DEFAULT_TRANSFORM.scale,
											applyStatic: () =>
												editor.timeline.updateElements({
													updates: [
														{
															trackId,
															elementId: element.id,
															updates: {
																transform: {
																	...element.transform,
																	scale: DEFAULT_TRANSFORM.scale,
																},
															},
														},
													],
												}),
										})
									}
									isDefault={transform.scale === DEFAULT_TRANSFORM.scale}
									endAdornment={buildEndAdornment({
										property: "scale",
										value: transform.scale,
									})}
								/>
							)}
							<Button
								variant={isScaleLocked ? "secondary" : "ghost"}
								size="icon"
								aria-pressed={isScaleLocked}
								onClick={() => setIsScaleLocked((isLocked) => !isLocked)}
							>
								<HugeiconsIcon icon={Link05Icon} />
							</Button>
						</div>
					</SectionField>

					<SectionField label="Position">
						<div className="flex items-center gap-2">
							<NumberField
								icon="X"
								className="flex-1"
								value={positionX.displayValue}
								onFocus={positionX.onFocus}
								onChange={positionX.onChange}
								onBlur={() => {
									const parsed = parseFloat(positionX.currentValue);
									positionX.onBlur();
									if (Number.isNaN(parsed)) return;
									updateAnimatedOrStaticProperty({
										property: "positionX",
										value: parsed,
										applyStatic: () =>
											editor.timeline.updateElements({
												updates: [
													{
														trackId,
														elementId: element.id,
														updates: {
															transform: {
																...element.transform,
																position: {
																	...element.transform.position,
																	x: parsed,
																},
															},
														},
													},
												],
											}),
									});
								}}
								onScrub={positionXAnimated ? undefined : positionX.scrubTo}
								onScrubEnd={
									positionXAnimated ? undefined : positionX.commitScrub
								}
								onReset={() =>
									updateAnimatedOrStaticProperty({
										property: "positionX",
										value: DEFAULT_TRANSFORM.position.x,
										applyStatic: () =>
											editor.timeline.updateElements({
												updates: [
													{
														trackId,
														elementId: element.id,
														updates: {
															transform: {
																...element.transform,
																position: {
																	...element.transform.position,
																	x: DEFAULT_TRANSFORM.position.x,
																},
															},
														},
													},
												],
											}),
									})
								}
								isDefault={transform.position.x === DEFAULT_TRANSFORM.position.x}
								endAdornment={buildEndAdornment({
									property: "positionX",
									value: transform.position.x,
								})}
							/>
							<NumberField
								icon="Y"
								className="flex-1"
								value={positionY.displayValue}
								onFocus={positionY.onFocus}
								onChange={positionY.onChange}
								onBlur={() => {
									const parsed = parseFloat(positionY.currentValue);
									positionY.onBlur();
									if (Number.isNaN(parsed)) return;
									updateAnimatedOrStaticProperty({
										property: "positionY",
										value: parsed,
										applyStatic: () =>
											editor.timeline.updateElements({
												updates: [
													{
														trackId,
														elementId: element.id,
														updates: {
															transform: {
																...element.transform,
																position: {
																	...element.transform.position,
																	y: parsed,
																},
															},
														},
													},
												],
											}),
									});
								}}
								onScrub={positionYAnimated ? undefined : positionY.scrubTo}
								onScrubEnd={
									positionYAnimated ? undefined : positionY.commitScrub
								}
								onReset={() =>
									updateAnimatedOrStaticProperty({
										property: "positionY",
										value: DEFAULT_TRANSFORM.position.y,
										applyStatic: () =>
											editor.timeline.updateElements({
												updates: [
													{
														trackId,
														elementId: element.id,
														updates: {
															transform: {
																...element.transform,
																position: {
																	...element.transform.position,
																	y: DEFAULT_TRANSFORM.position.y,
																},
															},
														},
													},
												],
											}),
									})
								}
								isDefault={transform.position.y === DEFAULT_TRANSFORM.position.y}
								endAdornment={buildEndAdornment({
									property: "positionY",
									value: transform.position.y,
								})}
							/>
						</div>
					</SectionField>

					<SectionField label="Rotation">
						<NumberField
							icon={<HugeiconsIcon icon={RotateClockwiseIcon} />}
							className="flex-none"
							value={rotation.displayValue}
							onFocus={rotation.onFocus}
							onChange={rotation.onChange}
							onBlur={() => {
								const parsed = parseFloat(rotation.currentValue);
								rotation.onBlur();
								if (Number.isNaN(parsed)) return;
								const clamped = clamp({ value: parsed, min: -360, max: 360 });
								updateAnimatedOrStaticProperty({
									property: "rotate",
									value: clamped,
									applyStatic: () =>
										editor.timeline.updateElements({
											updates: [
												{
													trackId,
													elementId: element.id,
													updates: {
														transform: {
															...element.transform,
															rotate: clamped,
														},
													},
												},
											],
										}),
								});
							}}
							dragSensitivity="slow"
							onScrub={rotateAnimated ? undefined : rotation.scrubTo}
							onScrubEnd={rotateAnimated ? undefined : rotation.commitScrub}
							onReset={() =>
								updateAnimatedOrStaticProperty({
									property: "rotate",
									value: DEFAULT_TRANSFORM.rotate,
									applyStatic: () =>
										editor.timeline.updateElements({
											updates: [
												{
													trackId,
													elementId: element.id,
													updates: {
														transform: {
															...element.transform,
															rotate: DEFAULT_TRANSFORM.rotate,
														},
													},
												},
											],
										}),
								})
							}
							isDefault={transform.rotate === DEFAULT_TRANSFORM.rotate}
							endAdornment={buildEndAdornment({
								property: "rotate",
								value: transform.rotate,
							})}
						/>
					</SectionField>
				</SectionFields>
			</SectionContent>
		</Section>
	);
}
