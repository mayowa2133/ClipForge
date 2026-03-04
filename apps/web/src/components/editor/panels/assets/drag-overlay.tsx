import { HugeiconsIcon } from "@hugeicons/react";
import { UploadIcon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";

interface MediaDragOverlayProps {
	isVisible: boolean;
	isProcessing?: boolean;
	progress?: number;
	onClick?: () => void;
	secondaryAction?: {
		label: string;
		onClick: () => void;
		disabled?: boolean;
	};
}

export function MediaDragOverlay({
	isVisible,
	isProcessing = false,
	progress = 0,
	onClick,
	secondaryAction,
}: MediaDragOverlayProps) {
	if (!isVisible) return null;

	const handleClick = ({
		event,
	}: {
		event: React.MouseEvent<HTMLButtonElement>;
	}) => {
		if (isProcessing || !onClick) return;
		event.preventDefault();
		event.stopPropagation();
		onClick();
	};

	return (
		<div className="bg-foreground/5 flex size-full flex-col items-center justify-center gap-4 rounded-lg p-8 text-center">
			<button
				className="hover:bg-foreground/10 flex w-full flex-1 flex-col items-center justify-center gap-4 rounded-lg"
				type="button"
				disabled={isProcessing || !onClick}
				onClick={(event) => handleClick({ event })}
			>
				<div className="flex items-center justify-center">
					<HugeiconsIcon icon={UploadIcon} className="text-foreground size-10" />
				</div>

				<div className="space-y-2">
					<p className="text-muted-foreground max-w-sm text-xs">
						{isProcessing
							? `Processing your files (${progress}%)`
							: "Drag and drop videos, photos, and audio files here"}
					</p>
				</div>

				{isProcessing && (
					<div className="w-full max-w-xs">
						<div className="bg-muted/50 h-2 w-full rounded-full">
							<div
								className="bg-primary h-2 rounded-full"
								style={{ width: `${progress}%` }}
							/>
						</div>
					</div>
				)}
			</button>

			{secondaryAction ? (
				<Button
					type="button"
					variant="outline"
					size="sm"
					onClick={secondaryAction.onClick}
					disabled={isProcessing || secondaryAction.disabled}
				>
					{secondaryAction.label}
				</Button>
			) : null}
		</div>
	);
}
