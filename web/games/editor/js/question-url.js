// Otwarte pytanie edytora żyje w adresie: /games/editor/?id=<gra>&q=<pytanie>.
// Adres jest jedynym źródłem — bez zapasu w sessionStorage.
import { filterToHref } from "../../../shared/js/core/list-filter.js?v=v2026-11-05T23552";


/** Id pytania z ?q=, tylko jeśli istnieje wśród pytań gry; inaczej null. */
export function questionFromSearch(search, questions) {
  const q = new URLSearchParams(search).get("q");
  return q && questions.some((x) => x.id === q) ? q : null;
}

/** Adres z ustawionym (albo usuniętym dla null) parametrem ?q=. */
export function questionHref(href, qId) {
  return filterToHref(href, "q", qId || "");
}
