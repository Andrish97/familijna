import { escapeHtmlAttribute as esc } from "../../../../shared/js/core/html-escape.js?v=v2026-11-08T21472";
// base-explorerjs/ui/toolbar.js
// Przyciski paska narzędzi z rejestru akcji (actions/registry.js): kolejność,
// grupy, ikony, dymki ze skrótem i powodem niedostępności, widoczność
// i dostępność — bez własnych reguł. Klik woła runAction.

import { ACTIONS, TOOLBAR_GROUPS, actionById, actionState } from "../actions/registry.js?v=v2026-11-08T21472";
import { buildContext } from "../actions/context.js?v=v2026-11-08T21472";
import { runAction } from "../actions/run.js?v=v2026-11-08T21472";
import { formatShortcut } from "../platform.js?v=v2026-11-08T21472";
import { icon } from "../../../../shared/js/core/icons.js?v=v2026-11-08T21472";
import { t } from "../../../../shared/translation/translation.js?v=v2026-11-08T21472";

const GROUP_LABEL = {
  history: "baseExplorer.toolbar.groupHistory",
  create: "baseExplorer.toolbar.groupCreate",
  edit: "baseExplorer.toolbar.groupEdit",
  clipboard: "baseExplorer.toolbar.groupClipboard",
  game: "baseExplorer.toolbar.groupGame",
  view: "baseExplorer.toolbar.groupView",
};



// HTML grup paska (wstawiany raz, w szkielecie renderToolbar).
export function toolbarButtonsHtml() {
  return TOOLBAR_GROUPS.map((group, i) => {
    const buttons = ACTIONS.filter((a) => a.toolbar?.group === group).map((a) => {
      const cls = ["btn icon", a.danger ? "danger" : "", a.primary ? "gold" : ""].filter(Boolean).join(" ");
      return `<button class="${cls}" type="button" data-act="${esc(a.toolbar.act)}" data-action="${esc(a.id)}">${icon(a.icon)}</button>`;
    }).join("");
    // pierwszy separator oddziela hamburger, który jest tylko na telefonie
    return `<div class="tbSep${i === 0 ? " explorer-narrow-only" : ""}" aria-hidden="true"></div>
      <div class="tbGroup" role="group" data-group="${esc(group)}" aria-label="${esc(t(GROUP_LABEL[group]))}">${buttons}</div>`;
  }).join("");
}

function setAttr(el, name, value) {
  if (el.getAttribute(name) !== value) el.setAttribute(name, value);
}

// Widoczność, dostępność i dymki przycisków dla bieżącego stanu.
export function updateToolbarButtons(root, state) {
  if (!root) return;
  const ctx = buildContext(state, { source: "toolbar" });

  root.querySelectorAll("button[data-action]").forEach((btn) => {
    const action = actionById(btn.dataset.action);
    if (!action) return;
    const st = actionState(action, ctx);
    btn.hidden = !st.visible;
    btn.disabled = !st.enabled;

    const label = t(action.label(ctx)).replace(/…$/, "");
    const combo = formatShortcut(action.shortcut);
    const tip = (combo ? `${label} (${combo})` : label) + (st.reason ? ` — ${t(st.reason)}` : "");
    setAttr(btn, "aria-label", label);
    setAttr(btn, "data-tooltip", tip);
  });

  // grupa bez widocznych przycisków znika razem ze swoim separatorem;
  // etykieta grupy w bieżącym języku (szkielet paska powstaje raz)
  root.querySelectorAll(".tbGroup[data-group]").forEach((group) => {
    setAttr(group, "aria-label", t(GROUP_LABEL[group.dataset.group] || ""));
    const empty = !group.querySelector("button[data-action]:not([hidden])");
    group.hidden = empty;
    const sep = group.previousElementSibling;
    if (sep?.classList.contains("tbSep")) sep.hidden = empty;
  });
}

// Klik w przycisk paska → akcja z rejestru.
export function wireToolbarButtons(root, state) {
  root?.addEventListener("click", async (e) => {
    const btn = e.target?.closest?.("button[data-action]");
    if (!btn || !root.contains(btn) || btn.disabled) return;
    e.preventDefault();
    await runAction(btn.dataset.action, buildContext(state, { source: "toolbar" }));
  });
}
