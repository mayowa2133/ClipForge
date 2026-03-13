import {
	assertClipForgeChatEvalThresholds,
	formatClipForgeChatEvalReport,
	runClipForgeChatEvaluationHarness,
} from "../src/lib/clipforge/chat/evaluation-harness";

async function main() {
	const report = await runClipForgeChatEvaluationHarness();
	console.log(
		formatClipForgeChatEvalReport({
			report,
		}),
	);
	assertClipForgeChatEvalThresholds({
		report,
	});
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
});
