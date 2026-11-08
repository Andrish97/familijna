// Wspólny HTML Wskazówek: serwer i przeglądarka używają tych samych elementów.
import { escapePublicHtml as esc } from "../../shared/js/core/public-seo.js?v=v2026-11-08T20300";

export function manualToc(manual, current, href) {
  const find = (id) => manual.chapters.find((c) => c.id === id);
  return manual.parts.map((part) => `<div class="m-side-part">${esc(part.title)}</div>${part.chapters.map((id) => {
    const ch = find(id);
    const active = current === id;
    return `<a class="m-side-item${active ? " active" : ""}" href="${esc(href(id))}" data-ch="${id}"${active ? ' aria-current="page"' : ""}>${esc(ch.title)}</a>
      ${(active ? ch.sections.filter((s) => s.level === 2) : []).map((s) => `<a class="m-side-item m-side-sub" href="${esc(href(id, `#s-${s.id.replace(/\./g, "-")}`))}" data-ch="${id}" data-sec="${s.id}">${esc(s.title)}</a>`).join("")}`;
  }).join("")}`).join("");
}

export function manualArticle(manual, ch, t, href) {
  const find = (id) => manual.chapters.find((c) => c.id === id);
  if (!ch) return `<header class="m-head"><h1 class="m-title">${esc(t("manual.pageTitle"))}</h1><p class="m-lead">${esc(t("manual.startLead"))}</p></header>
    <div class="m-parts">${manual.parts.map((part) => `<section class="m-part-card"><h2 class="m-part-title">${esc(part.title)}</h2>${part.intro || ""}<ol class="m-part-chapters">
      ${part.chapters.map((id) => `<li><a href="${esc(href(id))}" data-ch="${id}">${esc(find(id).title)}</a></li>`).join("")}
    </ol></section>`).join("")}</div>`;
  const idx = manual.chapters.indexOf(ch);
  const part = manual.parts.find((p) => p.chapters.includes(ch.id));
  const sections = ch.sections.filter((s) => s.level === 2);
  const pager = (c, cls, label) => c
    ? `<a class="m-pager-link ${cls}" href="${esc(href(c.id))}" data-ch="${c.id}"><span class="m-pager-arrow" aria-hidden="true"><i class="ico" data-icon="${cls === "next" ? "arrow-right" : "arrow-left"}"></i></span><span class="m-pager-label">${esc(label)}</span><span class="m-pager-title">${esc(c.title)}</span></a>`
    : `<span class="m-pager-link ${cls} is-empty"></span>`;
  return `<header class="m-head">${part ? `<div class="m-crumb">${esc(part.title)}</div>` : ""}<h1 class="m-title">${esc(ch.title)}</h1>
    <a class="m-ref" href="${esc(href(null))}" data-ch="">${esc(t("manual.toc"))}</a>
    ${sections.length > 1 ? `<nav class="m-sections" aria-label="${esc(t("manual.sections"))}"><div class="m-sections-title">${esc(t("manual.sections"))}</div><ol>
      ${sections.map((s) => `<li><a href="#s-${s.id.replace(/\./g, "-")}" data-sec="${s.id}">${esc(s.title)}</a></li>`).join("")}</ol></nav>` : ""}</header>
    <div class="m-doc">${ch.html.replace(/(class="m-ref" href=")\?ch=(\d+)(#[^"]*)?"/g,
      (_, prefix, id, hash = "") => `${prefix}${esc(href(id, hash))}"`)}</div><nav class="m-pager">${pager(manual.chapters[idx - 1], "prev", t("manual.prev"))}${pager(manual.chapters[idx + 1], "next", t("manual.next"))}</nav>`;
}
