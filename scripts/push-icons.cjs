#!/usr/bin/env node
// Ikony powiadomień push (E29) z ikon SVG aplikacji (web/assets/icons/…,
// mapa nazw w web/shared/js/core/icons.js). Powiadomienia przyjmują tylko
// obrazki rastrowe (Android nie pokazuje SVG), więc renderujemy PNG
// w Chromium (Playwright z tests/node_modules), tą samą drogą co
// scripts/app-icons.cjs:
//   <nazwa>.png         192 px — rysunek w kolorze aplikacji na jej tle,
//   badge-<nazwa>.png    96 px — biała sylwetka na przezroczystym (pasek Androida),
//   action-<nazwa>.png   48 px — rysunek na przezroczystym (przyciski powiadomienia).
// Wyjście: web/assets/img/push/ (aplikacja) oraz katalog panelu admina
// (domyślnie ../familijna-server/admin-panel/web/admin/icons/push, gdy istnieje;
// inny: --admin-out=ŚCIEŻKA).
//
// Użycie: node scripts/push-icons.cjs   (wersje ?v= robi CI)

const fs = require("fs");
const path = require("path");

const repo = path.resolve(__dirname, "..");
const BG = "#0f0f0f";
const FG = "#e5f34f";
const ACTION = "#8a8f98";

// Ikony rodzajów (duża i pasek) oraz przycisków — wg planu „Ikony rodzajów”.
const KINDS = ["people", "polls", "bell", "folder", "display", "gamepad", "image",
  "envelope-in", "megaphone", "check", "pause", "warning", "error"];
const ACTIONS = ["arrow-right", "check", "folder-open", "envelope-in", "reply", "eye"];

function iconFile(name) {
  const src = fs.readFileSync(path.join(repo, "web/shared/js/core/icons.js"), "utf8");
  const m = src.match(new RegExp(`(?:^|[\\s{,])"?${name.replace(/-/g, "\\-")}"?:\\s*"/(assets/icons/[^"?]+)`, "m"));
  if (!m) throw new Error(`Brak ikony ${name} w icons.js`);
  return path.join(repo, "web", m[1]);
}

function glyph(name, color, x, y, size) {
  let svg = fs.readFileSync(iconFile(name), "utf8").trim();
  svg = svg.replace(/currentColor/g, color)
    .replace(/<svg\b([^>]*)>/, (_, attrs) => `<svg${attrs.replace(/\s(width|height|x|y|id)="[^"]*"/g, "")} x="${x}" y="${y}" width="${size}" height="${size}">`);
  return svg;
}

function compose(side, body, background) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${side} ${side}" width="${side}" height="${side}">`
    + (background ? `<rect width="${side}" height="${side}" fill="${background}"/>` : "")
    + body + "</svg>";
}

function loadPlaywright() {
  for (const id of [path.join(repo, "tests/node_modules/playwright"), path.join(repo, "tests/node_modules/@playwright/test"), "playwright"]) {
    try { return require(id); } catch {}
  }
  throw new Error("Brak Playwrighta: cd tests && npm ci");
}

async function render(page, svg, size, transparent) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<!doctype html><html><head><style>html,body{margin:0;padding:0;background:transparent;overflow:hidden}img{display:block;width:${size}px;height:${size}px}</style></head><body><img src="data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}"></body></html>`, { waitUntil: "load" });
  return page.screenshot({ type: "png", omitBackground: transparent, clip: { x: 0, y: 0, width: size, height: size } });
}

async function main() {
  const adminArg = process.argv.find((a) => a.startsWith("--admin-out="));
  const adminDefault = path.resolve(repo, "../familijna-server/admin-panel/web/admin/icons/push");
  const outs = [path.join(repo, "web/assets/img/push")];
  if (adminArg) outs.push(path.resolve(adminArg.slice("--admin-out=".length)));
  else if (fs.existsSync(path.dirname(adminDefault))) outs.push(adminDefault);

  const { chromium } = loadPlaywright();
  const browser = await chromium.launch(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {});
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  const files = {};
  for (const name of KINDS) {
    // Duża ikona: Android przycina do koła — rysunek w środkowych ~58 %.
    files[`${name}.png`] = await render(page, compose(192, glyph(name, FG, 40, 40, 112), BG), 192, false);
    files[`badge-${name}.png`] = await render(page, compose(96, glyph(name, "#ffffff", 12, 12, 72)), 96, true);
  }
  for (const name of ACTIONS) {
    files[`action-${name}.png`] = await render(page, compose(48, glyph(name, ACTION, 6, 6, 36)), 48, true);
  }
  await browser.close();
  for (const dir of outs) {
    fs.mkdirSync(dir, { recursive: true });
    for (const [file, buf] of Object.entries(files)) fs.writeFileSync(path.join(dir, file), buf);
    console.log(`zapisano ${Object.keys(files).length} plików: ${path.relative(repo, dir) || dir}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
