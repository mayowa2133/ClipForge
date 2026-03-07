import { Button } from "@/components/ui/button";
import { cn } from "@/utils/ui";

export function KeyframeButton({
	isActive,
	disabled = false,
	onClick,
	label,
}: {
	isActive: boolean;
	disabled?: boolean;
	onClick: () => void;
	label: string;
}) {
	return (
		<Button
			variant={isActive ? "secondary" : "ghost"}
			size="icon"
			className={cn("size-6", isActive && "text-primary")}
			onClick={onClick}
			disabled={disabled}
			aria-label={label}
			title={label}
		>
			<span className="text-[10px] leading-none">◆</span>
		</Button>
	);
}

export function SectionKeyframeNavigation({
	hasAnimatedValues,
	onPrevious,
	onNext,
}: {
	hasAnimatedValues: boolean;
	onPrevious: () => void;
	onNext: () => void;
}) {
	return (
		<div className="flex items-center gap-1">
			{hasAnimatedValues ? <span className="bg-primary size-1.5 rounded-full" /> : null}
			<Button
				variant="ghost"
				size="icon"
				className="size-6"
				onClick={onPrevious}
				disabled={!hasAnimatedValues}
				aria-label="Previous keyframe"
				title="Previous keyframe"
			>
				<span className="text-xs leading-none">&lt;</span>
			</Button>
			<Button
				variant="ghost"
				size="icon"
				className="size-6"
				onClick={onNext}
				disabled={!hasAnimatedValues}
				aria-label="Next keyframe"
				title="Next keyframe"
			>
				<span className="text-xs leading-none">&gt;</span>
			</Button>
		</div>
	);
}
