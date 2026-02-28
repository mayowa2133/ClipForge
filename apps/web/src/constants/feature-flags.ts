function readFlag(value: string | undefined): boolean {
	return value === "1" || value === "true";
}

export const ENABLE_CLIPFORGE_AUTO_EDIT = readFlag(
	process.env.NEXT_PUBLIC_ENABLE_CLIPFORGE_AUTO_EDIT ??
		process.env.ENABLE_CLIPFORGE_AUTO_EDIT,
);

export const ENABLE_CLIPFORGE_CHAT = readFlag(
	process.env.NEXT_PUBLIC_ENABLE_CLIPFORGE_CHAT ??
		process.env.ENABLE_CLIPFORGE_CHAT,
);

export const ENABLE_BINARY_PREVIEW_RENDERER = readFlag(
	process.env.NEXT_PUBLIC_ENABLE_BINARY_PREVIEW_RENDERER ??
		process.env.ENABLE_BINARY_PREVIEW_RENDERER,
);
