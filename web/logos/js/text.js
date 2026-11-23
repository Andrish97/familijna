// familiada/logos/js/text.js
// Tryb TEXT: napis fontem 3x10 -> GLYPH_30x10 (30 kolumn x 10 wierszy znaków
// fontu 5x7). Glify przycięte do szerokości, stała 1 kolumna przerwy,
// napis wyśrodkowany.

import { setVars } from "../../shared/js/core/ui-metrics.js";
import { t, getUiLang } from "../../shared/translation/translation.js";
import { TILES_X, TILES_Y, TYPE_GLYPH, normalizeRows } from "./render.js";
import { compileText, cropGlyph, GLYPH_W, CYRILLIC_UK } from "../../shared/js/core/logo-text.js";

export { compileText };


/**
 * Odwrotność compileText(): odtwarza napis z samych wierszy GLYPH (dla logo
 * bez zapisanego source.text -- demo, stare zapisy, importy). Zwraca napis
 * tylko wtedy, gdy jego ponowna kompilacja daje DOKŁADNIE te same wiersze;
 * inaczej null (edytor nie otworzy się, żeby nie zniszczyć logo).
 *
 * Odstęp między glifami: 1 kolumna = brak spacji, każda kolejna = 1 spacja.
 */
export function decompileRows(rows, font) {
  const grid = Array.from({ length: TILES_Y }, (_, i) => String(rows?.[i] ?? "").padEnd(TILES_X, " ").slice(0, TILES_X));
  const colEmpty = (x) => grid.every((r) => r[x] === " ");
  let first = 0;
  while (first < TILES_X && colEmpty(first)) first++;
  if (first === TILES_X) return "";

  // kandydaci: litery przed cyframi i resztą (ten sam wygląd -> czytelniejszy napis)
  const rank = (k) => (/^[A-ZĄĆĘŁŃÓŚŹŻ]$/.test(k) ? 0 : /^[А-ЯҐЄІЇ]$/.test(k) ? 1 : /^[0-9]$/.test(k) ? 2 : 3);
  const glyphs = Object.keys(font || {})
    .filter((k) => k !== " ")
    .sort((a, b) => rank(a) - rank(b))
    .map((ch) => ({ ch, ...cropGlyph(Array.from({ length: TILES_Y }, (_, i) => String(font[ch][i] ?? "").padEnd(GLYPH_W, " ").slice(0, GLYPH_W))) }))
    .filter((g) => g.w > 0);

  const memo = new Map();
  const solve = (pos) => {
    if (memo.has(pos)) return memo.get(pos);
    let out = null;
    for (const g of glyphs) {
      if (pos + g.w > TILES_X) continue;
      if (!grid.every((r, y) => r.slice(pos, pos + g.w) === g.rows[y].padEnd(g.w, " "))) continue;
      let next = pos + g.w;
      let gap = 0;
      while (next < TILES_X && colEmpty(next)) { next++; gap++; }
      if (next === TILES_X) { out = g.ch; break; }
      if (gap === 0) continue; // między glifami zawsze jest przerwa
      const rest = solve(next);
      // k spacji między glifami = 1 + k kolumn odstępu
      if (rest != null) { out = g.ch + " ".repeat(gap - 1) + rest; break; }
    }
    memo.set(pos, out);
    return out;
  };

  const core = solve(first);
  if (core == null) return null;
  const same = (text) => compileText(text, font).rows.every((r, i) => r === grid[i]);
  // Wyśrodkowanie zależy od spacji na brzegach -- szukamy ich liczby.
  for (let lead = 0; lead <= TILES_X; lead++) {
    for (let trail = 0; trail <= TILES_X - lead; trail++) {
      const text = " ".repeat(lead) + core + " ".repeat(trail);
      if (same(text)) return text;
    }
  }
  return null;
}

/** Powód odmowy edycji albo null. Jedyny przypadek: logo tekstowe bez
 *  zapisanego napisu, którego wierszy nie da się odczytać jako napis
 *  (edycja by go wyczyściła). Sprawdzają lista i strona edytora. */
export function cannotEditReason(logo, mode, font) {
  if (mode !== "TEXT" || typeof logo.payload?.source?.text === "string") return null;
  const rows = logo.payload?.layers?.[0]?.rows;
  if (!normalizeRows(rows).join("").trim()) return null;
  return decompileRows(rows, font || {}) == null ? t("logoEditor.errors.noSourceText") : null;
}

export function initTextEditor(ctx) {
  const $ = (id) => document.getElementById(id);
  const paneText = $("paneText");
  const textValue = $("textValue");
  const textWarn = $("textWarn");
  const textMeasure = $("textMeasure");
  const charsList = $("charsList");

  const show = (el, on) => { if (el) el.hidden = !on; };
  const font = () => ctx.getFont3x10?.() || {};

  let lastCompiled = null;
  let lastWarnText = null;

  // Klawisze dozwolonych znaków w grupach bez podpisów, oddzielonych kreską
  // (decyzja użytkownika 2026-11-07): cyfry i znaki (ze spacją jako napisem),
  // litery, polskie, ukraińskie (te tylko w interfejsie UK).
  // Klik wstawia znak w miejscu kursora w polu napisu.
  const PL_LETTERS = new Set("ĄĆĘŁŃÓŚŹŻ");
  const groupOf = (k) => (CYRILLIC_UK.has(k) ? "uk" : PL_LETTERS.has(k) ? "pl" : /^[A-Z]$/.test(k) ? "latin" : "signs");
  function renderAllowedChars() {
    if (!charsList) return;
    const key = (ch, label, cls = "") => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `charKey${cls}`;
      b.dataset.char = ch;
      b.textContent = label;
      return b;
    };
    const groups = { signs: [key(" ", t("logoEditor.text.space"), " is-space")], latin: [], pl: [], uk: [] };
    for (const k of Object.keys(font())) {
      if (k === " " || (CYRILLIC_UK.has(k) && getUiLang() !== "uk")) continue;
      groups[groupOf(k)].push(key(k, k));
    }
    charsList.replaceChildren(...Object.entries(groups).filter(([, keys]) => keys.length).map(([name, keys]) => {
      const grid = document.createElement("div");
      grid.className = "charsGrid";
      grid.dataset.group = name;
      grid.append(...keys);
      return grid;
    }));
    fitKeys();
  }

  // Bez przewijania: gdy panel znaków ma ograniczoną wysokość (układ obok
  // podglądu, CSS --fit: 1), klawisze zmniejszają się (--key), aż wszystkie
  // grupy się zmieszczą. Mierzymy prawdziwy układ (wyszukiwanie połówkowe
  // rozmiaru), więc działa przy każdym ułożeniu grup i podpisów.
  const KEY_MIN = 20;
  function fitKeys() {
    if (!charsList) return;
    setVars(charsList, { "--key": null });
    const cs = getComputedStyle(charsList);
    if (cs.getPropertyValue("--fit").trim() !== "1") return;
    // wysokość = obecna lista + wolne miejsce pod panelem w kolumnie
    const col = charsList.closest(".editorToolbar");
    const panel = charsList.closest(".charsPanel");
    const free = col && panel
      ? col.getBoundingClientRect().bottom - (parseFloat(getComputedStyle(col).paddingBottom) || 0) - panel.getBoundingClientRect().bottom
      : 0;
    const h = charsList.clientHeight + Math.max(0, free);
    const fits = (k) => { setVars(charsList, { "--key": `${k}px` }); return charsList.scrollHeight <= h + 0.5; };
    const max = parseFloat(cs.getPropertyValue("--key-def")) || 34;
    if (fits(max)) return setVars(charsList, { "--key": null });
    let lo = KEY_MIN, hi = max;
    while (hi - lo > 1) { const mid = Math.floor((lo + hi) / 2); if (fits(mid)) lo = mid; else hi = mid; }
    setVars(charsList, { "--key": `${lo}px` });
  }
  if (charsList && "ResizeObserver" in window) {
    let raf = 0;
    const ro = new ResizeObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(fitKeys); });
    const col = charsList.closest(".editorToolbar");
    if (col) ro.observe(col);
    window.addEventListener("resize", () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(fitKeys); });
  }

  // Wstawianie bez kolizji z klawiaturą ekranową: gdy pole napisu ma fokus
  // (klawiatura fizyczna albo już otwarta ekranowa), klawisz go nie zabiera
  // i kursor zostaje w polu. Gdy pole fokusu nie ma (np. tablet, klawiatura
  // schowana), znak trafia w ostatnie miejsce kursora BEZ fokusowania pola —
  // klawiatura ekranowa się nie wysuwa i nie zasłania podglądu.
  let caret = null;
  const rememberCaret = () => { caret = { start: textValue.selectionStart, end: textValue.selectionEnd }; };
  textValue?.addEventListener("blur", rememberCaret);

  function insertChar(ch, keepFocus) {
    if (!textValue || textValue.disabled) return;
    const len = textValue.value.length;
    const sel = keepFocus ? { start: textValue.selectionStart, end: textValue.selectionEnd } : (caret || { start: len, end: len });
    const start = Math.min(sel.start ?? len, len), end = Math.min(sel.end ?? start, len);
    if (len - (end - start) >= textValue.maxLength) return;
    textValue.setRangeText(ch, start, end, "end");
    caret = { start: start + ch.length, end: start + ch.length };
    textValue.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function updateWarnings(c) {
    const parts = [];
    if (c.invalid.length) parts.push(t("logoEditor.text.invalidChars", { chars: c.invalid.join(" ") }));
    // Liczbę pokazuje pomiar pod polem -- ostrzeżenie mówi tylko, co zrobić.
    if (!c.fit) parts.push(t("logoEditor.text.fixTooWide"));
    if (textWarn) textWarn.textContent = parts.join("\n");
    const warnText = parts.join("\n");
    show(textWarn, parts.length > 0);
    // ostrzeżenie zabiera wysokość kolumny -- klawisze przeliczane od razu
    if (warnText !== lastWarnText) { lastWarnText = warnText; fitKeys(); }
    if (textMeasure) {
      textMeasure.textContent = t("logoEditor.text.widthStatus", { width: c.usedW });
    }
  }

  function recompile() {
    lastCompiled = compileText(textValue?.value || "", font());
    updateWarnings(lastCompiled);
    ctx.onPreview?.({ kind: "GLYPH", rows: lastCompiled.rows });
  }

  textValue?.addEventListener("input", () => {
    if (ctx.getMode?.() !== "TEXT") return;
    ctx.setEditorMsg?.("");
    ctx.markDirty?.();
    recompile();
  });

  // pointerdown/mousedown bez domyślnej akcji: klawisz nie zabiera fokusu polu
  // napisu (otwarta klawiatura ekranowa się nie chowa, zamknięta nie otwiera)
  let keepFocus = false;
  const holdFocus = (e) => {
    if (!e.target.closest(".charKey")) return;
    keepFocus = document.activeElement === textValue;
    e.preventDefault();
  };
  charsList?.addEventListener("pointerdown", holdFocus);
  charsList?.addEventListener("mousedown", holdFocus);
  charsList?.addEventListener("click", (e) => {
    const k = e.target.closest(".charKey");
    if (k) insertChar(k.dataset.char, keepFocus || document.activeElement === textValue);
    keepFocus = false;
  });

  window.addEventListener("i18n:lang", () => {
    renderAllowedChars();
    if (lastCompiled) updateWarnings(lastCompiled);
  });

  return {
    open(payload = null) {
      show(paneText, true);
      const saved = payload?.source?.text;
      const text = typeof saved === "string" ? saved : decompileRows(payload?.layers?.[0]?.rows, font());
      if (textValue) textValue.value = text ?? "";
      renderAllowedChars();
      recompile();
      ctx.clearDirty?.();
    },

    close() {
      show(paneText, false);
    },

    getCreatePayload() {
      recompile();
      if (lastCompiled.invalid.length) return { ok: false, msg: t("logoEditor.text.fixInvalidChars") };
      if (!lastCompiled.fit) return { ok: false, msg: t("logoEditor.text.fixTooWide") };
      return {
        ok: true,
        type: TYPE_GLYPH,
        payload: {
          layers: [{ color: "main", rows: lastCompiled.rows }],
          source: { mode: "TEXT", text: textValue?.value || "" },
        },
      };
    },
  };
}
