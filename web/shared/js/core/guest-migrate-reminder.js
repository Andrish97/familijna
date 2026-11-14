// js/core/guest-migrate-reminder.js
// Codzienny baner przypominający gościom o migracji konta (w odróżnieniu od
// guest-info-modal.js, który pokazuje się tylko raz). Pokazuje się raz na
// dzień kalendarzowy, dopóki gość nie kliknie "Nie pokazuj więcej" — wtedy
// znika na stałe (dla tego konta gościa).

import { t } from "../../translation/translation.js?v=v2026-11-14T11320";
import { icon } from "./icons.js?v=v2026-11-14T11320";
import { linkTo } from "./nav-map.js?v=v2026-11-14T11320";


const LAST_SHOWN_PREFIX = "fam:guest:migrate_last_shown:";
const DISMISSED_PREFIX = "fam:guest:migrate_dismissed:";

function todayKey() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD, lokalny zegar wystarczy
}

function readStorage(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // storage niedostępny (np. tryb prywatny) — po prostu nie zapamiętamy stanu
  }
}

function buildBanner(uid) {
  const bar = document.createElement("div");
  bar.id = "guestMigrateReminder";
  bar.className = "notice-bar";

  const text = document.createElement("span");
  text.textContent = t("guestReminder.text");

  const link = document.createElement("a");
  link.href = linkTo("account"); // z językiem strony i powrotem (ret) wg mapy
  link.textContent = t("guestReminder.link");

  const dismissBtn = document.createElement("button");
  dismissBtn.type = "button";
  dismissBtn.textContent = t("guestReminder.dismiss");
  dismissBtn.className = "btn-plain";
  dismissBtn.addEventListener("click", () => {
    writeStorage(DISMISSED_PREFIX + uid, "1");
    bar.remove();
  });

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.setAttribute("aria-label", t("guestReminder.close"));
  closeBtn.innerHTML = icon("close");
  closeBtn.className = "btn-plain";
  closeBtn.addEventListener("click", () => bar.remove()); // tylko na dziś — jutro wróci

  bar.append(text, link, dismissBtn, closeBtn);
  return bar;
}

/**
 * Pokazuje codzienny baner-przypomnienie dla gościa (raz na dzień
 * kalendarzowy, chyba że kliknął wcześniej "Nie pokazuj więcej").
 * Wywołaj zaraz po requireAuth() gdy user.is_guest === true.
 *
 * @param {object} user - enriched user z requireAuth() / getUser()
 */
export function maybeShowGuestMigrateReminder(user) {
  if (!user?.is_guest) return;
  const uid = user.id || "unknown";

  if (readStorage(DISMISSED_PREFIX + uid) === "1") return;
  if (readStorage(LAST_SHOWN_PREFIX + uid) === todayKey()) return;

  const banner = buildBanner(uid);
  document.body.prepend(banner);
  writeStorage(LAST_SHOWN_PREFIX + uid, todayKey());
}
