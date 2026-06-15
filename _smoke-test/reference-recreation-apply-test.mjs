/**
 * Reference recreation apply smoke test.
 *
 * Verifies the human-facing ClipForge workflow:
 *   1. Open a fresh editor project
 *   2. Import RAW footage, FINISHED reference, and background music
 *   3. Ask Assistant to match the reference
 *   4. Choose the FINISHED video as the reference
 *   5. Apply the generated plan
 *   6. Read the persisted project and assert the recreation quality gate is full
 */
import { chromium } from "playwright";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));

const APP_URL = "http://localhost:3000";
const RAW_FILE = resolve(__dir, "RAW-footage-h264.mp4");
const REF_FILE = resolve(__dir, "FINISHED-reference-h264.mp4");
const MUSIC_FILE = resolve(__dir, "MUSIC-background.mp3");

let passed = 0;
let failed = 0;

function check(label, condition, got) {
	if (condition) {
		console.log(`  ok  ${label}`);
		passed += 1;
		return;
	}
	console.error(
		`  err ${label}${got !== undefined ? `  (got: ${JSON.stringify(got).slice(0, 220)})` : ""}`,
	);
	failed += 1;
}

async function idbGetAll(page, dbName, storeName) {
	return page.evaluate(
		({ dbName, storeName }) =>
			new Promise((resolveResult, reject) => {
				const req = indexedDB.open(dbName, 1);
				req.onerror = () => reject(req.error?.message ?? "IDB open error");
				req.onsuccess = () => {
					const db = req.result;
					if (!db.objectStoreNames.contains(storeName)) {
						resolveResult([]);
						return;
					}
					const tx = db.transaction([storeName], "readonly");
					const store = tx.objectStore(storeName);
					const all = store.getAll();
					all.onsuccess = () => resolveResult(all.result);
					all.onerror = () => reject(all.error?.message);
				};
			}),
		{ dbName, storeName },
	);
}

async function readProjectIDB(page, projectId) {
	const projects = await idbGetAll(
		page,
		"video-editor-projects",
		"projects",
	).catch(() => []);
	return projects.find((project) => project.id === projectId) ?? null;
}

async function readMediaMetadata(page, projectId) {
	return idbGetAll(
		page,
		`video-editor-media-${projectId}`,
		"media-metadata",
	).catch(() => []);
}

async function dismissOnboarding(page) {
	for (const label of ["Not now", "Start Empty", "Close"]) {
		const button = page.getByRole("button", { name: label }).first();
		if (await button.isVisible({ timeout: 1000 }).catch(() => false)) {
			await button.click();
			await page.waitForTimeout(500);
			return;
		}
	}
}

async function exposeFileInputs(page) {
	await page.evaluate(() => {
		for (const input of document.querySelectorAll('input[type="file"]')) {
			Object.assign(input.style, {
				display: "block",
				height: "30px",
				left: "0",
				opacity: "1",
				position: "fixed",
				top: "0",
				width: "100px",
				zIndex: "99999",
			});
		}
	});
}

async function importFile(page, filePath) {
	await exposeFileInputs(page);
	let inputs = page.locator('input[type="file"]');
	if ((await inputs.count()) === 0) {
		const importButton = page.getByText("Import Clips", { exact: true }).first();
		if (await importButton.isVisible({ timeout: 2000 }).catch(() => false)) {
			await importButton.click();
			await page.waitForTimeout(500);
		}
		await exposeFileInputs(page);
		inputs = page.locator('input[type="file"]');
	}
	check("file input available", (await inputs.count()) > 0);
	await inputs.first().setInputFiles(filePath);
	await page.waitForTimeout(2500);
}

async function submitChat(page, message) {
	const chatSelectors = [
		'textarea[placeholder*="speed" i]',
		'textarea[placeholder*="Try" i]',
		'textarea[placeholder*="edit" i]',
		"textarea",
	];
	let chatArea = null;
	for (const selector of chatSelectors) {
		const candidate = page.locator(selector).first();
		if (await candidate.isVisible({ timeout: 1500 }).catch(() => false)) {
			chatArea = candidate;
			break;
		}
	}
	if (!chatArea) throw new Error("No chat textarea found");
	await chatArea.click();
	await chatArea.fill(message);
	const submitButton = page.getByRole("button", { name: /propose plan/i }).first();
	if (await submitButton.isVisible({ timeout: 3000 }).catch(() => false)) {
		await submitButton.click();
	} else {
		await chatArea.press("Enter");
	}
}

async function waitForPlannerState(page, timeoutMs = 90_000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const state = await page.evaluate(() => {
			const busy = Array.from(document.querySelectorAll("button")).find(
				(button) => button.disabled && button.textContent?.includes("Proposing"),
			);
			if (busy) return null;
			const paragraphs = Array.from(document.querySelectorAll("p"));
			const clarification = paragraphs.find(
				(paragraph) => paragraph.textContent?.trim() === "Need clarification",
			);
			if (clarification) {
				return {
					kind: "clarification",
					text: clarification.closest("div")?.textContent?.trim().slice(0, 700),
				};
			}
			const planImpact = paragraphs.find((paragraph) =>
				paragraph.textContent?.includes("Plan impact"),
			);
			if (planImpact) {
				return {
					kind: "plan",
					text: planImpact.closest("div")?.textContent?.trim().slice(0, 700),
				};
			}
			const errorBox = document.querySelector(
				".border-red-300, [class*='red-50']",
			);
			if (errorBox?.textContent?.trim()) {
				return {
					kind: "error",
					text: errorBox.textContent.trim().slice(0, 700),
				};
			}
			return null;
		});
		if (state) return state;
		await page.waitForTimeout(1500);
	}
	return null;
}

async function chooseReference(page) {
	const clicked = await page.evaluate(() => {
		const buttons = Array.from(document.querySelectorAll("button"));
		const option = buttons.find((button) =>
			/FINISHED-reference|reference-h264|finished/i.test(
				button.textContent ?? "",
			),
		);
		option?.click();
		return option?.textContent?.trim() ?? null;
	});
	return clicked;
}

async function applyPlan(page, timeoutMs = 30_000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		await page.evaluate(() => {
			for (const element of document.querySelectorAll(
				"div[class*='overflow'], div[class*='scroll']",
			)) {
				element.scrollTop = element.scrollHeight;
			}
		});
		const buttons = page.getByRole("button", { exact: true, name: "Apply" });
		const count = await buttons.count();
		for (let index = 0; index < count; index += 1) {
			const candidate = buttons.nth(index);
			if (!(await candidate.isVisible({ timeout: 500 }).catch(() => false))) {
				continue;
			}
			const box = await candidate.boundingBox();
			console.log(`  clicking Apply button ${index + 1}/${count}: ${JSON.stringify(box)}`);
			if (box) {
				const hitTarget = await page.evaluate(
					({ x, y }) => {
						const element = document.elementFromPoint(x, y);
						const button = element?.closest("button");
						return {
							elementTag: element?.tagName,
							elementText: element?.textContent?.trim().slice(0, 120),
							buttonText: button?.textContent?.trim().slice(0, 120),
							buttonDisabled: button?.disabled,
						};
					},
					{ x: box.x + box.width / 2, y: box.y + box.height / 2 },
				);
				console.log(`  hit target: ${JSON.stringify(hitTarget)}`);
				await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
			} else {
				await candidate.click({ timeout: 5000 });
			}
			await page.waitForTimeout(1500);
			if (await candidate.isVisible({ timeout: 500 }).catch(() => false)) {
				await candidate.press("Enter").catch(() => {});
				await page.waitForTimeout(1500);
			}
			if (await candidate.isVisible({ timeout: 500 }).catch(() => false)) {
				await candidate.evaluate((button) => {
					button.dispatchEvent(
						new MouseEvent("click", {
							bubbles: true,
							cancelable: true,
							view: window,
						}),
					);
				});
				await page.waitForTimeout(3000);
			}
			return true;
		}
		await page.waitForTimeout(1000);
	}
	return false;
}

async function readSelectedCommandDetails(page) {
	const opened = await page.evaluate(() => {
		const button = Array.from(document.querySelectorAll("button")).find(
			(candidate) => /show command details/i.test(candidate.textContent ?? ""),
		);
		button?.click();
		return Boolean(button);
	});
	if (!opened) return null;
	await page.waitForTimeout(500);
	return page.evaluate(() => {
		const pre = document.querySelector("pre");
		return pre?.textContent?.trim() ?? null;
	});
}

async function readPostApplyDiagnostics(page) {
	return page.evaluate(() => {
		const buttons = Array.from(document.querySelectorAll("button")).map(
			(button) => ({
				text: button.textContent?.trim().slice(0, 80),
				disabled: button.disabled,
				visible:
					button.getClientRects().length > 0 &&
					getComputedStyle(button).visibility !== "hidden",
			}),
		);
		const toastText = Array.from(
			document.querySelectorAll("[data-sonner-toast], [role='status'], [role='alert']"),
		)
			.map((element) => element.textContent?.trim())
			.filter(Boolean)
			.join(" | ")
			.slice(0, 1000);
		const rightPanelText = Array.from(document.querySelectorAll("aside, section, div"))
			.map((element) => element.textContent?.trim() ?? "")
			.find((text) => text.includes("Selected changes") && text.includes("Apply"));
		return {
			applyButtons: buttons.filter((button) => button.text === "Apply"),
			toastText,
			rightPanelText: rightPanelText?.slice(0, 1000) ?? null,
		};
	});
}

async function waitForAppliedProject(page, projectId, timeoutMs = 150_000) {
	const deadline = Date.now() + timeoutMs;
	let latestProject = null;
	while (Date.now() < deadline) {
		await page.evaluate(() => window.dispatchEvent(new Event("beforeunload")));
		await page.waitForTimeout(2000);
		latestProject = await readProjectIDB(page, projectId);
		const planId = latestProject?.clipforge?.activeReferenceRecreationPlanId;
		const plan = planId
			? latestProject.clipforge?.referenceRecreationPlansById?.[planId]
			: null;
		const scene =
			latestProject?.scenes?.find(
				(candidate) => candidate.id === latestProject.currentSceneId,
			) ?? latestProject?.scenes?.[0];
		const videoCount = (scene?.tracks ?? [])
			.filter((track) => track.type === "video")
			.flatMap((track) => track.elements ?? []).length;
		const audioCount = (scene?.tracks ?? [])
			.filter((track) => track.type === "audio")
			.flatMap((track) => track.elements ?? []).length;
		if (plan && videoCount > 0 && audioCount > 0) {
			return latestProject;
		}
		process.stdout.write(
			`  waiting for applied project... plan=${Boolean(plan)} video=${videoCount} audio=${audioCount}\n`,
		);
	}
	return latestProject;
}

(async () => {
	const browser = await chromium.launch({
		headless: true,
		args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
	});
	const context = await browser.newContext({
		viewport: { width: 1440, height: 950 },
	});
	const page = await context.newPage();
	const pageErrors = [];

	page.on("pageerror", (error) => pageErrors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {
			process.stderr.write(
				`  [browser:error] ${message.text().slice(0, 240)}\n`,
			);
		}
	});

	try {
		console.log("\n-- 1. Open fresh editor --");
		const fakeId = `00000000-0000-0000-0000-${Date.now()}`;
		await page.goto(`${APP_URL}/editor/${fakeId}`, {
			waitUntil: "domcontentloaded",
			timeout: 30_000,
		});
		await page.waitForURL(/\/editor\/[0-9a-f-]{30,}/, { timeout: 20_000 });
		await page.waitForTimeout(2500);
		await dismissOnboarding(page);
		const projectId = page.url().match(/\/editor\/([^/?#]+)/)?.[1];
		console.log(`  project ${projectId}`);
		check("fresh editor project created", Boolean(projectId), page.url());
		if (!projectId) throw new Error("No editor project id.");

		console.log("\n-- 2. Import raw, reference, and music --");
		await importFile(page, RAW_FILE);
		await importFile(page, REF_FILE);
		await importFile(page, MUSIC_FILE);
		const media = await readMediaMetadata(page, projectId);
		console.log(`  media: ${media.map((asset) => asset.name).join(", ")}`);
		check(
			"raw, reference, and music imported",
			media.filter((asset) => asset.type === "video").length >= 2 &&
				media.some((asset) => asset.type === "audio"),
			media.map((asset) => ({ name: asset.name, type: asset.type })),
		);

		console.log("\n-- 3. Ask assistant to match reference --");
		await submitChat(page, "match the reference");
		const firstState = await waitForPlannerState(page);
		console.log(`  first state: ${firstState?.kind} ${firstState?.text ?? ""}`);
		check("assistant asks for reference or creates plan", Boolean(firstState));
		check(
			"assistant did not error",
			firstState?.kind !== "error",
			firstState?.text,
		);

		if (firstState?.kind === "clarification") {
			const chosen = await chooseReference(page);
			console.log(`  chose: ${chosen}`);
			check("finished reference option chosen", Boolean(chosen), firstState.text);
		}

		const planState = await waitForPlannerState(page, 90_000);
		console.log(`  plan state: ${planState?.kind} ${planState?.text ?? ""}`);
		check("assistant produced reference recreation plan", planState?.kind === "plan", planState);

		console.log("\n-- 4. Apply plan --");
		const commandDetails = await readSelectedCommandDetails(page);
		console.log(`  selected command: ${commandDetails?.slice(0, 1200) ?? "(none)"}`);
		const applied = await applyPlan(page);
		check("plan applied from chat", applied);
		await page.screenshot({ path: "/tmp/reference-recreation-after-apply.png" });
		const postApplyDiagnostics = await readPostApplyDiagnostics(page);
		console.log(
			`  post-apply diagnostics: ${JSON.stringify(postApplyDiagnostics, null, 2).slice(0, 1600)}`,
		);

		console.log("\n-- 5. Validate persisted project --");
		const project = await waitForAppliedProject(page, projectId);
		check("project persisted after apply", Boolean(project));
		const planId = project?.clipforge?.activeReferenceRecreationPlanId;
		const plan = planId
			? project.clipforge?.referenceRecreationPlansById?.[planId]
			: null;
		const scene =
			project?.scenes?.find((candidate) => candidate.id === project.currentSceneId) ??
			project?.scenes?.[0];
		const videoElements = (scene?.tracks ?? [])
			.filter((track) => track.type === "video")
			.flatMap((track) => track.elements ?? []);
		const audioElements = (scene?.tracks ?? [])
			.filter((track) => track.type === "audio")
			.flatMap((track) => track.elements ?? []);

		console.log(
			JSON.stringify(
				{
					projectDuration: project?.metadata?.duration,
					qualityGate: plan?.quality_gate,
					sourceIds: plan?.source_asset_ids,
					musicId: plan?.music_asset_id,
					videoElements: videoElements.length,
					audioElements: audioElements.length,
				},
				null,
				2,
			),
		);

		const importedReference = media.find((asset) =>
			/finished-reference|reference-h264/i.test(asset.name ?? ""),
		);
		const importedRaw = media.find((asset) =>
			/raw-footage|raw/i.test(asset.name ?? ""),
		);
		check("active recreation plan persisted", Boolean(plan));
		check(
			"reference asset is not used as source",
			Boolean(
				plan &&
					importedReference &&
					!plan.source_asset_ids.includes(importedReference.id) &&
					!plan.source_ranges.some(
						(range) => range.source_asset_id === importedReference.id,
					),
			),
			{ referenceId: importedReference?.id, sourceIds: plan?.source_asset_ids },
		);
		check(
			"raw asset is used as source",
			Boolean(importedRaw && plan?.source_asset_ids.includes(importedRaw.id)),
			{ rawId: importedRaw?.id, sourceIds: plan?.source_asset_ids },
		);
		check("music selected", Boolean(plan?.music_asset_id), plan?.music_asset_id);
		check(
			"music volume matches reference recreation target",
			audioElements.some(
				(element) => element.role === "music" && element.volume === 0.45,
			),
			audioElements.map((element) => ({
				role: element.role,
				volume: element.volume,
			})),
		);
		check(
			"all reference slots filled",
			Boolean(
				plan &&
					plan.quality_gate.filled_reference_slots ===
						plan.quality_gate.total_reference_slots &&
					plan.quality_gate.total_reference_slots >= 10,
			),
			plan?.quality_gate,
		);
		check(
			"duration delta is export-reviewable",
			(plan?.quality_gate.target_duration_delta_ms ?? Number.POSITIVE_INFINITY) <=
				1000,
			plan?.quality_gate,
		);
		check(
			"quality gate is ready for human review",
			plan?.quality_gate.readiness === "ready-for-review",
			plan?.quality_gate,
		);
		check(
			"timeline has a video clip for each planned range",
			videoElements.length >= (plan?.source_ranges.length ?? Number.POSITIVE_INFINITY),
			{ videoElements: videoElements.length, ranges: plan?.source_ranges.length },
		);
	} catch (error) {
		failed += 1;
		console.error(`\nSmoke failed: ${error.message}`);
		await page.screenshot({ path: "/tmp/reference-recreation-apply-error.png" }).catch(
			() => {},
		);
	} finally {
		await browser.close();
	}

	const relevantErrors = pageErrors.filter(
		(error) => !error.includes("ResizeObserver loop"),
	);
	if (relevantErrors.length > 0) {
		console.log("\nPage errors:");
		for (const error of relevantErrors.slice(0, 5)) {
			console.log(`  ${error.slice(0, 240)}`);
		}
	}

	console.log(`\n${passed} passed / ${failed} failed`);
	process.exit(failed > 0 ? 1 : 0);
})();
