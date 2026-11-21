import { escapeHtmlText as escapeHtml } from "./html-escape.js";
// js/core/empty-state.js
// Pusty stan (.empty-state w silniku, E23 §6.2): jeden sposób budowania
// komunikatu „nic tu nie ma” w listach, oknach i panelach.
//   variant  "" (blok) | "inline" (w wierszu listy) | "tile" (kafel w siatce)
//   hook     dodatkowa klasa-uchwyt dla logiki strony (np. list-empty)

const VARIANTS = new Set(["", "inline", "tile"]);

function classes(variant, hook) {
  if (!VARIANTS.has(variant)) throw new Error(`emptyState: nieznany wariant "${variant}"`);
  return ["empty-state", variant && `empty-state--${variant}`, hook].filter(Boolean).join(" ");
}


/** Element pustego stanu. */
export function emptyState(text, { variant = "", hook = "", tag = "div" } = {}) {
  const el = document.createElement(tag);
  el.className = classes(variant, hook);
  el.textContent = text ?? "";
  return el;
}

/** To samo jako HTML (dla list składanych z szablonów). */
export function emptyStateHtml(text, { variant = "", hook = "", tag = "div" } = {}) {
  return `<${tag} class="${classes(variant, hook)}">${escapeHtml(text)}</${tag}>`;
}
