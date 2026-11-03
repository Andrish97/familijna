#!/usr/bin/env node
// Publikuje zrzuty użyte w podręczniku (![Podpis](zrzut:scena@urządzenie) w docs/podrecznik)
// z wyniku run.cjs do web/manual/img/<język>/<scena>-<urządzenie>.webp.
// Użycie:
//   node scripts/screens/publish-manual.cjs --list      -- zrzuty do zrobienia „scena@urządzenie” (lista dla --scenes=)
//   node scripts/screens/run.cjs --scenes=$(node scripts/screens/publish-manual.cjs --list) --lang=all \
//     && node scripts/screens/publish-manual.cjs
//   node scripts/screens/publish-manual.cjs --list --base=<ref>  -- tylko sceny do odświeżenia: zmiany od <ref>
//     wg changes.cjs (jak run.cjs --changed) albo brak pliku (workflow screens.yml)
//   opcje: --out=<katalog wyniku run.cjs> (domyślnie scripts/screens/out), --strict (wymaga kompletu)
//   --theme=light -- zrzuty z run.cjs --theme=light do web/manual/img/<język>/light/ (jasny motyw Wskazówek)
const fs = require("node:fs");
const path = require("node:path");
const { repo, launch, composeDevice } = require("./lib.cjs");
const scenes = require("./scenes.cjs");
const { selectChanged } = require("./changes.cjs");

const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const [key, ...rest] = arg.replace(/^--/, "").split("=");
  return [key, rest.length ? rest.join("=") : "true"];
}));
const outDir = path.resolve(repo, args.out || "scripts/screens/out");
const CONTENT = path.join(repo, "web/manual/content");
const MAX_WIDTH = 1400;
const LIGHT = args.theme === "light";
// Plik w motywie: ciemny img/<język>/<plik>, jasny img/<język>/light/<plik>.
const themed = (file) => (LIGHT ? file.replace(/^img\/(pl|en|uk)\//, "img/$1/light/") : file);

// Zrzuty wskazane w wygenerowanej treści: { lang, scene, device, file }.
function usedShots() {
  const shots = new Map();
  for (const name of fs.readdirSync(CONTENT).filter((f) => f.endsWith(".js"))) {
    const text = fs.readFileSync(path.join(CONTENT, name), "utf8");
    for (const m of text.matchAll(/\/manual\/(img\/(pl|en|uk)\/([a-z0-9-]+)-(desktop|phone-landscape|tablet-landscape|phone|tablet)\.webp)/g)) {
      shots.set(m[1], { file: m[1], lang: m[2], scene: m[3], device: m[4] });
    }
  }
  return [...shots.values()];
}

async function toWebp(page, png, maxWidth, quality) {
  const data = await page.evaluate(async ({ src, maxWidth, quality }) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    const w = Math.min(maxWidth, img.naturalWidth);
    const h = Math.round((img.naturalHeight * w) / img.naturalWidth);
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL("image/webp", quality);
  }, { src: `data:image/png;base64,${png.toString("base64")}`, maxWidth, quality });
  return Buffer.from(data.split(",")[1], "base64");
}

(async () => {
  const shots = usedShots();
  if (args.list) {
    let used = [...new Set(shots.map((s) => s.scene))];
    if (args.base) {
      // Te same zasady co run.cjs --changed (changes.cjs) + zrzuty, których brak w web/manual/img.
      const { all, scenes: picked, reason } = selectChanged(scenes.filter((s) => used.includes(s.id)), args.base);
      console.error(`[publish-manual] ${reason}`);
      const ids = new Set(picked.map((s) => s.id));
      const missing = new Set(shots.filter((s) => !fs.existsSync(path.join(repo, "web/manual", themed(s.file)))).map((s) => s.scene));
      used = used.filter((id) => all || ids.has(id) || missing.has(id));
    }
    // „scena@urządzenie” -- run.cjs robi tylko urządzenia użyte w treści (nie wszystkie z --devices).
    const pairs = [...new Set(shots.filter((s) => used.includes(s.scene)).map((s) => `${s.scene}@${s.device}`))];
    console.log(pairs.join(","));
    return;
  }
  const missing = [];
  const browser = await launch();
  const page = await browser.newPage();
  let written = 0;
  try {
    for (const shot of shots) {
      // Scena z własnym rozmiarem (size) zapisuje się jako <język>.png.
      const src = [`${shot.lang}-${shot.device}.png`, `${shot.lang}.png`].map((n) => path.join(outDir, shot.scene, n)).find((f) => fs.existsSync(f));
      if (!src) { missing.push(`${shot.scene}/${shot.lang}-${shot.device}`); continue; }
      const dest = path.join(repo, "web/manual", themed(shot.file));
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      // Telefon i tablet w ramce urządzenia (iPhone / iPad, pionowo lub poziomo), na tle 1400×875
      // jak zrzut z komputera; scena z własną ramką (deviceFrame) i sceny „size” zostają bez zmian.
      const scene = scenes.find((s) => s.id === shot.scene);
      let png = fs.readFileSync(src);
      if (shot.device !== "desktop" && !scene?.deviceFrame) png = await composeDevice(browser, png, { kind: shot.device.startsWith("phone") ? "iphone" : "ipad" });
      fs.writeFileSync(dest, await toWebp(page, png, MAX_WIDTH, 0.82));
      written++;
    }
  } finally {
    await browser.close();
  }
  console.log(`Zapisano ${written} zrzutów w web/manual/img/.`);
  if (missing.length) {
    console.log(`Pominięte (brak zrzutu w ${path.relative(repo, outDir)}): ${missing.join(", ")}`);
    if (args.strict) process.exitCode = 1;
  }
})().catch((e) => { console.error(e.stack || e); process.exitCode = 1; });
