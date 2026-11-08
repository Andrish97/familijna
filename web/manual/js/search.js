// manual/js/search.js
// Wyszukiwarka podręcznika: to samo pole co wyszukiwarki list (searchBox / searchText /
// searchClear), wyniki od razu podczas pisania — podrozdział, rozdział i fragment
// z zaznaczonym trafieniem. Strzałki + Enter, Esc czyści. Szukanej frazy nie zapamiętujemy.

import { t } from "../../shared/translation/translation.js?v=v2026-11-08T09461";
import { icon } from "../../shared/js/core/icons.js?v=v2026-11-08T09461";

export const norm = (s) => String(s || "").toLocaleLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ł/g, "l");
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/** Indeks: jeden wpis na rozdział (wstęp) i na każdy podrozdział — tytuł i czysty tekst. */
export function buildIndex(manual) {
  const entries = [];
  const tpl = document.createElement("template");
  for (const ch of manual.chapters) {
    // Spacja po każdym bloku — inaczej tekst sąsiednich akapitów i komórek skleja się w jedno słowo.
    tpl.innerHTML = ch.html.replace(/<\/(p|li|dt|dd|td|th|h[1-6]|div|tr)>/g, "$& ");
    let cur = { id: ch.id, ch: ch.id, title: ch.title, chapterTitle: ch.title, text: "" };
    entries.push(cur);
    for (const node of tpl.content.children) {
      if (/^H[23]$/.test(node.tagName) && node.id) {
        const id = node.id.replace(/^s-/, "").replace(/-/g, ".");
        cur = { id, ch: ch.id, title: node.textContent.trim(), chapterTitle: ch.title, text: "" };
        entries.push(cur);
        continue;
      }
      cur.text += ` ${node.textContent}`;
    }
  }
  for (const e of entries) {
    e.text = e.text.replace(/\s+/g, " ").trim();
    e.nTitle = norm(e.title);
    e.nText = norm(e.text);
  }
  return entries;
}

export function searchIndex(entries, query, limit = 12) {
  const words = norm(query).split(/\s+/).filter((w) => w.length > 1);
  if (!words.length) return [];
  const hits = [];
  for (const e of entries) {
    if (!words.every((w) => e.nTitle.includes(w) || e.nText.includes(w))) continue;
    let score = 0;
    for (const w of words) {
      if (e.nTitle.includes(w)) score += 10;
      score += Math.min(5, e.nText.split(w).length - 1);
    }
    hits.push({ e, score });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit).map((h) => h.e);
}

// Fragment tekstu wokół pierwszego trafienia, z <mark>. Pozycje liczone na tekście
// znormalizowanym — ta sama długość co oryginał (NFD + usunięcie znaków łączących
// mogłoby ją zmienić, więc mapujemy znak po znaku).
function snippet(text, words, width = 120) {
  const chars = [...text];
  const normed = chars.map((c) => norm(c) || c);
  const flat = normed.join("");
  let at = -1;
  for (const w of words) { const i = flat.indexOf(w); if (i >= 0 && (at < 0 || i < at)) at = i; }
  // indeks w `flat` → indeks znaku w `chars`
  const starts = []; let pos = 0;
  for (const n of normed) { starts.push(pos); pos += n.length; }
  const toChar = (i) => { let k = 0; while (k + 1 < starts.length && starts[k + 1] <= i) k++; return k; };
  const center = at < 0 ? 0 : toChar(at);
  const from = Math.max(0, center - Math.floor(width / 3));
  const to = Math.min(chars.length, from + width);
  let out = "";
  for (let i = from; i < to; ) {
    const rest = normed.slice(i).join("");
    const w = words.find((x) => rest.startsWith(x));
    if (w) {
      let j = i, len = 0;
      while (j < to && len < w.length) { len += normed[j].length; j++; }
      out += `<mark>${esc(chars.slice(i, j).join(""))}</mark>`;
      i = j;
    } else { out += esc(chars[i]); i++; }
  }
  return `${from > 0 ? "…" : ""}${out}${to < chars.length ? "…" : ""}`;
}

/**
 * @param {HTMLElement} host   miejsce na pole i wyniki
 * @param {() => Array} getEntries
 * @param {(entry, query) => void} onPick
 */
export function initManualSearch(host, getEntries, onPick) {
  host.innerHTML = `
    <div class="searchBox searchBox--field">${icon("search")}<input class="searchText" type="search" enterkeyhint="search" autocomplete="off"><button class="btn-plain searchClear" type="button" hidden>${icon("close")}</button></div>
    <div class="m-search-results" role="listbox" hidden></div>`;
  const input = host.querySelector(".searchText");
  const clear = host.querySelector(".searchClear");
  const list = host.querySelector(".m-search-results");
  let results = [];
  let active = -1;
  let renderRequest = 0;

  const label = () => {
    input.placeholder = t("manual.search");
    input.setAttribute("aria-label", t("manual.search"));
    clear.title = t("manual.searchClear");
  };
  label();
  window.addEventListener("i18n:lang", label);

  const render = async () => {
    const request = ++renderRequest;
    const q = input.value;
    clear.hidden = !q;
    const words = norm(q).split(/\s+/).filter((w) => w.length > 1);
    if (!words.length) { list.hidden = true; list.innerHTML = ""; results = []; return; }
    const entries = await getEntries();
    if (request !== renderRequest) return;
    results = searchIndex(entries, q);
    active = results.length ? 0 : -1;
    list.hidden = false;
    list.innerHTML = results.length
      ? results.map((e, i) => `<button class="m-search-hit${i === active ? " active" : ""}" type="button" role="option" data-i="${i}">
          <span class="m-search-title">${esc(e.title)}</span>
          ${e.id !== e.ch ? `<span class="m-search-chapter">${esc(e.chapterTitle)}</span>` : ""}
          <span class="m-search-snippet">${snippet(e.text || e.title, words)}</span>
        </button>`).join("")
      : `<div class="empty-state empty-state--inline">${esc(t("manual.searchEmpty"))}</div>`;
  };
  const pick = (i) => {
    const e = results[i];
    if (!e) return;
    onPick(e, input.value);
  };
  const setActive = (i) => {
    if (!results.length) return;
    active = (i + results.length) % results.length;
    list.querySelectorAll(".m-search-hit").forEach((b, k) => b.classList.toggle("active", k === active));
    list.querySelector(".m-search-hit.active")?.scrollIntoView({ block: "nearest" });
  };

  input.addEventListener("input", () => { void render(); });
  input.addEventListener("keydown", (ev) => {
    if (ev.key === "ArrowDown") { ev.preventDefault(); setActive(active + 1); }
    else if (ev.key === "ArrowUp") { ev.preventDefault(); setActive(active - 1); }
    else if (ev.key === "Enter") { ev.preventDefault(); pick(active); }
    else if (ev.key === "Escape") { input.value = ""; render(); }
  });
  clear.addEventListener("click", () => { input.value = ""; render(); input.focus(); });
  list.addEventListener("click", (ev) => {
    const b = ev.target.closest(".m-search-hit");
    if (b) pick(Number(b.dataset.i));
  });
  return { input, refresh: render };
}

/** Zaznacza w elemencie wszystkie wystąpienia słów (do kolejnej nawigacji). */
export function highlight(root, query) {
  const words = norm(query).split(/\s+/).filter((w) => w.length > 1);
  if (!root || !words.length) return null;
  // Podpisów zrzutów nie zaznaczamy — bywają na niewidocznym slajdzie karuzeli.
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement?.closest(".m-shot") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  let first = null;
  for (const node of nodes) {
    const text = node.nodeValue;
    const n = [...text].map((c) => norm(c) || c);
    const flat = n.join("");
    if (!words.some((w) => flat.includes(w))) continue;
    const frag = document.createDocumentFragment();
    const chars = [...text];
    let i = 0, buf = "";
    while (i < chars.length) {
      const rest = n.slice(i).join("");
      const w = words.find((x) => rest.startsWith(x));
      if (w) {
        if (buf) { frag.append(buf); buf = ""; }
        let j = i, len = 0;
        while (j < chars.length && len < w.length) { len += n[j].length; j++; }
        const mark = document.createElement("mark");
        mark.className = "m-hit";
        mark.textContent = chars.slice(i, j).join("");
        frag.append(mark);
        first ||= mark;
        i = j;
      } else { buf += chars[i]; i++; }
    }
    if (buf) frag.append(buf);
    node.replaceWith(frag);
  }
  return first;
}
