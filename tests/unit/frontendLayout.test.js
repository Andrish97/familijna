import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pageIndexPath, fetchFromOrigin, isBlockedPath, isLockedSnake } from "../../cloudflare/maintenance-worker/src/lib/origin/origin.js";
import { isStaticAssetPath, isMaintenanceAsset } from "../../cloudflare/maintenance-worker/src/lib/origin/assets.js";

const ROOT = fileURLToPath(new URL("../../web/", import.meta.url));
function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file, out); else out.push(file);
  }
  return out;
}
const files = walk(ROOT);
test("frontend HTML, module imports, CSS fonts and literal data URLs resolve", () => {
  const broken = [];
  const check = (file, value, module = false) => {
    const ref = value.split(/[?#]/)[0];
    if (!ref || /^(?:[a-z]+:|\/\/|#)/i.test(ref) || ref.includes("${") || ref.includes("<")) return;
    if (!/\.(?:js|mjs|css|json|woff2?|ttf|otf|svg|png|jpe?g|ico|mp3)$/.test(ref)) return;
    const target = ref.startsWith("/") ? path.join(ROOT, ref.slice(1)) : path.resolve(module ? path.dirname(file) : ROOT, ref);
    if (!fs.existsSync(target)) broken.push(`${path.relative(ROOT, file)} → ${value}`);
  };
  for (const file of files) {
    if (!/\.(?:html|js|css)$/.test(file)) continue;
    const source = fs.readFileSync(file, "utf8").replace(/<!--[\s\S]*?-->|\/\*[\s\S]*?\*\//g, "");
    if (file.endsWith(".html")) for (const m of source.matchAll(/\b(?:src|href)=["']([^"']+)["']/g)) check(file, m[1], true);
    if (/\.(?:js|html)$/.test(file)) {
      for (const m of source.matchAll(/\b(?:from\s+|import\s*(?:\(\s*)?)["']([^"']+)["']/g)) check(file, m[1], true);
      for (const m of source.matchAll(/\b(?:fetch|loadJson|loadFont5x7)\(\s*["']([^"']+)["']/g)) check(file, m[1]);
      for (const m of source.matchAll(/new URL\(["']([^"']+)["'],\s*import.meta.url\)/g)) check(file, m[1], true);
    }
    if (file.endsWith(".css")) for (const m of source.matchAll(/url\(["']?([^)'"\s]+)/g)) check(file, m[1], true);
  }
  assert.deepEqual(broken, []);
});

test("current device pages occupy the canonical folders without legacy copies", () => {
  for (const device of ["control", "control/display", "control/host", "control/buzzer", "games/settings"]) {
    const dir = path.join(ROOT, device);
    assert.ok(fs.existsSync(path.join(dir, "index.html")), `${device}/index.html`);
    assert.equal(fs.existsSync(path.join(ROOT, `${device}2`)), false, `${device}2 was removed`);
  }
  for (const file of files.filter(f => /\/(?:control|games\/settings|shared)\//.test(f) && f.endsWith(".js"))) {
    const source = fs.readFileSync(file, "utf8");
    assert.doesNotMatch(source, /["'`]\/(?:control|display|host|buzzer|game-settings)2(?:\/|\?|["'`])/);
  }
});

test("all page folders use index.html, and Worker fetches them without redirects", async (t) => {
  for (const file of files.filter(f => path.basename(f) === "index.html" && f !== path.join(ROOT, "index.html") && !f.includes("/admin/"))) {
    const route = "/" + path.relative(ROOT, path.dirname(file));
    assert.equal(pageIndexPath(route), route + "/index.html");
    assert.equal(pageIndexPath(route + "/"), route + "/index.html");
  }
  assert.equal(pageIndexPath("/builder"), "/builder");
  assert.equal(fs.existsSync(path.join(ROOT, "builder.html")), false);
  const { bindStaticAssets } = await import("../../cloudflare/maintenance-worker/src/lib/origin/origin.js");
  const requests = [];
  bindStaticAssets({ ASSETS: { fetch: async (req) => { requests.push(req.url); return new Response("page", { headers: { "Content-Type": "text/html" } }); } } });
  t.after(() => bindStaticAssets({}));
  const result = await fetchFromOrigin(new Request("https://www.familijna.app/games/?lang=en"), new URL("https://www.familijna.app/games/?lang=en"), "https://www.familijna.app");
  assert.equal(result.status, 200);
  assert.deepEqual(requests, ["https://www.familijna.app/games/index.html?lang=en"]);
});

test("public application blocks private panel assets and allows maintenance assets", () => {
  for (const ref of ["/admin/index.html", "/admin/js/admin.js", "/admin/tools/editor_5x7.html"]) assert.equal(isBlockedPath("www.familijna.app", ref), true, ref);
  assert.equal(isStaticAssetPath("/admin/js/admin.js"), false);
  assert.equal(isStaticAssetPath("/shared/js/core/auth.js"), true);
  assert.equal(isMaintenanceAsset("/maintenance/"), true);
  assert.equal(isMaintenanceAsset("/maintenance/js/maintenance.js"), true);
});

test("sound manifest and display theme modules point to existing assets", () => {
  const sounds = JSON.parse(fs.readFileSync(path.join(ROOT, "shared/data/sounds.json"), "utf8"));
  for (const category of sounds.categories) for (const sound of category.sounds) assert.ok(fs.existsSync(path.join(ROOT, "assets/audio", category.folder, sound.file.split("?")[0])), category.folder + "/" + sound.file);
  const themes = JSON.parse(fs.readFileSync(path.join(ROOT, "shared/themes/index.json"), "utf8"));
  for (const theme of themes.themes) assert.ok(fs.existsSync(path.join(ROOT, theme.file.replace(/^\//, "").split("?")[0])), theme.file);
  const hostThemeCss = fs.readFileSync(path.join(ROOT, "control/host/css/host.css"), "utf8");
  assert.match(hostThemeCss, /data-host-ruled="false"/);
  assert.doesNotMatch(hostThemeCss, /data-host-theme="modern"/);
  for (const name of ["font_5x7.json", "font_3x10.json", "font_win.json"]) assert.ok(fs.existsSync(path.join(ROOT, "shared/fonts/display", name)));
  assert.doesNotThrow(() => JSON.parse(fs.readFileSync(path.join(ROOT, "shared/data/logo_familijna.json"), "utf8")));
});

test("ukryty wąż: /snake/ tylko z linkiem z kodu QR (id demo), bez niego 404", () => {
  const u = (path) => new URL(`https://www.familijna.app${path}`);
  for (const path of ["/snake", "/snake/", "/snake/index.html", "/snake/?lang=pl", "/snake/?qr=8f14e45f-ceea-467a-9c2b-2f3a1d6e5b10", "/snake/?qr=00000000-0000-4000-8000-0000000001"]) {
    assert.equal(isLockedSnake(u(path)), true, path);
  }
  for (const path of ["/snake/?qr=00000000-0000-4000-8000-000000000103", "/snake/?qr=00000000-0000-4000-8000-000000000103&lang=uk", "/snake/js/snake.js", "/snake/css/snake.css", "/go/"]) {
    assert.equal(isLockedSnake(u(path)), false, path);
  }
});

// Zgłoszenie 2026-10-29: na telefonie link pod planszą węża (.snake-links
// z display:flex) wygrywał z .snake-desktop { display:none } i spychał planszę
// poza ekran; przyciski w rogach leżały na planszy.
test("wąż: na dotyku bez linków pod planszą, przyciski w pasie nad planszą", () => {
  const css = fs.readFileSync(new URL("../../web/snake/css/snake.css", import.meta.url), "utf8");
  const touch = css.slice(css.indexOf("@media (pointer: coarse)"));
  assert.match(touch, /\.snake-wrap \.snake-desktop \{ display: none; \}/);
  assert.match(touch, /padding: calc\(var\(--safe-top\) \+ var\(--snake-bar\)\)/);
  assert.match(touch, /- var\(--snake-bar\)\) \* 16 \/ 9\)/);
});
