/**
 * Caption rendering module.
 *
 * Generates ASS (Advanced SubStation Alpha) subtitle files for word-by-word
 * captions. Integrates with ffmpeg via the subtitles filter or, as a fallback,
 * spawns a Python/Pillow script for frame-by-frame caption burning.
 *
 * This exists because the standard Homebrew ffmpeg build lacks
 * libfreetype/drawtext. ASS subtitles use libass which is a separate library.
 */
import { execSync } from "node:child_process";
import { writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export interface CaptionWord {
	text: string;
	/** Start time in seconds (relative to output timeline) */
	startS: number;
	/** End time in seconds (relative to output timeline) */
	endS: number;
}

export interface CaptionBurnOptions {
	/** Output video width */
	width: number;
	/** Output video height */
	height: number;
	/** Font size for captions (default: 130) */
	fontSize?: number;
	/** Font name (default: "Arial") */
	fontName?: string;
	/** Outline border width (default: 7) */
	borderWidth?: number;
	/** Working directory for temp files */
	workDir: string;
}

/**
 * Check whether the local ffmpeg has the subtitles filter (libass).
 */
export function hasSubtitlesFilter(
	ffmpegBin: string = "ffmpeg",
): boolean {
	try {
		const output = execSync(`${ffmpegBin} -filters 2>/dev/null`, {
			encoding: "utf-8",
		});
		return output.includes("subtitles");
	} catch {
		return false;
	}
}

/**
 * Check whether the local ffmpeg has drawtext filter (libfreetype).
 */
export function hasDrawtextFilter(
	ffmpegBin: string = "ffmpeg",
): boolean {
	try {
		const output = execSync(`${ffmpegBin} -filters 2>/dev/null`, {
			encoding: "utf-8",
		});
		return /\bdrawtext\b/.test(output);
	} catch {
		return false;
	}
}

/**
 * Generate an ASS subtitle file from caption words.
 * Returns the path to the generated ASS file.
 */
export function generateAssFile(
	captions: CaptionWord[],
	options: CaptionBurnOptions,
): string {
	const {
		width,
		height,
		fontSize = 130,
		fontName = "Arial",
		borderWidth = 7,
		workDir,
	} = options;

	const marginV = Math.round(height / 4);

	const header = `[Script Info]
Title: ClipForge Captions
ScriptType: v4.00+
PlayResX: ${width}
PlayResY: ${height}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Word,${fontName},${fontSize},&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,${borderWidth},0,2,10,10,${marginV},1
`;

	const events = captions.map((cap) => {
		const start = formatAssTime(cap.startS);
		const end = formatAssTime(cap.endS);
		const text = cap.text.toUpperCase().replace(/\\/g, "\\\\");
		return `Dialogue: 0,${start},${end},Word,,0,0,0,,${text}`;
	});

	const ass = `${header}
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${events.join("\n")}
`;

	const assPath = join(workDir, "captions.ass");
	writeFileSync(assPath, ass);
	return assPath;
}

/**
 * Build drawtext filter chain for captions.
 * Only works if ffmpeg has libfreetype/drawtext compiled in.
 */
export function buildDrawtextFilterChain(
	captions: CaptionWord[],
	options: {
		fontSize?: number;
		fontName?: string;
		borderWidth?: number;
		fontFile?: string | null;
	} = {},
): string {
	if (captions.length === 0) return "";

	const {
		fontSize = 130,
		fontName = "Arial-Bold",
		borderWidth = 7,
		fontFile = null,
	} = options;

	const filters = captions.map((cap) => {
		const text = escapeDrawtext(cap.text.toUpperCase());
		const parts = [
			`drawtext=text='${text}'`,
			fontFile ? `:fontfile='${fontFile}'` : `:font='${fontName}'`,
			`:fontsize=${fontSize}`,
			":fontcolor=white",
			`:borderw=${borderWidth}`,
			":bordercolor=black",
			":x=(w-text_w)/2",
			":y=h-h/4",
			`:enable='between(t,${cap.startS.toFixed(3)},${cap.endS.toFixed(3)})'`,
		];
		return parts.join("");
	});

	return filters.join(",");
}

/**
 * Burn captions onto a video using Python/Pillow (fallback method).
 * Requires Python 3 with Pillow installed.
 */
export function burnCaptionsWithPillow(
	inputPath: string,
	captionsJson: string,
	outputPath: string,
	options: {
		fontSize?: number;
		borderWidth?: number;
		pythonBin?: string;
	} = {},
): void {
	const { fontSize = 130, borderWidth = 7, pythonBin = "python3" } = options;

	// Check if the burn-captions.py script exists
	const scriptPaths = [
		join(__dirname, "../../../../../scripts/burn-captions.py"),
		join(process.cwd(), "scripts/burn-captions.py"),
		join(process.cwd(), "apps/web/scripts/burn-captions.py"),
		join(process.cwd(), "_smoke-test/cli/burn-captions.py"),
	];

	let scriptPath: string | null = null;
	for (const p of scriptPaths) {
		if (existsSync(p)) {
			scriptPath = p;
			break;
		}
	}

	if (!scriptPath) {
		throw new Error(
			"burn-captions.py not found. Captions cannot be rendered without drawtext or subtitles filter.",
		);
	}

	execSync(
		`${pythonBin} "${scriptPath}" "${inputPath}" "${captionsJson}" "${outputPath}"`,
		{ stdio: "inherit", timeout: 600_000 },
	);
}

// ── Helpers ────────────────────────────────────────────────────

function formatAssTime(seconds: number): string {
	const h = Math.floor(seconds / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	const s = Math.floor(seconds % 60);
	const cs = Math.round((seconds % 1) * 100);

	return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

function escapeDrawtext(text: string): string {
	return text
		.replace(/\\/g, "\\\\")
		.replace(/'/g, "'\\''")
		.replace(/:/g, "\\:")
		.replace(/%/g, "%%")
		.replace(/\[/g, "\\[")
		.replace(/\]/g, "\\]")
		.replace(/;/g, "\\;");
}
