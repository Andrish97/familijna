// control/host/js/coverLogo.js
//
// Rysuje logo gry na okładce pasma 2 (#cover2Logo), w dwóch wariantach
// zależnie od tego, czy gra ma logo domyślne czy niestandardowe (zgłoszone
// wprost, nie zgadywane):
//
// - Logo DOMYŚLNE (brak logoId): w trybie "source" napis FAMILIJNA z
//   silnika Unbounded/3D, w trybie "pixel" siatka logo_familijna.json.
//
// - Logo NIESTANDARDOWE (jest logoId): zamiast oryginalnych kolorów/
//   przerw logo, rysujemy siatkę PEŁNYCH kwadratów bez przerw (w
//   odróżnieniu od kropek z realną przerwą na planszy LED) w jednolitym
//   kolorze DOT dla każdego zapalonego piksela, i NIC (przezroczyście) dla
//   zgaszonego — ten sam styl co wektor "Familijna" powyżej, tylko
//   zastosowany do treści właściwego logo gry. Wymaga pobrania
//   prawdziwego payloadu logo przez RPC display_logo_get_public (migracja
//   262 dopuściła też share_key_host, wcześniej tylko share_key_display).
//
// settings.display.colors.A/B/BACKGROUND nie mają tu wpływu.

import { sb } from "../../../shared/js/core/supabase.js?v=v2026-11-02T17000";
import { loadFont5x7, logoToBits150 } from "../../../shared/js/core/logo-preview.js?v=v2026-11-02T17000";
import { logoFaceColor, renderLogoSource, renderTextLogo } from "./sourceLogo.js?v=v2026-11-02T17000";
import { loadJson } from "../../../shared/js/display/fonts.js?v=v2026-11-02T17000";


const DOT_W = 150, DOT_H = 70;
const DEFAULT_DOT_COLOR = "#d7ff3d"; // web/js/gameplay/gameStateShape.js's default
// Logo domyślne ma te same dwa tryby co niestandardowe (decyzja 2026-10-20):
// "source" — napis FAMILIJNA, "pixel" — siatka z logo_familijna.json
// (to samo logo, które pokazuje Wyświetlacz).
let _defaultGlyphLogo = null;
function defaultGlyphLogoOnce() {
  if (!_defaultGlyphLogo) {
    _defaultGlyphLogo = loadJson("/shared/data/logo_familijna.json")
      .then((payload) => ({ type: "GLYPH_30x10", payload }))
      .catch(() => { _defaultGlyphLogo = null; return null; });
  }
  return _defaultGlyphLogo;
}

async function renderDefaultLogo(el, dotColor, shouldPaint = () => true, mode = "source") {
  if (mode === "pixel") {
    const logo = await defaultGlyphLogoOnce();
    if (!shouldPaint()) return;
    if (logo) return renderCustomLogo(el, logo, dotColor, shouldPaint, "pixel");
  }
  // Ten sam kolor co w trybie "pixel" (logoFaceColor), nie surowy DOT.
  const wordmark = await renderTextLogo("FAMILIJNA", logoFaceColor(dotColor));
  if (!shouldPaint()) return;
  wordmark.setAttribute("aria-label", "FAMILIJNA");
  wordmark.classList.add("cover-logo-fill");
  el.replaceChildren(wordmark);
}

// ===== Logo niestandardowe: siatka litych kwadratów bez przerw =====

let _glyphsPromise = null;
function glyphsOnce() {
  if (!_glyphsPromise) _glyphsPromise = loadFont5x7().catch(() => null);
  return _glyphsPromise;
}

function logoBounds(bits) {
  let left = DOT_W, top = DOT_H, right = -1, bottom = -1;
  for (let y = 0; y < DOT_H; y++) for (let x = 0; x < DOT_W; x++) {
    if (!bits[y * DOT_W + x]) continue;
    left = Math.min(left, x); right = Math.max(right, x);
    top = Math.min(top, y); bottom = Math.max(bottom, y);
  }
  return right < 0 ? { left: 0, top: 0, width: DOT_W, height: DOT_H }
    : { left, top, width: right - left + 1, height: bottom - top + 1 };
}

function drawSolidGrid(canvas, bits150, colorHex, bounds) {
  const ctx = canvas.getContext("2d");
  const scaleX = canvas.width / bounds.width;
  const scaleY = canvas.height / bounds.height;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = colorHex;
  for (let y = 0; y < DOT_H; y++) {
    for (let x = 0; x < DOT_W; x++) {
      if (bits150[y * DOT_W + x]) {
        ctx.fillRect((x - bounds.left) * scaleX, (y - bounds.top) * scaleY, scaleX + 1, scaleY + 1);
      }
    }
  }
}

async function renderCustomLogo(el, logo, dotColor, shouldPaint = () => true, mode = "pixel") {
  const logoDot = logoFaceColor(dotColor);
  if (mode === "source") {
    const sourceRender = await renderLogoSource(logo, dotColor);
    if (!shouldPaint()) return;
    if (sourceRender) {
      el.replaceChildren(sourceRender);
      sourceRender.classList.add("cover-logo-fill");
      // Napis w logo tekstowym wyższy, jak na Wyświetlaczu.
      sourceRender.classList.toggle("is-text", logo.payload.source?.mode === "TEXT");
    } else {
      el.replaceChildren();
    }
    return;
  }
  const glyphs = logo?.type === "GLYPH_30x10" ? await glyphsOnce() : null;
  if (!shouldPaint()) return;
  const bits150 = logoToBits150(logo, glyphs);
  const canvas = document.createElement("canvas");
  const bounds = logoBounds(bits150);
  canvas.width = bounds.width * 6;
  canvas.height = bounds.height * 6;
  drawSolidGrid(canvas, bits150, logoDot, bounds);
  el.innerHTML = "";
  canvas.className = "cover-logo-fill";
  el.appendChild(canvas);
}

// ===== Publiczny wejściowy punkt: wywoływany przy każdym wierszu =====

export function createCoverLogoRenderer({ gameId, key, previewOnly = false } = {}) {
  const el = document.getElementById("cover2Logo");
  let lastDot = null;
  let lastLogoId;
  let lastMode;
  let lastStep;
  let lastSummaryRev;
  let awaitingSummary = false;
  let fetchSeq = 0;

  function setCoverAccent(color) {
    document.documentElement.style.setProperty("--host-cover-accent", color);
  }

  async function apply(row) {
    if (!el) return;
    const dot = row.detail?.display?.colors?.DOT || DEFAULT_DOT_COLOR;
    const logoId = row.detail?.display?.logoId ?? null;
    const logoMode = row.detail?.display?.hostLogoMode === "pixel" ? "pixel" : "source";
    const hasPreviewLogo = row.detail?.display && Object.hasOwn(row.detail.display, "logoPreview");
    const previewLogo = row.detail?.display?.logoPreview;
    setCoverAccent(dot);
    const summary = row.step === "setup_finish";
    const refreshSummary = summary && (lastStep !== "setup_finish" || lastSummaryRev !== row.rev);
    lastStep = row.step;
    if (summary) lastSummaryRev = row.rev;
    if (!refreshSummary && dot === lastDot && logoId === lastLogoId && logoMode === lastMode && el.childElementCount) return;
    lastDot = dot;
    lastLogoId = logoId;
    lastMode = logoMode;
    const seq = ++fetchSeq;
    const current = () => seq === fetchSeq;
    if (hasPreviewLogo) {
      if (previewLogo?.type && previewLogo?.payload) await renderCustomLogo(el, previewLogo, dot, current, logoMode);
      else await renderDefaultLogo(el, dot, current, logoMode);
      return;
    }
    // Passive previews may receive an unsaved payload from their parent.
    // Otherwise resolve only the selected logoId through the logged-in
    // owner's RLS access; no game ID, device key, or lock state is involved.
    if (previewOnly) {
      if (!logoId) return renderDefaultLogo(el, dot, current, logoMode);
      if (!el.childElementCount) await renderDefaultLogo(el, dot, current, logoMode);
      try {
        const { data, error } = await sb()
          .from("user_logos")
          .select("type,payload")
          .eq("id", logoId)
          .maybeSingle();
        if (error) throw error;
        if (!current()) return;
        if (data?.type && data?.payload) await renderCustomLogo(el, data, dot, current, logoMode);
      } catch (error) {
        if (current()) console.warn("[host2] preview logo lookup failed:", error);
      }
      return;
    }
    if (awaitingSummary && !summary) {
      await renderDefaultLogo(el, dot, current, logoMode);
      return;
    }
    // A Host opened before Control has no game_state yet. Still resolve the
    // selected game logo; show the default while checking its editing lock.
    if (!el.childElementCount) await renderDefaultLogo(el, dot, current, logoMode);
    try {
      const { data, error } = await sb().rpc("host2_logo_get_public", { p_game_id:gameId, p_key:key });
      if (!current()) return;
      if (error) throw error;
      if (data?.busy) {
        awaitingSummary = true;
        await renderDefaultLogo(el, dot, current, logoMode);
        return;
      }
      awaitingSummary = false;
      const logo = data?.logo;
      if (logo?.type && logo?.payload) await renderCustomLogo(el, logo, dot, current, logoMode);
      else await renderDefaultLogo(el, dot, current, logoMode);
    } catch {
      if (!current()) return;
      lastLogoId = undefined;
      await renderDefaultLogo(el, dot, current, logoMode);
    }
  }

  return { apply };
}
