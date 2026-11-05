// js/core/blocking-screen.js
// Jeden pełnoekranowy ekran blokady (.blocking-overlay > .blocking-card,
// wygląd: shared/css/blocking-overlay.css): ikona, tytuł, tekst, przyciski.
// Używają: page-overlay.js („tu nie wejdziesz”: gość, urządzenie) i
// resource-lock.js (zasób edytowany gdzie indziej). Identyfikatory części:
// <id>Icon, <id>Title, <id>Msg, <id><key> (przyciski).

import { t } from "../../translation/translation.js?v=v2026-11-05T23575";
import { icon } from "./icons.js?v=v2026-11-05T23575";

/**
 * Nakładka o danym id (tworzona raz). actions: [{ key, i18n, iconName, accent }].
 * prefix: początek identyfikatorów części (domyślnie id nakładki).
 * Nie zamyka się kliknięciem w tło (to blokada).
 */
export function blockingScreen(id, actions = [], { prefix = id } = {}) {
  let overlay = document.getElementById(id);
  if (overlay) return overlay;
  overlay = document.createElement("div");
  overlay.id = id;
  overlay.className = "blocking-overlay";
  const buttons = actions.map((a) => `<button id="${prefix}${a.key}" class="blocking-action${a.accent ? " is-accent" : ""}" type="button" data-i18n="${a.i18n}" data-i18n-icon="${a.iconName}">${icon(a.iconName)} ${t(a.i18n)}</button>`).join("");
  overlay.innerHTML = `
    <div class="blocking-card" role="alertdialog" aria-labelledby="${prefix}Title" aria-describedby="${prefix}Msg">
      <div class="blocking-heading">
        <span id="${prefix}Icon" class="blocking-icon" aria-hidden="true"></span>
        <h2 id="${prefix}Title" class="blocking-title"></h2>
      </div>
      <div id="${prefix}Msg" class="blocking-message"></div>
      <div class="blocking-actions">${buttons}</div>
    </div>`;
  document.documentElement.appendChild(overlay);
  return overlay;
}

/** Ikona nakładki (nazwa z icons.js). */
export function setBlockingIcon(overlay, name) {
  const el = overlay.querySelector(".blocking-icon");
  el.innerHTML = icon(name);
}

/** Pokazuje/chowa nakładkę i blokuje przewijanie strony pod nią
 *  (klasy .is-open i html.blocking-open w blocking-overlay.css). */
export function setBlockingOpen(overlay, open) {
  overlay.classList.toggle("is-open", open);
  const anyOpen = !!document.querySelector(".blocking-overlay.is-open");
  document.documentElement.classList.toggle("blocking-open", anyOpen);
}

/** Czy nakładka jest pokazana. */
export function isBlockingOpen(overlay) {
  return !!overlay?.classList.contains("is-open");
}
