#!/usr/bin/env node
// Zrzuty prawdziwych stron z bogatymi danymi demo -- bez kont i bez bazy.
//
//   node scripts/screens/run.cjs --changed          # sceny stron zmienionych względem origin/main (+ nie zacommitowane)
//   node scripts/screens/run.cjs --scenes=games,logos
//   node scripts/screens/run.cjs --all --lang=all
//   --scenes=a,b@phone  -- „scena@urządzenie”: tylko to urządzenie (lista z publish-manual.cjs --list)
//   opcje: --devices=desktop,phone,tablet,phone-landscape,tablet-landscape,tablet-landscape-short,desktop-short,desktop-1400,tablet-short-1400  --lang=pl,en,uk|all  --base=<ref>  --out=<katalog>  --list  --dry (tylko wypisz sceny)  --force-devices (urządzenia z --devices także dla scen z własną listą)  --verbose (konsola strony)  --homepage (tylko kadry strony głównej)  --theme=light (jasny motyw; domyślnie ciemny)
//
// Strony, CSS i JS pochodzą z web/ (kod z bieżącego katalogu roboczego).
// Supabase podmienia fake-supabase.js, dane: data/demo.cjs, sceny: scenes.cjs.
// Wynik: <out>/<scena>/<język>-<urządzenie>.png oraz <out>/index.html (galeria).
const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");
const { repo, startServer, stopServer, launch, newContext, emulateSafeArea, composeIPhone } = require("./lib.cjs");
const scenes = require("./scenes.cjs");
const { observeLayoutShifts, inspectLayout, allowDocScroll, NO_WRAP } = require("./audit-layout.cjs");
const { buildDb } = require("./data/demo.cjs");
let buildGameState = null; // data/game-state.mjs (ESM, ładowany w main)

const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const [key, ...rest] = arg.replace(/^--/, "").split("=");
  return [key, rest.length ? rest.join("=") : "true"];
}));

const DEVICES = {
  desktop: { width: 1440, height: 900, scale: 1, mobile: false },
  phone: { width: 390, height: 844, scale: 2, mobile: true },
  // Mały Android (zgłoszenie 2026-10-24: pasek zawijał się przy 360 px).
  "phone-360": { width: 360, height: 640, scale: 2, mobile: true },
  tablet: { width: 820, height: 1180, scale: 2, mobile: true },
  "phone-landscape": { width: 844, height: 390, scale: 2, mobile: true },
  "tablet-landscape": { width: 1180, height: 820, scale: 2, mobile: true },
  // Niski viewport (guard wysokości, decyzja 2026-10-22): tablet w poziomie
  // z paskami przeglądarki/powiększeniem i niskie okno komputera.
  "tablet-landscape-short": { width: 1200, height: 560, scale: 1, mobile: true, screen: { width: 1280, height: 800 } },
  "desktop-short": { width: 1400, height: 550, scale: 1, mobile: false },
  "desktop-1400": { width: 1400, height: 900, scale: 1, mobile: false },
  // Typowy laptop (e2e Control: lista urządzeń bez przewijania przy 1366×768).
  "laptop-1366": { width: 1366, height: 768, scale: 1, mobile: false },
  // Tablet w pionie z paskami przeglądarki (zgłoszenie 2026-10-25, Eksplorator).
  "tablet-600": { width: 600, height: 960, scale: 2, mobile: true, screen: { width: 600, height: 960 } },
  "monitor-1920": { width: 1920, height: 1080, scale: 1, mobile: false },
  // Dotykowy tablet z niskim oknem 1400×550 (Host i Przycisk wymagają dotyku).
  "tablet-short-1400": { width: 1400, height: 550, scale: 1, mobile: true, screen: { width: 1440, height: 900 } },
};
// --viewport=1280x580 -- dodatkowe urządzenie „viewport” (komputer) o podanym rozmiarze.
if (args.viewport) {
  const [w, h] = String(args.viewport).split("x").map(Number);
  DEVICES.viewport = { width: w, height: h, scale: 1, mobile: false };
}
const LANGS = ["pl", "en", "uk"];
// Strefa bezpieczna iPhone'a (wyspa aparatu, pasek gestu) dla urządzeń „phone” -- jak na telefonie.
const IPHONE_SAFE_AREA = { phone: { top: 47, bottom: 34 }, "phone-landscape": { left: 59, right: 59, bottom: 21 } };

// ---------- wybór scen ----------
const { selectChanged } = require("./changes.cjs");
const onlyDevices = {};
function pickScenes() {
  if (args.all) return scenes;
  if (args.scenes) {
    // Wpis „scena@urządzenie” zawęża urządzenia sceny (lista z publish-manual.cjs --list).
    const ids = args.scenes.split(",").filter(Boolean).map((entry) => {
      const [id, device] = entry.split("@");
      if (device) (onlyDevices[id] ||= new Set()).add(device);
      return id;
    });
    const unknown = ids.filter((id) => !scenes.some((s) => s.id === id));
    if (unknown.length) throw new Error(`Nieznane sceny: ${unknown.join(", ")}. Lista: --list`);
    return scenes.filter((s) => ids.includes(s.id));
  }
  if (args.changed) {
    // Tylko sceny, na które zmiana może wpłynąć (changes.cjs: bez samych ?v=, wspólny kod -- strony, które go wczytują).
    const { all, scenes: picked, reason } = selectChanged(scenes, args.base || "origin/main");
    console.log(`${reason} -- sceny: ${all ? "wszystkie" : picked.map((s) => s.id).join(", ") || "brak"}`);
    return picked;
  }
  throw new Error("Podaj --changed, --scenes=… albo --all (--list pokazuje sceny).");
}

// ---------- jedna scena ----------
async function capture(browser, origin, scene, lang, deviceName, outDir) {
  const device = scene.size ? { scale: 1, mobile: false, ...scene.size } : DEVICES[deviceName];
  const db = buildDb(lang, scene.gameState ? { gameState: buildGameState(lang, scene.gameState) } : {});
  // --latency=250: kontrolowany odczyt danych po pokazaniu szkieletu.
  if (args.latency) db.latency = Number(args.latency);
  // guest: odwiedzający bez konta i sesji.
  if (scene.guest) { db.user = null; db.localStorage = {}; }
  // Dane tylko dla tej sceny (np. pusty stan, błąd, inny stan gry) bez zmian w demo.cjs.
  if (typeof scene.db === "function") scene.db(db, lang);
  const context = await newContext(browser, db, lang, device, { theme: args.theme });
  // Telefon jak iPhone (zrzuty w ramce z wyspą aparatu): strefa bezpieczna, chyba że scena ma własną.
  const safeArea = scene.safeArea || IPHONE_SAFE_AREA[deviceName];
  if (safeArea) await emulateSafeArea(context, origin, safeArea);
  if (args.audit) await context.addInitScript(observeLayoutShifts);
  // Przeglądarka, której nie da się ustawić opcjami kontekstu (np. Safari na iPhonie).
  if (scene.initScript) await context.addInitScript(scene.initScript);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  // Brak sekcji słownika na stronie (nieaktualna meta i18n-parts) -- jak błąd JS.
  page.on("console", (m) => { if (m.text().startsWith("[i18n]")) errors.push(m.text()); });
  if (args.verbose) page.on("console", (m) => { if (["error", "warning"].includes(m.type())) console.log(`    [${m.type()}] ${m.text().slice(0, 300)}`); });
  const [pathOnly, hash = ""] = scene.path.split("#");
  const sep = pathOnly.includes("?") ? "&" : "?";
  const target = `${pathOnly}${sep}lang=${lang}${hash ? `#${hash}` : ""}`;
  await page.goto(scene.frame ? `${origin}/__screens__/frame.html?src=${encodeURIComponent(target)}` : `${origin}${target}`, { waitUntil: "domcontentloaded" });
  // W ramce czekamy i robimy kroki na stronie wewnątrz, zrzut -- całego okna.
  const view = scene.frame ? await (await page.waitForSelector("#screensFrame")).contentFrame() : page;
  let readyError = null;
  let initialLayout = null;
  try {
    if (scene.previewRow) {
      // Tryb podglądu urządzenia (?preview=1): stan gry jak w Control -> postMessage.
      const row = buildGameState(lang, scene.previewRow);
      await view.waitForFunction(() => document.readyState === "complete", null, { timeout: 15000 });
      await view.evaluate(() => document.fonts?.ready);
      await page.waitForTimeout(1500);
      if (scene.frame) await page.evaluate((row) => document.getElementById("screensFrame").contentWindow.postMessage({ type: "familijna:preview-row", row }, location.origin), row);
      else await page.evaluate((row) => window.postMessage({ type: "familijna:preview-row", row }, "*"), row);
    }
    if (typeof scene.ready === "string") await view.waitForSelector(scene.ready, { state: "visible", timeout: 15000 });
    else if (scene.ready) await view.waitForFunction(scene.ready, null, { timeout: 15000 });
    await view.waitForFunction(() => !document.documentElement.classList.contains("page-loading"), null, { timeout: 8000 }).catch(() => {});
    await view.waitForFunction(() => (!document.documentElement.hasAttribute("data-layout-pending") || document.documentElement.hasAttribute("data-page-guard")), null, { timeout: 6000 });
    if (args.audit) {
      // Koniec pomiaru automatycznego ładowania przed akcjami sceny (zmiana
      // zakładki, otwarcie okna i przewinięcie są zamierzoną zmianą układu).
      await view.evaluate(() => document.fonts?.ready);
      await page.waitForTimeout(scene.settle ?? 400);
      initialLayout = await view.evaluate(() => window.__screensLayoutAudit?.stop());
    }
    for (const step of scene.steps || []) {
      let deadline;
      try {
        await Promise.race([
          step(view, { lang, device: deviceName, page }),
          new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error("Krok sceny przekroczył 45 s")), 45000); }),
        ]);
      } finally { clearTimeout(deadline); }
    }
    if (scene.fullPage) {
      // Zrzut całej strony: przewinąć, żeby wczytały się obrazy z loading="lazy".
      await view.evaluate(async () => {
        for (let y = 0; y < document.documentElement.scrollHeight; y += Math.round(innerHeight * 0.8)) {
          window.scrollTo(0, y);
          await new Promise((resolve) => setTimeout(resolve, 120));
        }
        await Promise.all([...document.images].map((img) => (img.complete ? null : new Promise((resolve) => { img.onload = img.onerror = resolve; }))));
        window.scrollTo(0, 0);
      });
    }
    await view.evaluate(() => document.fonts?.ready);
    await page.waitForTimeout(scene.settle ?? 400);
  } catch (e) { readyError = e.message.split("\n")[0]; }
  // Nieaktualny selektor sceny nie usuwa pomiaru samego startu strony.
  if (args.audit && !initialLayout) initialLayout = await view.evaluate(() => window.__screensLayoutAudit?.stop()).catch(() => null);
  const misses = await view.evaluate(() => window.__SCREENS_MISSES__ || []).catch(() => []);
  // --audit: układ (przewijanie, obcięcia, sterowanie poza ekranem, safe area) — audit-layout.cjs.
  const audit = args.audit
    ? await view.evaluate(inspectLayout, { initialLayout, path: pathOnly, safe: safeArea, allowDocScroll: scene.fullPage || allowDocScroll(pathOnly), noWrap: NO_WRAP, touch: !!device.mobile }).catch((e) => [{ kind: "blad-audytu", el: "", detail: e.message.split("\n")[0] }])
    : [];
  const file = path.join(outDir, scene.id, scene.size ? `${lang}.png` : `${lang}-${deviceName}.png`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const shot = await page.screenshot({ fullPage: !!scene.fullPage, animations: "disabled" });
  // --styles: obliczone style widocznych elementów obok PNG (compare.cjs pokazuje różnice właściwości).
  if (args.styles) {
    try { fs.writeFileSync(file.replace(/\.png$/, ".styles.json"), JSON.stringify(await view.evaluate(dumpStyles))); } catch {}
  }
  // deviceFrame: "iphone" -- ekran telefonu w ramce iPhone'a na czarnym tle (kadr strony głównej).
  fs.writeFileSync(file, scene.deviceFrame === "iphone" ? await composeIPhone(browser, shot, scene.frameSize?.width, scene.frameSize?.height, scene.frameSize?.scale) : shot);
  await context.close();
  return { scene: scene.id, title: scene.title, lang, device: scene.size ? `${scene.size.width}×${scene.size.height}` : deviceName, file: path.relative(outDir, file), errors, misses, readyError, initialLayout, audit };
}

// Obliczone style widocznych elementów: klucz = ścieżka w DOM (tag#id.klasy:nth), wartości wybranych właściwości.
function dumpStyles() {
  const PROPS = ["display", "position", "z-index", "margin", "padding", "gap", "color", "background-color", "background-image",
    "border-top", "border-right", "border-bottom", "border-left", "border-radius", "font-size", "font-weight", "letter-spacing", "line-height",
    "text-transform", "opacity", "box-shadow", "transform", "filter", "visibility", "overflow", "white-space", "text-align", "justify-content", "align-items", "flex", "grid-template-columns"];
  const out = {};
  const keyOf = (el) => {
    const parts = [];
    for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
      let k = e.tagName.toLowerCase();
      if (e.id) { parts.unshift(`${k}#${e.id}`); break; }
      const cls = [...e.classList].filter((c) => !/^(skel-step-ready|topbar-ready)$/.test(c)).slice(0, 3);
      if (cls.length) k += `.${cls.join(".")}`;
      const same = e.parentElement ? [...e.parentElement.children].filter((c) => c.tagName === e.tagName) : [];
      if (same.length > 1) k += `:${same.indexOf(e) + 1}`;
      parts.unshift(k);
    }
    return parts.join(">");
  };
  let n = 0;
  for (const el of document.querySelectorAll("body, body *")) {
    if (++n > 6000) break; // pełne strony (Wskazówki) — limit rozmiaru
    if (el.closest("svg") && el.tagName.toLowerCase() !== "svg") continue;
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) continue;
    const cs = getComputedStyle(el);
    const v = { rect: [r.x, r.y, r.width, r.height].map((n) => Math.round(n * 10) / 10).join(",") };
    for (const p of PROPS) v[p] = cs.getPropertyValue(p);
    out[keyOf(el)] = v;
  }
  return out;
}

function gallery(outDir, results) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const cards = results.map((r) => {
    const problems = [r.readyError && `Nie doczekano gotowości: ${r.readyError}`, ...r.errors.map((e) => `Błąd JS: ${e}`), r.misses.length && `Brak danych w atrapie: ${r.misses.join(", ")}`].filter(Boolean);
    return `<article class="${problems.length ? "bad" : ""}"><h2>${esc(r.title)} <small>${r.lang} · ${r.device}</small></h2>${problems.map((p) => `<p class="err">${esc(p)}</p>`).join("")}<a href="${r.file}"><img loading="lazy" src="${r.file}" alt="${esc(r.title)}"></a></article>`;
  }).join("\n");
  // README.md: ta sama galeria w Markdownie -- GitHub pokazuje ją z obrazkami (także na telefonie).
  const md = results.map((r) => {
    const problems = [r.readyError && `nie doczekano gotowości`, r.errors.length && `${r.errors.length} błędów JS`, r.misses.length && `brak danych: ${r.misses.join(", ")}`].filter(Boolean);
    return `### ${r.title} — ${r.lang} · ${r.device}${problems.length ? `\n\n> ⚠️ ${problems.join("; ")}` : ""}\n\n![${r.scene} ${r.lang} ${r.device}](${r.file})\n`;
  }).join("\n");
  fs.writeFileSync(path.join(outDir, "README.md"), `# Zrzuty — ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC\n\n${md}`);
  fs.writeFileSync(path.join(outDir, "index.html"), `<!doctype html><html lang="pl"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Zrzuty Familijnej</title><style>body{font:14px system-ui;background:#0b1020;color:#e5e7eb;margin:16px}main{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:16px}article{background:#151c30;border-radius:12px;padding:12px;min-width:0}article.bad{outline:2px solid #f87171}h2{font-size:15px;margin:0 0 8px}small{color:#94a3b8;font-weight:400}.err{color:#fca5a5;font-size:12px;margin:4px 0}img{display:block;width:100%;height:auto;border-radius:6px;border:1px solid #334155}</style><h1>Zrzuty — ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC</h1><main>${cards}</main></html>`);
}

(async () => {
  if (args.list) {
    for (const s of scenes) console.log(`${s.id.padEnd(22)} ${s.path.padEnd(40)} ${s.title}`);
    return;
  }
  // --homepage: tylko kadry strony głównej (scene.homepage) spośród wybranych.
  let picked = pickScenes().filter((scene) => !args.homepage || scene.homepage);
  // Dwie niezależne części audytu bez mnożenia procesów przeglądarki.
  if (args.part) {
    const [part, total] = args.part.split("/").map(Number);
    if (!Number.isInteger(part) || !Number.isInteger(total) || part < 1 || part > total) throw new Error("--part wymaga numeru części, np. 1/2");
    picked = picked.filter((_, index) => index % total === part - 1);
  }
  if (!picked.length) { console.log("Brak scen do zrobienia."); return; }
  if (args.dry) { console.log(picked.map((s) => s.id).join("\n")); return; }
  const langs = args.lang === "all" ? LANGS : (args.lang || "pl").split(",");
  const devices = (args.devices || "desktop,phone").split(",");
  for (const d of devices) if (!DEVICES[d]) throw new Error(`Nieznane urządzenie ${d}: ${Object.keys(DEVICES).join(", ")}`);
  const outDir = path.resolve(repo, args.out || "scripts/screens/out");
  if (!args.keep) fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  ({ buildGameState } = await import("./data/game-state.mjs"));
  const origin = await startServer();
  const browser = await launch();
  const results = [];
  try {
    for (const scene of picked) {
      for (const lang of langs) {
        const sceneDevices = scene.size ? ["size"]
          : onlyDevices[scene.id] ? [...onlyDevices[scene.id]]
          : scene.devices && !args["force-devices"] ? scene.devices.filter((d) => devices.includes(d) || args.devices == null) : devices;
        for (const device of sceneDevices) {
          const r = await capture(browser, origin, scene, lang, device, outDir);
          results.push(r);
          const flags = [r.readyError && "NIEGOTOWA", r.errors.length && `${r.errors.length} błędów JS`, r.misses.length && `brak danych: ${r.misses.join(", ")}`].filter(Boolean);
          console.log(`${flags.length ? "✗" : "✓"} ${scene.id} ${lang}/${device}${flags.length ? `  ${flags.join(" | ")}` : ""}`);
          for (const e of r.errors) console.log(`    JS: ${e}`);
          for (const a of r.audit) console.log(`    ${a.kind}: ${a.el} ${a.detail}`);
        }
      }
    }
  } finally {
    await browser.close();
    stopServer();
  }
  gallery(outDir, results);
  if (args.audit) {
    fs.writeFileSync(path.join(outDir, "layout-load.json"), JSON.stringify(results.map(({ scene, lang, device, initialLayout }) => ({ scene, lang, device, ...initialLayout })), null, 1));
    const found = results.filter((r) => r.audit.length).map(({ scene, lang, device, file, audit }) => ({ scene, lang, device, file, audit }));
    fs.writeFileSync(path.join(outDir, "audit.json"), JSON.stringify(found, null, 1));
    console.log(`Audyt układu: ${found.reduce((n, r) => n + r.audit.length, 0)} uwag w ${found.length}/${results.length} zrzutach (${path.join(outDir, "audit.json")})`);
    if (args.strict && found.length) process.exitCode = 1;
  }
  console.log(`\nGaleria: ${path.join(outDir, "index.html")} (${results.length} zrzutów)`);
  if (args.strict && results.some((r) => r.readyError || r.errors.length)) process.exitCode = 1;
})().catch((e) => { console.error(e.stack || e); stopServer(); process.exitCode = 1; });
