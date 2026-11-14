import plManual from "../../../../../web/manual/content/pl.js";
import enManual from "../../../../../web/manual/content/en.js";
import ukManual from "../../../../../web/manual/content/uk.js";
import plText from "../../../../../web/shared/translation/pl/manual.js";
import enText from "../../../../../web/shared/translation/en/manual.js";
import ukText from "../../../../../web/shared/translation/uk/manual.js";
import plPrivacy from "../../../../../web/shared/translation/pl/privacy.js";
import enPrivacy from "../../../../../web/shared/translation/en/privacy.js";
import ukPrivacy from "../../../../../web/shared/translation/uk/privacy.js";
import { homeDictionary, homeText } from "./home.js";
import { publicLang, publicUrl, publicSeo, publicMetaHtml } from "../../../../../web/shared/js/core/public-seo.js";
import { manualArticle, manualToc } from "../../../../../web/manual/js/render.js";
import { fetchWithOrigin, ORIGIN_BASE, ORIGIN_HOST, ORIGIN_RESOLVE } from "../origin/origin.js";

const MANUALS = { pl: plManual, en: enManual, uk: ukManual };
const TEXTS = { pl: plText, en: enText, uk: ukText };
const PRIVACY = { pl: plPrivacy, en: enPrivacy, uk: ukPrivacy };
export const MANUAL_CHAPTERS = plManual.chapters.map((ch) => ch.id);

export function publicPage(path) {
  if (["/manual", "/manual/", "/manual/index.html"].includes(path)) return "manual";
  if (["/privacy", "/privacy/", "/privacy/index.html"].includes(path)) return "privacy";
  return null;
}

export function invalidManualChapter(url) {
  return publicPage(url.pathname) === "manual" && url.searchParams.has("ch")
    && !MANUAL_CHAPTERS.includes(url.searchParams.get("ch"));
}

// Zrzuty Wskazówek z wersją z treści obrazu (?v=h<skrót>), jak w wydaniu Pages
// (scripts/content-hash-assets.cjs): zmieniony zrzut ma nowy adres od razu,
// niezmieniony zostaje w pamięci na rok. Treść Workera pochodzi z jego wdrożenia,
// a zrzuty odświeża CI w Pages -- wersje bierzemy więc z asset-hashes.json
// bieżącego wydania (obraz i skrót z tego samego wydania), pamiętane 1 min.
const MANUAL_SHOT = /(\/manual\/img\/[a-zA-Z0-9_./-]+\.webp)(?!\?v=)/g;
const SHOT_VERSIONS_TTL = 60_000;
let shotVersions = { at: 0, map: null };

export function versionManualShots(html, versions) {
  if (!versions) return html;
  return html.replace(MANUAL_SHOT, (match, src) => (versions[src.slice(1)] ? `${src}?v=h${versions[src.slice(1)]}` : match));
}

async function manualShotVersions(request) {
  if (Date.now() - shotVersions.at < SHOT_VERSIONS_TTL) return shotVersions.map;
  try {
    const res = await fetchWithOrigin(`${ORIGIN_BASE}/asset-hashes.json`, new Request(request.url, { method: "GET" }), ORIGIN_HOST, ORIGIN_RESOLVE);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const map = {};
    for (const [file, hash] of Object.entries(await res.json())) if (file.startsWith("manual/img/")) map[file] = String(hash).slice(0, 16);
    shotVersions = { at: Date.now(), map };
  } catch (error) {
    // Bez wersji obrazy idą jak dotąd (krótka pamięć); poprzednia mapa zostaje.
    console.warn("[manual] asset-hashes.json:", error?.message || error);
    shotVersions = { at: Date.now(), map: shotVersions.map };
  }
  return shotVersions.map;
}

// Gotowa treść z Markdown i słowników, bez bazy, sesji i rozpoznawania botów.
export async function localizePublicPage(request, response) {
  const url = new URL(request.url);
  const page = publicPage(url.pathname);
  if (url.hostname !== "www.familijna.app" || !page || !["GET", "HEAD"].includes(request.method)
      || response.status !== 200 || !response.headers.get("Content-Type")?.includes("text/html")) return response;
  const lang = publicLang(url.searchParams.get("lang"));
  const dict = { ...homeDictionary(lang), ...TEXTS[lang], ...PRIVACY[lang] };
  const t = (key, params = {}) => (homeText(dict, key) ?? key)
    .replace(/\{(\w+)\}/g, (m, name) => params[name] ?? m);
  const manual = MANUALS[lang];
  const versions = page === "manual" ? await manualShotVersions(request) : null;
  const chapter = page === "manual" ? manual.chapters.find((ch) => ch.id === url.searchParams.get("ch")) : null;
  const seo = publicSeo(page, lang, chapter ? t("manual.chapterTitle", { title: chapter.title }) : t(`${page}.title`),
    page === "privacy" ? t("privacy.description") : chapter?.description || t("manual.startLead"), chapter);
  const href = (id, hash = "") => publicUrl("manual", lang, id).replace("https://www.familijna.app", "") + hash;
  const rewriter = new HTMLRewriter()
    .on("html", { element(el) { el.setAttribute("lang", lang); el.removeAttribute("data-device-guard-pending"); } })
    .on("head", { element(el) { el.append(publicMetaHtml(page, seo, chapter), { html: true }); } })
    .on('meta[name="robots"]', { element(el) { el.setAttribute("content", "index, follow"); } })
    .on('meta[name="description"], link[rel="canonical"], link[hreflang], meta[property^="og:"]', { element(el) { el.remove(); } })
    .on("title", { element(el) { el.removeAttribute("data-i18n"); el.setInnerContent(seo.title); } })
    // Starszy szablon Pages także nie może ukrywać gotowej treści do startu JS.
    .on("body", { element(el) {
      el.setAttribute("class", (el.getAttribute("class") || "").split(/\s+/).filter((c) => c !== "skel-body").join(" "));
    } })
    .on("script:not([src])", { element(el) { el.remove(); } })
    .on('[data-i18n]', { element(el) {
      const value = homeText(dict, el.getAttribute("data-i18n"));
      if (value != null) el.setInnerContent(value);
    } })
    .on('[data-i18n-html="privacy.content"]', { element(el) { el.setInnerContent(dict.privacy.content, { html: true }); } })
    .on("[data-i18n-alt], [data-i18n-title], [data-i18n-aria-label]", { element(el) {
      for (const attr of ["alt", "title", "aria-label"]) {
        const key = el.getAttribute(`data-i18n-${attr}`);
        const value = key && homeText(dict, key);
        if (value != null) el.setAttribute(attr, value);
      }
    } })
    .on("#manualArticle", { element(el) {
      el.setAttribute("data-manual-lang", lang);
      el.setAttribute("data-manual-chapter", chapter?.id || "");
      el.setInnerContent(versionManualShots(manualArticle(manual, chapter, t, href), versions), { html: true });
    } })
    .on("#manualToc", { element(el) { el.setInnerContent(manualToc(manual, chapter?.id, href), { html: true }); } })
    .on("#manualCurrent", { element(el) { el.setInnerContent(chapter?.title || t("manual.pageTitle")); } })
    .on("#btnLegal", { element(el) { el.setAttribute("href", publicUrl("privacy", lang)); } })
    .on("a#btnBack", { element(el) { el.setAttribute("href", `/${lang === "pl" ? "" : `?lang=${lang}`}`); } })
    .on("[data-skel-step]", { element(el) { el.removeAttribute("data-skel-step"); } });
  const headers = new Headers(response.headers);
  headers.set("Content-Language", lang);
  headers.set("Cache-Control", "no-store");
  headers.set("X-Robots-Tag", "index, follow");
  headers.delete("ETag");
  headers.delete("Content-Length");
  const localized = rewriter.transform(new Response(response.body, { headers }));
  return request.method === "HEAD" ? new Response(null, { headers: localized.headers }) : localized;
}
