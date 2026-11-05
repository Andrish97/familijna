import pl from "../../../../../web/shared/translation/pl/marketplace.js";
import en from "../../../../../web/shared/translation/en/marketplace.js";
import uk from "../../../../../web/shared/translation/uk/marketplace.js";
import { homeDictionary, homeText } from "./home.js";
import { publicLang } from "../../../../../web/shared/js/core/public-seo.js";
import { cardHtml, questionsHtml, publicRow, publicGame, selectRows, marketSeo, marketSchema, catalogPath, UUID_RE, validSlug, esc, starsHtml } from "../../../../../web/marketplace/js/public.js";
import { fetchFromOrigin, serveNotFoundPage, ORIGIN_BASE, ORIGIN_HOST, ORIGIN_RESOLVE } from "../origin/origin.js";

export const isMarketPath=(path)=>["/marketplace","/marketplace/","/marketplace/index.html"].includes(path) || path.startsWith("/marketplace/game/");
export function marketText(lang) {
  const dict={...homeDictionary(lang),...({pl,en,uk}[lang]||pl)};
  return (key,params={})=>(homeText(dict,key)??key).replace(/\{(\w+)\}/g,(m,k)=>params[k]??m);
}
export function marketUnavailable() {
  return new Response("Service temporarily unavailable",{status:503,headers:{"Content-Type":"text/plain; charset=utf-8","Cache-Control":"no-store","Retry-After":"60"}});
}
// Nigdy nie przekazuj cookies/JWT gościa i nie używaj klucza administracyjnego.
export async function publicMarketRpc(env,fn,body={}) {
  if(!env.SUPABASE_URL||!env.SUPABASE_ANON_KEY) throw new Error("public_market_configuration");
  const response=await fetch(`${String(env.SUPABASE_URL).replace(/\/$/,"")}/rest/v1/rpc/${fn}`,{
    method:"POST",headers:{apikey:env.SUPABASE_ANON_KEY,Authorization:`Bearer ${env.SUPABASE_ANON_KEY}`,"Content-Type":"application/json"},
    body:JSON.stringify(body),signal:AbortSignal.timeout(6000),
  });
  if(!response.ok) throw new Error(`public_market_${response.status}`);
  const data=await response.json();
  if(!Array.isArray(data)) throw new Error("public_market_invalid_response");
  return data;
}
export async function publicCatalog(env) {
  return (await publicMarketRpc(env,"market_public_catalog")).map(publicRow).filter((g)=>validSlug(g.slug));
}
// Strona Społeczności: publiczny katalog jest ten sam dla wszystkich, więc
// Worker trzyma go w pamięci izolatu przez CATALOG_TTL_MS — wejście nie czeka
// na bazę przed wysłaniem HTML (TTFB ~1 s, pomiar 2026-11-04). Równoległe
// żądania czekają na jedno zapytanie; błąd nie zostaje w pamięci. Mapa strony
// (sitemap) czyta katalog bez pamięci — zawsze aktualna.
export const CATALOG_TTL_MS=60_000;
let catalogCache=null; // { at, promise }
export function resetCatalogCache() { catalogCache=null; }
// Druga warstwa: Cache API Cloudflare, wspólna dla izolatów w danym centrum
// danych. Pomiar 2026-11-05: samo zapytanie w bazie 0 ms (90 gier), ale
// pierwsze połączenie Workera z serwerem bazy ~600 ms. Dlatego
// stale-while-revalidate: wpis starszy niż CATALOG_TTL_MS idzie od razu,
// a świeży katalog pobiera się w tle (ctx.waitUntil); po CATALOG_STALE_MS
// wpis wygasa i wejście czeka na bazę jak dawniej.
const CATALOG_CACHE_KEY="https://cache.familijna.internal/market-public-catalog";
export const CATALOG_STALE_MS=600_000;
let catalogRefresh=null;
async function refreshSharedCatalog(env,cache) {
  const rows=await publicCatalog(env);
  await cache.put(CATALOG_CACHE_KEY,new Response(JSON.stringify(rows),{headers:{
    "Content-Type":"application/json",
    "Cache-Control":`max-age=${Math.round(CATALOG_STALE_MS/1000)}`,
    "X-Fetched-At":String(Date.now()),
  }})).catch(()=>{});
  return rows;
}
async function sharedCatalog(env,ctx) {
  const cache=globalThis.caches?.default;
  if(!cache) return publicCatalog(env);
  const hit=await cache.match(CATALOG_CACHE_KEY).catch(()=>null);
  if(hit) {
    const age=Date.now()-Number(hit.headers.get("X-Fetched-At")||0);
    if(age>CATALOG_TTL_MS && !catalogRefresh) {
      catalogRefresh=refreshSharedCatalog(env,cache).catch(()=>{}).finally(()=>{catalogRefresh=null;});
      ctx?.waitUntil?.(catalogRefresh);
    }
    return hit.json();
  }
  return refreshSharedCatalog(env,cache);
}
export async function cachedPublicCatalog(env,now=Date.now(),ctx=null) {
  if(catalogCache && now-catalogCache.at<CATALOG_TTL_MS) return catalogCache.promise;
  const entry={at:now,promise:sharedCatalog(env,ctx)};
  catalogCache=entry;
  entry.promise.catch(()=>{ if(catalogCache===entry) catalogCache=null; });
  return entry.promise;
}
export async function servePublicMarketplace(request,env,url,ctx=null) {
  const param=url.pathname.startsWith("/marketplace/game/")?url.pathname.slice("/marketplace/game/".length):null;
  if(param!==null && !validSlug(param) && !UUID_RE.test(param))
    return serveNotFoundPage(request,ORIGIN_BASE,ORIGIN_HOST,ORIGIN_RESOLVE);
  let games,game=null,template;
  const timings=[];
  try {
    const originUrl=new URL(url);originUrl.pathname="/marketplace/index.html";
    // Server-Timing: czas każdego kroku (pomiar TTFB Społeczności, 2026-11-05).
    const timed=(name,p)=>{const t0=Date.now();return p.finally(()=>{timings.push(`${name};dur=${Date.now()-t0}`);});};
    const [rows,detail,source]=await Promise.all([
      timed("catalog",cachedPublicCatalog(env,Date.now(),ctx)),
      param ? timed("detail",publicMarketRpc(env,UUID_RE.test(param)?"market_game_detail":"market_game_by_slug",UUID_RE.test(param)?{p_id:param}:{p_slug:param})) : Promise.resolve([]),
      timed("origin",fetchFromOrigin(new Request(request,{method:"GET"}),originUrl,ORIGIN_BASE,ORIGIN_HOST,ORIGIN_RESOLVE)),
    ]);
    games=rows;template=source;
    if(param) {
      game=publicGame(detail[0]);
      const summary=game && rows.find((g)=>g.id===game.id);
      if (summary) { game.avg_rating=summary.avg_rating; game.rating_count=summary.rating_count; }
      if(!game) return serveNotFoundPage(request,ORIGIN_BASE,ORIGIN_HOST,ORIGIN_RESOLVE);
      if(UUID_RE.test(param)) return Response.redirect(`https://www.familijna.app/marketplace/game/${game.slug}`,301);
    }
    if(template.status!==200||!template.headers.get("Content-Type")?.includes("text/html")) throw new Error("public_market_template");
  } catch(err) {console.error("[marketplace] public rendering unavailable",err.message);return marketUnavailable();}
  const lang=publicLang(url.searchParams.get("lang") || game?.lang);
  const t=marketText(lang),privatePreview=!game&&url.searchParams.has("game"),seo=marketSeo(lang,t,game,privatePreview);
  const filter=["pl","en","uk"].includes(url.searchParams.get("filter"))?url.searchParams.get("filter"):"all";
  const sort=url.searchParams.get("sort")||"recommended",search=url.searchParams.get("q")||"";
  const visible=selectRows(games,{search,filter,sort,lang});
  const json=(data)=>JSON.stringify(data).replace(/</g,"\\u003c");
  // Bootstrap ma tę samą białą listę co publiczny HTML. Bez danych sesji.
  const bootstrap={lang,games,game};
  const rewriter=new HTMLRewriter()
    .on("html",{element(el){el.setAttribute("lang",lang);el.removeAttribute("data-device-guard-pending");}})
    .on("body",{element(el){el.setAttribute("class","mkt-body mkt-ssr");}})
    .on("title",{element(el){el.removeAttribute("data-i18n");el.setInnerContent(seo.title);}})
    .on("head",{element(el){el.append(`<meta name="description" content="${esc(seo.description)}"><link rel="canonical" href="${esc(seo.url)}">
      <meta name="robots" content="${seo.robots}"><meta property="og:title" content="${esc(seo.title)}"><meta property="og:description" content="${esc(seo.description)}"><meta property="og:url" content="${esc(seo.url)}"><meta property="og:type" content="${game?"article":"website"}">
      ${!game&&!privatePreview?["pl","en","uk","x-default"].map((alt)=>`<link rel="alternate" hreflang="${alt}" href="https://www.familijna.app${catalogPath(alt)}">`).join(""):""}
      <script type="application/ld+json" data-market-schema>${json(marketSchema(seo,game))}</script>
      <script type="application/json" id="marketBootstrap">${json(bootstrap)}</script>`,{html:true});}})
    .on('meta[name="description"],meta[name="robots"],link[rel="canonical"],link[hreflang],meta[property^="og:"]:not([property="og:image"])',{element(el){el.remove();}})
    .on('script:not([src])',{element(el){el.remove();}})
    .on('[data-i18n]',{element(el){const val=t(el.getAttribute("data-i18n"));if(val!==el.getAttribute("data-i18n"))el.setInnerContent(val);}})
    .on('[data-i18n-title],[data-i18n-aria-label],[data-i18n-placeholder]',{element(el){for(const attr of ["title","aria-label","placeholder"]){const key=el.getAttribute(`data-i18n-${attr}`);if(key)el.setAttribute(attr,t(key));}}})
    .on('#browseGrid',{element(el){el.removeAttribute("data-skel-step");el.setInnerContent(visible.map((g)=>cardHtml(g,t,lang)).join("") || `<p class="mkt-empty">${esc(t("marketplace.empty"))}</p>`,{html:true});}})
    .on('#gameDetailOverlay',{element(el){if(game){el.removeAttribute("hidden");el.setAttribute("data-detail-state","ready");el.setAttribute("data-public-slug",game.slug);}}})
    .on('#detailTitle',{element(el){el.tagName=game?"h1":"div";if(game)el.setInnerContent(game.title);}})
    .on('#viewBrowse h1',{element(el){if(game)el.tagName="div";}})
    .on('#detailMeta',{element(el){if(game)el.setInnerContent(`${game.lang.toUpperCase()}${game.author_username?` · ${game.author_username}`:""}`);}})
    .on('#detailDesc',{element(el){if(game)el.setInnerContent(game.description);}})
    .on('#detailQuestions',{element(el){if(game){el.setAttribute("lang",game.lang);el.setInnerContent(questionsHtml(game,t),{html:true});}}})
    .on('#detailRating',{element(el){if(game)el.setInnerContent(`<div class="mkt-rating-summary">${starsHtml(game.avg_rating,game.rating_count,t)}</div>`,{html:true});}})
    .on('#btnDetailClose',{element(el){if(game)el.setAttribute("data-public-close",catalogPath(lang));}})
    .on('#marketNoJsBack',{element(el){if(game){el.removeAttribute("hidden");el.setAttribute("href",catalogPath(lang));el.setInnerContent(t("common.back"));}}})
    .on('#btnAddLibrary,#btnRemoveLibrary,#addedBadge,#detailRaters,#btnMySent,#loadMoreWrap',{element(el){el.setAttribute("hidden","");}})
    .on('#btnGoGames',{element(el){el.setAttribute("href",`/${lang==="pl"?"":`?lang=${lang}`}`);}})
    .on('#btnManual',{element(el){el.setAttribute("href",`/manual/?ch=13${lang==="pl"?"":`&lang=${lang}`}`);}});
  const headers=new Headers(template.headers);
  headers.set("Content-Language",lang);headers.set("Cache-Control","no-store");headers.set("X-Robots-Tag",seo.robots);
  headers.delete("Content-Length");headers.delete("ETag");
  if(timings.length) headers.set("Server-Timing",timings.join(", "));
  const response=rewriter.transform(new Response(template.body,{headers}));
  return request.method==="HEAD"?new Response(null,{headers:response.headers}):response;
}
