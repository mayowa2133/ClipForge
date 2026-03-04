export function normalizeClause(text: string): string {
	return text.replace(/\s+/g, " ").trim().replace(/^,+|,+$/g, "").trim();
}

export function splitCompoundRequest(text: string): string[] {
	const protectedText = text.replace(
		/\bswap\s+the\s+(first|second|third|1|2|3)\s+and\s+(first|second|third|1|2|3)\s+clips?\b/gi,
		(match) => match.replace(/\sand\s/i, " __CLIPFORGE_AND__ "),
	);

	return protectedText
		.split(/\s+,\s+then\s+|\s+then\s+|\s+and\s+/i)
		.map((clause) =>
			normalizeClause(clause.replace(/ __CLIPFORGE_AND__ /g, " and ")),
		)
		.filter(Boolean)
		.slice(0, 3);
}
