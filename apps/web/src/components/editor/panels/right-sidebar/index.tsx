"use client";

import { useEffect, useRef } from "react";
import { ChatPanel } from "@/components/editor/panels/chat";
import { PropertiesPanel } from "@/components/editor/panels/properties";
import {
	ResizableHandle,
	ResizablePanel,
	ResizablePanelGroup,
} from "@/components/ui/resizable";
import { ENABLE_CLIPFORGE_CHAT } from "@/constants/feature-flags";
import { useChatPanelStore } from "@/stores/chat-panel-store";
import { usePanelStore } from "@/stores/panel-store";

const MIN_SPLIT_WIDTH_PX = 520;

export function RightSidebarPanel() {
	const { panels, setPanel } = usePanelStore();
	const { isOpen, close } = useChatPanelStore();
	const containerRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!ENABLE_CLIPFORGE_CHAT && isOpen) {
			close();
		}
	}, [close, isOpen]);

	useEffect(() => {
		if (!ENABLE_CLIPFORGE_CHAT || !isOpen) return;

		const container = containerRef.current;
		if (!container) return;

		const observer = new ResizeObserver((entries) => {
			const width = entries[0]?.contentRect.width ?? 0;
			if (width < MIN_SPLIT_WIDTH_PX) {
				close();
			}
		});

		observer.observe(container);
		return () => observer.disconnect();
	}, [close, isOpen]);

	return (
		<div ref={containerRef} className="size-full">
			{ENABLE_CLIPFORGE_CHAT && isOpen ? (
				<ResizablePanelGroup
					direction="horizontal"
					className="size-full gap-[0.18rem]"
					onLayout={(sizes) => {
						setPanel("inspector", sizes[0] ?? panels.inspector);
						setPanel("chat", sizes[1] ?? panels.chat);
					}}
				>
					<ResizablePanel
						defaultSize={panels.inspector}
						minSize={30}
						className="min-w-0"
					>
						<PropertiesPanel />
					</ResizablePanel>

					<ResizableHandle withHandle />

					<ResizablePanel defaultSize={panels.chat} minSize={30} className="min-w-0">
						<ChatPanel />
					</ResizablePanel>
				</ResizablePanelGroup>
			) : (
				<PropertiesPanel />
			)}
		</div>
	);
}
