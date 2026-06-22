import { cn } from "@/utils/ui";

interface PanelViewProps extends React.HTMLAttributes<HTMLDivElement> {
	title?: string;
	actions?: React.ReactNode;
	children: React.ReactNode;
	contentClassName?: string;
	hideHeader?: boolean;
	ref?: React.Ref<HTMLDivElement>;
	onScroll?: React.UIEventHandler<HTMLDivElement>;
	scrollRef?: React.Ref<HTMLDivElement>;
}

export function PanelView({
	title,
	actions,
	children,
	className,
	contentClassName,
	hideHeader = false,
	ref,
	onScroll,
	scrollRef,
	...rest
}: PanelViewProps) {
	return (
		<div
			className={cn("relative flex h-full min-w-0 flex-col", className)}
			ref={ref}
			{...rest}
		>
			{!hideHeader && (
				<div className="bg-background flex h-11 min-w-0 shrink-0 items-center justify-between gap-2 border-b px-3 pr-2">
					<span className="text-muted-foreground shrink-0 text-sm">
						{title}
					</span>
					<div className="min-w-0">{actions}</div>
				</div>
			)}
			<div
				className={cn(
					"scrollbar-thin size-full overflow-y-auto",
					hideHeader ? "pt-4" : "pt-2",
				)}
				ref={scrollRef}
				onScroll={onScroll}
			>
				<div className={cn("w-full flex-1 px-2 pt-0", contentClassName)}>
					{children}
				</div>
			</div>
		</div>
	);
}
