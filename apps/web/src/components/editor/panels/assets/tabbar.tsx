"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { cn } from "@/utils/ui";
import {
	TAB_KEYS,
	tabs,
	useAssetsPanelStore,
} from "@/stores/assets-panel-store";

export function TabBar() {
	const { activeTab, setActiveTab, showTabLabels, toggleTabLabels } =
		useAssetsPanelStore();
	const [showTopFade, setShowTopFade] = useState(false);
	const [showBottomFade, setShowBottomFade] = useState(false);
	const scrollRef = useRef<HTMLDivElement>(null);

	const checkScrollPosition = useCallback(() => {
		const element = scrollRef.current;
		if (!element) return;

		const { scrollTop, scrollHeight, clientHeight } = element;
		setShowTopFade(scrollTop > 0);
		setShowBottomFade(scrollTop < scrollHeight - clientHeight - 1);
	}, []);

	useEffect(() => {
		const element = scrollRef.current;
		if (!element) return;

		checkScrollPosition();
		element.addEventListener("scroll", checkScrollPosition);

		const resizeObserver = new ResizeObserver(checkScrollPosition);
		resizeObserver.observe(element);

		return () => {
			element.removeEventListener("scroll", checkScrollPosition);
			resizeObserver.disconnect();
		};
	}, [checkScrollPosition]);

	return (
		<div
			className={cn(
				"relative flex flex-col border-r bg-background/70",
				showTabLabels ? "w-40" : "w-14",
			)}
		>
			<div className="flex shrink-0 items-center justify-between border-b px-2 py-2">
				<span
					className={cn(
						"text-muted-foreground text-xs font-medium uppercase tracking-wide",
						!showTabLabels && "sr-only",
					)}
				>
					Tools
				</span>
				<Button
					type="button"
					variant="ghost"
					size="icon"
					className="size-8"
					aria-label={showTabLabels ? "Collapse tool labels" : "Expand tool labels"}
					onClick={toggleTabLabels}
				>
					{showTabLabels ? (
						<PanelLeftClose className="size-4" />
					) : (
						<PanelLeftOpen className="size-4" />
					)}
				</Button>
			</div>
			<div
				ref={scrollRef}
				className={cn(
					"scrollbar-hidden relative flex size-full flex-col justify-start gap-1.5 overflow-y-auto p-2",
					showTabLabels ? "items-stretch" : "items-center",
				)}
			>
				{TAB_KEYS.map((tabKey) => {
					const tab = tabs[tabKey];
					return (
						<Tooltip key={tabKey} delayDuration={10}>
							<TooltipTrigger asChild>
								<Button
									variant={activeTab === tabKey ? "secondary" : "text"}
									aria-label={tab.label}
									className={cn(
										"flex !h-auto !rounded-sm [&_svg]:size-4.5",
										showTabLabels
											? "w-full items-center justify-start gap-2 px-3 py-2"
											: "flex-col !p-1.5",
										activeTab !== tabKey &&
											"border border-transparent text-muted-foreground",
									)}
									onClick={() => setActiveTab(tabKey)}
								>
									<tab.icon />
									{showTabLabels ? (
										<span className="text-sm">{tab.label}</span>
									) : null}
								</Button>
							</TooltipTrigger>
							<TooltipContent
								side="right"
								align="center"
								variant="sidebar"
								sideOffset={8}
							>
								<div className="text-foreground text-sm leading-none font-medium">
									{tab.label}
								</div>
							</TooltipContent>
						</Tooltip>
					);
				})}
			</div>

			<FadeOverlay direction="top" show={showTopFade} />
			<FadeOverlay direction="bottom" show={showBottomFade} />
		</div>
	);
}

function FadeOverlay({
	direction,
	show,
}: {
	direction: "top" | "bottom";
	show: boolean;
}) {
	return (
		<div
			className={cn(
				"pointer-events-none absolute right-0 left-0 h-6",
				direction === "top" && show
					? "from-background top-0 bg-gradient-to-b to-transparent"
					: "from-background bottom-0 bg-gradient-to-t to-transparent",
			)}
		/>
	);
}
