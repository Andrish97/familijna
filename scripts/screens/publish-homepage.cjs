#!/usr/bin/env node
// Publikuje kadry strony głównej z wyniku run.cjs do plików strony:
//   web/assets/img/<język>/shots/<scena>.webp          -- pełny kadr (przeglądarka zdjęć)
//   web/assets/img/<język>/shots/<scena>-preview.webp  -- podgląd na kaflu (960 px)
//   web/assets/img/og/og-image.webp                    -- podgląd linku (scena og-image, PL)
//   web/assets/img/og/og-image-mail.webp               -- ta sama grafika w mailu marketingowym (1032 px)
// Użycie (po zrzutach scen homepage we wszystkich językach):
//   node scripts/screens/run.cjs --scenes=<homepage> --lang=all && node scripts/screens/publish-homepage.cjs
//   opcje: --out=<katalog wyniku run.cjs> (domyślnie scripts/screens/out), --strict (wymaga wszystkich kadrów)
//   --theme=light -- kadry z run.cjs --theme=light do web/assets/img/<język>/shots/light/ (bez og-image)
const fs = require("node:fs");
const path = require("node:path");
const { repo, launch } = require("./lib.cjs");
const scenes = require("./scenes.cjs");

const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const [key, ...rest] = arg.replace(/^--/, "").split("=");
  return [key, rest.length ? rest.join("=") : "true"];
}));
const outDir = path.resolve(repo, args.out || "scripts/screens/out");
const LANGS = ["pl", "en", "uk"];
const PREVIEW_WIDTH = 960;
const OG_MAIL_WIDTH = 1032;

// Plik wyniku run.cjs dla sceny strony głównej: własny rozmiar, telefon albo komputer.
function sourceFile(scene, lang) {
  const names = scene.size ? [`${lang}.png`] : scene.devices?.includes("phone") && !scene.devices.includes("desktop") ? [`${lang}-phone.png`] : [`${lang}-desktop.png`];
  return names.map((name) => path.join(outDir, scene.id, name)).find((file) => fs.existsSync(file)) || null;
}

async function toWebp(page, png, width, quality) {
  const data = await page.evaluate(async ({ src, width, quality }) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    const w = width || img.naturalWidth;
    const h = Math.round((img.naturalHeight * w) / img.naturalWidth);
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL("image/webp", quality);
  }, { src: `data:image/png;base64,${png.toString("base64")}`, width, quality });
  return Buffer.from(data.split(",")[1], "base64");
}

(async () => {
  const homepage = scenes.filter((scene) => scene.homepage);
  const missing = [];
  const browser = await launch();
  const page = await browser.newPage();
  let written = 0;
  try {
    for (const lang of LANGS) {
      const dir = path.join(repo, "web/assets/img", lang, "shots", ...(args.theme === "light" ? ["light"] : []));
      fs.mkdirSync(dir, { recursive: true });
      for (const scene of homepage) {
        const file = sourceFile(scene, lang);
        if (!file) { missing.push(`${scene.id}/${lang}`); continue; }
        const png = fs.readFileSync(file);
        if (scene.id === "og-image") {
          // Podgląd linku i grafika maila są jedne dla wszystkich (bez motywu).
          if (lang === "pl" && args.theme !== "light") {
            fs.writeFileSync(path.join(repo, "web/assets/img/og/og-image.webp"), await toWebp(page, png, 0, 0.9));
            // Pierwszy obraz maila „Zaproszenie” w prywatnym panelu:
            // 2× szerokości maila (516 px), odświeżany razem z grafiką OG.
            fs.writeFileSync(path.join(repo, "web/assets/img/og/og-image-mail.webp"), await toWebp(page, png, OG_MAIL_WIDTH, 0.82));
            written += 2;
          }
          continue;
        }
        fs.writeFileSync(path.join(dir, `${scene.id}.webp`), await toWebp(page, png, 0, 0.88));
        fs.writeFileSync(path.join(dir, `${scene.id}-preview.webp`), await toWebp(page, png, PREVIEW_WIDTH, 0.85));
        written += 2;
      }
    }
  } finally {
    await browser.close();
  }
  console.log(`Zapisano ${written} plików w web/assets/img/<język>/shots/ i og-image.`);
  // Częściowa publikacja (np. tylko zmienione sceny) jest poprawna; --strict wymaga kompletu.
  if (missing.length) {
    console.log(`Pominięte (brak zrzutu w ${path.relative(repo, outDir)}): ${missing.join(", ")}`);
    if (args.strict) process.exitCode = 1;
  }
})().catch((e) => { console.error(e.stack || e); process.exitCode = 1; });
