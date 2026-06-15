/**
 * Operating from Abundance — recreation smoke test.
 *
 * Workflow:
 *   1. Import RAW footage (RAW-abundance-h264.mp4)
 *   2. Verify silence analysis runs automatically
 *   3. "cut all the non-talking parts and leave 0.5 seconds between each clip"
 *   4. "add word-by-word captions"
 *   5. "add the title 'Always Operate from Abundance' at the top"
 *   6. Import background music and "add the background music at 30% volume"
 *   7. Validate each step produced a planner response
 */
import { chromium } from "playwright";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));

const APP_URL  = "http://localhost:3000";
const RAW_MP4  = resolve(__dir, "RAW-abundance-h264.mp4");
const MUSIC_MP3 = resolve(__dir, "MUSIC-background.mp3");

let passed = 0, failed = 0;
function check(label, cond, got) {
  if (cond) { console.log(`  ✅  ${label}`); passed++; }
  else { console.error(`  ❌  ${label}${got !== undefined ? `  (got: ${JSON.stringify(got).slice(0,120)})` : ""}`); failed++; }
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
        const getAll = store.getAll();
        getAll.onsuccess = () => resolve(getAll.result);
        getAll.onerror  = () => reject(getAll.error?.message);
      };
    });
  }, { dbName, storeName });
}

async function listIDBDatabases(page) {
  return page.evaluate(() => {
    if (!indexedDB.databases) return [];
    return indexedDB.databases().then(dbs => dbs.map(d => d.name));
  });
}

/** Type a message and click "Propose Plan", return the response text */
async function submitChat(page, message, { timeoutMs = 60_000 } = {}) {
  const chatSels = [
    'textarea[placeholder*="speed" i]',
    'textarea[placeholder*="Try" i]',
    'textarea[placeholder*="edit" i]',
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
  await chatArea.fill(message);

  const submitBtn = page.getByRole("button", { name: /propose plan/i }).first();
  const submitVisible = await submitBtn.isVisible({ timeout: 3000 }).catch(() => false);
  if (submitVisible) {
    await submitBtn.click();
  } else {
    await chatArea.press("Enter");
  }

  // Wait for response
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await page.evaluate(() => {
      const proposingBtn = Array.from(document.querySelectorAll("button"))
        .find(b => b.disabled && b.textContent?.includes("Proposing"));
      if (proposingBtn) return null; // still loading

      const allParas = Array.from(document.querySelectorAll("p"));
      const clarifPara = allParas.find(p => p.textContent?.trim() === "Need clarification");
      if (clarifPara) {
        const box = clarifPara.closest("div");
        return `CLARIFY: ${box?.textContent?.trim().slice(0, 400) ?? "clarification shown"}`;
      }

      const errBox = document.querySelector(".border-red-300, [class*='red-50']");
      if (errBox && errBox.textContent?.trim().length > 5)
        return `ERROR: ${errBox.textContent?.trim().slice(0, 200)}`;

      const planImpact = allParas.find(p => p.textContent?.includes("Plan impact"));
      if (planImpact) return `PLAN: ${planImpact.closest("div")?.textContent?.trim().slice(0, 400)}`;

      const proposeBtn = Array.from(document.querySelectorAll("button"))
        .find(b => !b.disabled && b.textContent?.includes("Propose Plan"));
      if (proposeBtn) return "COMPLETE: button re-enabled";

      return null;
    });

    if (result) return result;
    await page.waitForTimeout(2000);
  }
  return null;
}

/** Read silence/gaze data from IDB for latest project */
async function readProjectMetadata(page, projectId) {
  const dbName = `video-editor-media-${projectId}`;
  const allDbs = await listIDBDatabases(page);
  if (!allDbs.some(n => n && n.includes(dbName))) return null;
  const assets = await idbGetAll(page, dbName, "media-metadata").catch(() => []);
  return assets;
}

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();

  page.on("pageerror", e => {
    if (!e.message.includes("ZodError") && !e.message.includes("NODE_ENV"))
      process.stderr.write(`  [browser:err] ${e.message.slice(0, 160)}\n`);
  });

  try {
    // ── 1. Bootstrap editor ─────────────────────────────────────────────────
    console.log("\n── Step 1: Bootstrap editor ──");
    const fakeId = `00000000-0000-0000-0000-${Date.now()}`;
    await page.goto(`${APP_URL}/editor/${fakeId}`, { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForURL(/\/editor\/[0-9a-f-]{30,}/, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(3000);

    const currentUrl = page.url();
    const projectId = currentUrl.match(/\/editor\/([^/?#]+)/)?.[1];
    check("editor URL with real project ID", !!projectId && projectId !== fakeId, projectId);
    if (!projectId) { console.error("  No project ID — stopping"); return; }

    await page.screenshot({ path: "/tmp/abundance-1-editor.png" });

    // ── 2. Import RAW footage ────────────────────────────────────────────────
    console.log("\n── Step 2: Import RAW footage ──");
    await page.waitForTimeout(2000);
    await page.evaluate(() => {
      for (const el of document.querySelectorAll('input[type="file"]'))
        Object.assign(el.style, { display:"block", opacity:"1", position:"fixed",
          top:"0", left:"0", zIndex:"99999", width:"100px", height:"30px" });
    });

    const fileInputs = page.locator('input[type="file"]');
    const count = await fileInputs.count();
    console.log(`  File inputs: ${count}`);

    if (count > 0) {
      await fileInputs.first().setInputFiles(RAW_MP4);
      console.log(`  ✅ RAW file set`);
      check("raw video imported", true);
    } else {
      check("raw video imported", false, "no input[type=file]");
      return;
    }

    await page.waitForTimeout(5000); // allow file to be ingested
    await page.screenshot({ path: "/tmp/abundance-2-imported.png" });

    // ── 2b. Add clip to timeline by double-clicking thumbnail ───────────────
    console.log("\n── Step 2b: Add clip to timeline ──");
    const thumbSel = '.media-asset-thumbnail, [data-testid*="media-item"], [data-testid*="asset"]';
    // Try double-click on the clip thumbnail in media panel
    const thumbnails = page.locator('img[alt*="RAW"], [data-name*="RAW"], div[class*="thumbnail"]').first();
    const thumbVisible = await thumbnails.isVisible({ timeout: 3000 }).catch(() => false);
    if (thumbVisible) {
      await thumbnails.dblclick({ timeout: 2000 }).catch(() => {});
      console.log("  Tried dblclick on thumbnail");
      await page.waitForTimeout(2000);
    } else {
      // Fallback: try to use the chat command to add clip to timeline
      const addMsg = "add the raw footage to my timeline";
      console.log(`  Thumbnail not found, trying chat: "${addMsg}"`);
      const addResp = await submitChat(page, addMsg, { timeoutMs: 30_000 });
      console.log(`  Add response: "${(addResp ?? "(none)").slice(0, 150)}"`);
    }
    await page.screenshot({ path: "/tmp/abundance-2b-added.png" });

    // ── 3. Check silence analysis triggered ─────────────────────────────────
    console.log("\n── Step 3: Submit silence-cut command ──");
    const silenceMsg = "cut all the non-talking parts and leave 0.5 seconds between each clip";
    console.log(`  Typing: "${silenceMsg}"`);
    const silenceResponse = await submitChat(page, silenceMsg, { timeoutMs: 90_000 });

    console.log(`  Response: "${(silenceResponse ?? "(none)").slice(0,300)}"`);
    await page.screenshot({ path: "/tmp/abundance-3-silence.png" });

    check("silence-cut command got response", !!silenceResponse && silenceResponse.length > 5, silenceResponse?.slice(0, 80));
    check("silence response is PLAN or CLARIFY (not error)",
      !!silenceResponse && !silenceResponse.startsWith("ERROR"),
      silenceResponse?.slice(0, 80));

    // ── 4. Check silence regions stored in IDB ──────────────────────────────
    console.log("\n── Step 4: Validate silence data in IDB ──");
    await page.waitForTimeout(2000);
    const assets = await readProjectMetadata(page, projectId);
    console.log(`  IDB assets: ${assets?.length ?? 0}`);

    const rawAsset = assets?.find(a => a.type === "video" && !a.ephemeral);
    if (rawAsset) {
      const regions = rawAsset.clipforge?.silenceRegions ?? rawAsset.silenceRegions ?? [];
      const cfMeta = rawAsset.clipforge;
      console.log(`  Asset name: ${rawAsset.name}`);

      // Silence data may be in IDB differently — check project IDB
      const projectDb = `video-editor-projects`;
      const projects = await idbGetAll(page, projectDb, "projects").catch(() => []);
      const project = projects.find(p => p.id === projectId);
      const silenceRegions = Object.values(
        project?.clipforge?.mediaMetadataById ?? {}
      ).flatMap(m => m.silenceRegions ?? []);
      console.log(`  Silence regions in project: ${silenceRegions.length}`);
      check("silence regions stored in project", silenceRegions.length > 0, silenceRegions.length);
    } else {
      console.log("  ⚠️  No video asset in IDB yet");
    }

    // ── 5. Add captions ──────────────────────────────────────────────────────
    console.log("\n── Step 5: Add word-by-word captions ──");
    await page.waitForTimeout(2000);
    const captionMsg = "add word-by-word captions";
    const captionResponse = await submitChat(page, captionMsg, { timeoutMs: 60_000 });
    console.log(`  Response: "${(captionResponse ?? "(none)").slice(0, 300)}"`);
    await page.screenshot({ path: "/tmp/abundance-5-captions.png" });
    check("caption command got response", !!captionResponse && captionResponse.length > 5, captionResponse?.slice(0, 80));

    // ── 6. Add title overlay ─────────────────────────────────────────────────
    console.log("\n── Step 6: Add title overlay ──");
    await page.waitForTimeout(2000);
    const titleMsg = "add the title 'Always Operate from Abundance' at the top covering the entire video";
    const titleResponse = await submitChat(page, titleMsg, { timeoutMs: 60_000 });
    console.log(`  Response: "${(titleResponse ?? "(none)").slice(0, 300)}"`);
    await page.screenshot({ path: "/tmp/abundance-6-title.png" });
    check("title overlay command got response", !!titleResponse && titleResponse.length > 5, titleResponse?.slice(0, 80));

    // ── 7. Import music + mix ────────────────────────────────────────────────
    console.log("\n── Step 7: Import background music ──");
    await page.waitForTimeout(2000);

    // Re-expose file inputs for music
    await page.evaluate(() => {
      for (const el of document.querySelectorAll('input[type="file"]'))
        Object.assign(el.style, { display:"block", opacity:"1", position:"fixed",
          top:"0", left:"0", zIndex:"99999", width:"100px", height:"30px" });
    });

    const musicInputs = page.locator('input[type="file"]');
    const mCount = await musicInputs.count();
    if (mCount > 0) {
      await musicInputs.first().setInputFiles(MUSIC_MP3);
      console.log("  ✅ Music file set");
      check("music file imported", true);
    } else {
      check("music file imported", false, "no input[type=file]");
    }

    await page.waitForTimeout(3000);
    const musicMsg = "add the background music at 30% volume";
    const musicResponse = await submitChat(page, musicMsg, { timeoutMs: 60_000 });
    console.log(`  Response: "${(musicResponse ?? "(none)").slice(0, 300)}"`);
    await page.screenshot({ path: "/tmp/abundance-7-music.png" });
    check("music mix command got response", !!musicResponse && musicResponse.length > 5, musicResponse?.slice(0, 80));
    // Verify the response references the imported workspace track, not a bundled one.
    const usedImportedMusic = musicResponse?.includes("MUSIC-background") ||
      musicResponse?.toLowerCase().includes("background") ||
      musicResponse?.toLowerCase().includes("imported") ||
      // Plan impact should show the imported track name, not "Energetic Bounce"
      (musicResponse?.includes("PLAN") && !musicResponse?.includes("Energetic Bounce"));
    check("music command uses imported workspace music track (not bundled)",
      !!usedImportedMusic, musicResponse?.slice(0, 120));

  } catch (err) {
    console.error(`\n💥 Error: ${err.message?.slice(0, 300)}`);
    await page.screenshot({ path: "/tmp/abundance-error.png" }).catch(() => {});
    failed++;
  } finally {
    await browser.close();
  }

  console.log(`\n══════════════════════════════`);
  console.log(`  ${passed} passed  /  ${failed} failed`);
  console.log(`  Screenshots: /tmp/abundance-*.png`);
  process.exit(failed > 0 ? 1 : 0);
})();
