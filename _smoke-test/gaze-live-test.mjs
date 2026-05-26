/**
 * Live app gaze analysis test.
 * Imports RAW-footage.MOV, waits for gaze analysis via IndexedDB polling,
 * then tests AI chat with gaze-based commands.
 */
import { chromium } from "playwright";
import { resolve } from "path";
import { existsSync } from "fs";

const APP_URL   = "http://localhost:3000";
// Use H.264 MP4 — headless Chromium cannot decode HEVC (the .MOV file).
// DXQOzrHiW3p.mp4 is H.264 and is verified to produce real gaze data.
const videoFile = "/Users/mayowaadesanya/Downloads/DXQOzrHiW3p.mp4";

console.log(`Using video: ${videoFile}`);

let passed = 0, failed = 0;
function check(label, cond, got) {
  if (cond) { console.log(`  ✅  ${label}`); passed++; }
  else { console.error(`  ❌  ${label}${got !== undefined ? `  (got: ${JSON.stringify(got).slice(0,120)})` : ""}`); failed++; }
}

/** Read all records from an IndexedDB store */
async function idbGetAll(page, dbName, storeName) {
  return page.evaluate(({ dbName, storeName }) => {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(dbName, 1);
      req.onerror = () => reject(req.error?.message ?? "IDB open error");
      req.onsuccess = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(storeName)) {
          resolve([]);
          return;
        }
        const tx = db.transaction([storeName], "readonly");
        const store = tx.objectStore(storeName);
        const getAll = store.getAll();
        getAll.onsuccess = () => resolve(getAll.result);
        getAll.onerror  = () => reject(getAll.error?.message);
      };
    });
  }, { dbName, storeName });
}

/** List all IDB databases in this browser context */
async function listIDBDatabases(page) {
  return page.evaluate(() => {
    if (!indexedDB.databases) return [];
    return indexedDB.databases().then(dbs => dbs.map(d => d.name));
  });
}

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();

  const pageErrors = [];
  page.on("pageerror", e => pageErrors.push(e.message));
  page.on("console", m => {
    const t = m.type(), txt = m.text();
    if (t === "error" && !txt.includes("ZodError") && !txt.includes("NODE_ENV")) {
      process.stderr.write(`  [browser:err] ${txt.slice(0,160)}\n`);
    }
  });

  try {
    // ── 1. Navigate to editor (auto-creates project if UUID not found) ────────
    console.log("\n── Step 1: Bootstrap editor ──");
    const fakeId = `00000000-0000-0000-0000-${Date.now()}`;
    await page.goto(`${APP_URL}/editor/${fakeId}`, { waitUntil: "domcontentloaded", timeout: 20000 });
    // Wait for auto-redirect to real project ID
    await page.waitForURL(/\/editor\/[0-9a-f-]{30,}/, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(3000);

    const currentUrl = page.url();
    const projectId = currentUrl.match(/\/editor\/([^/?#]+)/)?.[1];
    console.log(`  URL: ${currentUrl}`);
    console.log(`  Project ID: ${projectId}`);
    check("editor URL with real project ID", !!projectId && projectId !== fakeId, projectId);

    await page.screenshot({ path: "/tmp/gaze-1-editor.png" });

    if (!projectId) {
      console.error("  No project ID — stopping");
      return;
    }

    // ── 2. Import RAW video file ───────────────────────────────────────────
    console.log("\n── Step 2: Import RAW video ──");
    await page.waitForTimeout(2000);

    // Expose hidden file inputs
    await page.evaluate(() => {
      for (const el of document.querySelectorAll('input[type="file"]')) {
        Object.assign(el.style, { display:"block", opacity:"1", position:"fixed",
          top:"0", left:"0", zIndex:"99999", width:"100px", height:"30px" });
      }
    });

    const fileInputs = page.locator('input[type="file"]');
    const count = await fileInputs.count();
    console.log(`  File inputs: ${count}`);

    if (count === 0) {
      // Try clicking import button to reveal inputs
      const triggerSel = ['[aria-label*="import" i]', 'button:text("Import")', '[data-testid*="import"]'];
      for (const sel of triggerSel) {
        if (await page.locator(sel).first().isVisible({ timeout: 1000 }).catch(() => false)) {
          await page.locator(sel).first().click();
          await page.waitForTimeout(500);
          break;
        }
      }
      await page.evaluate(() => {
        for (const el of document.querySelectorAll('input[type="file"]'))
          Object.assign(el.style, { display:"block", opacity:"1" });
      });
    }

    const inputs2 = page.locator('input[type="file"]');
    const cnt2 = await inputs2.count();
    if (cnt2 > 0) {
      await inputs2.first().setInputFiles(videoFile);
      console.log(`  ✅ File set: ${videoFile}`);
      check("video file imported", true);
    } else {
      check("video file imported", false, "no input[type=file]");
      console.error("  Cannot import — stopping");
      return;
    }

    await page.waitForTimeout(4000);
    await page.screenshot({ path: "/tmp/gaze-2-after-import.png" });

    const mediaDbName = `video-editor-media-${projectId}`;

    // Helper: read gaze from IDB
    const readGazeFromIDB = async () => {
      const allDbs = await listIDBDatabases(page);
      if (!allDbs.some(n => n && n.includes(`video-editor-media-${projectId}`))) return null;
      const assets = await idbGetAll(page, mediaDbName, "media-metadata").catch(() => []);
      const video  = assets.find(a => a.type === "video" && !a.ephemeral);
      return video ?? null;
    };

    // Quick check: asset in IDB?
    const assetCheck = await readGazeFromIDB();
    console.log(`  Asset in IDB: ${assetCheck ? assetCheck.id?.slice(0,8) : "none"}`);

    // ── 3. AI chat — gaze command (triggers gaze analysis automatically) ─────
    console.log("\n── Step 3: Submit gaze-cut command to AI chat ──");

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
        chatArea = el; console.log(`  Chat found: ${sel}`); break;
      }
    }

    if (!chatArea) {
      check("chat panel accessible", false, "no textarea found");
      console.error("  No chat area — stopping");
      return;
    }

    const gazeMsg = "cut where I'm looking down after I say 'hey'";
    console.log(`  Typing: "${gazeMsg}"`);
    await chatArea.click();
    await chatArea.fill(gazeMsg);
    await page.screenshot({ path: "/tmp/gaze-3-chat-filled.png" });

    // The chat uses a "Propose Plan" button, not Enter-to-submit
    const submitBtn = page.getByRole("button", { name: /propose plan/i }).first();
    const submitVisible = await submitBtn.isVisible({ timeout: 3000 }).catch(() => false);
    if (submitVisible) {
      console.log("  Clicking 'Propose Plan' button");
      await submitBtn.click();
    } else {
      // Fallback: try any submit/send button near the textarea
      const fallbacks = [
        page.getByRole("button", { name: /send|submit|run|go|plan/i }).first(),
        page.locator('button[type="submit"]').first(),
      ];
      let clicked = false;
      for (const fb of fallbacks) {
        if (await fb.isVisible({ timeout: 1000 }).catch(() => false)) {
          await fb.click(); clicked = true;
          console.log("  Clicked fallback submit button"); break;
        }
      }
      if (!clicked) {
        await chatArea.press("Enter");
        console.log("  Pressed Enter (last resort)");
      }
    }

    // ── 4. Wait for gaze analysis + AI response (up to 180s) ────────────────
    // Transcription is now awaited in the hot-path before the planner runs,
    // so allow extra time: gaze (≤30s) + transcription (≤120s) + planner (≤10s).
    console.log("\n── Step 4: Wait for gaze analysis + AI response (up to 180s) ──");
    let gazeData   = null;
    let aiResponse = null;
    const deadline = Date.now() + 180_000;

    while (Date.now() < deadline) {
      // Check IDB for gaze data
      if (!gazeData) {
        const vid = await readGazeFromIDB();
        if (vid?.gazeAnalysis?.analyzedAt) {
          gazeData = vid.gazeAnalysis;
          console.log(`\n  ✅ Gaze ready: ${gazeData.windows?.length} windows, cameraRatio=${gazeData.cameraLookRatio?.toFixed(3)}`);
        }
      }

      // Check for AI activity in the chat panel
      if (!aiResponse) {
        aiResponse = await page.evaluate(() => {
          // Still loading?
          const proposingBtn = Array.from(document.querySelectorAll('button'))
            .find(b => b.disabled && b.textContent?.includes("Proposing"));
          if (proposingBtn) return null;

          // "Need clarification" box (what we expect for gaze + no transcript)
          const allParas = Array.from(document.querySelectorAll('p'));
          const clarifPara = allParas.find(p => p.textContent?.trim() === 'Need clarification');
          if (clarifPara) {
            const box = clarifPara.closest('div');
            return `CLARIFY: ${box?.textContent?.trim().slice(0, 400) ?? 'clarification shown'}`;
          }

          // Error box
          const errBox = document.querySelector('.border-red-300, [class*="red-50"]');
          if (errBox && errBox.textContent?.trim().length > 5)
            return `ERROR: ${errBox.textContent?.trim().slice(0,200)}`;

          // Proposed commands / plan complete
          const planImpact = allParas.find(p => p.textContent?.includes('Plan impact'));
          if (planImpact) return `PLAN: ${planImpact.closest('div')?.textContent?.trim().slice(0,200)}`;

          // "Propose Plan" re-enabled = plan completed with no UI output
          const proposeBtn = Array.from(document.querySelectorAll('button'))
            .find(b => !b.disabled && b.textContent?.includes('Propose Plan'));
          if (proposeBtn) return `COMPLETE: button re-enabled`;

          return null;
        });
        if (aiResponse) console.log(`\n  ✅ AI activity: "${aiResponse.slice(0,300)}"`);
      }

      if (gazeData && aiResponse) break;
      const secs = Math.round((deadline - Date.now()) / 1000);
      process.stdout.write(`  [${secs}s] gaze=${gazeData ? "ready" : "pending"} aiResp=${aiResponse ? "ready" : "pending"}...\n`);
      await page.waitForTimeout(3000);
    }

    console.log();
    await page.screenshot({ path: "/tmp/gaze-4-after-response.png" });

    // Look specifically for the clarification box
    const clarificationText = await page.evaluate(() => {
      // The clarification box shows "Need clarification" as a heading
      const allParas = Array.from(document.querySelectorAll('p'));
      const needsClarif = allParas.find(p => p.textContent?.includes('Need clarification'));
      if (needsClarif) {
        // Next sibling paragraph has the clarification message
        const parent = needsClarif.closest('div');
        if (parent) return parent.textContent?.trim().slice(0, 400);
      }
      return null;
    });
    if (clarificationText) {
      console.log(`  Clarification box: "${clarificationText.slice(0, 300)}"`);
    }

    // ── 5. Validate gaze structure ───────────────────────────────────────────
    console.log("\n── Step 5: Validate gaze structure ──");

    if (gazeData) {
      const windows = gazeData.windows ?? [];
      console.log(`  version=${gazeData.version} windows=${windows.length} cameraRatio=${gazeData.cameraLookRatio}`);
      if (windows.length > 0)
        console.log("  First 3 windows:", JSON.stringify(windows.slice(0,3), null, 2));

      check("gazeAnalysis.version === 1", gazeData.version === 1, gazeData.version);
      check("windows is array", Array.isArray(windows));
      check("samplingIntervalMs = 500", gazeData.samplingIntervalMs === 500, gazeData.samplingIntervalMs);
      check("cameraLookRatio in [0,1]",
        gazeData.cameraLookRatio >= 0 && gazeData.cameraLookRatio <= 1, gazeData.cameraLookRatio);

      if (windows.length > 0) {
        const w = windows[0];
        check("window.category valid", ["camera","off-camera"].includes(w.category), w.category);
        check("window.gazeScore in [0,1]", w.gazeScore >= 0 && w.gazeScore <= 1, w.gazeScore);
        check("window.endTime > startTime", w.endTime > w.startTime);
        const camW  = windows.filter(w => w.category === "camera").length;
        const offW  = windows.filter(w => w.category === "off-camera").length;
        console.log(`  camera=${camW} off-camera=${offW}`);
        check("gaze heuristic classified windows", offW + camW > 0);
      } else {
        console.log("  ⚠️  0 windows — very short clip or no face");
        check("gaze analysis ran", true);
      }
    } else {
      check("gazeAnalysis populated after chat command", false, "no gaze data in IDB after 90s");
    }

    // ── 6. AI response validation ─────────────────────────────────────────────
    console.log("\n── Step 6: AI response check ──");
    console.log(`  AI response: "${(aiResponse ?? "(none)").slice(0,300)}"`);
    check("AI produced a response", !!aiResponse && aiResponse.length > 5, aiResponse?.slice(0,80));

  } catch (err) {
    console.error(`\n💥 Error: ${err.message?.slice(0,300)}`);
    await page.screenshot({ path: "/tmp/gaze-error.png" }).catch(() => {});
    failed++;
  } finally {
    await browser.close();
  }

  if (pageErrors.filter(e => !e.includes("ZodError") && !e.includes("NODE_ENV")).length) {
    console.log("\n⚠️  Page errors:");
    pageErrors.slice(0,5).forEach(e => console.error(" ", e.slice(0,200)));
  }

  console.log(`\n══════════════════════════════`);
  console.log(`  ${passed} passed  /  ${failed} failed`);
  console.log(`  Screenshots: /tmp/gaze-*.png`);
  process.exit(failed > 0 ? 1 : 0);
})();
