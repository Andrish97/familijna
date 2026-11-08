// familiada/logos/js/image.js
// Tryb IMAGE: obraz użytkownika + kadr 26:11 + korekty (jasność, kontrast,
// gamma, poziomy, dither) -> PIX 150x70.
//
// Źródło obrazu w zapisie (payload.source):
//   imageUrl  – publiczny URL w Storage (bucket user-logos), normalny przypadek
//   imageData – data: URI (demo / import pliku .famlogo z osadzonym obrazem)
// Nowy plik z dysku trafia do Storage dopiero przy zapisie.

import { alertModal } from "../../shared/js/core/modal.js?v=v2026-11-08T23273";
import { t } from "../../shared/translation/translation.js?v=v2026-11-08T23273";
import { sb } from "../../shared/js/core/supabase.js?v=v2026-11-08T23273";
import { DOT_W, DOT_H, TYPE_PIX, PIX_FORMAT, packBits, unpackBits, fitPreview } from "./render.js?v=v2026-11-08T23273";
import { setBox } from "../../shared/js/core/geometry.js?v=v2026-11-08T23273";
import { setVars } from "../../shared/js/core/ui-metrics.js?v=v2026-11-08T23273";
import { wrapStepper, bindSteppers } from "./stepper.js?v=v2026-11-08T23273";


const ASPECT = 26 / 11;
const BUCKET = "user-logos";
// Muszą się zgadzać z ustawieniami bucketu (migracja 178), inaczej upload
// kończy się niezrozumiałym błędem Storage. SVG celowo pominięte: bucket
// jest publiczny, a SVG otwarte bezpośrednio może wykonać skrypt.
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];

const DEFAULTS = {
  invert: true,
  bright: 0,
  contrast: 0,
  gamma: 1.0,
  ditherAmt: 0.8,
  black: 0,
  white: 100,
  straighten: 0,
};

// Obrót: przyciski co 90° + prostowanie ±30°. Obraz obracamy raz, na
// osobnym płótnie („obraz roboczy”), a kadr, podgląd i kropki liczą się z
// niego -- reszta logiki się nie zmienia. Przy kącie 0 obrazem roboczym jest
// sam oryginał, więc logo bez obrotu dają dokładnie te same kropki co dawniej.
const STRAIGHTEN_MAX = 30;
const MAX_WORK_SIDE = 2560;    // większe obrazy obracamy w zmniejszeniu (kropek jest 150x70)
const MAX_PREVIEW_SIDE = 1400; // obrazek pod ramką -- tylko do oglądania

const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const num = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
const show = (el, on) => { if (el) el.hidden = !on; };

/** Ścieżka pliku w buckecie z publicznego URL albo null, gdy to nie plik tego usera. */
export function storagePathFromUrl(url, userId) {
  const s = String(url || "");
  const marker = `/${BUCKET}/`;
  const i = s.indexOf(marker);
  if (i < 0 || !userId) return null;
  const path = s.slice(i + marker.length).split("?")[0];
  return path.startsWith(`${userId}/`) ? path : null;
}

export function initImageEditor(ctx) {
  // =========================================================
  // DOM
  // =========================================================
  const $ = (id) => document.getElementById(id);
  const paneImage = $("paneImage");
  const imgFile = $("imgFile");
  const imgStage = $("imgStage");
  const imgPreview = $("imgPreview");
  const cropFrame = $("cropFrame");
  const imgBigPreview = $("imgBigPreview");
  // podgląd rysowany w rozmiarze swojego miejsca (zmienia się z układem edytora)
  const drawImgPreview = imgBigPreview ? fitPreview(imgBigPreview) : () => {};
  const chkInvert = $("chkImgInvert");
  const btnImgResetDefault = $("btnImgResetDefault");

  // suwak -> [input, etykieta w panelu, formatowanie]
  const fmtSigned = (n) => { const x = Math.round(num(n, 0)); return x > 0 ? `+${x}` : `${x}`; };
  const fmtInt = (n) => String(Math.round(num(n, 0)));
  const fmt2 = (n) => num(n, 0).toFixed(2);
  const fmtDeg = (n) => { const x = Math.round(num(n, 0) * 10) / 10; return `${x > 0 ? "+" : ""}${x}°`; };
  const SLIDERS = {
    bright:    { input: $("rngImgBright"),    label: $("valImgBright"),    fmt: fmtSigned },
    contrast:  { input: $("rngImgContrast"),  label: $("valImgContrast"),  fmt: fmtSigned },
    gamma:     { input: $("rngImgGamma"),     label: $("valImgGamma"),     fmt: fmt2 },
    black:     { input: $("rngImgBlack"),     label: $("valImgBlack"),     fmt: fmtInt },
    white:     { input: $("rngImgWhite"),     label: $("valImgWhite"),     fmt: fmtInt },
    ditherAmt: { input: $("rngImgDitherAmt"), label: $("valImgDitherAmt"), fmt: fmt2, panel: "dither" },
    straighten: { input: $("rngImgStraighten"), label: $("valImgStraighten"), fmt: fmtDeg },
  };

  // =========================================================
  // Stan
  // =========================================================
  let imgObj = null;            // załadowany <img> (gotowy do rysowania na canvasie)
  let imageStatus = "none";     // none | loading | ready | error
  let loadSeq = 0;              // unieważnia spóźnione wczytania po ponownym open()
  let objectUrl = null;         // blob: dla pliku z dysku (tylko do podglądu)
  let pendingFile = null;       // plik z dysku, jeszcze nie w Storage
  let imageUrl = null;          // publiczny URL w Storage (to trafia do zapisu)
  let imageData = null;         // data: URI (demo/import), gdy brak imageUrl
  let openedImageUrl = null;    // imageUrl w chwili otwarcia -- do sprzątnięcia po podmianie
  let bits = new Uint8Array(DOT_W * DOT_H);
  let rot90 = 0;                // 0 | 90 | 180 | 270 (przyciski)
  let work = null;              // obraz roboczy, patrz buildWork()
  let previewUrl = null;        // blob: obrazka pod ramką, gdy obraz jest obrócony
  let rotSeq = 0;
  let rotating = false;         // w trakcie przebudowy obrazu roboczego zapis czeka

  // Kadr: w pikselach pola (`crop`) i -- źródło prawdy -- względem
  // WYŚWIETLONEGO obrazu (`cropImg`, ułamki 0–1: x, y, w; wysokość z ASPECT).
  let crop = { x: 40, y: 40, w: 280, h: Math.round(280 / ASPECT) };
  let cropImg = null;
  // Stary zapis kadru (względem pola) czeka na prawdziwy prostokąt obrazu.
  let pendingLegacyCrop = null;
  let deb = null;

  // =========================================================
  // Ustawienia
  // =========================================================
  function syncLabels() {
    const toolbar = $("toolsImage");
    for (const [key, s] of Object.entries(SLIDERS)) {
      const txt = s.fmt(s.input?.value);
      if (s.label) s.label.textContent = txt;
      const btnVal = toolbar?.querySelector(`[data-panel='${s.panel || key}'] .imgSetBtnVal`);
      if (btnVal) btnVal.textContent = txt;
    }
  }

  function readSettings() {
    const out = { invert: !!chkInvert?.checked };
    for (const [key, s] of Object.entries(SLIDERS)) out[key] = num(s.input?.value, DEFAULTS[key]);
    return out;
  }

  function writeSettings(src) {
    if (chkInvert) chkInvert.checked = src.invert ?? DEFAULTS.invert;
    for (const [key, s] of Object.entries(SLIDERS)) {
      if (s.input) s.input.value = String(num(src[key], DEFAULTS[key]));
    }
    syncLabels();
  }

  function resetToDefaults() {
    writeSettings(DEFAULTS);
    if (imgObj && (rot90 || work?.a)) {
      void applyRotation(0, 0, { keepCrop: false });
      ctx.markDirty?.();
      return;
    }
    rot90 = 0;
    // Kadr wraca do „dużego, centralnego” -- zależy od układu, więc po reflow.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (imgObj) { cropImg = null; pendingLegacyCrop = null; initCropToCenterBig(); }
      schedulePreview(10);
    }));
    ctx.markDirty?.();
  }

  // =========================================================
  // Kadr: ograniczony do WIDOCZNEGO obrazu (object-fit: contain zostawia pasy)
  // =========================================================
  function getStageRect() {
    return imgStage?.getBoundingClientRect() || { left: 0, top: 0, width: 1, height: 1 };
  }

  function getImgRect() {
    const r = imgPreview?.getBoundingClientRect();
    return r && r.width > 1 && r.height > 1 ? r : null;
  }

  function imgOffset(imgR, stageR) {
    return { x: imgR.left - stageR.left, y: imgR.top - stageR.top };
  }

  function clampCropToImg(next) {
    const imgR = getImgRect();
    if (!imgR) return next;
    const o = imgOffset(imgR, getStageRect());

    let w = Math.max(Math.min(60, imgR.width), next.w);
    let h = Math.max(1, Math.round(w / ASPECT));
    if (w > imgR.width) { w = imgR.width; h = Math.round(w / ASPECT); }
    if (h > imgR.height) { h = imgR.height; w = Math.round(h * ASPECT); }

    const out = {
      x: clamp(next.x, o.x, o.x + imgR.width - w),
      y: clamp(next.y, o.y, o.y + imgR.height - h),
      w, h,
    };
    if (!work?.a) return out;
    // obrócony obraz: ramka nie może objąć pustych rogów -- liczymy w pikselach obrazu roboczego
    const k = work.w / imgR.width;
    // zapas 2 px ekranu: zaokrąglenia ramki w DOM nie mogą wyjść na rogi
    const r = fitCropToImage({ x: (out.x - o.x) * k, y: (out.y - o.y) * k, w: out.w * k }, work, 2 * k);
    return { x: o.x + r.x / k, y: o.y + r.y / k, w: r.w / k, h: r.w / k / ASPECT };
  }

  // =========================================================
  // Obraz roboczy (obrót) i ramka w jego granicach
  // =========================================================
  const totalAngle = (straighten) => ((rot90 + straighten) * Math.PI) / 180;

  /**
   * { el, w, h, a, sc, w0, h0 }: el = płótno z obróconym oryginałem (albo sam
   * oryginał, gdy kąt = 0), w/h jego rozmiar, a = kąt (rad), sc = skala
   * oryginał -> płótno, w0/h0 = rozmiar oryginału.
   */
  function buildWork(straighten) {
    const w0 = imgObj.naturalWidth, h0 = imgObj.naturalHeight;
    const a = totalAngle(straighten);
    if (Math.abs(Math.sin(a)) < 1e-9 && Math.cos(a) > 0) return { el: imgObj, w: w0, h: h0, a: 0, sc: 1, w0, h0 };
    const c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a));
    const bw = w0 * c + h0 * s, bh = w0 * s + h0 * c;
    const sc = Math.min(1, MAX_WORK_SIDE / Math.max(bw, bh));
    const cv = document.createElement("canvas");
    cv.width = Math.max(1, Math.round(bw * sc));
    cv.height = Math.max(1, Math.round(bh * sc));
    const g = cv.getContext("2d");
    g.imageSmoothingQuality = "high";
    g.translate(cv.width / 2, cv.height / 2);
    g.rotate(a);
    g.scale(sc, sc);
    g.drawImage(imgObj, -w0 / 2, -h0 / 2);
    return { el: cv, w: cv.width, h: cv.height, a, sc, w0, h0 };
  }

  // punkt: płótno robocze <-> oryginał (oba względem środka, oryginał w skali płótna)
  const rot = (x, y, a) => ({ x: x * Math.cos(a) - y * Math.sin(a), y: x * Math.sin(a) + y * Math.cos(a) });

  /**
   * Kadr {x, y, w} (px płótna roboczego, wysokość z ASPECT) przesunięty i w
   * razie potrzeby zmniejszony tak, żeby cały leżał na obrazie, a nie na
   * pustych rogach po obrocie. W układzie oryginału ramka jest obróconym
   * prostokątem, a oryginał zwykłym -- ramka mieści się dokładnie wtedy, gdy
   * mieści się jej obrys (bounding box), więc wystarczy przyciąć środek.
   */
  function fitCropToImage(r, W, margin = 1) {
    const c = Math.abs(Math.cos(W.a)), s = Math.abs(Math.sin(W.a));
    // zapas: brzeg obróconego obrazu jest półprzezroczysty
    const iw = W.w0 * W.sc - 2 * margin, ih = W.h0 * W.sc - 2 * margin;
    const maxW = Math.max(1, Math.min(iw / (c + s / ASPECT), ih / (s + c / ASPECT)));
    const w = Math.min(r.w, maxW), h = w / ASPECT;
    const ex = (w * c + h * s) / 2, ey = (w * s + h * c) / 2;
    const q = rot(r.x + r.w / 2 - W.w / 2, r.y + r.w / ASPECT / 2 - W.h / 2, -W.a);
    const p = rot(clamp(q.x, -iw / 2 + ex, iw / 2 - ex), clamp(q.y, -ih / 2 + ey, ih / 2 - ey), W.a);
    return { x: p.x + W.w / 2 - w / 2, y: p.y + W.h / 2 - h / 2, w };
  }

  /** Obrazek pod ramką dla obróconego obrazu (zmniejszony, JPEG -- szybko). */
  function makePreviewUrl(W) {
    const k = Math.min(1, MAX_PREVIEW_SIDE / Math.max(W.w, W.h));
    const cv = document.createElement("canvas");
    cv.width = Math.max(1, Math.round(W.w * k));
    cv.height = Math.max(1, Math.round(W.h * k));
    const g = cv.getContext("2d");
    // rogi po obrocie przezroczyste (WebP z kanałem alfa; bez obsługi WebP
    // przeglądarka daje PNG) -- pole kadru ma tło karty, bez drugiego koloru
    g.drawImage(W.el, 0, 0, cv.width, cv.height);
    return new Promise((resolve) => cv.toBlob((b) => resolve(b ? URL.createObjectURL(b) : cv.toDataURL()), "image/webp", 0.9));
  }

  /**
   * Ustawia obrót (rot90 + prostowanie) i przebudowuje obraz roboczy. Kadr
   * zostaje nad tym samym fragmentem obrazu (środek i wielkość przeliczone
   * przez obrót), a potem jest wciągany w granice obrazu.
   */
  async function applyRotation(nextRot90, nextStraighten, { keepCrop = true } = {}) {
    if (!imgObj) { rot90 = nextRot90; return; }
    const seq = ++rotSeq;
    rotating = true;
    if (imgStage) imgStage.dataset.rotating = "1"; // ramka chwilowo ukryta (też sygnał dla testów)
    try {
      await rotateNow(seq, nextRot90, nextStraighten, keepCrop);
    } finally {
      if (seq === rotSeq) { rotating = false; delete imgStage?.dataset.rotating; }
    }
  }

  async function rotateNow(seq, nextRot90, nextStraighten, keepCrop) {
    const old = work;
    let center = null, widthOrig = null;
    if (keepCrop && old && cropImg) {
      const wpx = cropImg.w * old.w;
      const p = { x: cropImg.x * old.w + wpx / 2 - old.w / 2, y: cropImg.y * old.h + wpx / ASPECT / 2 - old.h / 2 };
      const q = rot(p.x, p.y, -old.a);
      center = { x: q.x / old.sc, y: q.y / old.sc }; // oryginał, względem środka
      widthOrig = wpx / old.sc;
    }
    rot90 = ((nextRot90 % 360) + 360) % 360;
    const W = buildWork(nextStraighten);
    const url = W.a ? await makePreviewUrl(W) : null;
    if (seq !== rotSeq || ctx.getMode?.() !== "IMAGE") { if (url?.startsWith("blob:")) URL.revokeObjectURL(url); return; }
    work = W;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = url?.startsWith("blob:") ? url : null;
    setStageImage(url || imgObj.src);
    applyBestImageLayout();
    await whenPreviewReady();
    if (seq !== rotSeq) return;
    if (center) {
      const p = rot(center.x * W.sc, center.y * W.sc, W.a);
      const wpx = widthOrig * W.sc;
      cropImg = { x: (p.x + W.w / 2 - wpx / 2) / W.w, y: (p.y + W.h / 2 - wpx / ASPECT / 2) / W.h, w: wpx / W.w };
      applyCropImg();
      syncCropImg();
    } else {
      cropImg = null;
      initCropToCenterBig();
    }
    show(cropFrame, imageStatus === "ready");
    schedulePreview(10);
  }

  function applyCropToDom() {
    if (!cropFrame) return;
    setBox(cropFrame, { left: Math.round(crop.x), top: Math.round(crop.y), width: Math.round(crop.w), height: Math.round(crop.h) });
  }

  function syncCropImg() {
    const imgR = getImgRect();
    if (!imgR) return;
    const o = imgOffset(imgR, getStageRect());
    cropImg = { x: (crop.x - o.x) / imgR.width, y: (crop.y - o.y) / imgR.height, w: crop.w / imgR.width };
  }

  function legacyCropToImg(saved, imgR, stageR) {
    const px = { x: saved.x * stageR.width, y: saved.y * stageR.height, w: saved.w * stageR.width };
    const o = imgOffset(imgR, stageR);
    return { x: (px.x - o.x) / imgR.width, y: (px.y - o.y) / imgR.height, w: px.w / imgR.width };
  }

  // Przelicza zapamiętany kadr (cropImg) na piksele dla bieżącego układu.
  // Nie woła syncCropImg(): przycięcie do obrazu w chwilowym, małym układzie
  // (np. w trakcie obrotu ekranu) nie może trwale zmienić zapamiętanego kadru.
  function applyCropImg() {
    const imgR = getImgRect();
    if (!imgR) return;
    const stageR = getStageRect();
    if (!cropImg && pendingLegacyCrop) {
      cropImg = legacyCropToImg(pendingLegacyCrop, imgR, stageR);
      pendingLegacyCrop = null;
    }
    if (!cropImg) { initCropToCenterBig(); return; }
    const o = imgOffset(imgR, stageR);
    const w = cropImg.w * imgR.width;
    crop = clampCropToImg({ x: o.x + cropImg.x * imgR.width, y: o.y + cropImg.y * imgR.height, w, h: w / ASPECT });
    applyCropToDom();
  }

  function initCropToCenterBig() {
    const imgR = getImgRect();
    if (!imgR) return;
    const o = imgOffset(imgR, getStageRect());
    let w = imgR.width * 0.78;
    let h = w / ASPECT;
    if (h > imgR.height * 0.9) { h = imgR.height * 0.9; w = h * ASPECT; }
    crop = clampCropToImg({ x: o.x + (imgR.width - w) / 2, y: o.y + (imgR.height - h) / 2, w, h });
    applyCropToDom();
    syncCropImg();
  }

  // Czeka, aż <img> podglądu ma wyrenderowany obraz i układ się ustalił.
  async function whenPreviewReady() {
    try { await imgPreview?.decode?.(); } catch {}
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  }

  // =========================================================
  // Przetwarzanie: skala szarości -> korekty -> Floyd–Steinberg
  // =========================================================
  const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

  function applyBCGamma(v, bright, contrast, gamma) {
    const c = clamp(contrast, -100, 100);
    const factor = (259 * (c + 255)) / (255 * (259 - c));
    let x = clamp(factor * (v + bright - 128) + 128, 0, 255);
    x = 255 * Math.pow(x / 255, 1 / clamp(gamma, 0.05, 10));
    return clamp(x, 0, 255);
  }

  function applyLevels(v, black, white) {
    const b = clamp(black, 0, 100) * 2.55;
    const w = clamp(white, 0, 100) * 2.55;
    if (w <= b + 1) return v;
    return clamp((v - b) * (255 / (w - b)), 0, 255);
  }

  function compileBits() {
    const empty = new Uint8Array(DOT_W * DOT_H);
    const imgR = getImgRect();
    if (!imgObj || !work || !imgR) return empty;

    const o = imgOffset(imgR, getStageRect());
    const sx = work.w / imgR.width;
    const sy = work.h / imgR.height;
    const nx = clamp((crop.x - o.x) * sx, 0, work.w - 1);
    const ny = clamp((crop.y - o.y) * sy, 0, work.h - 1);
    const nw = clamp(crop.w * sx, 1, work.w - nx);
    const nh = clamp(crop.h * sy, 1, work.h - ny);

    const s = readSettings();
    const tmp = document.createElement("canvas");
    tmp.width = DOT_W;
    tmp.height = DOT_H;
    const g = tmp.getContext("2d", { willReadFrequently: true });
    g.imageSmoothingEnabled = true;
    g.drawImage(work.el, nx, ny, nw, nh, 0, 0, DOT_W, DOT_H);
    const data = g.getImageData(0, 0, DOT_W, DOT_H).data;

    const buf = new Float32Array(DOT_W * DOT_H);
    for (let i = 0; i < buf.length; i++) {
      const v = lum(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
      buf[i] = applyLevels(applyBCGamma(v, s.bright, s.contrast, s.gamma), s.black, s.white);
    }

    const strength = clamp(s.ditherAmt, 0, 1);
    const out = new Uint8Array(DOT_W * DOT_H);
    for (let y = 0; y < DOT_H; y++) {
      for (let x = 0; x < DOT_W; x++) {
        const i = y * DOT_W + x;
        const bright = buf[i] >= 128;
        // „jasne = zapalone”; invert (domyślnie włączony) odwraca
        out[i] = (bright ? 1 : 0) ^ (s.invert ? 1 : 0);
        const err = (buf[i] - (bright ? 255 : 0)) * strength;
        if (x + 1 < DOT_W) buf[i + 1] += err * (7 / 16);
        if (y + 1 < DOT_H) {
          if (x > 0) buf[i + DOT_W - 1] += err * (3 / 16);
          buf[i + DOT_W] += err * (5 / 16);
          if (x + 1 < DOT_W) buf[i + DOT_W + 1] += err * (1 / 16);
        }
      }
    }
    return out;
  }

  function pushPreviewNow() {
    bits = compileBits();
    drawImgPreview(bits);
    ctx.onPreview?.({ kind: "PIX", bits });
  }

  function schedulePreview(ms = 40) {
    clearTimeout(deb);
    deb = setTimeout(() => {
      if (ctx.getMode?.() !== "IMAGE" || imageStatus !== "ready") return;
      pushPreviewNow();
    }, ms);
  }

  // =========================================================
  // Wczytywanie obrazu
  // =========================================================
  function setStageImage(src) {
    if (!imgPreview) return;
    if (src) imgPreview.src = src; else imgPreview.removeAttribute("src");
    show(cropFrame, false); // ramka pojawia się, gdy obraz jest gotowy (showImage)
  }

  // crossOrigin=anonymous jest konieczne: bez CORS canvas jest „skażony”
  // i getImageData() rzuca wyjątek -- podgląd i zapis by nie działały.
  function loadImg(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(t("logoEditor.image.loadError")));
      img.src = src;
    });
  }

  /** Wczytuje src do edytora. cropRel: zapisany kadr albo null (= nowy, na środku). */
  async function showImage(src, cropRel, fallbackSrc = null) {
    const seq = ++loadSeq;
    imageStatus = "loading";
    imgObj = null;
    work = null;
    try {
      const img = await loadImg(src);
      if (seq !== loadSeq) return;
      imgObj = img;
      work = buildWork(num(SLIDERS.straighten.input?.value, 0));
      let shown = src;
      if (work.a) {
        shown = await makePreviewUrl(work);
        if (seq !== loadSeq) return;
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        previewUrl = shown.startsWith("blob:") ? shown : null;
      }
      setStageImage(shown);
      applyBestImageLayout();

      cropImg = null;
      pendingLegacyCrop = null;
      if (cropRel?.v === 2) cropImg = { x: num(cropRel.x, 0), y: num(cropRel.y, 0), w: num(cropRel.w, 0.78) };
      else if (cropRel) pendingLegacyCrop = cropRel;

      await whenPreviewReady();
      if (seq !== loadSeq) return;
      imageStatus = "ready";
      show(cropFrame, true);
      applyCropImg();
      schedulePreview(10);
    } catch (e) {
      if (seq !== loadSeq) return;
      // Adres nie działa, ale plik ma osadzoną kopię obrazu -- użyj jej.
      // Zapis trzyma wtedy tę kopię zamiast niedziałającego adresu (pliku
      // w Storage nie ruszamy -- błąd mógł być chwilowy).
      if (fallbackSrc) {
        imageUrl = null;
        openedImageUrl = null;
        return showImage(fallbackSrc, cropRel);
      }
      imageStatus = "error";
      setStageImage(null);
      console.error("[logo/image] load failed:", src.slice(0, 80), e);
      void alertModal({ text: t("logoEditor.image.errors.loadFailed") });
    }
  }

  async function pickFile(file) {
    if (!ALLOWED_TYPES.includes(file.type)) {
      void alertModal({ text: t("logoEditor.image.errors.badType") });
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      void alertModal({ text: t("logoEditor.image.errors.tooLarge", { max: MAX_FILE_BYTES / 1024 / 1024 }) });
      return;
    }
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = URL.createObjectURL(file);
    pendingFile = file;
    ctx.markDirty?.();
    // nowy obraz zaczyna bez obrotu; układ dobierany od nowa (bez progu zmiany)
    rot90 = 0;
    layoutNow = null;
    if (SLIDERS.straighten.input) SLIDERS.straighten.input.value = "0";
    syncLabels();
    await showImage(objectUrl, null);
  }

  // Układ pola obrazu i podglądu zależy od dwóch rzeczy: kształtu miejsca
  // w karcie (okno przeglądarki) i proporcji obrazu (po obrocie). Liczymy oba
  // układy — obok siebie i jeden pod drugim — z płynnym podziałem miejsca
  // i wybieramy ten, w którym obraz do kadrowania i podgląd są razem
  // największe (średnia geometryczna pól). Podgląd nie może być za mały:
  // ma co najmniej 45% szerokości karty (decyzja użytkownika 2026-11-07).
  const PREV_ASPECT = 1280 / 580; // płótno podglądu: tablica + równy margines
  const LAYOUT_GAP = 24;
  const PREV_MIN_SHARE = 0.45;
  const fitArea = (aspect, w, h) => (w <= 0 || h <= 0 ? 0 : (w / h > aspect ? h * h * aspect : (w * w) / aspect));
  const fitWidth = (aspect, w, h) => Math.min(w, h * aspect);

  // Najlepszy podział osobno dla każdego układu ({ row, col }).
  function bestImageLayouts(W, H, imgAspect, chrome) {
    const best = { row: null, col: null }, fallback = { row: null, col: null };
    const score = (img, prev) => (img > 0 && prev > 0 ? Math.log(img) + Math.log(prev) : -Infinity);
    const consider = (c, prevW) => {
      const fb = fallback[c.mode];
      if (!fb || prevW > fb.prevW) fallback[c.mode] = { ...c, prevW };
      if (prevW >= PREV_MIN_SHARE * W && (!best[c.mode] || c.s > best[c.mode].s)) best[c.mode] = c;
    };
    for (let f = 0.25; f <= 0.751; f += 0.02) {
      // obok siebie: f = część szerokości dla pola obrazu
      const colH = H - chrome.title;
      const wi = (W - LAYOUT_GAP) * f, wp = (W - LAYOUT_GAP) - wi;
      consider({ s: score(fitArea(imgAspect, wi, colH), fitArea(PREV_ASPECT, wp, colH - chrome.hint)), mode: "row", f, a: wi, b: wp },
        fitWidth(PREV_ASPECT, wp, colH - chrome.hint));
      // jeden pod drugim: f = część wysokości dla pola obrazu
      const avail = H - 2 * chrome.title - chrome.hint - LAYOUT_GAP;
      const hi = avail * f, hp = avail - hi;
      consider({ s: score(fitArea(imgAspect, W, hi), fitArea(PREV_ASPECT, W, hp)), mode: "col", f, a: chrome.title + hi, b: chrome.title + hp + chrome.hint },
        fitWidth(PREV_ASPECT, W, hp));
    }
    return { row: best.row || fallback.row, col: best.col || fallback.col };
  }

  // Bez skakania: proporcje obrazu liczone z obrysu obróconego obrazu (obrót
  // o 90° i prostowanie o dowolny kąt), ale w trakcie przesuwania suwaka
  // prostowania układ stoi -- dobiera się raz, po puszczeniu suwaka. Układ
  // zmienia się na drugi tylko, gdy jest wyraźnie lepszy (o 15%), a podział
  // w obrębie układu tylko przy zmianie o ponad 3%. Zmiana podziału jest
  // animowana (przejście w CSS), ramka kadru nadąża co klatkę.
  const MODE_SWITCH_GAIN = Math.log(1.15);
  let layoutNow = null; // { mode, f }
  let straightenActive = false;
  function applyBestImageLayout() {
    if (straightenActive) return;
    const grid = paneImage?.querySelector?.(".imgTopGrid");
    if (!grid || !grid.clientWidth || !grid.clientHeight) return;
    const title = grid.querySelector(".imgCardTitle");
    const hint = grid.querySelector(".imgPrevWrap > .hint");
    const chrome = { title: (title?.offsetHeight || 22) + 12, hint: (hint?.offsetHeight || 18) + 12 };
    const imgAspect = work ? work.w / Math.max(1, work.h) : 26 / 11;
    const both = bestImageLayouts(grid.clientWidth, grid.clientHeight, imgAspect, chrome);
    let L = both.row && (!both.col || both.row.s >= both.col.s) ? both.row : both.col;
    if (!L) return;
    const cur = layoutNow && both[layoutNow.mode];
    if (cur && L.mode !== layoutNow.mode && L.s - cur.s < MODE_SWITCH_GAIN) L = cur;
    if (layoutNow && L.mode === layoutNow.mode && Math.abs(L.f - layoutNow.f) <= 0.03) return;
    layoutNow = { mode: L.mode, f: L.f };
    grid.classList.toggle("is-row", L.mode === "row");
    grid.classList.toggle("is-col", L.mode === "col");
    // podział miejsca w pikselach jako fr (wiersze z tytułami i podpowiedzią)
    const fr = (x) => `${Math.max(1, x).toFixed(1)}fr`;
    setVars(grid, { "--img-a": fr(L.a), "--img-b": fr(L.b) });
  }

  // =========================================================
  // Gesty kadru (mysz i dotyk):
  // - przeciąganie ramki albo obrazu = przesuwanie,
  // - narożnik = skalowanie (ruch w poziomie LUB pionie, wygrywa większy),
  // - dwa palce = pinch wokół środka ramki + przesuwanie środkiem palców.
  // =========================================================
  const touches = new Map();
  let drag = null;  // { kind, sx, sy, startCrop }
  let pinch = null; // { dist, mid, startCrop }
  const pDist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const pMid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

  function setCrop(next) {
    crop = clampCropToImg(next);
    applyCropToDom();
    syncCropImg();
    ctx.markDirty?.();
    schedulePreview(30);
  }

  function onPointerDown(ev) {
    if (ctx.getMode?.() !== "IMAGE" || imageStatus !== "ready") return;
    if (ev.pointerType === "mouse" && ev.button !== 0) return;
    touches.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    imgStage?.setPointerCapture?.(ev.pointerId);
    ev.preventDefault();

    if (touches.size >= 2) {
      const [a, b] = [...touches.values()];
      pinch = { dist: pDist(a, b) || 1, mid: pMid(a, b), startCrop: { ...crop } };
      drag = null;
      return;
    }
    const handle = ev.target?.closest?.(".cropHandle")?.dataset?.h || null;
    drag = { kind: handle || "move", sx: ev.clientX, sy: ev.clientY, startCrop: { ...crop } };
  }

  function onPointerMove(ev) {
    if (!touches.has(ev.pointerId)) return;
    touches.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });

    if (pinch && touches.size >= 2) {
      const [a, b] = [...touches.values()];
      const m = pMid(a, b);
      const s = pinch.startCrop;
      const w = s.w * ((pDist(a, b) || 1) / pinch.dist);
      const h = w / ASPECT;
      const cx = s.x + s.w / 2 + (m.x - pinch.mid.x);
      const cy = s.y + s.h / 2 + (m.y - pinch.mid.y);
      setCrop({ x: cx - w / 2, y: cy - h / 2, w, h });
      return;
    }
    if (!drag) return;

    const dx = ev.clientX - drag.sx;
    const dy = ev.clientY - drag.sy;
    const s = drag.startCrop;
    if (drag.kind === "move") {
      setCrop({ x: s.x + dx, y: s.y + dy, w: s.w, h: s.h });
      return;
    }
    const dirX = drag.kind.includes("r") ? 1 : -1;
    const dirY = drag.kind.includes("b") ? 1 : -1;
    const byX = dirX * dx;
    const byY = dirY * dy * ASPECT;
    const newW = Math.max(60, s.w + (Math.abs(byX) >= Math.abs(byY) ? byX : byY));
    const newH = newW / ASPECT;
    // przeciwległy narożnik stoi w miejscu
    setCrop({
      x: dirX > 0 ? s.x : s.x + (s.w - newW),
      y: dirY > 0 ? s.y : s.y + (s.h - newH),
      w: newW,
      h: newH,
    });
  }

  function onPointerUp(ev) {
    if (!touches.has(ev.pointerId)) return;
    touches.delete(ev.pointerId);
    if (pinch) {
      pinch = null;
      // z dwóch palców na jeden: dalej przesuwanie pozostałym, bez skoku
      if (touches.size === 1) {
        const [rest] = touches.values();
        drag = { kind: "move", sx: rest.x, sy: rest.y, startCrop: { ...crop } };
      }
    } else if (touches.size === 0) {
      drag = null;
    }
  }

  // =========================================================
  // Pasek suwaka pod narzędziami (decyzja użytkownika 2026-11-07): zawsze
  // widoczny, jeden suwak naraz, na starcie prostowanie; przycisk w pasku
  // narzędzi wybiera, który suwak jest w pasku. Nic nie zasłania obrazu.
  // Przyciski − i + zmieniają wartość o krok suwaka; przytrzymane powtarzają
  // krok coraz szybciej (gamma i dither mają krok 0,01).
  // =========================================================
  const panelBtns = Array.from(document.querySelectorAll(".imgSetBtn"));
  const panels = Array.from(document.querySelectorAll("#imgPanels .imgPanel"));
  const DEFAULT_PANEL = "straighten";

  function showPanel(name) {
    for (const b of panelBtns) {
      const on = b.dataset.panel === name;
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    }
    for (const p of panels) p.classList.toggle("is-open", p.dataset.panel === name);
  }
  // dawne „zamknij panel” = powrót do domyślnego suwaka
  const closePanels = () => showPanel(DEFAULT_PANEL);

  // − i + przy każdym suwaku (wspólne z paskiem ustawień rysunku: stepper.js)
  for (const p of panels) wrapStepper(p.querySelector('input[type="range"]'), "imgStepRow");
  bindSteppers($("imgPanels"));

  // =========================================================
  // Zdarzenia (raz, przy starcie strony)
  // =========================================================
  $("btnPickImage")?.addEventListener("click", () => imgFile?.click());

  imgFile?.addEventListener("change", async () => {
    const f = imgFile.files?.[0];
    imgFile.value = ""; // ten sam plik wybrany drugi raz też ma zadziałać
    if (ctx.getMode?.() !== "IMAGE" || !f) return;
    await pickFile(f);
  });

  imgStage?.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onPointerUp);

  imgBigPreview?.addEventListener("click", () => {
    window.dispatchEvent(new CustomEvent("logoeditor:openPreview", { detail: { kind: "PIX", bits } }));
  });

  const onSettingChange = () => {
    if (ctx.getMode?.() !== "IMAGE") return;
    syncLabels();
    if (!imgObj) return;
    ctx.markDirty?.();
    schedulePreview(40);
  };
  chkInvert?.addEventListener("change", onSettingChange);
  for (const [key, s] of Object.entries(SLIDERS)) {
    if (key !== "straighten") s.input?.addEventListener("input", onSettingChange);
  }

  // Prostowanie: przebudowa obrazu roboczego po krótkiej przerwie w ruchu suwaka.
  let straightenDeb = null;
  SLIDERS.straighten.input?.addEventListener("input", () => {
    if (ctx.getMode?.() !== "IMAGE") return;
    syncLabels();
    if (!imgObj) return;
    ctx.markDirty?.();
    rotating = true; // zapis poczeka na przebudowę
    straightenActive = true; // układ pól nie zmienia się w trakcie przesuwania suwaka
    clearTimeout(straightenDeb);
    straightenDeb = setTimeout(() => applyRotation(rot90, num(SLIDERS.straighten.input.value, 0)), 60);
  });
  // puszczenie suwaka (albo zmiana klawiaturą): układ dobrany raz, z nowego kąta
  SLIDERS.straighten.input?.addEventListener("change", () => {
    straightenActive = false;
    setTimeout(() => applyBestImageLayout(), 150);
  });
  for (const [id, delta] of [["btnImgRotL", -90], ["btnImgRotR", 90]]) {
    $(id)?.addEventListener("click", () => {
      if (ctx.getMode?.() !== "IMAGE" || imageStatus !== "ready") return;
      ctx.markDirty?.();
      void applyRotation(rot90 + delta, num(SLIDERS.straighten.input?.value, 0));
    });
  }

  btnImgResetDefault?.addEventListener("click", () => {
    if (ctx.getMode?.() === "IMAGE") resetToDefaults();
  });

  for (const b of panelBtns) b.addEventListener("click", () => showPanel(b.dataset.panel));
  window.addEventListener("i18n:lang", syncLabels);

  // Zmiana rozmiaru okna albo samego pola: przelicz piksele ramki z kadru.
  // co klatkę (nie po przerwie): przy animowanej zmianie podziału ramka
  // kadru i obraz płynnie nadążają za polem
  let layoutRaf = 0;
  const relayout = () => {
    cancelAnimationFrame(layoutRaf);
    layoutRaf = requestAnimationFrame(() => {
      if (ctx.getMode?.() !== "IMAGE" || imageStatus !== "ready" || drag || pinch) return;
      applyCropImg();
      schedulePreview(10);
    });
  };
  window.addEventListener("resize", () => { applyBestImageLayout(); relayout(); });
  if (imgStage && "ResizeObserver" in window) new ResizeObserver(relayout).observe(imgStage);
  // zmiana miejsca w karcie (np. pasek narzędzi zawinął się w dwa rzędy) — nowy układ
  const layoutGrid = paneImage?.querySelector?.(".imgTopGrid");
  if (layoutGrid && "ResizeObserver" in window) new ResizeObserver(() => applyBestImageLayout()).observe(layoutGrid.parentElement || layoutGrid);

  closePanels();
  syncLabels();

  // =========================================================
  // Upload do Storage (przy zapisie)
  // =========================================================
  async function uploadPendingFile() {
    const user = (await sb().auth.getUser())?.data?.user;
    if (!user) throw new Error(t("logoEditor.image.errors.notLogged"));
    const ext = { "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/webp": "webp" }[pendingFile.type] || "png";
    const path = `${user.id}/${Date.now()}.${ext}`;
    const { error } = await sb().storage.from(BUCKET).upload(path, pendingFile, {
      cacheControl: "3600",
      upsert: false,
      contentType: pendingFile.type,
    });
    if (error) throw error;
    return sb().storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  }

  async function removeStorageFile(url) {
    try {
      const user = (await sb().auth.getUser())?.data?.user;
      const path = storagePathFromUrl(url, user?.id);
      if (path) await sb().storage.from(BUCKET).remove([path]);
    } catch (e) {
      console.warn("[logo/image] could not remove old file:", e);
    }
  }

  // =========================================================
  // API
  // =========================================================
  return {
    open(payload = null) {
      show(paneImage, true);
      applyBestImageLayout();
      closePanels();

      const source = payload?.source || {};
      writeSettings({ ...DEFAULTS, ...source, straighten: clamp(num(source.straighten, 0), -STRAIGHTEN_MAX, STRAIGHTEN_MAX) });
      rot90 = [0, 90, 180, 270].includes(num(source.rotate, 0)) ? num(source.rotate, 0) : 0;
      rotSeq++;
      rotating = false;

      if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = null; }
      pendingFile = null;
      imageUrl = /^https?:/i.test(source.imageUrl || "") ? source.imageUrl : null;
      imageData = /^data:image\//i.test(source.imageData || "") ? source.imageData : null;
      openedImageUrl = imageUrl;
      imgObj = null;
      loadSeq++;
      setStageImage(null); // bez obrazu i ramki poprzedniego logo, zanim wczyta się nowy

      // Do czasu przeliczenia z obrazu pokazujemy to, co jest zapisane.
      bits = payload?.bits_b64 ? unpackBits(payload.bits_b64) : new Uint8Array(DOT_W * DOT_H);
      drawImgPreview(bits);
      ctx.onPreview?.({ kind: "PIX", bits });

      const src = imageUrl || imageData;
      if (src) {
        void showImage(src, source.crop || null, imageUrl && imageData ? imageData : null);
      } else {
        imageStatus = "none";
        setStageImage(null);
      }
      ctx.clearDirty?.();
    },

    close() {
      show(paneImage, false);
      closePanels();
      loadSeq++;
      rotSeq++;
      rotating = false;
      if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = null; }
      if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = null; }
    },

    /** Obraz się wczytuje / obraca albo kadr jest właśnie przeciągany --
     *  autozapis czeka na koniec. */
    isInteracting() {
      return imageStatus === "loading" || rotating || !!drag || !!pinch;
    },

    async getCreatePayload() {
      if (imageStatus === "loading" || rotating) return { ok: false, msg: t("logoEditor.image.errors.stillLoading") };
      if (imageStatus === "error") return { ok: false, msg: t("logoEditor.image.errors.loadFailed") };
      if (imageStatus === "none") return { ok: false, msg: t("logoEditor.image.errors.noImage") };

      bits = compileBits();

      if (pendingFile) {
        try {
          imageUrl = await uploadPendingFile();
          imageData = null;
          pendingFile = null;
        } catch (e) {
          console.error("[logo/image] upload failed:", e);
          return { ok: false, msg: t("logoEditor.image.errors.storageFailed", { error: e?.message || e }) };
        }
      }

      const s = readSettings();
      return {
        ok: true,
        type: TYPE_PIX,
        payload: {
          w: DOT_W,
          h: DOT_H,
          format: PIX_FORMAT,
          bits_b64: packBits(bits),
          source: {
            mode: "IMAGE",
            ...s,
            // kadr względem obrazu roboczego, czyli PO obrocie
            crop: cropImg ? { v: 2, x: cropImg.x, y: cropImg.y, w: cropImg.w } : null,
            rotate: rot90,
            imageUrl,
            imageData: imageUrl ? null : imageData,
          },
        },
      };
    },

    /** Po udanym zapisie: sprzątnij plik, który ten zapis zastąpił. */
    async onSaved() {
      if (openedImageUrl && openedImageUrl !== imageUrl) await removeStorageFile(openedImageUrl);
      openedImageUrl = imageUrl;
    },
  };
}
