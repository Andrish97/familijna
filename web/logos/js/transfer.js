// familiada/logos/js/transfer.js
// Eksport/import logo do pliku .famlogo (JSON, bez id i użytkownika).
//
// Formaty wejściowe:
//   (A) { kind:"GLYPH"|"PIX", name, payload:{ rows | layers | bits_b64, source } }  -- nasz eksport
//   (B) { type:"GLYPH_30x10"|"PIX_150x70", name, payload }                          -- stary zrzut z bazy

import { standaloneLogoSource } from "../../shared/js/core/logo-transfer-source.js?v=v2026-11-05T19265";
import { parseLogoPackage, sanitizeLogoFileImport } from "./package.js?v=v2026-11-05T19265";
import { t } from "../../shared/translation/translation.js?v=v2026-11-05T19265";
import { DOT_W, DOT_H, TYPE_PIX, PIX_FORMAT, normalizeRows } from "./render.js?v=v2026-11-05T19265";


/** Nazwa pliku z nazwy logo -- zostawia litery każdego alfabetu, wycina znaki zakazane w systemach plików. */
export function safeFileName(name, fallback) {
  const s = String(name || "").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "").replace(/\s+/g, " ").trim().slice(0, 80);
  return s || fallback;
}

async function fetchImageAsDataUrl(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const blob = await resp.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/** Pełny rekord z bazy -> obiekt pliku. Obraz ze Storage osadzany jako base64. */
export async function buildExport(logo, fallbackName) {
  const name = logo.name || fallbackName;
  const p = logo.payload || {};
  let source;
  try {
    source = await standaloneLogoSource(p.source, fetchImageAsDataUrl);
  } catch (error) {
    console.warn("[logo/export] incomplete image source:", error?.message || error);
    throw new Error(t("logoEditor.errors.exportIncomplete"));
  }

  if (logo.type === TYPE_PIX) {
    return {
      kind: "PIX",
      name,
      payload: { w: DOT_W, h: DOT_H, format: PIX_FORMAT, bits_b64: String(p.bits_b64 || ""), source },
    };
  }

  return {
    kind: "GLYPH",
    name,
    payload: { layers: [{ color: "main", rows: normalizeRows(p.layers?.[0]?.rows) }], source },
  };
}

export function downloadJson(obj, fileName) {
  // The file contents are JSON, but application/json makes Android append
  // ".json" to the custom .famlogo filename. Keep the custom extension intact.
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Po kliknięciu przeglądarka i tak ma już referencję; zwolnienie z opóźnieniem
  // dla Safari, które potrafi zacząć pobieranie dopiero po obsłudze zdarzenia.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Tekst pliku -> { name, type, payload } gotowe do INSERT.
 * Rzuca Error z przetłumaczonym komunikatem.
 */
export function parseImport(text, fallbackName) {
  let obj;
  try { obj = JSON.parse(text); } catch { throw new Error(t("logoEditor.errors.invalidJson")); }
  try {
    return sanitizeLogoFileImport(parseLogoPackage(obj, fallbackName));
  } catch (error) {
    if (["pixSize", "missingBits", "unknownImportFormat"].includes(error?.code)) {
      throw new Error(t(`logoEditor.errors.${error.code}`, error.params));
    }
    throw error;
  }
}
