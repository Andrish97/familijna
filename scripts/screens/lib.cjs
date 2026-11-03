// Wspólne części zrzutów i wypalania logo: Playwright, serwer web/, CDN, kontekst z atrapą.
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { execSync } = require("node:child_process");

const repo = path.resolve(__dirname, "../..");
const webRoot = process.env.SCREENS_WEB_ROOT ? path.resolve(process.env.SCREENS_WEB_ROOT) : path.join(repo, "web");

function loadPlaywright() {
  for (const id of [path.join(repo, "tests/node_modules/playwright"), path.join(repo, "tests/node_modules/@playwright/test"), "playwright", "/opt/node22/lib/node_modules/playwright"]) {
    try { return require(id); } catch {}
  }
  throw new Error("Brak Playwrighta: cd tests && npm ci");
}

// ---------- biblioteki z CDN (lokalnie CDN bywa zablokowany) ----------
const cacheDir = path.join(os.homedir(), ".cache", "familijna-screens");
function vendorFile(pkg, version, file) {
  const dir = path.join(cacheDir, `${pkg.replace("/", "__")}@${version}`);
  const target = path.join(dir, "package", file);
  if (!fs.existsSync(target)) {
    fs.mkdirSync(dir, { recursive: true });
    try {
      const tgz = execSync(`npm pack ${pkg}@${version} --silent`, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim().split("\n").pop();
      execSync(`tar xzf ${JSON.stringify(tgz)}`, { cwd: dir });
    } catch { return null; }
  }
  return fs.existsSync(target) ? fs.readFileSync(target) : null;
}
async function routeCdn(route) {
  const url = new URL(route.request().url());
  if (/\/npm\/@supabase\/supabase-js/.test(url.pathname)) return route.fulfill({ contentType: "text/javascript", body: fs.readFileSync(path.join(__dirname, "fake-supabase.js")) });
  if (/\/npm\/qrcode@1\.5\.3\/\+esm/.test(url.pathname)) return route.fulfill({ contentType: "text/javascript", body: fs.readFileSync(path.join(repo, "scripts/agent-tools/qrcode.esm.js")) });
  const m = url.pathname.match(/^\/npm\/((?:@[^/]+\/)?[^@/]+)@([^/]+)\/(.+)$/);
  if (m && !m[3].startsWith("+esm")) {
    const body = vendorFile(m[1], m[2], m[3]);
    if (body) return route.fulfill({ contentType: m[3].endsWith(".css") ? "text/css" : "text/javascript", body });
  }
  return route.continue().catch(() => route.abort());
}

// ---------- serwer plików web/ ----------
const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".mp3": "audio/mpeg", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json" };
// Strony idą pod prawdziwym adresem serwisu (żeby linki i kody QR na kadrach
// prowadziły do familijna.app, nie do 127.0.0.1) -- przeglądarka dostaje
// je z dysku przez context.route, sieć nie jest używana.
const SITE = "https://www.familijna.app";
function serveLocal(href) {
  const reqUrl = new URL(href, "http://x");
  let pathname = decodeURIComponent(reqUrl.pathname);
  // Ramka dla stron, które w trybie podglądu przyjmują stan tylko od rodzica
  // (Prowadzący ?preview=1): /__screens__/frame.html?src=/control/host/?preview=1
  if (pathname === "/__screens__/frame.html") {
    const src = reqUrl.searchParams.get("src") || "/";
    return { status: 200, type: mime[".html"], body: `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;height:100%;background:#000}iframe{display:block;border:0;width:100%;height:100%}</style><iframe id="screensFrame" src="${src.replace(/"/g, "&quot;")}"></iframe>` };
  }
  if (pathname.endsWith("/")) pathname += "index.html";
  let file = path.resolve(webRoot, `.${pathname}`);
  if (!file.startsWith(webRoot)) return { status: 403, type: "text/plain", body: "" };
  if (!fs.existsSync(file) && fs.existsSync(path.join(file, "index.html"))) file = path.join(file, "index.html");
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) return { status: 404, type: "text/plain", body: "Not found" };
  return { status: 200, type: mime[path.extname(file)] || "application/octet-stream", body: fs.readFileSync(file) };
}
const server = http.createServer((req, res) => {
  res.on("error", () => {});
  const r = serveLocal(req.url);
  res.writeHead(r.status, { "content-type": r.type });
  res.end(r.body);
});

async function startServer() {
  // Serwer HTTP zostaje do ręcznego podglądu (SCREENS_LOCAL=1); zrzuty używają SITE.
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return process.env.SCREENS_LOCAL ? `http://127.0.0.1:${server.address().port}` : SITE;
}
function stopServer() { server.close(); }

async function launch() {
  const { chromium } = loadPlaywright();
  return chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
}

// Kontekst przeglądarki z atrapą Supabase i danymi db (buildDb z data/demo.cjs).
// theme: "dark" (domyślnie — Wskazówki i galeria) albo "light" (jasny motyw, Auto wg systemu).
async function newContext(browser, db, lang, device, { theme = "dark" } = {}) {
  const context = await browser.newContext({
    colorScheme: theme === "light" ? "light" : "dark",
    viewport: { width: device.width, height: device.height }, deviceScaleFactor: device.scale,
    ...(device.screen ? { screen: device.screen } : {}),
    isMobile: device.mobile, hasTouch: device.mobile, locale: { pl: "pl-PL", en: "en-GB", uk: "uk-UA" }[lang],
    timezoneId: "Europe/Warsaw", serviceWorkers: "block",
  });
  await context.addInitScript(({ db, lang }) => {
    window.__SCREENS_DB__ = db;
    try {
      localStorage.setItem("uiLang", lang);
      localStorage.setItem("fam:app_rating_suppressed", "true");
      for (const [k, v] of Object.entries(db.localStorage || {})) localStorage.setItem(k, v);
    } catch {}
  }, { db, lang });
  await context.route(/^https:\/\/(cdn\.jsdelivr\.net|unpkg\.com|cdnjs\.cloudflare\.com)\//, routeCdn);
  await context.route(/^https:\/\/(?!cdn\.jsdelivr\.net|unpkg\.com|cdnjs\.cloudflare\.com)/, (route) => route.abort());
  await context.route((url) => url.origin === SITE, (route) => {
    // Atrapa warstwy Supabase zamiast prawdziwej biblioteki (web/shared/vendor).
    if (new URL(route.request().url()).pathname === "/shared/vendor/supabase-js.js") {
      return route.fulfill({ contentType: "text/javascript", body: fs.readFileSync(path.join(__dirname, "fake-supabase.js")) });
    }
    const r = serveLocal(route.request().url());
    const safe = context.__screensSafeArea;
    const body = safe && /text\/(css|html)/.test(r.type) ? rewriteSafeArea(String(r.body), safe) : r.body;
    return route.fulfill({ status: r.status, contentType: r.type, body });
  });
  for (const [pattern, body] of Object.entries(db.http || {})) {
    await context.route(`**${pattern}`, (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(body) }));
  }
  return context;
}

// Emulacja strefy bezpiecznej urządzenia (notch, pasek gestu): Chromium nie
// pozwala ustawić env(safe-area-inset-*), więc w CSS/HTML strony zamieniamy
// je na piksele. safe = { top, right, bottom, left }.
const rewriteSafeArea = (text, sides) => text.replace(/env\(\s*safe-area-inset-(top|right|bottom|left)\s*(?:,[^)]*)?\)/g, (_, side) => `${sides[side]}px`);
async function emulateSafeArea(context, origin, safe) {
  context.__screensSafeArea = { top: 0, right: 0, bottom: 0, left: 0, ...safe };
}

// Ramka iPhone'a na czarnym tle (jak kadr głosowania w dawnym panelu admina:
// web/admin/js/homepage-screenshots.js, composeIPhoneFrame). screen -- PNG
// ekranu telefonu; wynik -- PNG outputWidth × outputHeight.
async function composeIPhone(browser, screen, outputWidth = 1440, outputHeight = 900, scale = 1) {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  const data = await page.evaluate(async ({ src, outputWidth, outputHeight, scale }) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    const W = outputWidth * scale; const H = outputHeight * scale;
    const frameRatio = 0.0485;
    const screenScale = H / (img.height + 2 * img.width * frameRatio / (1 - 2 * frameRatio) + 2 * scale);
    const screenWidth = img.width * screenScale;
    const screenHeight = img.height * screenScale;
    const whiteEdge = scale;
    const bezelBlack = screenWidth * frameRatio / (1 - 2 * frameRatio);
    const bezel = bezelBlack + whiteEdge;
    const deviceWidth = screenWidth + 2 * bezel;
    const deviceX = (W - deviceWidth) / 2;
    const cornerRadius = deviceWidth * 0.16;
    const unit = screenWidth / 390; // 1 pkt ekranu iPhone'a
    const canvas = document.createElement("canvas");
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d");
    const rounded = (x, y, w, h, r) => { ctx.beginPath(); ctx.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2)); };
    ctx.fillStyle = "#000000"; ctx.fillRect(0, 0, W, H);
    ctx.save(); ctx.shadowColor = "#000b"; ctx.shadowBlur = 24 * scale;
    rounded(deviceX, 0, deviceWidth, H, cornerRadius); ctx.fillStyle = "#d7d9df"; ctx.fill(); ctx.restore();
    rounded(deviceX + whiteEdge, whiteEdge, deviceWidth - 2 * whiteEdge, H - 2 * whiteEdge, cornerRadius - whiteEdge); ctx.fillStyle = "#030407"; ctx.fill();
    const sx = deviceX + bezel; const sy = bezel;
    ctx.save(); rounded(sx, sy, screenWidth, screenHeight, cornerRadius - bezel); ctx.clip();
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, sx, sy, screenWidth, screenHeight);
    const notchW = screenWidth * 0.41; const notchH = screenHeight * 0.04; const nx = sx + (screenWidth - notchW) / 2; const curve = 22 * unit;
    ctx.beginPath(); ctx.moveTo(nx, sy); ctx.lineTo(nx + notchW, sy); ctx.lineTo(nx + notchW, sy + notchH - curve);
    ctx.quadraticCurveTo(nx + notchW, sy + notchH, nx + notchW - curve, sy + notchH); ctx.lineTo(nx + curve, sy + notchH);
    ctx.quadraticCurveTo(nx, sy + notchH, nx, sy + notchH - curve); ctx.closePath(); ctx.fillStyle = "#030407"; ctx.fill();
    ctx.fillStyle = "#111318"; ctx.beginPath(); ctx.roundRect(nx + notchW * 0.72, sy + notchH * 0.34, notchW * 0.15, notchH * 0.15, 5 * unit); ctx.fill();
    ctx.fillStyle = "#08090c"; ctx.beginPath(); ctx.arc(nx + notchW * 0.72 - 28 * unit, sy + notchH * 0.415, 5 * unit, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#ffffffa8"; ctx.beginPath(); ctx.roundRect(sx + (screenWidth - screenWidth * 0.344) / 2, sy + screenHeight - 13 * unit, screenWidth * 0.344, 5 * unit, 99); ctx.fill();
    ctx.restore();
    return canvas.toDataURL("image/png");
  }, { src: `data:image/png;base64,${screen.toString("base64")}`, outputWidth, outputHeight, scale });
  await page.close();
  return Buffer.from(data.split(",")[1], "base64");
}

// Ramka urządzenia dla zrzutów Wskazówek: iPhone albo iPad, pionowo lub poziomo (z proporcji
// zrzutu), wyśrodkowana na przezroczystym tle outputWidth × outputHeight — każdy zrzut
// telefonu i tabletu ma wtedy ten sam rozmiar co zrzut z komputera.
async function composeDevice(browser, screen, { kind = "iphone", outputWidth = 1400, outputHeight = 875, pad = 18 } = {}) {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  const data = await page.evaluate(async ({ src, kind, W, H, pad }) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    const iphone = kind === "iphone";
    const sw = img.width, sh = img.height, short = Math.min(sw, sh);
    const k = iphone ? 0.05 : 0.055;            // ramka jako część krótszego boku ekranu
    const s = Math.min((W - 2 * pad) / (sw + 2 * k * short), (H - 2 * pad) / (sh + 2 * k * short));
    const w = sw * s, h = sh * s, b = k * short * s;
    const dw = w + 2 * b, dh = h + 2 * b, dx = (W - dw) / 2, dy = (H - dh) / 2;
    const r = Math.min(dw, dh) * (iphone ? 0.16 : 0.07);
    const canvas = document.createElement("canvas");
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d");
    const rounded = (x, y, ww, hh, rr) => { ctx.beginPath(); ctx.roundRect(x, y, ww, hh, Math.max(0, Math.min(rr, ww / 2, hh / 2))); };
    ctx.save(); ctx.shadowColor = "#0009"; ctx.shadowBlur = 22;
    rounded(dx, dy, dw, dh, r); ctx.fillStyle = "#cfd2d8"; ctx.fill(); ctx.restore();
    const edge = 2.5;
    rounded(dx + edge, dy + edge, dw - 2 * edge, dh - 2 * edge, r - edge); ctx.fillStyle = "#07080b"; ctx.fill();
    const sx = dx + b, sy = dy + b;
    ctx.save(); rounded(sx, sy, w, h, iphone ? r - b : r * 0.45); ctx.clip();
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, sx, sy, w, h);
    ctx.restore();
    const portrait = h >= w;
    if (iphone) {
      // wyspa z aparatem na krótszym boku (góra w pionie, lewo w poziomie)
      const len = Math.min(w, h) * 0.3, th = Math.min(w, h) * 0.075;
      ctx.fillStyle = "#020203";
      if (portrait) rounded(sx + (w - len) / 2, sy + th * 0.45, len, th, th / 2);
      else rounded(sx + th * 0.45, sy + (h - len) / 2, th, len, th / 2);
      ctx.fill();
    } else {
      // aparat iPada na środku ramki (krótszy bok w pionie, dłuższy w poziomie)
      ctx.fillStyle = "#1c1f26";
      ctx.beginPath();
      if (portrait) ctx.arc(dx + dw / 2, dy + b / 2, b * 0.16, 0, Math.PI * 2);
      else ctx.arc(dx + b / 2, dy + dh / 2, b * 0.16, 0, Math.PI * 2);
      ctx.fill();
    }
    return canvas.toDataURL("image/png");
  }, { src: `data:image/png;base64,${screen.toString("base64")}`, kind, W: outputWidth, H: outputHeight, pad });
  await page.close();
  return Buffer.from(data.split(",")[1], "base64");
}

module.exports = { repo, startServer, stopServer, launch, newContext, emulateSafeArea, composeIPhone, composeDevice };
