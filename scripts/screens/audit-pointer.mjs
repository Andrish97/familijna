#!/usr/bin/env node
// Audyt wskazywania (E30, show_on_page): każde miejsce z POINT_TARGETS na swojej
// stronie, na telefonie i komputerze — prawdziwy kod strony i pointer.js, atrapa
// Supabase jak w zrzutach (scripts/screens). Wypisuje miejsca, których czat nie
// podświetli (shown: false albo nie znalazł kafla).
// Użycie: CHROMIUM_PATH=… node scripts/screens/audit-pointer.mjs [--page=games] [--device=phone]
import { createRequire } from "node:module";
import { POINT_TARGETS, PAGE_PATHS } from "../../web/shared/js/ai/tools/targets.js";

const require = createRequire(import.meta.url);
const L = require("./lib.cjs");
const scenes = require("./scenes.cjs");
const { buildDb, IDS } = require("./data/demo.cjs");
const { buildGameState } = await import("./data/game-state.mjs");

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")));
const DEVICES = {
  phone: { width: 390, height: 844, scale: 1, mobile: true },
  desktop: { width: 1400, height: 900, scale: 1, mobile: false },
};
// scena z danymi i adresem strony (bez kroków)
const SCENE = {
  games: "games", editor: "game-editor", gameSettings: "game-settings", polls: "poll-share", logoEditor: "logos",
  logoDraw: "logo-draw", logoImage: "logo-image", bases: "bases", baseExplorer: "base-explorer", friends: "friends",
  subscribers: "subscribers", marketplace: "marketplace", tasks: "tasks", account: "account", control: "control-devices",
};
const TILE_ID = { game: IDS.game, logo: IDS.logoText, base: IDS.base };

const origin = await L.startServer();
const browser = await L.launch();
const misses = [];
const explained = [];
let total = 0;
for (const [pageId, places] of Object.entries(POINT_TARGETS)) {
  if (args.page && args.page !== pageId) continue;
  const scene = scenes.find((s) => s.id === SCENE[pageId]);
  if (!scene) { console.log(`brak sceny dla ${pageId} (${PAGE_PATHS[pageId]})`); continue; }
  for (const [devName, device] of Object.entries(DEVICES)) {
    if (args.device && args.device !== devName) continue;
    for (const [place, target] of Object.entries(places)) {
      total += 1;
      const db = buildDb("pl", scene.gameState ? { gameState: buildGameState("pl", scene.gameState) } : {});
      if (typeof scene.db === "function") scene.db(db, "pl");
      db.rpc.ai_quota_status ??= { ok: true, visible: true, enabled: true, daily: 20, used: 0, remaining: 20 };
      const ctx = await L.newContext(browser, db, "pl", device);
      const page = await ctx.newPage();
      let result;
      try {
        await page.goto(`${origin}${scene.path}`, { waitUntil: "domcontentloaded" });
        if (scene.ready) await page.waitForSelector(scene.ready, { timeout: 15000 }).catch(() => {});
        await page.waitForTimeout(500);
        result = await page.evaluate(async ([p, k, id]) => {
          const m = await import("/shared/js/ai/pointer.js");
          return m.pointHere(p, { place: k, id, text: "audyt" }, {});
        }, [pageId, place, target.select ? TILE_ID[target.select] : null]);
      } catch (e) {
        result = { error: String(e?.message || e).slice(0, 120) };
      }
      const ok = result?.shown && !result?.note && !result?.error;
      const expected = ["computer_only", "not_available_now"].includes(result?.note);
      if (expected) explained.push(`${pageId}.${place} [${devName}] ${result.note}`);
      else if (!ok) misses.push(`${pageId}.${place} [${devName}] ${JSON.stringify(result)} sel=${target.sel}${target.before ? ` before=${target.before.join(",")}` : ""}`);
      await ctx.close();
    }
  }
}
await browser.close();
L.stopServer();
console.log(`sprawdzono: ${total}, podświetla: ${total - misses.length - explained.length}, wyjaśnia (komputer/stan): ${explained.length}, nie podświetla: ${misses.length}`);
for (const m of explained) console.log(`  ~ ${m}`);
for (const m of misses) console.log(`  ✗ ${m}`);
