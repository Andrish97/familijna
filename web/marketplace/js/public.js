// Ten sam publiczny model i HTML w Workerze i w przeglądarce.
import { iconText, starRating } from "../../shared/js/core/icons.js?v=v2026-11-05T18324";
import { sortAnswersByPoints } from "../../shared/js/core/answer-order.js?v=v2026-11-05T18324";
import { escapePublicHtml as esc, publicLang } from "../../shared/js/core/public-seo.js?v=v2026-11-05T18324";
export { esc };
export const validSlug = (s) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(s || ""));
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const catalogPath = (lang) => `/marketplace${publicLang(lang) === "pl" ? "" : `?lang=${publicLang(lang)}`}`;
export const gamePath = (g, lang) => `/marketplace/game/${encodeURIComponent(g.slug)}${publicLang(lang) === "pl" ? "" : `?lang=${publicLang(lang)}`}`;
const n = (value) => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
const array = (value) => Array.isArray(value) ? value : [];

export function publicRow(row) {
  return {
    id: String(row.id || ""), slug: String(row.slug || ""), title: String(row.title || ""),
    description: String(row.description || ""), lang: publicLang(row.lang), origin: String(row.origin || "community"),
    author_username: String(row.author_username || ""), library_count: n(row.library_count),
    avg_rating: Math.min(5, n(row.avg_rating)), rating_count: n(row.rating_count), created_at: row.created_at || null,
  };
}
export function publicGame(row) {
  if (!row || row.status !== "published" || !validSlug(row.slug)) return null;
  return { ...publicRow(row), status: "published", payload: { questions: array(row.payload?.questions).map((q) => ({
    text: String(q.text || ""), answers: array(q.answers).map((a) => ({ text: String(a.text || ""), fixed_points: n(a.fixed_points), ord: Number.isFinite(Number(a.ord)) ? Number(a.ord) : undefined })),
  })) } };
}

export function starsHtml(avg, count, t) {
  if (!n(count)) return `<span class="mkt-no-rating">${esc(t("marketplace.rating.none"))}</span>`;
  const value = Math.min(5, n(avg)).toFixed(1);
  return `<span class="mkt-stars" role="img" aria-label="${value}/5">${starRating(avg)}</span> <span class="mkt-rating-avg">${value}</span> <span class="mkt-rating-count">(${n(count)})</span>`;
}
export function cardInner(g, t) {
  const producer = g.origin === "producer";
  return `<div class="mkt-card-top"><span class="tag tag--gold mkt-lang-badge">${esc(g.lang.toUpperCase())}</span>
    ${g.in_library ? `<span class="tag tag--ok mkt-badge-added">${iconText("check",t("marketplace.addedBadge"))}</span>` : ""}</div>
    <h2 class="mkt-card-title">${esc(g.title)}</h2>
    <div class="mkt-card-author">${producer ? `<span class="tag tag--gold mkt-badge-producer">${esc(t("marketplace.producerBadge"))}</span>` : `<span class="mkt-author">${esc(g.author_username ? t("marketplace.authorLabel").replace("{author}",g.author_username) : "")}</span>`}</div>
    <div class="mkt-card-desc">${esc(g.description)}</div><div class="mkt-card-footer">
    <span class="mkt-count">${esc(t("marketplace.libraryCount").replace("{count}",g.library_count ?? 0))}</span>
    <span class="mkt-card-rating">${starsHtml(g.avg_rating,g.rating_count,t)}</span></div>`;
}
export function cardHtml(g,t,lang) {
  return `<a class="mkt-card${g.origin === "producer" ? " mkt-card-producer" : ""}" data-id="${esc(g.id)}" href="${esc(gamePath(g,lang))}">${cardInner(g,t)}</a>`;
}
export function questionsHtml(g,t) {
  return (g.payload?.questions || []).map((q,i) => `<section class="q-preview-item">
    <h2 class="q-preview-text">${i+1}. ${esc(q.text)}</h2><ol class="q-preview-answers">
    ${sortAnswersByPoints(q.answers).map((a) => `<li>${esc(a.text)} <span class="q-preview-pts" data-points="${esc(a.fixed_points ?? 0)}">(${esc(t("marketplace.detail.points",{count:a.fixed_points ?? 0}))})</span></li>`).join("")}</ol></section>`).join("");
}
export function selectRows(rows,{search="",filter="all",sort="recommended",lang="pl"}={}) {
  const query=search.trim().toLocaleLowerCase();
  return rows.filter((g) => (filter === "all" || g.lang === filter)
    && (!query || `${g.title} ${g.description}`.toLocaleLowerCase().includes(query)))
    .sort((a,b) => {
      if(sort === "title") return a.title.localeCompare(b.title,lang);
      if(sort === "newest") return new Date(b.created_at)-new Date(a.created_at);
      if(sort === "popular") return n(b.library_count)-n(a.library_count) || new Date(b.created_at)-new Date(a.created_at);
      if(sort === "rating") return n(b.avg_rating)-n(a.avg_rating) || n(b.rating_count)-n(a.rating_count);
      return Number(b.lang === lang)-Number(a.lang === lang)
        || (b.rating_count>=3?n(b.avg_rating):0)-(a.rating_count>=3?n(a.avg_rating):0)
        || n(b.library_count)-n(a.library_count) || new Date(b.created_at)-new Date(a.created_at);
    });
}
export function marketSeo(lang,t,game=null,privatePreview=false) {
  const canonical=`https://www.familijna.app${game ? `/marketplace/game/${encodeURIComponent(game.slug)}` : catalogPath(lang)}`;
  return { lang:publicLang(lang), title:game ? `${game.title} — Familijna` : t("marketplace.pageTitle"),
    description:game ? game.description || game.title : t("marketplace.seoDescription"), url:canonical,
    robots:privatePreview ? "noindex, nofollow" : "index, follow" };
}
export function marketSchema(seo,game) {
  return {"@context":"https://schema.org","@type":game?"Game":"CollectionPage",name:seo.title,
    description:seo.description,url:seo.url,inLanguage:game?.lang || seo.lang};
}
export function syncMarketSeo(lang,t,game=null,privatePreview=false) {
  const seo=marketSeo(lang,t,game,privatePreview);
  document.title=seo.title;
  const set=(selector,tag,attrs)=>{
    let el=document.head.querySelector(selector);if(!el){el=document.createElement(tag);document.head.append(el);}
    for(const [k,v] of Object.entries(attrs)) el.setAttribute(k,v);
  };
  set('link[rel="canonical"]',"link",{rel:"canonical",href:seo.url});
  set('meta[name="description"]',"meta",{name:"description",content:seo.description});
  set('meta[name="robots"]',"meta",{name:"robots",content:seo.robots});
  for(const [key,value] of Object.entries({title:seo.title,description:seo.description,url:seo.url,type:game?"article":"website"}))
    set(`meta[property="og:${key}"]`,"meta",{property:`og:${key}`,content:value});
  document.head.querySelectorAll('link[hreflang]').forEach((el)=>el.remove());
  if(!game&&!privatePreview) for(const alt of ["pl","en","uk","x-default"])
    set(`link[hreflang="${alt}"]`,"link",{rel:"alternate",hreflang:alt,href:`https://www.familijna.app${catalogPath(alt)}`});
  let script=document.querySelector('script[data-market-schema]');
  if(!script){script=document.createElement('script');script.type='application/ld+json';script.dataset.marketSchema='';document.head.append(script);}
  script.textContent=JSON.stringify(marketSchema(seo,privatePreview?null:game)).replace(/</g,"\\u003c");
}
