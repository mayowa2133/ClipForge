function readFlag(value: string | undefined): boolean {
	return value === "1" || value === "true";
}

function readEnabledByDefaultFlag(value: string | undefined): boolean {
	if (value === undefined) return true;
	return readFlag(value);
}

function readPlannerMode(value: string | undefined): "auto" | "heuristic" | "openai" {
	switch (value) {
		case "heuristic":
		case "openai":
			return value;
		default:
			return "auto";
	}
}

export const ENABLE_CLIPFORGE_AUTO_EDIT = readEnabledByDefaultFlag(
	process.env.NEXT_PUBLIC_ENABLE_CLIPFORGE_AUTO_EDIT ??
		process.env.ENABLE_CLIPFORGE_AUTO_EDIT,
);

export const ENABLE_CLIPFORGE_CHAT = readEnabledByDefaultFlag(
	process.env.NEXT_PUBLIC_ENABLE_CLIPFORGE_CHAT ??
		process.env.ENABLE_CLIPFORGE_CHAT,
);

export const ENABLE_CLIPFORGE_EXPERIENCE =
	ENABLE_CLIPFORGE_AUTO_EDIT || ENABLE_CLIPFORGE_CHAT;

export const ENABLE_BINARY_PREVIEW_RENDERER = readFlag(
	process.env.NEXT_PUBLIC_ENABLE_BINARY_PREVIEW_RENDERER ??
		process.env.ENABLE_BINARY_PREVIEW_RENDERER,
);

export const CLIPFORGE_CHAT_PLANNER_MODE = readPlannerMode(
	process.env.NEXT_PUBLIC_CLIPFORGE_CHAT_PLANNER_MODE,
);

export const CLIPFORGE_MANAGED_TRANSCRIBER_DEFAULT = readFlag(
	process.env.NEXT_PUBLIC_CLIPFORGE_MANAGED_TRANSCRIBER,
);
