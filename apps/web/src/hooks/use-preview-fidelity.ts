"use client";

import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useSyncExternalStore,
} from "react";
import { EditorCore } from "@/core";
import { buildRenderGraphFingerprint } from "@/services/renderer/preview-fidelity";
import type { PreviewFidelityReport } from "@/services/renderer/types";

export const PREVIEW_FIDELITY_DEBOUNCE_MS = 150;

export function isPreviewFidelityChecking({
	report,
	graphFingerprint,
}: {
	report: PreviewFidelityReport | null;
	graphFingerprint: string | null;
}): boolean {
	if (!graphFingerprint) return false;
	if (!report) return true;
	return report.graphFingerprint !== graphFingerprint;
}

export function usePreviewFidelity(): {
	report: PreviewFidelityReport | null;
	isChecking: boolean;
	refresh: () => void;
} {
	const editor = useMemo(() => EditorCore.getInstance(), []);
	const revisionRef = useRef(0);

	const subscribe = useCallback(
		(onStoreChange: () => void) => {
			const handleStoreChange = () => {
				revisionRef.current += 1;
				onStoreChange();
			};

			const unsubscribers = [
				editor.renderer.subscribe(handleStoreChange),
				editor.renderer.subscribeFidelity(handleStoreChange),
			];

			return () => {
				for (const unsubscribe of unsubscribers) {
					unsubscribe();
				}
			};
		},
		[editor],
	);
	const getSnapshot = useCallback(() => revisionRef.current, []);
	useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

	const renderGraph = editor.renderer.getRenderGraph();
	const graphFingerprint = buildRenderGraphFingerprint({
		graph: renderGraph,
	});
	const report = editor.renderer.getPreviewFidelityReport();

	useEffect(() => {
		if (!graphFingerprint || !renderGraph || renderGraph.duration <= 0) {
			return;
		}

		const timeout = window.setTimeout(() => {
			void editor.renderer.evaluatePreviewFidelity();
		}, PREVIEW_FIDELITY_DEBOUNCE_MS);

		return () => {
			window.clearTimeout(timeout);
		};
	}, [editor, graphFingerprint, renderGraph]);

	const refresh = useCallback(() => {
		void editor.renderer.evaluatePreviewFidelity({ force: true });
	}, [editor]);

	return {
		report,
		isChecking: isPreviewFidelityChecking({
			report,
			graphFingerprint,
		}),
		refresh,
	};
}
