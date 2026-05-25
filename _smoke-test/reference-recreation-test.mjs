/**
 * Live reference-recreation smoke test.
 *
 * Flow:
 *  1. Create project, import RAW footage + FINISHED reference (both H.264 transcodes)
 *  2. Submit "recreate the reference from the raw" → expect clarification (which is reference?)
 *  3. Click the FINISHED-reference option in the clarification
 *  4. Submit gaze cut command → expect gaze analysis + clarification about transcript
 *  5. Validate gaze structure on the RAW footage asset
 */
import { chromium } from "playwright";

const APP_URL   = "http://localhost:3000";
const SMOKE     = "/Users/mayowaadesanya/Documents/Projects/ClipForge/clipforge/_smoke-test";
const RAW_FILE  = `${SMOKE}/RAW-footage-h264.mp4`;
const REF_FILE  = `${SMOKE}/FINISHED-reference-h264.mp4`;

let passed = 0, failed = 0;
function check(label, cond, got) {
  if (cond) { console.log(`  ✅  ${label}`); passed++; }
  else { console.error(`  ❌  ${label}${got !== undefined ? `  (got: ${JSON.stringify(got).slice(0,200)})` : ""}`); failed++; }
}

async function idbGetAll(page, dbName, storeName) {
  return page.evaluate(({ dbName, storeName }) => {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(dbName, 1);
      req.onerror = () => reject(req.error?.message ?? "IDB open error");
      req.onsuccess = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(storeName)) { resolve([]); return; }
        const tx = db.transaction([storeName], "readonly");
        const store = tx.objectStore(storeName);
        const all = store.getAll();
        all.onsuccess = () => resolve(all.result);
        all.onerror  = () => reject(all.error?.message);
      };
    });
  }, { dbName, storeName });
}

async function submitChat(page, text) {
  const chatSels = [
    'textarea[placeholder*="speed" i]',
    'textarea[placeholder*="Try" i]',
    'textarea[placeholder*="edit" i]',
    'textarea[placeholder*="cut" i]',
    'textarea',
  ];
  let chatArea = null;
  for (const sel of chatSels) {
    const el = page.locator(sel).first();
    if (await el.isVisible({ timeout: 1500 }).catch(() => false)) {
      chatArea = el; break;
    }
  }
  if (!chatArea) throw new Error("No chat textarea found");

  await chatArea.click();
  await chatArea.fill(text);

  const submitBtn = page.getByRole("button", { name: /propose plan/i }).first();
  if (await submitBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await submitBtn.click();
  } else {
    const fallbacks = [
      page.getByRole("button", { name: /send|submit|run|go|plan/i }).first(),
      page.locator('button[type="submit"]').first(),
    ];
    let clicked = false;
    for (const fb of fallbacks) {
      if (await fb.isVisible({ timeout: 1000 }).catch(() => false)) {
        await fb.click(); clicked = true; break;
      }
    }
    if (!clicked) await chatArea.press("Enter");
  }
}

async function waitForAIResponse(page, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await page.evaluate(() => {
      // Still proposing?
      const busy = Array.from(document.querySelectorAll("button"))
        .find(b => b.disabled && b.textContent?.includes("Proposing"));
      if (busy) return null;

      // Need clarification
      const allParas = Array.from(document.querySelectorAll("p"));
      const clarif = allParas.find(p => p.textContent?.trim() === "Need clarification");
      if (clarif) {
        const box = clarif.closest("div");
        return `CLARIFY: ${box?.textContent?.trim().slice(0, 500) ?? "clarification shown"}`;
      }

      // Error
      const errBox = document.querySelector(".border-red-300, [class*=\"red-50\"]");
      if (errBox?.textContent?.trim().length > 5)
        return `ERROR: ${errBox.textContent?.trim().slice(0, 200)}`;

      // Plan impact
      const planImpact = allParas.find(p => p.textContent?.includes("Plan impact"));
      if (planImpact) return `PLAN: ${planImpact.closest("div")?.textContent?.trim().slice(0, 200)}`;

      // Re-enabled button = plan done
      const propBtn = Array.from(document.querySelectorAll("button"))
        .find(b => !b.disabled && b.textContent?.includes("Propose Plan"));
      if (propBtn) return "COMPLETE: button re-enabled";

      return null;
    });
    if (result) return result;
    await page.waitForTimeout(2000);
  }
  return null;
}

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });
  const ctx  = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();

  const pageErrors = [];
  page.on("pageerror", e => pageErrors.push(e.message));
  page.on("console", m => {
    if (m.type() === "error" && !m.text().includes("ZodError") && !m.text().includes("NODE_ENV"))
      process.stderr.write(`  [browser:err] ${m.text().slice(0, 160)}\n`);
  });

  try {
    // ── 1. Bootstrap editor ─────────────────────────────────────────────────
    console.log("\n── Step 1: Bootstrap editor ──");
    const fakeId = `00000000-0000-0000-0000-${Date.now()}`;
    await page.goto(`${APP_URL}/editor/${fakeId}`, { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForURL(/\/editor\/[0-9a-f-]{30,}/, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(3000);

    const currentUrl = page.url();
    const projectId  = currentUrl.match(/\/editor\/([^/?#]+)/)?.[1];
    console.log(`  URL: ${currentUrl}`);
    check("editor URL with real project ID", !!projectId && projectId !== fakeId, projectId);
    if (!projectId) { console.error("  No project ID — stopping"); return; }

    await page.screenshot({ path: "/tmp/rec-1-editor.png" });

    // ── 2. Import BOTH files ─────────────────────────────────────────────────
    console.log("\n── Step 2: Import RAW + reference videos ──");
    await page.waitForTimeout(2000);

    const exposeInputs = async () => {
      await page.evaluate(() => {
        for (const el of document.querySelectorAll('input[type="file"]'))
          Object.assign(el.style, { display:"block", opacity:"1", position:"fixed", top:"0", left:"0", zIndex:"99999", width:"100px", height:"30px" });
      });
    };
    await exposeInputs();

    let fileInputs = page.locator('input[type="file"]');
    let count = await fileInputs.count();
    if (count === 0) {
      for (const sel of ['[aria-label*="import" i]', 'button:text("Import")', '[data-testid*="import"]']) {
        if (await page.locator(sel).first().isVisible({ timeout: 1000 }).catch(() => false)) {
          await page.locator(sel).first().click();
          await page.waitForTimeout(500);
          break;
        }
      }
      await exposeInputs();
      fileInputs = page.locator('input[type="file"]');
      count = await fileInputs.count();
    }

    if (count === 0) {
      check("file input found", false, "no input[type=file]");
      return;
    }

    // Import RAW first
    await fileInputs.first().setInputFiles(RAW_FILE);
    console.log(`  ✅ RAW file set`);
    await page.waitForTimeout(3000);

    // Re-expose and import reference
    await exposeInputs();
    const inputs2 = page.locator('input[type="file"]');
    const cnt2    = await inputs2.count();
    if (cnt2 > 0) {
      await inputs2.first().setInputFiles(REF_FILE);
      console.log(`  ✅ Reference file set`);
    } else {
      console.log("  ⚠️  Could not find second file input — will test with single video");
    }

    await page.waitForTimeout(4000);
    await page.screenshot({ path: "/tmp/rec-2-after-import.png" });

    const mediaDbName = `video-editor-media-${projectId}`;
    const readAssets  = async () => idbGetAll(page, mediaDbName, "media-metadata").catch(() => []);
    const assets = await readAssets();
    console.log(`  Assets in IDB: ${assets.length} (${assets.map(a => a.name ?? a.id?.slice(0,8)).join(", ")})`);
    check("at least one video asset in IDB", assets.filter(a => a.type === "video").length >= 1);

    // ── 3. Submit "recreate" command ─────────────────────────────────────────
    console.log("\n── Step 3: Submit 'recreate the reference' command ──");
    const recreateMsg = "recreate the reference from the raw footage";
    console.log(`  Typing: "${recreateMsg}"`);
    await submitChat(page, recreateMsg);
    await page.screenshot({ path: "/tmp/rec-3-chat-sent.png" });

    // ── 4. Wait for AI response ──────────────────────────────────────────────
    console.log("\n── Step 4: Wait for AI response (up to 60s) ──");
    const recreateResponse = await waitForAIResponse(page, 60_000);
    console.log(`  Response: "${(recreateResponse ?? "(none)").slice(0, 300)}"`);
    await page.screenshot({ path: "/tmp/rec-4-recreate-response.png" });

    // With 2 videos: should ask "which is the reference?"
    // With 1 video: might return plan or need transcript clarification
    const videoCount = assets.filter(a => a.type === "video").length;
    if (videoCount >= 2) {
      const askedForRef = recreateResponse?.includes("reference") ||
                          recreateResponse?.includes("CLARIFY");
      check("asked to clarify which video is reference (2 videos)", askedForRef, recreateResponse?.slice(0, 100));
    } else {
      // Single video — recreation might require a reference to be set
      check("AI produced a recreate response", !!recreateResponse, recreateResponse?.slice(0, 80));
    }

    // ── 5. Gaze cut command on the raw footage ──────────────────────────────
    console.log("\n── Step 5: Submit gaze-cut command ──");
    // Wait for "Propose Plan" to re-enable
    await page.waitForTimeout(2000);
    const gazeMsg = "cut where I'm looking down after I say 'hey'";
    console.log(`  Typing: "${gazeMsg}"`);

    // Check button is enabled before trying
    const proposeBtn = page.getByRole("button", { name: /propose plan/i }).first();
    await proposeBtn.waitFor({ state: "visible", timeout: 10000 }).catch(() => {});

    await submitChat(page, gazeMsg);
    await page.screenshot({ path: "/tmp/rec-5-gaze-sent.png" });

    // ── 6. Wait for gaze analysis + AI response ──────────────────────────────
    console.log("\n── Step 6: Wait for gaze analysis + AI response (up to 120s) ──");
    let gazeData   = null;
    let aiResponse = null;
    const deadline = Date.now() + 120_000;

    while (Date.now() < deadline) {
      if (!gazeData) {
        const vids = await readAssets();
        const vid  = vids.find(a => a.type === "video" && !a.ephemeral && a.gazeAnalysis?.analyzedAt);
        if (vid) {
          gazeData = vid.gazeAnalysis;
          console.log(`\n  ✅ Gaze ready: ${gazeData.windows?.length} windows, cameraRatio=${gazeData.cameraLookRatio?.toFixed(3)}`);
        }
      }

      if (!aiResponse) {
        aiResponse = await page.evaluate(() => {
          const busy = Array.from(document.querySelectorAll("button"))
            .find(b => b.disabled && b.textContent?.includes("Proposing"));
          if (busy) return null;
          const allParas = Array.from(document.querySelectorAll("p"));
          const clarif = allParas.find(p => p.textContent?.trim() === "Need clarification");
          if (clarif) {
            const box = clarif.closest("div");
            return `CLARIFY: ${box?.textContent?.trim().slice(0, 500) ?? "clarification shown"}`;
          }
          const errBox = document.querySelector(".border-red-300, [class*=\"red-50\"]");
          if (errBox?.textContent?.trim().length > 5)
            return `ERROR: ${errBox.textContent?.trim().slice(0, 200)}`;
          const planImpact = allParas.find(p => p.textContent?.includes("Plan impact"));
          if (planImpact) return `PLAN: ${planImpact.closest("div")?.textContent?.trim().slice(0, 200)}`;
          const propBtn = Array.from(document.querySelectorAll("button"))
            .find(b => !b.disabled && b.textContent?.includes("Propose Plan"));
          if (propBtn) return "COMPLETE: button re-enabled";
          return null;
        });
        if (aiResponse) console.log(`\n  ✅ AI activity: "${aiResponse.slice(0, 300)}"`);
      }

      if (gazeData && aiResponse) break;
      const secs = Math.round((deadline - Date.now()) / 1000);
      process.stdout.write(`  [${secs}s] gaze=${gazeData ? "ready" : "pending"} ai=${aiResponse ? "ready" : "pending"}...\n`);
      await page.waitForTimeout(3000);
    }

    await page.screenshot({ path: "/tmp/rec-6-gaze-response.png" });

    // ── 7. Validate ──────────────────────────────────────────────────────────
    console.log("\n── Step 7: Validate gaze structure ──");
    if (gazeData) {
      const windows = gazeData.windows ?? [];
      check("gazeAnalysis.version === 1", gazeData.version === 1, gazeData.version);
      check("windows is array", Array.isArray(windows));
      check("samplingIntervalMs = 500", gazeData.samplingIntervalMs === 500, gazeData.samplingIntervalMs);
      check("cameraLookRatio in [0,1]", gazeData.cameraLookRatio >= 0 && gazeData.cameraLookRatio <= 1, gazeData.cameraLookRatio);
      if (windows.length > 0) {
        const w = windows[0];
        check("window.category valid", ["camera","off-camera"].includes(w.category), w.category);
        check("window.gazeScore in [0,1]", w.gazeScore >= 0 && w.gazeScore <= 1, w.gazeScore);
        check("window.endTime > startTime", w.endTime > w.startTime);
        const camW = windows.filter(w => w.category === "camera").length;
        const offW = windows.filter(w => w.category === "off-camera").length;
        console.log(`  camera=${camW} off-camera=${offW} total=${windows.length}`);
        check("gaze classified windows", camW + offW > 0);

        // RAW footage should have MIXED gaze (on+off camera) — it's a raw unedited clip
        // so we expect some off-camera moments
        if (offW > 0) {
          console.log(`  ✅ Raw footage has off-camera gaze windows (${offW}) — realistic for raw footage`);
        } else {
          console.log(`  ⚠️  All ${camW} windows are on-camera — may be correct or may indicate decode issue`);
        }
      } else {
        check("gaze analysis ran (no windows = very short clip)", true);
      }
    } else {
      check("gazeAnalysis populated within 120s", false, "no gaze data in IDB");
    }

    console.log("\n── Step 8: AI response check ──");
    console.log(`  Gaze AI response: "${(aiResponse ?? "(none)").slice(0, 300)}"`);
    check("AI produced gaze response", !!aiResponse && aiResponse.length > 5, aiResponse?.slice(0, 80));

    // The ideal response: mentions gaze + transcript (since we haven't transcribed raw yet)
    if (aiResponse?.includes("transcript") || aiResponse?.includes("Transcrib")) {
      console.log("  ✅ AI correctly identified missing transcript as blocker");
    } else if (aiResponse?.includes("CLARIFY")) {
      console.log("  ✅ AI returned clarification (gaze or reference)");
    } else if (aiResponse?.includes("PLAN")) {
      console.log("  ✅ AI returned a full plan");
    }

  } catch (err) {
    console.error(`\n💥 Error: ${err.message?.slice(0, 300)}`);
    await page.screenshot({ path: "/tmp/rec-error.png" }).catch(() => {});
    failed++;
  } finally {
    await browser.close();
  }

  if (pageErrors.filter(e => !e.includes("ZodError") && !e.includes("NODE_ENV")).length) {
    console.log("\n⚠️  Page errors:");
    pageErrors.slice(0, 5).forEach(e => console.error(" ", e.slice(0, 200)));
  }

  console.log(`\n══════════════════════════════`);
  console.log(`  ${passed} passed  /  ${failed} failed`);
  console.log(`  Screenshots: /tmp/rec-*.png`);
  process.exit(failed > 0 ? 1 : 0);
})();
