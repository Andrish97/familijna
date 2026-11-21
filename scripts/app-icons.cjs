#!/usr/bin/env node
// Ikony aplikacji (PWA) dla Familijnej i panelu admina — jedno źródło: SVG.
//
// Z `web/assets/img/familijna-icon.svg` i `web/admin/icons/admin-icon.svg`
// renderuje w Chromium (Playwright z tests/node_modules) komplet PNG:
//   - `any`      192/512 px — jak SVG (zaokrąglone, przezroczyste rogi),
//   - `maskable` 192/512 px — pełne tło na cały kwadrat, rysunek wyśrodkowany
//                i zmniejszony do strefy bezpiecznej (koło 80 % boku), żeby
//                Android mógł ciąć ikonę do swojego kształtu bez białej obwódki
//                i bez pomniejszania rysunku,
//   - `apple-touch-icon` 180 px — pełne tło, bez przezroczystości (iOS sam
//                zaokrągla rogi; przezroczyste rogi iOS zamienia na czarne).
// Obie aplikacje przechodzą dokładnie tę samą ścieżkę, więc jakość jest równa.
//
// Użycie: node scripts/app-icons.cjs   (wersje ?v= dokłada build przy wdrożeniu)

const fs = require("fs");
const path = require("path");

const repo = path.resolve(__dirname, "..");

const APPS = [
  {
    svg: "web/assets/img/familijna-icon.svg",
    outDir: "web/assets/img",
    prefix: "icon",
  },
];

const ANY_SIZES = [192, 512];
const MASKABLE_SIZES = [192, 512];
const APPLE_SIZE = 180;
// Strefa bezpieczna ikony maskowalnej: koło o średnicy 80 % boku (spec. W3C),
// z lekkim zapasem na antyaliasing krawędzi systemowej maski.
const SAFE_ZONE = 0.8;
const SAFE_MARGIN = 0.96;

function loadPlaywright() {
  for (const id of [path.join(repo, "tests/node_modules/playwright"), path.join(repo, "tests/node_modules/@playwright/test"), "playwright"]) {
    try { return require(id); } catch {}
  }
  throw new Error("Brak Playwrighta: cd tests && npm ci");
}

function readSvg(file) {
  const src = fs.readFileSync(path.join(repo, file), "utf8");
  const bg = src.match(/<rect[^>]*\bfill="([^"]+)"[^>]*\/>/);
  if (!bg) throw new Error(`${file}: brak prostokąta tła (<rect … fill="…"/>)`);
  const view = src.match(/viewBox="0 0 (\d+) (\d+)"/);
  if (!view || view[1] !== view[2]) throw new Error(`${file}: oczekiwano kwadratowego viewBox "0 0 N N"`);
  const inner = src.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
  return { full: src, background: bg[1], side: Number(view[1]), artwork: inner.replace(bg[0], "") };
}

function wrap(side, background, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${side} ${side}"><rect width="${side}" height="${side}" fill="${background}"/>${body}</svg>`;
}

async function renderSvg(page, svg, size, transparent) {
  await page.setViewportSize({ width: size, height: size });
  const html = `<!doctype html><html><head><style>html,body{margin:0;padding:0;background:transparent;overflow:hidden}img{display:block;width:${size}px;height:${size}px}</style></head><body><img src="data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}"></body></html>`;
  await page.setContent(html, { waitUntil: "load" });
  return page.screenshot({ type: "png", omitBackground: transparent, clip: { x: 0, y: 0, width: size, height: size } });
}

// Środek i promień najmniejszego koła (wokół środka masy pikseli) obejmującego
// cały rysunek — liczone z pikseli, a nie z bounding boxa, więc litera „F”
// (puste rogi) dostaje większą skalę niż pełny kwadrat.
async function measureArtwork(page, side, artwork) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${side} ${side}">${artwork}</svg>`;
  await page.setViewportSize({ width: side, height: side });
  await page.setContent(`<!doctype html><html><body style="margin:0"><canvas id="c" width="${side}" height="${side}"></canvas></body></html>`);
  return page.evaluate(async ({ svg, side }) => {
    const img = new Image();
    img.src = `data:image/svg+xml;base64,${btoa(svg)}`;
    await img.decode();
    const canvas = document.getElementById("c");
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, side, side);
    const data = ctx.getImageData(0, 0, side, side).data;
    let minX = side, minY = side, maxX = -1, maxY = -1;
    for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
      if (data[(y * side + x) * 4 + 3] > 8) {
        if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
    const cx = (minX + maxX + 1) / 2, cy = (minY + maxY + 1) / 2;
    let r2 = 0;
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      if (data[(y * side + x) * 4 + 3] > 8) {
        const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
        if (dx * dx + dy * dy > r2) r2 = dx * dx + dy * dy;
      }
    }
    return { cx, cy, radius: Math.sqrt(r2) };
  }, { svg, side });
}

async function main() {
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  const written = [];
  try {
    for (const app of APPS) {
      const { full, background, side, artwork } = readSvg(app.svg);
      const outDir = path.join(repo, app.outDir);
      const save = async (name, png) => {
        fs.writeFileSync(path.join(outDir, name), png);
        written.push(path.join(app.outDir, name));
      };

      for (const size of ANY_SIZES) await save(`${app.prefix}-${size}.png`, await renderSvg(page, full, size, true));

      const m = await measureArtwork(page, side, artwork);
      const safeRadius = (side * SAFE_ZONE * SAFE_MARGIN) / 2;
      const scale = Math.min(1, safeRadius / m.radius);
      const centered = `<g transform="translate(${side / 2} ${side / 2}) scale(${scale.toFixed(4)}) translate(${(-m.cx).toFixed(2)} ${(-m.cy).toFixed(2)})">${artwork}</g>`;
      const maskable = wrap(side, background, centered);
      for (const size of MASKABLE_SIZES) await save(`${app.prefix}-maskable-${size}.png`, await renderSvg(page, maskable, size, false));

      const apple = wrap(side, background, artwork);
      await save(`${app.prefix}-apple-touch-${APPLE_SIZE}.png`, await renderSvg(page, apple, APPLE_SIZE, false));
      console.log(`${app.svg}: rysunek r=${m.radius.toFixed(1)} px, skala maskable ${scale.toFixed(3)}`);
    }
  } finally {
    await browser.close();
  }
  for (const f of written) console.log("zapisano", f);
}

main().catch((err) => { console.error(err); process.exit(1); });
