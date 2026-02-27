export function toggleClipForgeChatPanel({
	isEnabled,
	toggle,
	close,
}: {
	isEnabled: boolean;
	toggle: () => void;
	close: () => void;
}) {
	if (!isEnabled) {
		close();
		return;
	}

	toggle();
}
