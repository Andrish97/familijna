// control/display/js/scene.js
//
// Silnik rysowania LED-matrix dla Display v2 — NIE jest kopią
// control/display/js/scene.js. Ten sam materiał źródłowy (fonts.js/anim.js/
// displays.js/theme_manager.js — czyste biblioteki rysujące, bez sprzężenia
// z komendami — zostają reużyte bez zmian, importowane wprost z control/display/js/),
// ale sam plik jest napisany od nowa z jedną zmianą struktury: w oryginale
// zmiana motywu/kolorów (THEME/COLOR) istnieje WYŁĄCZNIE jako gałąź
// wewnątrz interpretera komend tekstowych (handleCommand) — nie ma żadnego
// odpowiednika w czystym `api`. Tu ta logika jest wyciągnięta jako
// pierwszorzędne funkcje `api.theme.set()`/`api.color.set()`/
// `api.color.reset()`, wywoływane bezpośrednio z render.js na podstawie
// zdarzeń z deriveEvents — bez żadnego pośredniego formatu tekstowego.
//
// Interpreter komend (RBATCH/FBATCH/RTXT/R/RSUMA/RX/FL/FA/FB/FR/F/FSUMA/TOP/
// LEFT/RIGHT/LONG1/LONG2/INDICATOR/BLANK/LOGO/WIN/DEBUG, tokenizer,
// parseAnim) w ogóle nie istnieje w tym pliku — control/display/js/render.js woła
// `api.*` wprost. `api.debug.showFont(...)` zostaje jako zwykła funkcja do
// ręcznego wywołania z konsoli przy testach znaczków — bez wejścia przez
// komendę.
//
// Reszta (rysowanie glifów 5x7, layout pól rund/finału, WIN, logo,
// snapshot/restore) to ten sam algorytm co dziś — przepisywanie pikselowej
// matematyki animacji/fontów od zera nie dałoby żadnej korzyści, tylko
// ryzyko niezgodności z tym, jak wygląda dziś (ustalone wprost).

import { loadJson, buildGlyphMap, resolveGlyph } from "../../../shared/js/display/fonts.js?v=v2026-11-05T18070";
import { LONG_GAP, layoutLongText, dropUnsupported } from "../../../shared/js/display/long-text.js?v=v2026-11-05T18070";
import { createAnimator } from "../../../shared/js/display/anim.js?v=v2026-11-05T18070";
import { createDisplays } from "../../../shared/js/display/displays.js?v=v2026-11-05T18070";
import { createThemeManager } from "../../../shared/js/display/theme_manager.js?v=v2026-11-05T18070";
import { sb } from "../../../shared/js/core/supabase.js?v=v2026-11-05T18070";
import { t } from "../../../shared/translation/translation.js?v=v2026-11-05T18070";
import { clipDisplayText } from "../../../shared/js/gameplay/displayText.js?v=v2026-11-05T18070";

export async function createScene() {
  let animationGeneration = 0;
  let themeGeneration = 0;
  const $ = (id) => document.getElementById(id);

  let SUMA_LABEL = t("display.sumLabel");

  // ============================================================
  // Theme manager + displays
  // ============================================================
  const baseSvg = $("baseSvg");
  const bgLayer = document.querySelector(".layer-bg");
  const displaysGroup = $("displays");

  const themeMgr = await createThemeManager(baseSvg, bgLayer);
  const activeTheme = themeMgr.getActiveTheme();
  let displays = createDisplays({ svgGroup: displaysGroup, theme: activeTheme });

  let big = displays.big;
  let leftPanel = displays.left;
  let rightPanel = displays.right;
  let topPanel = displays.top;
  let long1 = displays.long1;
  let long2 = displays.long2;
  let leftTriple = displays.leftTriple;
  let rightTriple = displays.rightTriple;
  let topTriple = displays.topTriple;

  const COLORS = { cell: "#000000", dotOff: "#2e2e32" };
  const updateDotColor = (oldColor, newColor) => {
    const updateTiled = (d) => {
      for (let ty = 0; ty < d.tilesY; ty++)
        for (let tx = 0; tx < d.tilesX; tx++) {
          const tile = d.tiles[ty]?.[tx];
          if (!tile) continue;
          for (let row = 0; row < 7; row++)
            for (let col = 0; col < 5; col++)
              if (tile.dots[row][col].getAttribute("fill") === oldColor)
                tile.dots[row][col].setAttribute("fill", newColor);
        }
    };
    const updatePanel = (d) => {
      for (let row = 0; row < d.Y; row++)
        for (let col = 0; col < d.X; col++)
          if (d.dots[row][col].getAttribute("fill") === oldColor)
            d.dots[row][col].setAttribute("fill", newColor);
    };
    updateTiled(big); updateTiled(leftPanel); updateTiled(rightPanel); updateTiled(topPanel);
    updatePanel(long1); updatePanel(long2);
  };
  const LIT_DEFAULT = "#d7ff3d";
  const LIT = { main: LIT_DEFAULT, top: LIT_DEFAULT, left: LIT_DEFAULT, right: LIT_DEFAULT, bottom: LIT_DEFAULT };

  // ============================================================
  // Render 5x7 glyph into a tile
  // ============================================================
  const renderCharToTile = (GLYPHS, tile, ch, onColor, offColor) => {
    const glyph = resolveGlyph(GLYPHS, ch);
    for (let row = 0; row < 7; row++) {
      const bits = glyph[row] | 0;
      for (let col = 0; col < 5; col++) {
        const mask = 1 << (4 - col);
        const on = (bits & mask) !== 0;
        tile.dots[row][col].setAttribute("fill", on ? onColor : offColor);
      }
    }
  };

  const clearTile = (tile) => {
    for (let row = 0; row < 7; row++) for (let col = 0; col < 5; col++) {
      tile.dots[row][col].setAttribute("fill", COLORS.dotOff);
    }
  };

  const tileAt = (big, col1, row1) => {
    const x = (col1 | 0) - 1;
    const y = (row1 | 0) - 1;
    if (x < 0 || y < 0 || x >= big.tilesX || y >= big.tilesY) return null;
    return big.tiles[y][x];
  };

  const putCharAt = (GLYPHS, big, col1, row1, ch, color) => {
    const t = tileAt(big, col1, row1);
    if (!t) return;
    renderCharToTile(GLYPHS, t, ch, color, COLORS.dotOff);
  };

  const clearTileAt = (big, col1, row1) => {
    const t = tileAt(big, col1, row1);
    if (!t) return;
    clearTile(t);
  };

  const clearArea = (big, c1, r1, c2, r2) => {
    for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) clearTileAt(big, c, r);
  };

  const clearBig = (big) => clearArea(big, 1, 1, big.tilesX, big.tilesY);

  const snapArea = (big, c1, r1, c2, r2) => {
    const W = c2 - c1 + 1, H = r2 - r1 + 1;
    const snap = Array.from({ length: H }, () => Array.from({ length: W }, () => null));
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const t = tileAt(big, c1 + x, r1 + y);
      if (!t) continue;
      snap[y][x] = t.dots.map(row => row.map(c => c.getAttribute("fill")));
    }
    return snap;
  };

  const anim = createAnimator({ tileAt, snapArea, clearArea, clearTileAt, dotOff: COLORS.dotOff, getGeneration: () => animationGeneration });
  if (typeof anim.outEdge !== "function" && typeof anim.inEdge === "function") anim.outEdge = (...args) => anim.inEdge(...args);
  if (typeof anim.outMatrix !== "function" && typeof anim.inMatrix === "function") anim.outMatrix = (...args) => anim.inMatrix(...args);

  const normMs = (ms, fallback) => { const base = Number.isFinite(ms) ? ms : fallback; return Math.max(0, base | 0); };

  // ============================================================
  // WIN
  // ============================================================
  const measureWinDigit = (pat) => {
    const rows = Array.from({ length: 7 }, (_, i) => (pat[i] ?? ""));
    const W = Math.max(...rows.map(r => r.length), 0);
    let left = W, right = -1;
    for (let x = 0; x < W; x++) {
      let any = false;
      for (let y = 0; y < 7; y++) { if ((rows[y][x] ?? " ") !== " ") { any = true; break; } }
      if (any) { if (x < left) left = x; if (x > right) right = x; }
    }
    if (right < left) return { left: 0, w: 0 };
    return { left, w: right - left + 1 };
  };

  const drawWinDigitTight = (GLYPHS, big, WIN_DIGITS, col1, rowTop1, digit, color) => {
    const pat = WIN_DIGITS[digit];
    if (!pat) return 0;
    const rows = Array.from({ length: 7 }, (_, i) => (pat[i] ?? ""));
    const { left, w } = measureWinDigit(pat);
    for (let y = 0; y < 7; y++) {
      for (let x = 0; x < w; x++) {
        const ch = rows[y][left + x] ?? " ";
        if (ch === " ") clearTileAt(big, col1 + x, rowTop1 + y);
        else putCharAt(GLYPHS, big, col1 + x, rowTop1 + y, ch, color);
      }
    }
    return w;
  };

  const drawWinNumber5 = (GLYPHS, big, WIN_DIGITS, number, color) => {
    let s = (number ?? "").toString().replace(/\D/g, "");
    if (s.length > 5) s = s.slice(-5);
    const rowTop1 = 2;
    clearArea(big, 1, rowTop1, 30, rowTop1 + 6);
    if (!s.length) return;
    const gap = 1, groupGapExtra = 1;
    const widths = s.split("").map(d => (WIN_DIGITS[d] ? measureWinDigit(WIN_DIGITS[d]).w : 0));
    let totalW = widths.reduce((a, b) => a + b, 0);
    if (s.length > 1) totalW += gap * (s.length - 1);
    if (s.length > 3) totalW += groupGapExtra;
    const startCol1 = 1 + Math.max(0, Math.floor((30 - totalW) / 2));
    let cx = startCol1;
    for (let i = 0; i < s.length; i++) {
      const w = drawWinDigitTight(GLYPHS, big, WIN_DIGITS, cx, rowTop1, s[i], color);
      cx += w;
      if (i < s.length - 1) { cx += gap; if (s.length > 3 && i === (s.length - 4)) cx += groupGapExtra; }
    }
  };

  // ============================================================
  // X 3x3
  // ============================================================
  const drawBigX_3x3 = (GLYPHS, big, col1, row1, color) => {
    putCharAt(GLYPHS, big, col1 + 0, row1 + 0, "⇖", color);
    putCharAt(GLYPHS, big, col1 + 1, row1 + 0, "⎵", color);
    putCharAt(GLYPHS, big, col1 + 2, row1 + 0, "⇗", color);
    putCharAt(GLYPHS, big, col1 + 1, row1 + 1, "⧗", color);
    putCharAt(GLYPHS, big, col1 + 0, row1 + 2, "⇙", color);
    putCharAt(GLYPHS, big, col1 + 1, row1 + 2, "⎴", color);
    putCharAt(GLYPHS, big, col1 + 2, row1 + 2, "⇘", color);
  };

  const drawRoundsBigX = (GLYPHS, big, side, color) => {
    const s = (side ?? "").toString().toUpperCase();
    const put = (col1, row1, ch) => putCharAt(GLYPHS, big, col1, row1, ch, color);
    if (s === "A") { put(1,4,"◣");put(3,4,"◢");put(1,5,"◥");put(3,5,"◤");put(2,6,"⧗");put(1,7,"◢");put(3,7,"◣");put(1,8,"◤");put(3,8,"◥"); return; }
    if (s === "B") { put(28,4,"◣");put(30,4,"◢");put(28,5,"◥");put(30,5,"◤");put(29,6,"⧗");put(28,7,"◢");put(30,7,"◣");put(28,8,"◤");put(30,8,"◥"); return; }
    throw new Error(`drawRoundsBigX: nieznana strona: ${side}`);
  };

  // ============================================================
  // Fields + layout
  // ============================================================
  const field = (name, c1, r1, len) => ({ name, c1, r1, c2: c1 + len - 1, r2: r1 });

  const writeField = (GLYPHS, big, f, text, color) => {
    // Pełne znaki Unicode (emotka to jeden znak, nie dwie połówki UTF-16).
    const s = Array.from((text ?? "").toString().toUpperCase());
    const len = f.c2 - f.c1 + 1;
    for (let i = 0; i < len; i++) putCharAt(GLYPHS, big, f.c1 + i, f.r1, s[i] ?? " ", color);
  };

  const alignRight = (val, width) => { const s = (val ?? "").toString(); if (!s.length) return " ".repeat(width); return s.length >= width ? s.slice(-width) : " ".repeat(width - s.length) + s; };
  // Znaki spoza fontu są pomijane (z jedną spacją za nimi), zanim tekst
  // zostanie skrócony — bez pustych miejsc (decyzja użytkownika 2026-10-22).
  const clipText = (text, capacity) => clipDisplayText(dropUnsupported(text, GLYPHS), capacity);

  const updateField = async (GLYPHS, big, f, text, { out = null, in: inn = null, color = LIT.main } = {}) => {
    const area = { c1: f.c1, r1: f.r1, c2: f.c2, r2: f.r2 };
    const normalizeOpts = (a) => { if (!a) return undefined; const opts = {}; if (a.pixel) opts.pixel = true; if (a.pxBatch != null) opts.pxBatch = a.pxBatch; if (a.stepPxMs != null) opts.stepPxMs = a.stepPxMs; if (a.tileMs != null) opts.tileMs = a.tileMs; return opts; };
    if (out) { const type = out.type || "edge"; const step = normMs(out.ms, 20); if (type === "edge") await anim.outEdge(big, area, out.dir || "left", step, normalizeOpts(out)); else if (type === "matrix") await anim.outMatrix(big, area, out.axis || "down", step, normalizeOpts(out)); }
    // Bez zejścia wejście nadpisuje dotychczasową zawartość pola (kropki,
    // stare punkty) czołem fali, zamiast najpierw gasić całe pole.
    const from = inn && !out ? snapArea(big, area.c1, area.r1, area.c2, area.r2) : null;
    writeField(GLYPHS, big, f, text, color);
    if (inn) { const type = inn.type || "edge"; const step = normMs(inn.ms, 20); const opts = { ...normalizeOpts(inn), from }; if (type === "edge") await anim.inEdge(big, area, inn.dir || "left", step, opts); else if (type === "matrix") await anim.inMatrix(big, area, inn.axis || "down", step, opts); }
  };

  // ============================
  // Layout: ROUNDS
  // ============================
  const ROUNDS = (() => {
    const rows = [2,3,4,5,6,7];
    const roundNums = rows.map((r, i) => field(`R${i+1}_NUM`, 5, r, 1));
    const answers = rows.map((r, i) => field(`R${i+1}_TXT`, 7, r, 17));
    const points = rows.map((r, i) => field(`R${i+1}_PTS`, 25, r, 2));
    const xCells = { "1A":{c1:1,r1:8,c2:3,r2:10},"2A":{c1:1,r1:5,c2:3,r2:7},"3A":{c1:1,r1:2,c2:3,r2:4},"4A":{c1:1,r1:4,c2:3,r2:8,kind:"BIG"},"1B":{c1:28,r1:8,c2:30,r2:10},"2B":{c1:28,r1:5,c2:30,r2:7},"3B":{c1:28,r1:2,c2:30,r2:4},"4B":{c1:28,r1:4,c2:30,r2:8,kind:"BIG"} };
    return { rows, roundNums, answers, points, xCells };
  })();

  const roundsState = { text: Array(6).fill(""), pts: Array(6).fill(""), suma: "", sumaRow: 9 };
  // Śledzi, która plansza jest aktualnie namalowana — wyłącznie po to, żeby
  // refreshSumaLabel() (i18n:lang) wiedziało, KTÓRĄ z dwóch osobnych etykiet
  // "SUMA" bezpiecznie przemalować, nie ryzykując narysowania fragmentu
  // planszy finału na planszy rund (i odwrotnie) w nieużywanym, ale wciąż
  // widocznym rogu siatki.
  let activeBoard = null;
  const xState = { "1A":false,"2A":false,"3A":false,"4A":false,"1B":false,"2B":false,"3B":false,"4B":false };

  const hasVisibleText = (s) => (s ?? "").toString().trim().length > 0;
  const setRoundNumberVisible = (idx1to6, on) => { const i = (idx1to6|0)-1; if (i<0||i>5) return; writeField(GLYPHS, big, ROUNDS.roundNums[i], on ? String(i+1) : " ", LIT.main); };
  const isNonEmpty = (s) => (s ?? "").toString().trim().length > 0;

  const computeLastUsedRow = () => { let lastIdx = -1; for (let i=0;i<6;i++) { if (isNonEmpty(roundsState.text[i])||isNonEmpty(roundsState.pts[i])) lastIdx = i; } return lastIdx < 0 ? null : ROUNDS.rows[lastIdx]; };
  const computeSumaRow = () => { const last = computeLastUsedRow(); if (last == null) return 9; return Math.min(10, last + 2); };
  const roundsSumaFields = () => { const r = roundsState.sumaRow; return { label: field("SUMA_LABEL",19,r,4), val: field("SUMA_VAL",24,r,3) }; };
  const clearRow = (r) => clearArea(big, 1, r, 30, r);

  const relocateSumaIfNeeded = () => {
    const nextRow = computeSumaRow();
    if (nextRow === roundsState.sumaRow) return;
    clearRow(roundsState.sumaRow);
    roundsState.sumaRow = nextRow;
    const F = roundsSumaFields();
    writeField(GLYPHS, big, F.label, SUMA_LABEL, LIT.main);
    if (isNonEmpty(roundsState.suma)) writeField(GLYPHS, big, F.val, roundsState.suma, LIT.main);
  };

  // ============================
  // Layout: FINAL
  // ============================
  const FINAL = (() => {
    const rows = [3,4,5,6,7];
    return {
      rows,
      leftTxt: rows.map((r,i)=>field(`F${i+1}_LTXT`,1,r,11)),
      ptsA: rows.map((r,i)=>field(`F${i+1}_A`,13,r,2)),
      ptsB: rows.map((r,i)=>field(`F${i+1}_B`,17,r,2)),
      rightTxt: rows.map((r,i)=>field(`F${i+1}_RTXT`,20,r,11)),
      sumaALabel: field("FSUMA_A_LABEL",7,9,4), sumaAVal: field("FSUMA_A_VAL",12,9,3),
      sumaBLabel: field("FSUMA_B_LABEL",11,9,4), sumaBVal: field("FSUMA_B_VAL",16,9,3),
    };
  })();

  const finalState = { sumMode: "B", sumA: "", sumB: "" };
  const clearFinalSumRow = () => clearArea(big, 1, 9, 30, 9);

  const drawFinalSum = () => {
    clearFinalSumRow();
    if (finalState.sumMode === "A") { writeField(GLYPHS, big, FINAL.sumaALabel, SUMA_LABEL, LIT.main); writeField(GLYPHS, big, FINAL.sumaAVal, alignRight(finalState.sumA,3), LIT.main); }
    else { writeField(GLYPHS, big, FINAL.sumaBLabel, SUMA_LABEL, LIT.main); writeField(GLYPHS, big, FINAL.sumaBVal, alignRight(finalState.sumB,3), LIT.main); }
  };

  // Zgłoszone: etykieta "SUMA" nie tłumaczyła się na żywo w Finale (tylko
  // w Rundach) — refreshSumaLabel() sprawdzał wyłącznie roundsState.sumaRow,
  // nigdy nie wołał drawFinalSum() dla planszy finału. activeBoard (nie np.
  // obecność finalState.sumA/sumB — te bywają puste, zanim gracz zdobędzie
  // pierwsze punkty, mimo że plansza finału już jest widoczna) mówi wprost,
  // która plansza jest teraz namalowana, więc nie ma ryzyka przemalowania
  // złej etykiety na nieużywany fragment siatki.
  const refreshSumaLabel = () => {
    SUMA_LABEL = t("display.sumLabel");
    if (activeBoard === "rounds" && roundsState.sumaRow) { const F = roundsSumaFields(); writeField(GLYPHS, big, F.label, SUMA_LABEL, LIT.main); }
    if (activeBoard === "final") drawFinalSum();
  };
  window.addEventListener("i18n:lang", refreshSumaLabel);

  const FINAL_AREA_LEFT = { c1:1,r1:3,c2:14,r2:7 };
  const FINAL_AREA_RIGHT = { c1:17,r1:3,c2:30,r2:7 };

  // ============================================================
  // Small displays
  // ============================================================
  const setTripleDigits = (GLYPHS, tripleTiles, text, onColor) => {
    let s = (text ?? "").toString().replace(/\D/g, "");
    if (s.length > 3) s = s.slice(-3);
    s = s.padStart(3, " ");
    for (let i=0;i<3;i++) renderCharToTile(GLYPHS, tripleTiles[i], s[i], onColor, COLORS.dotOff);
  };

  // Nazwy drużyn: znaki proporcjonalnie, wyśrodkowane (long-text.js -- ten
  // sam układ co pomiar w ustawieniach gry). Co się nie mieści, jest pomijane.
  const setLongTextCentered = (GLYPHS, panel, text, onColor) => {
    for (let y=0;y<panel.Y;y++) for (let x=0;x<panel.X;x++) panel.dots[y][x].setAttribute("fill", COLORS.dotOff);
    const { items, width } = layoutLongText(text, GLYPHS);
    let xCursor = Math.max(0, Math.floor((panel.X - width) / 2));
    for (const item of items) {
      if (xCursor + item.width > panel.X) break;
      for (let row=0; item.glyph && row<7; row++) {
        const bits = item.glyph[row] | 0;
        for (let col=0; col<item.width; col++) {
          if (bits & (1 << (4 - (item.from + col)))) panel.dots[row][xCursor + col].setAttribute("fill", onColor);
        }
      }
      xCursor += item.width + LONG_GAP;
    }
  };

  // ============================================================
  // Load fonts
  // ============================================================
  const FONT5 = await loadJson("/shared/fonts/display/font_5x7.json");
  const GLYPHS = buildGlyphMap(FONT5);
  const FONTWIN = await loadJson("/shared/fonts/display/font_win.json");
  const WIN_DIGITS = FONTWIN?.digits || {};

  // ============================================================
  // Indicator
  // ============================================================
  let indicatorState = "OFF";
  const setIndicator = (state) => {
    const s = (state ?? "").toString().toUpperCase();
    if (s === indicatorState) return;
    if (s === "OFF") { themeMgr.updateControls({ A: false, B: false }); indicatorState = "OFF"; return; }
    if (s === "ON_A") { themeMgr.updateControls({ A: true, B: false }); indicatorState = "ON_A"; return; }
    if (s === "ON_B") { themeMgr.updateControls({ A: false, B: true }); indicatorState = "ON_B"; return; }
    throw new Error(`INDICATOR: zły stan: ${state}`);
  };

  // ============================================================
  // LOGO
  // ============================================================
  let LOGO_JSON = null;
  try { LOGO_JSON = await loadJson("/shared/data/logo_familijna.json"); } catch {}
  const DEFAULT_LOGO = LOGO_JSON ?? { layers:[{color:"main",rows:Array(10).fill(" ".repeat(30))}] };
  let ACTIVE_LOGO = null;
  let logoSeq = 0;

  const loadActiveLogoFromDb = async (gameId, key) => {
    if (!gameId || !key) return null;
    try { const { data, error } = await sb().rpc("display_logo_get_public", { p_game_id: gameId, p_key: key }); if (error) return null; return data || null; } catch { return null; }
  };

  const normalizeLogoRow30 = (s) => { const t = (s?? "").toString(); if (t.length===30) return t; if (t.length>30) return t.slice(0,30); return t.padEnd(30," "); };
  const normalizeLogoJson30x10 = (logoJson) => {
    const layersIn = Array.isArray(logoJson?.layers) ? logoJson.layers : [];
    return { layers: layersIn.map((layer) => {
      const rowsIn = Array.isArray(layer?.rows) ? layer.rows : [];
      const rows = []; for (let i=0;i<10;i++) rows.push(normalizeLogoRow30(rowsIn[i] ?? ""));
      return { color: layer?.color ?? "main", rows };
    })};
  };

  const litFromName = (name) => { const n = (name??"main").toString().toLowerCase(); if (n==="top") return LIT.top; if (n==="left") return LIT.left; if (n==="right") return LIT.right; if (n==="bottom") return LIT.bottom; return LIT.main; };

  const drawLogoGrid30x10 = (logoJsonRaw) => {
    const logoJson = normalizeLogoJson30x10(logoJsonRaw);
    clearArea(big, 1, 1, 30, 10);
    for (const layer of logoJson.layers) {
      const color = litFromName(layer.color);
      for (let ry=0;ry<10;ry++) {
        const rowStr = layer.rows[ry] ?? " ".repeat(30);
        for (let cx=0;cx<30;cx++) { const ch = rowStr[cx] ?? " "; if (ch !== " ") putCharAt(GLYPHS, big, 1+cx, 1+ry, ch, color); }
      }
    }
  };

  const base64ToBytes = (b64) => { try { const bin = atob((b64||"").replace(/\s+/g,"")); const out = new Uint8Array(bin.length); for (let i=0;i<bin.length;i++) out[i] = bin.charCodeAt(i); return out; } catch { return new Uint8Array(0); } };
  const getBitRowMajor_MSB = (bytes, x, y, w) => { const bytesPerRow = Math.ceil(w/8); const byteIndex = y*bytesPerRow+(x>>3); if (byteIndex<0||byteIndex>=bytes.length) return 0; return (bytes[byteIndex]>>(7-(x&7)))&1; };

  const drawLogoPix150x70 = (bitsBase64, colorOn = LIT.main) => {
    const W=150; const bytes = base64ToBytes(bitsBase64);
    clearArea(big, 1, 1, 30, 10);
    for (let ty=0;ty<10;ty++) for (let tx=0;tx<30;tx++) {
      const tile = tileAt(big, 1+tx, 1+ty); if (!tile) continue;
      for (let py=0;py<7;py++) for (let px=0;px<5;px++) {
        const x = tx*5+px, y = ty*7+py;
        const on = getBitRowMajor_MSB(bytes, x, y, W) === 1;
        tile.dots[py][px].setAttribute("fill", on ? colorOn : COLORS.dotOff);
      }
    }
  };

  // ============================================================
  // SNAPSHOT / RESTORE (używane też przez theme.set() poniżej —
  // zmiana motywu przebudowuje panele SVG, więc trzeba zachować
  // to, co akurat jest narysowane)
  // ============================================================
  const snapDotsGrid = (panel) => panel.dots.map(row => row.map(el => el.getAttribute("fill")));
  const restoreDotsGrid = (panel, snap) => { if (!snap) return; for (let y=0;y<panel.dots.length;y++) for (let x=0;x<panel.dots[0].length;x++) { const fill = snap?.[y]?.[x]; if (fill != null) panel.dots[y][x].setAttribute("fill", fill); } };
  const snapTriple = (tripleTiles) => [tripleTiles.map(t => t.dots.map(row => row.map(c => c.getAttribute("fill"))))];
  const restoreTriple = (tripleTiles, snap) => {
    const row0 = snap?.[0]; if (!row0) return;
    for (let tx=0;tx<3;tx++) { const t=tripleTiles[tx], data=row0?.[tx]; if (!t||!data) continue; for (let rr=0;rr<7;rr++) for (let cc=0;cc<5;cc++) t.dots[rr][cc].setAttribute("fill", data[rr][cc]); }
  };

  const snapshotAll = () => ({
    v: 1, big: snapArea(big,1,1,30,10),
    small: { top: snapTriple(topTriple), left: snapTriple(leftTriple), right: snapTriple(rightTriple), long1: snapDotsGrid(long1), long2: snapDotsGrid(long2) },
    indicator: indicatorState,
    theme: themeMgr.getActiveTheme()?.getColors?.() ?? { A: "#ff8c1a", B: "#138a50", BG: "#152238" },
  });

  const restoreSnapshot = (S) => {
    if (!S) return;
    if (S.theme) { try { themeMgr.updateColors({ A: S.theme.A, B: S.theme.B, BG: S.theme.BG }); } catch (e) { console.warn("Nie można przywrócić THEME:", e); } }
    if (S.big) { for (let ty=0;ty<10;ty++) for (let tx=0;tx<30;tx++) { const t=tileAt(big,1+tx,1+ty), data=S.big?.[ty]?.[tx]; if (!t||!data) continue; for (let rr=0;rr<7;rr++) for (let cc=0;cc<5;cc++) t.dots[rr][cc].setAttribute("fill", data[rr][cc]); } }
    restoreTriple(topTriple, S.small?.top); restoreTriple(leftTriple, S.small?.left); restoreTriple(rightTriple, S.small?.right);
    restoreDotsGrid(long1, S.small?.long1); restoreDotsGrid(long2, S.small?.long2);
    if (S.indicator) { try { api.indicator.set(S.indicator); } catch (e) { console.warn("Nie można przywrócić INDICATOR:", e); } }
  };

  let appMode = "NONE";
  const hardClearAll = () => {
    clearBig(big); api.small.clearAll(); api.indicator.set("OFF");
    roundsState.text = Array(6).fill(""); roundsState.pts = Array(6).fill(""); roundsState.suma = ""; roundsState.sumaRow = 9;
    for (const k of Object.keys(xState)) xState[k] = false;
    finalState.sumMode = "B"; finalState.sumA = ""; finalState.sumB = "";
  };

  // ============================================================
  // Kolor CSS -> rgb, do walidacji wejścia w theme/color
  // ============================================================
  const cssColorToRgb = (css) => {
    const s = (css ?? "").toString().trim();
    if (!s) return null;
    const tmp = document.createElement("div");
    tmp.style.color = s;
    document.body.appendChild(tmp);
    const rgb = getComputedStyle(tmp).color;
    tmp.remove();
    const m = rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
    if (!m) return null;
    return { r: +m[1], g: +m[2], b: +m[3] };
  };

  // ============================================================
  // API
  // ============================================================
  const api = {
    mode: { getApp: () => appMode, setApp: (m) => { const next = (m??"").toString().toUpperCase(); if (next===appMode) return; appMode = next; hardClearAll(); }, hardClearAll },
    big: {
      areaAll: () => ({c1:1,r1:1,c2:30,r2:10}), areaWin: () => ({c1:1,r1:2,c2:30,r2:8}), areaLogo: () => ({c1:1,r1:3,c2:30,r2:7}),
      animIn: async ({ type="edge", dir="left", axis="down", ms=20, area=null, opts=null } = {}) => {
        const A = area ?? api.big.areaAll(); const speed = normMs(ms,20);
        if (type==="edge") return anim.inEdge(big, A, dir, speed, opts||{});
        if (type==="matrix") return anim.inMatrix(big, A, axis, speed, opts||{});
      },
      animOut: async ({ type="edge", dir="left", axis="down", ms=20, area=null, opts=null } = {}) => {
        const A = area ?? api.big.areaAll(); const speed = normMs(ms,20);
        if (type==="edge") return anim.outEdge(big, A, dir, speed, opts||{});
        if (type==="matrix") return anim.outMatrix(big, A, axis, speed, opts||{});
      },
      clear: () => { activeBoard = null; clearBig(big); },
      // Przejście planszy: zrzut obecnej zawartości, draw() rysuje nową,
      // potem losowe wyrywanie starej z nachodzącym wjazdem nowej (anim.transition).
      replace: async (draw, { area=null, ...timing } = {}) => {
        const A = area ?? api.big.areaAll();
        const from = snapArea(big, A.c1, A.r1, A.c2, A.r2);
        clearArea(big, A.c1, A.r1, A.c2, A.r2);
        draw();
        await anim.transition(big, A, { ...timing, from });
      },
      put: (col, row, ch, color=LIT.main) => putCharAt(GLYPHS, big, col, row, ch, color),
      clearArea: (c1,r1,c2,r2) => clearArea(big, c1,r1,c2,r2),
    },
    small: {
      topDigits: (ddd) => setTripleDigits(GLYPHS, topTriple, ddd, LIT.top),
      leftDigits: (ddd) => setTripleDigits(GLYPHS, leftTriple, ddd, LIT.left),
      rightDigits: (ddd) => setTripleDigits(GLYPHS, rightTriple, ddd, LIT.right),
      long1: (txt) => setLongTextCentered(GLYPHS, long1, txt, LIT.bottom),
      long2: (txt) => setLongTextCentered(GLYPHS, long2, txt, LIT.bottom),
      clearAll: () => { setTripleDigits(GLYPHS, topTriple, "   ", LIT.top); setTripleDigits(GLYPHS, leftTriple, "   ", LIT.left); setTripleDigits(GLYPHS, rightTriple, "   ", LIT.right); setLongTextCentered(GLYPHS, long1, "", LIT.main); setLongTextCentered(GLYPHS, long2, "", LIT.main); },
    },
    indicator: { get: () => indicatorState, set: setIndicator },
    snapshotAll, restoreSnapshot,
    logo: {
      _gameId: null, _key: null,
      bindGame: async (gameId) => { const u = new URL(location.href); const key = u.searchParams.get("key")||""; api.logo._gameId = (gameId??"").toString(); api.logo._key = key; const dbLogo = await loadActiveLogoFromDb(api.logo._gameId, key); ACTIVE_LOGO = (dbLogo&&dbLogo.type&&dbLogo.payload) ? dbLogo : null; },
      // WYŁĄCZNIE dla podglądu (control/display/js/main.js's bootPreview) — ustawia
      // logo wprost z gotowego payloadu (np. jeszcze NIEZAPISANEGO wyboru w
      // formularzu ustawień gry), bez odpytywania bazy jak bindGame/reload.
      // logo=null -> wraca do wbudowanego domyślnego logo (ten sam fallback
      // co _getSource() ma i tak, gdy ACTIVE_LOGO jest puste).
      setPreview: (logo) => { ACTIVE_LOGO = (logo?.type && logo?.payload) ? logo : null; },
      _getSource: () => { if (ACTIVE_LOGO?.type==="GLYPH_30x10") return { type:"GLYPH_30x10", payload: ACTIVE_LOGO.payload }; if (ACTIVE_LOGO?.type==="PIX_150x70") return { type:"PIX_150x70", payload: ACTIVE_LOGO.payload }; return { type:"GLYPH_30x10", payload: DEFAULT_LOGO }; },
      draw: () => { const src = api.logo._getSource(); if (src.type==="GLYPH_30x10") { drawLogoGrid30x10(src.payload); return; } if (src.type==="PIX_150x70") { drawLogoPix150x70(src.payload?.bits_b64||src.payload?.bits_base64||src.payload?.bitsBase64||"", LIT.main); return; } throw new Error("LOGO: nieznany typ: "+src.type); },
      show: async (animIn = {type:"edge",dir:"left",ms:14}) => { api.logo.draw(); await api.big.animIn({ ...animIn, area: api.big.areaAll() }); },
      hide: async (animOut = {type:"edge",dir:"right",ms:14}) => { await api.big.animOut({ ...animOut, area: api.big.areaAll() }); },
      reload: async () => {
        const gid = api.logo._gameId, key = api.logo._key;
        if (!gid) return;
        const seq = ++logoSeq;
        try {
          const dbLogo = await loadActiveLogoFromDb(gid, key);
          if (seq !== logoSeq) return;
          ACTIVE_LOGO = (dbLogo && dbLogo.type && dbLogo.payload) ? dbLogo : null;
          api.logo.draw();
        } catch (e) { console.warn("[logo] reload failed:", e); }
      },
    },
    win: {
      set: async (num, { animOut=null, animIn=null } = {}) => { const A = api.big.areaWin(); if (animOut) await api.big.animOut({...animOut, area:A}); drawWinNumber5(GLYPHS, big, WIN_DIGITS, num, LIT.main); if (animIn) await api.big.animIn({...animIn, area:A}); },
    },
    rounds: {
      setText: async (idx1to6, text, { animOut=null, animIn=null } = {}) => { const i=(idx1to6|0)-1; if (i<0||i>5) throw new Error("idx1to6 musi być 1..6"); const t = clipText((text??"").toString(),17); roundsState.text[i]=t; await updateField(GLYPHS, big, ROUNDS.answers[i], t, {out:animOut, in:animIn, color:LIT.main}); setRoundNumberVisible(idx1to6, hasVisibleText(roundsState.text[i])); relocateSumaIfNeeded(); },
      setPts: async (idx1to6, pts, { animOut=null, animIn=null } = {}) => { const i=(idx1to6|0)-1; if (i<0||i>5) throw new Error("idx1to6 musi być 1..6"); const p = alignRight((pts??"").toString(),2); roundsState.pts[i]=(pts??"").toString(); await updateField(GLYPHS, big, ROUNDS.points[i], p, {out:animOut, in:animIn, color:LIT.main}); setRoundNumberVisible(idx1to6, isNonEmpty(roundsState.text[i])||isNonEmpty(roundsState.pts[i])); relocateSumaIfNeeded(); },
      setRow: async (idx1to6, { text=undefined, pts=undefined, animOut=null, animIn=null } = {}) => {
        // Tekst i punkty należą do jednej odpowiedzi: wspólny czas, różne
        // pola SVG. Sekwencja dwóch pełnych animacji podwajała ten czas.
        const fields = [];
        if (text !== undefined) fields.push(api.rounds.setText(idx1to6, text, { animOut, animIn }));
        if (pts !== undefined) fields.push(api.rounds.setPts(idx1to6, pts, { animOut, animIn }));
        await Promise.all(fields);
      },
      setSuma: async (val, { animOut=null, animIn=null } = {}) => { roundsState.suma=(val??"").toString(); relocateSumaIfNeeded(); const F=roundsSumaFields(); await updateField(GLYPHS, big, F.val, alignRight(roundsState.suma,3), {out:animOut, in:animIn, color:LIT.main}); },
      setX: (name, on) => {
        const key = (name??"").toString().toUpperCase(); const cell = ROUNDS.xCells[key]; if (!cell) throw new Error(`Nieznane X: ${name}`);
        const clearKey = (k) => { const c=ROUNDS.xCells[k]; if (!c) return; clearArea(big, c.c1, c.r1, c.c2, c.r2); };
        const side = key.endsWith("A")?"A":key.endsWith("B")?"B":null;
        const bigKey = side==="A"?"4A":side==="B"?"4B":null;
        const smallKeys = side==="A"?["1A","2A","3A"]:side==="B"?["1B","2B","3B"]:[];
        const isBig = (cell.kind==="BIG");
        if (!on) {
          if (side) { if (isBig) { if (smallKeys.some(k=>xState[k])) return; } else { if (bigKey&&xState[bigKey]) return; } }
          clearArea(big, cell.c1, cell.r1, cell.c2, cell.r2); xState[key]=false; return;
        }
        if (side) {
          if (isBig) { for (const k of smallKeys) { if (xState[k]) clearKey(k); xState[k]=false; } xState[bigKey]=true; drawRoundsBigX(GLYPHS, big, side, LIT.main); return; }
          else { if (bigKey&&xState[bigKey]) { clearKey(bigKey); xState[bigKey]=false; } xState[key]=true; drawBigX_3x3(GLYPHS, big, cell.c1, cell.r1, LIT.main); return; }
        }
        xState[key]=true; if (isBig) drawRoundsBigX(GLYPHS, big, side, LIT.main); else drawBigX_3x3(GLYPHS, big, cell.c1, cell.r1, LIT.main);
      },
      setAll: async ({ rows=[], suma=undefined, animOut=null, animIn=null, transition=null } = {}) => {
        if (transition) return api.big.replace(() => api.rounds.setAll({ rows, suma }), transition);
        activeBoard = "rounds";
        const A_ALL = api.big.areaAll();
        const hasAnyRowData = rows.some(r => isNonEmpty(r?.text)||isNonEmpty(r?.pts));
        if (animOut && !animIn && !hasAnyRowData && suma===undefined) { await api.big.animOut({...animOut, area:A_ALL}); clearBig(big); roundsState.text=Array(6).fill(""); roundsState.pts=Array(6).fill(""); roundsState.suma=""; roundsState.sumaRow=9; return; }
        if (animOut) await api.big.animOut({...animOut, area:A_ALL});
        for (let i=0;i<6;i++) { const r=rows[i]??{}; const t=clipText((r.text??"").toString(),17), p=alignRight((r.pts??"").toString(),2); roundsState.text[i]=t; roundsState.pts[i]=(r.pts??"").toString(); writeField(GLYPHS, big, ROUNDS.answers[i], t, LIT.main); writeField(GLYPHS, big, ROUNDS.points[i], p, LIT.main); setRoundNumberVisible(i+1, isNonEmpty(t)||isNonEmpty(r.pts)); }
        if (suma!==undefined) roundsState.suma=(suma??"").toString();
        relocateSumaIfNeeded(); const F=roundsSumaFields(); writeField(GLYPHS, big, F.label, SUMA_LABEL, LIT.main); writeField(GLYPHS, big, F.val, isNonEmpty(roundsState.suma)?alignRight(roundsState.suma,3):"   ", LIT.main);
        if (animIn) await api.big.animIn({...animIn, area:A_ALL});
      },
    },
    final: {
      setLeft: async (idx1to5, text, { animOut=null, animIn=null } = {}) => { const i=(idx1to5|0)-1; if (i<0||i>4) throw new Error("idx1to5 musi być 1..5"); await updateField(GLYPHS, big, FINAL.leftTxt[i], clipText((text??"").toString(),11), {out:animOut, in:animIn, color:LIT.main}); },
      setA: async (idx1to5, pts, { animOut=null, animIn=null } = {}) => { const i=(idx1to5|0)-1; if (i<0||i>4) throw new Error("idx1to5 musi być 1..5"); await updateField(GLYPHS, big, FINAL.ptsA[i], alignRight((pts??"").toString(),2), {out:animOut, in:animIn, color:LIT.main}); },
      setB: async (idx1to5, pts, { animOut=null, animIn=null } = {}) => { const i=(idx1to5|0)-1; if (i<0||i>4) throw new Error("idx1to5 musi być 1..5"); await updateField(GLYPHS, big, FINAL.ptsB[i], alignRight((pts??"").toString(),2), {out:animOut, in:animIn, color:LIT.main}); },
      setRight: async (idx1to5, text, { animOut=null, animIn=null } = {}) => { const i=(idx1to5|0)-1; if (i<0||i>4) throw new Error("idx1to5 musi być 1..5"); await updateField(GLYPHS, big, FINAL.rightTxt[i], clipText((text??"").toString(),11), {out:animOut, in:animIn, color:LIT.main}); },
      setRow: async (idx1to5, { left=undefined, a=undefined, b=undefined, right=undefined, animOut=null, animIn=null } = {}) => {
        const tasks = [];
        if (left !== undefined) tasks.push(api.final.setLeft(idx1to5,left,{animOut,animIn}));
        if (a !== undefined) tasks.push(api.final.setA(idx1to5,a,{animOut,animIn}));
        if (b !== undefined) tasks.push(api.final.setB(idx1to5,b,{animOut,animIn}));
        if (right !== undefined) tasks.push(api.final.setRight(idx1to5,right,{animOut,animIn}));
        await Promise.all(tasks);
      },
      setSumMode: (side) => { const s=(side??"").toString().toUpperCase(); if (s!=="A"&&s!=="B") throw new Error(`FSUMMODE: nieznana strona: ${side}`); finalState.sumMode=s; drawFinalSum(); },
      setSuma: async (val, { animOut=null, animIn=null } = {}) => { if (finalState.sumMode==="A") finalState.sumA=(val??"").toString(); else finalState.sumB=(val??"").toString(); const isA=(finalState.sumMode==="A"); clearFinalSumRow(); writeField(GLYPHS, big, isA?FINAL.sumaALabel:FINAL.sumaBLabel, SUMA_LABEL, LIT.main); await updateField(GLYPHS, big, isA?FINAL.sumaAVal:FINAL.sumaBVal, alignRight((val??"").toString(),3), {out:animOut, in:animIn, color:LIT.main}); },
      setSumaFor: async (side, val, anims={}) => { const s=(side??"").toString().toUpperCase(); if (s!=="A"&&s!=="B") throw new Error(`setSumaFor: nieznana strona: ${side}`); finalState.sumMode=s; return api.final.setSuma(val, anims); },
      setAll: async ({ rows=[], suma=undefined, sumaSide=null, animOut=null, animIn=null, transition=null } = {}) => {
        if (transition) return api.big.replace(() => api.final.setAll({ rows, suma, sumaSide }), transition);
        activeBoard = "final";
        const A_ALL = api.big.areaAll();
        const hasAnyRowData = rows.some(r => isNonEmpty(r?.left)||isNonEmpty(r?.a)||isNonEmpty(r?.b)||isNonEmpty(r?.right));
        if (animOut&&!animIn&&!hasAnyRowData&&suma===undefined) { await api.big.animOut({...animOut, area:A_ALL}); clearBig(big); finalState.sumA=""; finalState.sumB=""; return; }
        if (animOut) await api.big.animOut({...animOut, area:A_ALL});
        for (let i=0;i<5;i++) { const r=rows[i]??{}; writeField(GLYPHS, big, FINAL.leftTxt[i], clipText((r.left??"").toString(),11), LIT.main); writeField(GLYPHS, big, FINAL.ptsA[i], alignRight((r.a??"").toString(),2), LIT.main); writeField(GLYPHS, big, FINAL.ptsB[i], alignRight((r.b??"").toString(),2), LIT.main); writeField(GLYPHS, big, FINAL.rightTxt[i], clipText((r.right??"").toString(),11), LIT.main); }
        if (suma!==undefined&&(sumaSide==="A"||sumaSide==="B")) { if (sumaSide==="A") { finalState.sumA=(suma??"").toString(); finalState.sumMode="A"; } else { finalState.sumB=(suma??"").toString(); finalState.sumMode="B"; } }
        drawFinalSum(); if (animIn) await api.big.animIn({...animIn, area:A_ALL});
      },
      setHalf: async (side, { rows=[], animOut=null, animIn=null, transition=null } = {}) => {
        const s = (side??"").toString().toUpperCase(); let area; if (s==="A") area=FINAL_AREA_LEFT; else if (s==="B") area=FINAL_AREA_RIGHT; else throw new Error(`final.setHalf: nieznana strona: ${side}`);
        if (transition) return api.big.replace(() => api.final.setHalf(s, { rows }), { ...transition, area });
        if (animOut) await api.big.animOut({...animOut, area});
        for (let i=0;i<5;i++) { const r=rows[i]??{}; if (s==="A") { writeField(GLYPHS, big, FINAL.leftTxt[i], clipText((r.left??"").toString(),11), LIT.main); writeField(GLYPHS, big, FINAL.ptsA[i], alignRight((r.a??"").toString(),2), LIT.main); } else { writeField(GLYPHS, big, FINAL.ptsB[i], alignRight((r.b??"").toString(),2), LIT.main); writeField(GLYPHS, big, FINAL.rightTxt[i], clipText((r.right??"").toString(),11), LIT.main); } }
        if (animIn) await api.big.animIn({...animIn, area});
      },
    },
    // ============================================================
    // theme / color — w oryginalnym scene.js istniały WYŁĄCZNIE jako
    // gałęzie interpretera komend (THEME <name>, COLOR A|B|BACKGROUND|
    // DOT|RESET). Tu są pierwszorzędnymi funkcjami — to jest właśnie
    // wyciągnięcie sprzężenia rysowanie<->komendy, o które chodziło.
    // ============================================================
    theme: {
      getActive: () => themeMgr.getActive(),
      getAvailable: () => themeMgr.getAvailable(),
      set: async (name) => {
        const requested = (name ?? "").toString().toLowerCase();
        const generation = ++themeGeneration;
        const known = await themeMgr.ensure(requested);
        if (generation !== themeGeneration) return;
        const key = known ? requested : themeMgr.getDefault();
        const oldTheme = themeMgr.getActiveTheme();
        const config = { colors: oldTheme?.getColors?.(), controls: oldTheme?.getControls?.() };
        const snap = {
          big: big.snapshot(), left: leftPanel.snapshot(),
          right: rightPanel.snapshot(), top: topPanel.snapshot(),
          long1: long1.snapshot(), long2: long2.snapshot(),
        };
        const newTheme = themeMgr.load(key, config);
        displaysGroup.innerHTML = "";
        const newDisplays = createDisplays({ svgGroup: displaysGroup, theme: newTheme });
        big = newDisplays.big;
        leftPanel = newDisplays.left;
        rightPanel = newDisplays.right;
        topPanel = newDisplays.top;
        long1 = newDisplays.long1;
        long2 = newDisplays.long2;
        leftTriple = newDisplays.leftTriple;
        rightTriple = newDisplays.rightTriple;
        topTriple = newDisplays.topTriple;
        big.restore(snap.big);
        leftPanel.restore(snap.left);
        rightPanel.restore(snap.right);
        topPanel.restore(snap.top);
        long1.restore(snap.long1);
        long2.restore(snap.long2);
      },
    },
    color: {
      // target: "A" | "B" | "BG" | "DOT"
      set: (target, value) => {
        const key = (target ?? "").toString().toUpperCase();
        if (key === "DOT") {
          if (!cssColorToRgb(value)) { console.warn(`color.set: nieprawidłowy kolor: ${value}`); return; }
          const oldLit = LIT.main;
          LIT.main = value; LIT.top = value; LIT.left = value; LIT.right = value; LIT.bottom = value;
          updateDotColor(oldLit, LIT.main);
          return;
        }
        if (!cssColorToRgb(value)) { console.warn(`color.set: nieprawidłowy kolor: ${value}`); return; }
        const themeKey = key === "A" ? "A" : key === "B" ? "B" : key === "BG" ? "BG" : null;
        if (!themeKey) { console.warn(`color.set: nieznany cel "${target}" (użyj A | B | BG | DOT)`); return; }
        themeMgr.updateColors({ [themeKey]: value });
      },
      reset: () => {
        const def = themeMgr.getDefault();
        themeMgr.load(def);
        const oldDot = COLORS.dotOff;
        COLORS.dotOff = "#2e2e32";
        updateDotColor(oldDot, COLORS.dotOff);
        const oldLit = LIT.main;
        const newLit = LIT_DEFAULT;
        LIT.main = newLit; LIT.top = newLit; LIT.left = newLit; LIT.right = newLit; LIT.bottom = newLit;
        updateDotColor(oldLit, LIT.main);
      },
    },
    debug: {
      // Wywoływane ręcznie z konsoli do testów znaczków — bez wejścia
      // przez żadną komendę (interpreter komend nie istnieje w v2).
      showFont: (opts={}) => {
        const kind=(opts.kind||"ALL").toUpperCase(), group=(opts.group||""), text=(opts.text||"");
        const groups = Object.keys(FONT5).filter(k=>k!=="meta").map(name=>({name:name.toUpperCase(),map:FONT5[name]||{}}));
        const allChars = groups.flatMap(g=>Object.keys(g.map));
        let chars = []; if (kind==="ALL") chars=allChars; else if (kind==="GROUP") { const wanted=group.toUpperCase(); const g=groups.find(g=>g.name===wanted); if (!g) return; chars=Object.keys(g.map); } else if (kind==="TEXT") chars=Array.from(text); else chars=Array.from(text||kind);
        api.big.clear(); let i=0; for (let row=1;row<=big.tilesY;row++) for (let col=1;col<=big.tilesX;col++) { if (i>=chars.length) return; api.big.put(col, row, chars[i]); i++; }
      },
    },
  };

  // Init
  clearBig(big);
  setTripleDigits(GLYPHS, topTriple, "   ", LIT.top);
  setTripleDigits(GLYPHS, leftTriple, "   ", LIT.left);
  setTripleDigits(GLYPHS, rightTriple, "   ", LIT.right);
  setLongTextCentered(GLYPHS, long1, "", LIT.main);
  setLongTextCentered(GLYPHS, long2, "", LIT.main);

  return { api, themeMgr, cancelAnimations() { animationGeneration++; } };
}
