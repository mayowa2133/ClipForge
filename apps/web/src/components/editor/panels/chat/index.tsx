"use client";

import { PanelView } from "@/components/editor/panels/assets/views/base-view";
import { ChatContent } from "./chat-content";

export function ChatPanel() {
	return (
		<div className="panel bg-background h-full rounded-sm border border-t-0 overflow-hidden">
			<PanelView title="Assistant" contentClassName="px-3">
				<ChatContent />
			</PanelView>
		</div>
	);
}
