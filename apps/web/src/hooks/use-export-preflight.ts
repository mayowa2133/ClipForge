import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import { EditorCore } from "@/core";
import type {
	ExportFormat,
	ExportPreflightResult,
	ExportQuality,
} from "@/types/export";

export const EXPORT_PREFLIGHT_DEBOUNCE_MS = 120;

export interface UseExportPreflightInput {
	isOpen: boolean;
	format: ExportFormat;
	quality: ExportQuality;
	includeAudio: boolean;
}

export interface UseExportPreflightResult {
	result: ExportPreflightResult | null;
	isRunning: boolean;
	isFresh: boolean;
	refresh: () => ExportPreflightResult | null;
}

export function isExportPreflightFresh({
	result,
	isRunning,
	lastComputedRevision,
	currentRevision,
}: {
	result: ExportPreflightResult | null;
	isRunning: boolean;
	lastComputedRevision: number | null;
	currentRevision: number;
}): boolean {
	if (!result || isRunning || lastComputedRevision === null) {
		return false;
	}
	return lastComputedRevision === currentRevision;
}

export function hasUnverifiedCompatibilityIssue({
	result,
}: {
	result: ExportPreflightResult | null;
}): boolean {
	if (!result) return false;
	return result.issues.some(
		(issue) => issue.code === "media-compatibility-unverified",
	);
}

export function useExportPreflight({
	isOpen,
	format,
	quality,
	includeAudio,
}: UseExportPreflightInput): UseExportPreflightResult {
	const editor = useMemo(() => EditorCore.getInstance(), []);
	const revisionRef = useRef(0);
	const autoScanInFlightKeyRef = useRef<string | null>(null);
	const autoScanCompletedKeyRef = useRef<string | null>(null);

	const subscribe = useCallback(
		(onStoreChange: () => void) => {
			const handleStoreChange = () => {
				revisionRef.current += 1;
				onStoreChange();
			};

			const unsubscribers = [
				editor.project.subscribe(handleStoreChange),
				editor.timeline.subscribe(handleStoreChange),
				editor.media.subscribe(handleStoreChange),
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
	const revision = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
	const [result, setResult] = useState<ExportPreflightResult | null>(null);
	const [isRunning, setIsRunning] = useState(false);
	const [lastComputedRevision, setLastComputedRevision] = useState<number | null>(
		null,
	);

	const computePreflight = useCallback(
		({
			revisionValue,
		}: {
			revisionValue: number;
		}): ExportPreflightResult => {
			const nextResult = editor.clipforge.runExportPreflight({
				format,
				quality,
				includeAudio,
			});
			setResult(nextResult);
			setLastComputedRevision(revisionValue);
			return nextResult;
		},
		[editor, format, includeAudio, quality],
	);

	const refresh = useCallback((): ExportPreflightResult | null => {
		if (!isOpen) {
			return null;
		}
		setIsRunning(true);
		const nextResult = computePreflight({
			revisionValue: revisionRef.current,
		});
		setIsRunning(false);
		return nextResult;
	}, [computePreflight, isOpen]);

	useEffect(() => {
		if (!isOpen) {
			setResult(null);
			setIsRunning(false);
			setLastComputedRevision(null);
			autoScanInFlightKeyRef.current = null;
			autoScanCompletedKeyRef.current = null;
			return;
		}

		setIsRunning(true);
		const timeout = window.setTimeout(() => {
			computePreflight({
				revisionValue: revision,
			});
			setIsRunning(false);
		}, EXPORT_PREFLIGHT_DEBOUNCE_MS);

		return () => {
			window.clearTimeout(timeout);
		};
	}, [computePreflight, isOpen, revision]);

	useEffect(() => {
		if (!isOpen || !result || !hasUnverifiedCompatibilityIssue({ result })) {
			return;
		}

		const scanKey = `${result.healthFingerprint}|audio=${includeAudio}`;
		if (
			autoScanInFlightKeyRef.current === scanKey ||
			autoScanCompletedKeyRef.current === scanKey
		) {
			return;
		}

		autoScanInFlightKeyRef.current = scanKey;
		setIsRunning(true);
		void editor.clipforge
			.scanReferencedMediaCompatibility({
				includeAudio,
			})
			.then(() => {
				const refreshed = computePreflight({
					revisionValue: revisionRef.current,
				});
				autoScanCompletedKeyRef.current = `${refreshed.healthFingerprint}|audio=${includeAudio}`;
			})
			.catch((error) => {
				console.warn("Failed to auto-scan media compatibility:", error);
				autoScanCompletedKeyRef.current = scanKey;
			})
			.finally(() => {
				autoScanInFlightKeyRef.current = null;
				setIsRunning(false);
			});
	}, [computePreflight, editor, includeAudio, isOpen, result]);

	return {
		result,
		isRunning,
		isFresh: isExportPreflightFresh({
			result,
			isRunning,
			lastComputedRevision,
			currentRevision: revision,
		}),
		refresh,
	};
}
