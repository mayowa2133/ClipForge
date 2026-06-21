#!/usr/bin/env npx ts-node
/**
 * Repeatable no-reference autonomous edit gate.
 *
 * Generation is raw-only: each fixture passes raw footage, music, and a learned
 * creator profile to autonomous-pipeline.ts. The finished reference is used
 * only after generation by compare-reference.mjs for scoring.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const SMOKE_DIR = resolve(__dirname, "..");
const PROJECT_DIR = resolve(SMOKE_DIR, "..");

interface Fixture {
	id: string;
	rawPath: string;
	musicPath: string;
	referencePath: string;
	referenceTranscriptPath?: string;
	outputPath: string;
	transcriptPath?: string;
	profile: {
		learnedFrom: string;
		targetDurationS: number;
		musicVolume: number;
		musicStartOffsetS: number;
		targetCutDensityPerMinute: number;
		voiceGainDb: number;
		editorialKeepKeywords: string[];
		editorialHookKeywords: string[];
		editorialPayoffKeywords: string[];
		editorialAvoidKeywords: string[];
		maxWordsPerCaption: number;
		minCaptionDisplayMs: number;
	};
}

const defaultProfile: Fixture["profile"] = {
	learnedFrom: "prior-reference-profile",
	targetDurationS: 36.06,
	musicVolume: 0.6,
	musicStartOffsetS: 4,
	targetCutDensityPerMinute: 26.6,
	voiceGainDb: 11,
	editorialKeepKeywords: [
		"sign",
		"prove",
		"wrong",
		"talking",
		"becoming",
		"undeniable",
		"work",
		"speak",
		"results",
		"shock",
		"name",
		"weight",
		"chasing",
		"reach",
		"coming",
		"opportunities",
		"move",
		"take",
		"losing",
		"learning",
		"pushing",
		"forward",
		"waiting",
		"start",
	],
	editorialHookKeywords: ["sign", "here", "right", "now"],
	editorialPayoffKeywords: [
		"losing",
		"learning",
		"pushing",
		"forward",
		"waiting",
		"becoming",
	],
	editorialAvoidKeywords: ["fuck", "fucking", "dream", "outgrow"],
	maxWordsPerCaption: 1,
	minCaptionDisplayMs: 160,
};

const fixtures: Fixture[] = [
	{
		id: "reference-rawonly",
		rawPath: join(SMOKE_DIR, "RAW-footage.MOV"),
		musicPath: join(SMOKE_DIR, "MUSIC-background.mp3"),
		referencePath: join(SMOKE_DIR, "FINISHED-reference.mov"),
		referenceTranscriptPath: join(SMOKE_DIR, ".ref-tmp", "ref_audio.json"),
		outputPath: join(SMOKE_DIR, "OUTPUT-autonomous-rawonly.mp4"),
		transcriptPath: join(SMOKE_DIR, ".whisper-tmp", "audio.json"),
		profile: defaultProfile,
	},
	{
		id: "abundance-rawonly",
		rawPath: join(SMOKE_DIR, "RAW-abundance-h264.mp4"),
		musicPath: join(SMOKE_DIR, "MUSIC-background.mp3"),
		referencePath: join(SMOKE_DIR, "FINISHED-abundance-h264.mp4"),
		referenceTranscriptPath: join(
			SMOKE_DIR,
			".abundance-ref-tmp",
			"audio.json",
		),
		outputPath: join(SMOKE_DIR, "OUTPUT-abundance-autonomous-rawonly.mp4"),
		transcriptPath: join(SMOKE_DIR, ".abundance-whisper-tmp", "audio.json"),
		profile: {
			learnedFrom: "abundance-style-profile",
			targetDurationS: 72.03,
			musicVolume: 0.3,
			musicStartOffsetS: 0,
			targetCutDensityPerMinute: 20,
			voiceGainDb: 11,
			editorialKeepKeywords: [
				"success",
				"talent",
				"knowledge",
				"game",
				"changer",
				"scarcity",
				"abundance",
				"candidates",
				"desperate",
				"options",
				"fear",
				"pressure",
				"calm",
				"confident",
				"opportunity",
				"quality",
				"authenticity",
				"mindset",
				"confidence",
				"growth",
				"pressure",
				"worth",
				"outcome",
			],
			editorialHookKeywords: ["percent", "understand", "success"],
			editorialPayoffKeywords: [
				"confidence",
				"everything",
				"needing",
				"abundance",
				"success",
			],
			editorialAvoidKeywords: ["crap", "um", "uh", "like"],
			maxWordsPerCaption: 1,
			minCaptionDisplayMs: 160,
		},
	},
	{
		id: "transfer-abundance",
		rawPath: join(SMOKE_DIR, "RAW-abundance-h264.mp4"),
		musicPath: join(SMOKE_DIR, "MUSIC-background.mp3"),
		referencePath: join(SMOKE_DIR, "FINISHED-abundance-h264.mp4"),
		referenceTranscriptPath: join(
			SMOKE_DIR,
			".abundance-ref-tmp",
			"audio.json",
		),
		outputPath: join(SMOKE_DIR, "OUTPUT-transfer-abundance.mp4"),
		transcriptPath: join(SMOKE_DIR, ".abundance-whisper-tmp", "audio.json"),
		profile: {
			...defaultProfile,
			// Derived only from the first fixture's learned keep ratio:
			// 255.28s * (36.06s / 127.5s) = 72.20s.
			targetDurationS: 72.2,
		},
	},
];

interface FixtureResult {
	id: string;
	status: "pass" | "fail" | "skipped";
	reason?: string;
	outputPath?: string;
	qualityReportPath?: string;
	comparisonReportPath?: string;
	comparisonVerdict?: string;
	captionTextSimilarity?: number;
	captionTextPass?: boolean;
}

function normalizedTokens(text: string): string[] {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9'\s]/g, " ")
		.split(/\s+/)
		.filter(Boolean);
}

function editDistance(left: string[], right: string[]): number {
	const row = Array.from({ length: right.length + 1 }, (_, index) => index);
	for (let leftIndex = 1; leftIndex <= left.length; leftIndex++) {
		let diagonal = row[0] ?? 0;
		row[0] = leftIndex;
		for (let rightIndex = 1; rightIndex <= right.length; rightIndex++) {
			const prior = row[rightIndex] ?? rightIndex;
			row[rightIndex] = Math.min(
				prior + 1,
				(row[rightIndex - 1] ?? rightIndex - 1) + 1,
				diagonal + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
			);
			diagonal = prior;
		}
	}
	return row[right.length] ?? 0;
}

function compareCaptionText({
	captionPath,
	referenceTranscriptPath,
}: {
	captionPath: string;
	referenceTranscriptPath: string;
}): number {
	const captionEvents = JSON.parse(
		readFileSync(captionPath, "utf-8"),
	) as Array<{
		text?: string;
		word?: string;
	}>;
	const reference = JSON.parse(
		readFileSync(referenceTranscriptPath, "utf-8"),
	) as { segments?: Array<{ text?: string }> };
	const actual = captionEvents.flatMap((event) =>
		normalizedTokens(event.text ?? event.word ?? ""),
	);
	const expected = (reference.segments ?? []).flatMap((segment) =>
		normalizedTokens(segment.text ?? ""),
	);
	if (actual.length === 0 || expected.length === 0) return 0;
	return Math.max(
		0,
		1 -
			editDistance(actual, expected) / Math.max(actual.length, expected.length),
	);
}

function run(command: string, args: string[], env: NodeJS.ProcessEnv = {}) {
	return execFileSync(command, args, {
		cwd: PROJECT_DIR,
		encoding: "utf-8",
		env: { ...process.env, ...env },
		stdio: ["pipe", "pipe", "pipe"],
		maxBuffer: 256 * 1024 * 1024,
		timeout: 900_000,
	});
}

function main() {
	const selectedIds = new Set(
		(
			process.env.CLIPFORGE_FIXTURES ??
			fixtures.map((fixture) => fixture.id).join(",")
		)
			.split(",")
			.map((entry) => entry.trim())
			.filter(Boolean),
	);
	const results: FixtureResult[] = [];

	for (const fixture of fixtures) {
		if (!selectedIds.has(fixture.id)) continue;
		const missing = [
			["raw", fixture.rawPath],
			["music", fixture.musicPath],
			["reference", fixture.referencePath],
		].find(([, filePath]) => !existsSync(filePath));
		if (missing) {
			results.push({
				id: fixture.id,
				status: "skipped",
				reason: `Missing ${missing[0]} file: ${missing[1]}`,
			});
			continue;
		}

		const profilePath = join(SMOKE_DIR, `${fixture.id}-profile.json`);
		writeFileSync(profilePath, JSON.stringify(fixture.profile, null, 2));
		const artifactPrefix = `${fixture.id}-autonomous`;
		const qualityReportPath = join(
			SMOKE_DIR,
			`${artifactPrefix}-quality-report.json`,
		);
		const comparisonReportPath = join(
			SMOKE_DIR,
			`${fixture.id}-comparison.json`,
		);
		const captionPath = join(SMOKE_DIR, `${artifactPrefix}-captions.json`);

		try {
			console.log(`\n=== Evaluating ${fixture.id} ===`);
			if (process.env.CLIPFORGE_SKIP_GENERATION !== "1") {
				run(
					"node_modules/.bin/tsx",
					["_smoke-test/cli/autonomous-pipeline.ts"],
					{
						CLIPFORGE_RAW_PATH: fixture.rawPath,
						CLIPFORGE_MUSIC_PATH: fixture.musicPath,
						CLIPFORGE_OUTPUT_PATH: fixture.outputPath,
						CLIPFORGE_CREATOR_PROFILE_JSON: profilePath,
						CLIPFORGE_ARTIFACT_PREFIX: artifactPrefix,
						...(fixture.transcriptPath && existsSync(fixture.transcriptPath)
							? { CLIPFORGE_RAW_TRANSCRIPT_JSON: fixture.transcriptPath }
							: {}),
					},
				);
			}
			run(
				"node",
				[
					"_smoke-test/compare-reference.mjs",
					fixture.outputPath,
					fixture.referencePath,
				],
				{
					CLIPFORGE_COMPARISON_REPORT: comparisonReportPath,
				},
			);
			const comparison = JSON.parse(
				readFileSync(comparisonReportPath, "utf-8"),
			) as {
				verdict?: string;
			};
			const captionTextSimilarity =
				fixture.referenceTranscriptPath &&
				existsSync(fixture.referenceTranscriptPath) &&
				existsSync(captionPath)
					? compareCaptionText({
							captionPath,
							referenceTranscriptPath: fixture.referenceTranscriptPath,
						})
					: undefined;
			const captionTextPass =
				captionTextSimilarity === undefined
					? undefined
					: captionTextSimilarity >= 0.9;
			results.push({
				id: fixture.id,
				status:
					comparison.verdict === "PASS" && captionTextPass !== false
						? "pass"
						: "fail",
				outputPath: fixture.outputPath,
				qualityReportPath,
				comparisonReportPath,
				comparisonVerdict: comparison.verdict,
				captionTextSimilarity:
					captionTextSimilarity === undefined
						? undefined
						: Math.round(captionTextSimilarity * 10_000) / 10_000,
				captionTextPass,
			});
		} catch (error) {
			results.push({
				id: fixture.id,
				status: "fail",
				reason: error instanceof Error ? error.message : String(error),
				outputPath: fixture.outputPath,
				qualityReportPath,
				comparisonReportPath,
			});
		}
	}

	const reportPath = join(SMOKE_DIR, "autonomous-fixture-evaluation.json");
	writeFileSync(
		reportPath,
		JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2),
	);
	console.log(JSON.stringify({ reportPath, results }, null, 2));

	if (results.some((result) => result.status === "fail")) {
		process.exitCode = 1;
	}
}

main();
