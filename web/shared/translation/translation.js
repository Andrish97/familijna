import { holdPageLayout } from "../js/core/page-layout.js?v=v2026-11-09T01142";
import { icon, iconText } from "../js/core/icons.js?v=v2026-11-09T01142";
import { applyLegacyHandoff } from "../js/core/legacy-handoff.js?v=v2026-11-09T01142";

// Przenosiny ze starej domeny przed pierwszym odczytem uiLang (do usunięcia po 2026-12-01).
applyLegacyHandoff();

// Słownik jest podzielony na części: <lang>/<część>.js (familijna-server/docs/tlumaczenia-podzial-plan.md).
// Strona wczytuje część wspólną i części z <meta name="i18n-parts" content="…">,
// które wylicza z jej kodu scripts/i18n-parts.mjs. Części dostają tę samą wersję
// ?v= co ten moduł.
const LANG_META = {
  pl: { lang: "pl", label: "Polski", icon: "flag-pl" },
  en: { lang: "en", label: "English", icon: "lang-en" },
  uk: { lang: "uk", label: "Українська", icon: "flag-ua" },
};
const ASSET_VERSION = new URL(import.meta.url).search;
import { placeDropdown } from "../js/core/popover.js?v=v2026-11-09T01142";
import { injectThemeSwitcher, refreshThemeSwitcher } from "../js/core/theme-switcher.js?v=v2026-11-09T01142";

const LANG_ORDER = ["pl", "en", "uk"];
let pageParts = null;
const warnedSections = new Set();

let currentLang = "pl";
let translations = null;
let languageRequestId = 0;
// Ostatnie rozpoczęte setUiLang. Starsze, wyprzedzone wywołanie czeka na nie,
// żeby wołający (np. initI18n) nie ruszył dalej bez wczytanego słownika.
let latestLanguageLoad = Promise.resolve(false);

let switcherEl = null; // container w topbarze

function getCurrentYear() {
  return new Date().getFullYear();
}

function normalizeLang(raw) {
  const v = String(raw || "").toLowerCase();
  if (v.startsWith("pl")) return "pl";
  if (v.startsWith("en")) return "en";
  if (v.startsWith("uk") || v.startsWith("ua")) return "uk";
  return "pl";
}

function safeGetLocalStorage(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSetLocalStorage(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {}
}

function readPageParts() {
  const meta = typeof document !== "undefined" ? document.querySelector?.('meta[name="i18n-parts"]') : null;
  const listed = String(meta?.content || "").split(/\s+/).filter((part) => part && part !== "common");
  pageParts = ["common", ...listed];
  return pageParts;
}

async function loadDictionary(lang, parts) {
  const loaded = await Promise.all(parts.map(async (part) =>
    (await import(new URL(`./${lang}/${part}.js${ASSET_VERSION}`, import.meta.url).href)).default));
  return Object.assign({}, ...loaded);
}

// Sekcja spoza wczytanych części: strona pokazałaby surowy klucz. Zwykle
// nieaktualna meta i18n-parts — node scripts/i18n-parts.mjs.
function warnMissingSection(key) {
  if (!translations || !/^[A-Za-z]\w*(\.[\w-]+)+$/.test(key)) return;
  const section = key.split(".")[0];
  if (section in translations || warnedSections.has(section)) return;
  warnedSections.add(section);
  console.error(`[i18n] brak sekcji „${section}” na tej stronie (${key}) — node scripts/i18n-parts.mjs`);
}

export function getUiLang() {
  const params = new URLSearchParams(location.search);
  const q = params.get("lang");
  if (q) return normalizeLang(q);

  const stored = safeGetLocalStorage("uiLang");
  if (stored) return normalizeLang(stored);

  // Strony do indeksowania (meta i18n-lang=url): adres bez ?lang to wersja
  // polska z canonicalem bez parametru. Język przeglądarki przetłumaczyłby ten
  // sam adres (Googlebot renderuje z en-US) i Google sklejał PL z ?lang=en.
  if (typeof document !== "undefined" && document.querySelector?.('meta[name="i18n-lang"][content="url"]')) return "pl";

  if (navigator?.language) return normalizeLang(navigator.language);
  return "pl";
}

export function setUiLang(lang, options = {}) {
  const load = holdPageLayout(loadUiLang(lang, options));
  latestLanguageLoad = load.catch(() => false);
  return load;
}

async function loadUiLang(
  lang,
  { persist = true, updateUrl = true, apply = true, parts = null } = {}
) {
  const requestId = ++languageRequestId;
  const next = normalizeLang(lang);
  if (parts) pageParts = ["common", ...parts.filter((part) => part !== "common")];

  const loaded = await loadDictionary(next, pageParts || readPageParts());
  // Przy szybkim PL -> EN -> UK wolniejszy, starszy import nie może
  // nadpisać języka wybranego później. Wraca dopiero, gdy nowszy wybór
  // wczytał słownik -- inaczej t() zaraz po await zwracałoby klucze.
  if (requestId !== languageRequestId) {
    await latestLanguageLoad;
    return false;
  }
  translations = loaded;
  currentLang = next;

  if (persist) safeSetLocalStorage("uiLang", currentLang);

  if (updateUrl) {
    const url = new URL(location.href);
    if (currentLang === "pl") {
      url.searchParams.delete("lang");
    } else {
      url.searchParams.set("lang", currentLang);
    }
    history.replaceState({}, "", url);
  }

  document.documentElement.lang = currentLang;

  if (apply) applyTranslations(document);
  updateSwitcherLabel();

  window.dispatchEvent(new CustomEvent("i18n:lang", { detail: { lang: currentLang } }));
  return true;
}

export async function initI18n({ withSwitcher = true, apply = true } = {}) {
  await setUiLang(getUiLang(), { persist: true, updateUrl: true, apply });

  if (withSwitcher) {
    // ✅ Jeśli initI18n jest wołane zanim DOM istnieje (np. top-level await),
    // to switcher nie ma gdzie się wstrzyknąć i potrafi wysypać całą stronę.
    if (typeof document !== "undefined" && document.readyState === "loading") {
      await new Promise((resolve) =>
        document.addEventListener("DOMContentLoaded", resolve, { once: true })
      );
    }
    await injectLanguageSwitcher();
  }
}

export function t(key, vars = {}) {
  const value = key
    .split(".")
    .reduce(
      (acc, part) => (acc && acc[part] !== undefined ? acc[part] : undefined),
      translations
    );

  if (value == null) {
    warnMissingSection(key);
    return key;
  }
  if (typeof value === "function") return value(vars);

  return String(value).replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? `{${k}}`));
}

export function getI18nSection(section) {
  return (translations && translations[section]) || {};
}

export function withLangParam(url) {
  const u = new URL(url, location.href);
  if (currentLang === "pl") {
    u.searchParams.delete("lang");
  } else {
    u.searchParams.set("lang", currentLang);
  }
  return u.toString();
}

export function applyTranslations(root = document) {
  const defaultVars = {
    site: (typeof location !== "undefined" ? location.origin : ""),
    siteHost: (typeof location !== "undefined" ? location.host : ""),
    year: getCurrentYear(),
  };

  // data-i18n-icon="nazwa" (ikona przed tekstem) / data-i18n-icon-after
  // (za tekstem): tłumaczenie nadpisuje całą treść elementu, więc ikonę ze
  // wspólnego silnika dokładamy tu, po wstawieniu tekstu.
  root.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    if (!key || el.tagName === "TITLE") return;
    const before = el.getAttribute("data-i18n-icon");
    const after = el.getAttribute("data-i18n-icon-after");
    if (before || after) el.innerHTML = iconText(before || after, t(key, defaultVars), { after: !before, animation: el.dataset.iconAnimation || "" });
    else el.textContent = t(key, defaultVars);
  });

  root.querySelectorAll("[data-i18n-html]").forEach((el) => {
    const key = el.getAttribute("data-i18n-html");
    if (key) el.innerHTML = t(key, defaultVars);
  });

  const attrMap = [
    { attr: "placeholder", data: "data-i18n-placeholder" },
    { attr: "title", data: "data-i18n-title" },
    { attr: "aria-label", data: "data-i18n-aria-label" },
    { attr: "value", data: "data-i18n-value" },
    { attr: "alt", data: "data-i18n-alt" },
    { attr: "content", data: "data-i18n-content" },
    { attr: "data-text", data: "data-i18n-data-text" },
  ];

  attrMap.forEach(({ attr, data }) => {
    root.querySelectorAll(`[${data}]`).forEach((el) => {
      const key = el.getAttribute(data);
      if (key) el.setAttribute(attr, t(key, defaultVars));
    });
  });

  root.querySelectorAll("title[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    if (key) el.textContent = t(key, defaultVars);
  });
}

async function injectLanguageSwitcher() {
  if (switcherEl) return switcherEl;

  // --- Container w topbarze ---
  const container = document.createElement("div");
  container.className = "lang-switcher";

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn lang-btn";
  btn.setAttribute("aria-label", t("common.languageLabel", {
    site: (typeof location !== "undefined" ? location.origin : ""),
    siteHost: (typeof location !== "undefined" ? location.host : ""),
  }));

  // --- Menu jako PORTAL w body ---
  const menu = document.createElement("div");
  menu.className = "lang-menu";
  menu.hidden = true;

  // Ważne: portal do body (żeby nie ucinało przez topbar/overflow/stacking)
  document.body.appendChild(menu);

  LANG_ORDER.map((lang) => LANG_META[lang]).forEach((meta) => {
    const opt = document.createElement("button");
    opt.type = "button";
    opt.className = "menu-item";
    opt.dataset.lang = meta.lang;
    opt.innerHTML = iconText(meta.icon, meta.label);
    opt.addEventListener("click", async (e) => {
      e.stopPropagation();
      menu.hidden = true;
      await setUiLang(meta.lang, { persist: true, updateUrl: true, apply: true });
    });
    menu.appendChild(opt);
  });

  // Toggle menu
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    menu.hidden = !menu.hidden;
    if (!menu.hidden) placeDropdown(container, menu);
  });

  // Klik poza: uwzględnij i container i menu (bo menu jest w body)
  document.addEventListener("click", (e) => {
    if (!container.contains(e.target) && !menu.contains(e.target)) {
      menu.hidden = true;
    }
  });

  window.addEventListener(
    "resize",
    () => {
      if (!menu.hidden) placeDropdown(container, menu);
    },
    { passive: true }
  );

  window.addEventListener(
    "scroll",
    () => {
      if (!menu.hidden) placeDropdown(container, menu);
    },
    { passive: true }
  );

  container.appendChild(btn);

  // Miejsce przełącznika: sekcja 3 topbara albo grupa [data-lang-slot] na stronach
  // bez topbara (logowanie) — wtedy stoi obok „i” po prawej, jak na stronach aplikacji.
  const topbarLangSection = document.querySelector(".topbar .topbar-section-3") || document.querySelector("[data-lang-slot]");
  if (topbarLangSection) {
    topbarLangSection.appendChild(container);
    // Motyw: osobny przycisk tuż przed flagą (decyzja 2026-11-03).
    injectThemeSwitcher(topbarLangSection, container, t);
  } else {
    container.classList.add("lang-floating");
    document.body.appendChild(container);
    injectThemeSwitcher(container, btn, t);
  }

  switcherEl = container;

  updateSwitcherLabel();
  return switcherEl;
}

function updateSwitcherLabel() {
  if (!switcherEl) return;
  const btn = switcherEl.querySelector(".lang-btn");
  if (!btn) return;

  const meta = LANG_META[currentLang] || LANG_META.pl;
  btn.innerHTML = icon(meta.icon);
  btn.setAttribute("aria-label", t("common.languageLabel"));
  refreshThemeSwitcher();
}

// -----------------------------------------------------------------------------
// BFCache / back-forward navigation fix
// Przy powrocie na stronę (pageshow) JS nie jest restartowany,
// więc musimy ponownie zsynchronizować język z URL / localStorage
// -----------------------------------------------------------------------------

if (typeof window !== "undefined") {
  window.addEventListener("pageshow", async (event) => {
    // Pierwsze wczytanie strony też wysyła pageshow; język ustawia wtedy
    // initI18n strony. Tu tylko powrót z BFCache.
    if (!event.persisted) return;
    try {
      // setUiLang robi:
      // - load właściwego słownika
      // - applyTranslations()
      // - synchronizację URL / localStorage
      await setUiLang(getUiLang(), {
        persist: true,
        updateUrl: true,
        apply: true,
      });
    } catch (e) {
      console.warn("i18n pageshow sync failed", e);
    }
  });

}
