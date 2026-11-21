// Ikony aplikacji (PWA): obie aplikacje — Familijna i panel admina — mają ten sam
// komplet ikon (any 192/512, maskable 192/512, apple-touch 180) wygenerowany
// z SVG przez scripts/app-icons.cjs; manifesty i nagłówki stron wskazują
// istniejące pliki o zadeklarowanych wymiarach.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../web");
const read = (rel) => fs.readFileSync(path.join(web, rel), "utf8");
const stripV = (src) => src.replace(/\?v=[^"']*$/, "");

function pngSize(rel) {
  const buf = fs.readFileSync(path.join(web, rel));
  assert.equal(buf.toString("ascii", 1, 4), "PNG", `${rel}: nie jest PNG`);
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), colorType: buf[25] };
}

const APPS = [
  { manifest: "manifest.json", dir: "/assets/img", prefix: "icon", pages: ["index.html", "games/index.html", "connect/index.html", "logos/index.html", "logos/editor/draw/index.html", "logos/editor/image/index.html", "logos/editor/text/index.html"] },
];

for (const app of APPS) {
  test(`${app.manifest}: komplet ikon any + maskable, pliki istnieją i mają zadeklarowane wymiary`, () => {
    const m = JSON.parse(read(app.manifest));
    const byPurpose = { any: [], maskable: [] };
    for (const icon of m.icons) {
      const src = stripV(icon.src);
      assert.ok(src.startsWith(`${app.dir}/${app.prefix}-`), `${src}: ikona spoza ${app.dir}`);
      const { width, height, colorType } = pngSize(src.slice(1));
      assert.equal(`${width}x${height}`, icon.sizes, `${src}: wymiary inne niż w manifeście`);
      assert.equal(icon.type, "image/png");
      byPurpose[icon.purpose].push(icon.sizes);
      // Ikona maskowalna wypełnia cały kwadrat (bez kanału alfa) — Android
      // tnie ją do swojego kształtu bez białej obwódki.
      if (icon.purpose === "maskable") assert.equal(colorType, 2, `${src}: maskable musi być bez przezroczystości`);
    }
    assert.deepEqual(byPurpose.any.sort(), ["192x192", "512x512"]);
    assert.deepEqual(byPurpose.maskable.sort(), ["192x192", "512x512"]);
  });

  test(`${app.manifest}: strony z manifestem mają apple-touch-icon 180 px bez przezroczystości`, () => {
    const href = `${app.dir}/${app.prefix}-apple-touch-180.png`;
    const { width, height, colorType } = pngSize(href.slice(1));
    assert.equal(`${width}x${height}`, "180x180");
    assert.equal(colorType, 2, `${href}: apple-touch-icon musi być bez przezroczystości`);
    for (const page of app.pages) {
      const html = read(page);
      assert.match(html, new RegExp(`<link rel="manifest" href="/${app.manifest.replace(".", "\\.")}"`), `${page}: brak manifestu`);
      assert.match(html, new RegExp(`<link rel="apple-touch-icon" sizes="180x180" href="${href}"`), `${page}: brak apple-touch-icon`);
    }
  });
}

test("ikony aplikacji pochodzą z SVG i nie zawierają starego rozmiaru 1024", () => {
  const a = read("assets/img/familijna-icon.svg");
  assert.match(a, /viewBox="0 0 512 512"/);
  assert.equal(fs.existsSync(path.join(web, "assets/img/icon-1024.png")), false, "stara ikona 1024 px — generować przez scripts/app-icons.cjs");
});
