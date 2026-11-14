// base-explorerjs/ui/left.js
// Lewy panel: proponowane kategorie i tagi. Zaznaczenie w panelu TO JEST
// filtr (query.types / query.tagIds) — te same dane co tabletki w polu
// wyszukiwania. Klik: tylko ten element (drugi klik — wyłącza), Ctrl/⌘:
// dołóż / zdejmij, Shift: zakres, ramka: zakres przeciągnięciem, klik w tło:
// wyczyść. Działa w każdym miejscu — filtr obejmuje bieżący folder.

import { setQuery } from "../state.js?v=v2026-11-14T13241";
import { renderAll } from "../render.js?v=v2026-11-14T13241";
import { openTagsWindow } from "../commands.js?v=v2026-11-14T13241";
import { showContextMenu } from "../context-menu.js?v=v2026-11-14T13241";
import { attachMarquee } from "./marquee.js?v=v2026-11-14T13241";
import { addLongPress, isTouchContextMenuWindow } from "../mobile.js?v=v2026-11-14T13241";
import { isModKey } from "../platform.js?v=v2026-11-14T13241";
import { commitPendingSearch } from "./search.js?v=v2026-11-14T13241";

const ROW = '.row[data-kind="tag"], .row[data-kind="meta"]';
const field = (kind) => (kind === "meta" ? "types" : "tagIds");

export function wireLeft(state) {
  const panel = document.getElementById("leftFilters");
  if (!panel) return;

  let anchor = null; // { kind, id } dla Shift

  function orderedIds(kind) {
    return [...panel.querySelectorAll(`.row[data-kind="${kind}"]`)].map((r) => r.dataset.id);
  }

  function apply(kind, ids) {
    setQuery(state, { [field(kind)]: ids });
    renderAll(state);
  }

  // klucze ramki (data-key z render.js): "meta:<id>" / "tag:<id>"
  const marquee = attachMarquee(panel, {
    rowSelector: ".row[data-key]",
    getBase: () => new Set([
      ...state.query.types.map((id) => `meta:${id}`),
      ...state.query.tagIds.map((id) => `tag:${id}`),
    ]),
    onSelect: (keys, final) => {
      if (final) { renderAll(state); return; }
      const types = [];
      const tagIds = [];
      for (const k of keys) {
        if (k.startsWith("meta:")) types.push(k.slice(5));
        else if (k.startsWith("tag:")) tagIds.push(k.slice(4));
      }
      state.query = { ...state.query, types, tagIds };
      panel.querySelectorAll(".row[data-key]").forEach((row) => row.classList.toggle("is-selected", keys.has(row.dataset.key)));
    },
  });
  panel.addEventListener("click", async (e) => {
    if (marquee.consumeClick()) return;
    commitPendingSearch();

    if (e.target.closest("#btnAddTag")) {
      await openTagsWindow(state, { mode: "create" });
      return;
    }

    const row = e.target.closest(ROW);
    if (!row) {
      if (state.query.tagIds.length || state.query.types.length) {
        setQuery(state, { tagIds: [], types: [] });
        renderAll(state);
      }
      return;
    }

    const { kind, id } = row.dataset;
    const cur = state.query[field(kind)];
    let next;
    if (e.shiftKey && anchor?.kind === kind) {
      const order = orderedIds(kind);
      const [a, b] = [order.indexOf(anchor.id), order.indexOf(id)].sort((x, y) => x - y);
      next = a === -1 ? [id] : order.slice(a, b + 1);
    } else if (isModKey(e)) {
      next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
      anchor = { kind, id };
    } else {
      next = cur.length === 1 && cur[0] === id ? [] : [id];
      anchor = { kind, id };
    }
    apply(kind, next);
  });

  function menuTarget(target) {
    const row = target?.closest?.(ROW);
    if (!row) return { kind: "tags-bg", id: null };
    return { kind: row.dataset.kind === "meta" ? "type" : "tag", id: row.dataset.id };
  }
  panel.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    if (isTouchContextMenuWindow(panel)) return;
    void showContextMenu({ state, x: e.clientX, y: e.clientY, target: menuTarget(e.target) });
  });
  addLongPress(panel, (x, y, target) => {
    void showContextMenu({ state, x, y, target: menuTarget(target) });
  });
}
