// familiada/logos/js/routes.js
// Adresy stron logo: lista /logos/ i trzy edytory /logos/editor/<tryb>/?id=.
// Cele i powroty liczy mapa nawigacji (core/nav-map.js): edytor wraca przez
// ?ret= do listy z kartą, z której wszedł; bez ret — na /logos/.
// Patrz docs/nawigacja-mapa-plan.md.

import { linkTo, backHref } from "../../shared/js/core/nav-map.js?v=v2026-11-08T20154";
import { TYPE_GLYPH } from "./render.js?v=v2026-11-08T20154";


/** Id strony w mapie nawigacji dla trybu edytora. */
export const EDITOR_PAGE_IDS = {
  TEXT: "logoText",
  DRAW: "logoDraw",
  IMAGE: "logoImage",
};

/**
 * Tryb edycji zapisanego logo. GLYPH to zawsze Tekst; PIX -- Obraz, jeśli ma
 * obraz źródłowy, w pozostałych przypadkach Rysunek (także stare logo i demo
 * bez source: ich kropki trafiają na scenę jako warstwa obrazu).
 */
export function editModeFor(logo) {
  if (logo.type === TYPE_GLYPH) return "TEXT";
  const src = logo.payload?.source || {};
  if (src.mode === "IMAGE" || src.imageUrl || src.imageData) return "IMAGE";
  return "DRAW";
}

export function editorUrl(mode, id) {
  return linkTo(EDITOR_PAGE_IDS[mode], { id });
}

/** Powrót z edytora danego trybu: ret (lista logo) albo /logos/. */
export function listBackUrl(mode) {
  return backHref(EDITOR_PAGE_IDS[mode]);
}
