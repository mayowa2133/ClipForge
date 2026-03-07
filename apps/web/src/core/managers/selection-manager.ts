import type { EditorCore } from "@/core";
import { getElementLinkedGroupId } from "@/lib/timeline";

type ElementRef = { trackId: string; elementId: string };

export class SelectionManager {
	private selectedElements: ElementRef[] = [];
	private listeners = new Set<() => void>();
	private editor: EditorCore;

	constructor(editor: EditorCore) {
		this.editor = editor;
	}

	getSelectedElements(): ElementRef[] {
		return this.selectedElements;
	}

	setSelectedElements({
		elements,
		expandLinkedGroups = true,
	}: {
		elements: ElementRef[];
		expandLinkedGroups?: boolean;
	}): void {
		this.selectedElements = expandLinkedGroups
			? this.expandLinkedSelection({ elements })
			: elements;
		this.notify();
	}

	clearSelection(): void {
		this.selectedElements = [];
		this.notify();
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private notify(): void {
		this.listeners.forEach((fn) => fn());
	}

	private expandLinkedSelection({
		elements,
	}: {
		elements: ElementRef[];
	}): ElementRef[] {
		const tracks = this.editor.timeline.getTracks();
		const deduped = new Map<string, ElementRef>();

		for (const ref of elements) {
			const key = `${ref.trackId}:${ref.elementId}`;
			deduped.set(key, ref);

			const track = tracks.find((candidate) => candidate.id === ref.trackId);
			const element = track?.elements.find((candidate) => candidate.id === ref.elementId);
			if (!element) continue;

			const linkedGroupId = getElementLinkedGroupId({ element });
			if (!linkedGroupId) continue;

			for (const candidateTrack of tracks) {
				for (const candidateElement of candidateTrack.elements) {
					if (getElementLinkedGroupId({ element: candidateElement }) !== linkedGroupId) {
						continue;
					}
					deduped.set(`${candidateTrack.id}:${candidateElement.id}`, {
						trackId: candidateTrack.id,
						elementId: candidateElement.id,
					});
				}
			}
		}

		return [...deduped.values()];
	}
}
