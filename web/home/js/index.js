import { redirectPage } from "../../shared/js/core/page-layout.js?v=v2026-11-05T19482";
import { getUser } from "../../shared/js/core/auth.js?v=v2026-11-05T19482";
import { sb } from "../../shared/js/core/supabase.js?v=v2026-11-05T19482";
import { initI18n, withLangParam, applyTranslations, getUiLang, t } from "../../shared/translation/translation.js?v=v2026-11-05T19482";
import { isGuestUser } from "../../shared/js/core/guest-mode.js?v=v2026-11-05T19482";
import { icon, starRating } from "../../shared/js/core/icons.js?v=v2026-11-05T19482";
import { onSwipe } from "../../shared/js/core/swipe.js?v=v2026-11-05T19482";
import { initEntryPage } from "../../shared/js/core/page-init.js?v=v2026-11-05T19482";
import { setProgress, setVars } from "../../shared/js/core/ui-metrics.js?v=v2026-11-05T19482";
import { homeSeo, homeSchemas, schemaJson } from "../../shared/js/core/home-seo.js?v=v2026-11-05T19482";


async function redirectIfSession() {
  try {
    const user = await getUser();
    if (user) {
      // Gość ma prawie pełne konto: od razu /games/ (nawigacja, decyzja 2026-10-07).
      if (isGuestUser(user)) {
        redirectPage(withLangParam("/games/"));
        return true;
      }
      if (!user.username) {
        redirectPage(withLangParam("/login/?setup=username"));
        return true;
      }
      redirectPage(withLangParam("/games/"));
      return true;
    }
  } catch (e) {
    console.warn("[index] session check failed:", e);
  }
  return false;
}

async function loadRatingStats() {
  const wrap = document.getElementById("ratingBadgeWrap");
  if (!wrap) return;

  try {
    const { data, error } = await sb().rpc("get_app_rating_stats");
    if (error) throw error;
    
    // Stats is an array if called via RPC sometimes, but with our definition it should be an object or row.
    const stats = Array.isArray(data) ? data[0] : data;
    if (!stats || Number(stats.total_count) < 1) return;

    const avg = Number(stats.avg_stars);
    const count = Number(stats.total_count);
    if (!Number.isFinite(avg) || !Number.isSafeInteger(count) || avg < 0 || avg > 5 || count < 1) return;

    const starsStr = starRating(avg);

    wrap.innerHTML = `
      <div class="rating-badge-index">
        <span class="stars" role="img" aria-label="${avg}/5">${starsStr}</span>
        <span class="score">${avg}/5</span>
        <span class="count">(${count})</span>
      </div>
    `;
  } catch (e) {
    console.warn("[index] loadRatingStats failed:", e);
  }
}

function updateInternalLinks() {
  document.querySelectorAll("main a[href]").forEach((link) => {
    if (!link.dataset.baseHref) link.dataset.baseHref = link.getAttribute("href") || "";
    const baseHref = link.dataset.baseHref;
    if (!baseHref || baseHref.startsWith("#")) return;
    const url = new URL(baseHref, location.href);
    if (url.origin !== location.origin) return;
    link.href = withLangParam(url.toString());
  });
}

function updateHomeSeo() {
  const seo = homeSeo(getUiLang(), t);
  document.title = seo.title;
  document.querySelector('link[rel="canonical"]')?.setAttribute("href", seo.url);
  document.querySelector('meta[property="og:url"]')?.setAttribute("content", seo.url);
  document.querySelector('meta[property="og:locale"]')?.setAttribute("content", seo.locale);
  const questions = [...document.querySelectorAll(".faq-item")].map((item) => ({
    q: item.querySelector(".faq-q")?.textContent?.trim() || "",
    a: item.querySelector(".faq-a")?.textContent?.trim() || "",
  })).filter((item) => item.q && item.a);
  const schemas = homeSchemas(seo, t, questions);
  document.querySelectorAll("script[data-home-schema]").forEach((node) => {
    const schema = schemas[node.dataset.homeSchema];
    if (schema) node.textContent = schemaJson(schema);
  });
}

/* ---------- images (lang) ---------- */

// Kadry w motywie odwiedzającego (jasny-motyw-plan.md): jasny komplet w
// /assets/img/<język>/shots/light/; podgląd linku (og) jest jeden.
function buildLangImgUrl(lang, file) {
  const themed = document.documentElement.dataset.theme === "light" && file.startsWith("shots/") ? file.replace(/^shots\//, "shots/light/") : file;
  return new URL(`/assets/img/${lang}/${themed}`, location.href).toString();
}

function setImgLoaded(img) {
  if (!img) return;
  if (img.complete && img.naturalWidth > 0) { img.classList.add("is-loaded"); return; }
  img.addEventListener("load", () => img.classList.add("is-loaded"), { once: true });
  img.addEventListener("error", () => img.classList.add("is-loaded"), { once: true });
}

// Kadr już widoczny zostaje na ekranie, dopóki następny nie jest pobrany
// i zdekodowany -- bez mignięcia pustym tłem przy przełączaniu karuzeli.
function swapShot(img, url) {
  img.dataset.pendingSrc = url;
  const next = new Image();
  next.src = url;
  next.decode().catch(() => {}).then(() => {
    if (img.dataset.pendingSrc !== url) return;
    img.src = url;
    setImgLoaded(img);
  });
}

function switchLandingImages(lang) {
  document.querySelectorAll(".shot-img").forEach((img) => {
    const file = img.dataset.file;
    if (!file) return;
    const next = buildLangImgUrl(lang, file);
    if (img.src === next) { setImgLoaded(img); return; }
    if (img.classList.contains("is-loaded")) { swapShot(img, next); return; }
    img.src = next;
    setImgLoaded(img);
  });
}

// Pobranie kadrów z wyprzedzeniem (sąsiednie w karuzeli), żeby przełączenie
// było natychmiastowe.
const preloaded = new Set();
function preloadShot(lang, file) {
  const url = buildLangImgUrl(lang, file);
  if (preloaded.has(url)) return;
  preloaded.add(url);
  const img = new Image();
  img.decoding = "async";
  img.src = url;
}

/* ---------- pipeline nav ---------- */

function initPipeline() {
  const wrap = document.getElementById("pipeline");
  const topbar = document.querySelector(".topbar");
  if (!wrap) return;

  const pipeline = wrap.querySelector(".pipeline");
  const nodes = Array.from(pipeline.querySelectorAll(".pipeline-node"));
  const sections = nodes.map((n) => document.getElementById(n.dataset.target));

  // Usuń stary track jeśli był
  pipeline.querySelectorAll(".pipeline-track").forEach((el) => el.remove());

  // Wstrzyknij linie między przyciski: [node][line][node][line][node]...
  // Iterujemy od końca żeby nie przesuwać indeksów
  const lines = [];
  for (let i = nodes.length - 1; i >= 1; i--) {
    const line = document.createElement("div");
    line.className = "pipeline-line";
    const lineFill = document.createElement("div");
    lineFill.className = "pipeline-line-fill";
    line.appendChild(lineFill);
    // wstaw przed węzłem i
    nodes[i].before(line);
    lines.unshift(line); // lines[0] = linia między węzłem 0 i 1, itd.
  }

  // Kliknięcie scrolluje do sekcji
  nodes.forEach((node, i) => {
    node.addEventListener("click", () => {
      const id = sections[i]?.id;
      if (id && location.hash !== `#${id}`) history.pushState(history.state, "", `#${id}`);
      sections[i]?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });

  // Ustaw top rury śledząc dolną krawędź topbara
  let _lastPipelineTop = -1;
  let _lastHomeTop = -1;
  function syncTop() {
    if (!topbar) { setVars(wrap, { "--pipeline-top": null }); return; }
    const topbarBottom = Math.max(0, Math.round(topbar.getBoundingClientRect().bottom));
    if (_lastPipelineTop !== topbarBottom) {
      _lastPipelineTop = topbarBottom;
      setVars(wrap, { "--pipeline-top": `${topbarBottom}px` });
    }
    // Body rezerwuje wysokość elementów, nie ich współrzędne ekranowe.
    // Dzięki temu zmiana visualViewport nie dodaje/odejmuje pustego pasa
    // w dokumencie, a po zamknięciu arkusza wraca miejsce na pipeline.
    const topbarHeight = Math.round(topbar.getBoundingClientRect().height);
    const pipelineHeight = Math.round(wrap.getBoundingClientRect().height);
    const sheetOpen = document.body.classList.contains("sheet-open");
    const nextHomeTop = Math.max(0, topbarHeight + (sheetOpen ? 0 : pipelineHeight));
    if (_lastHomeTop !== nextHomeTop) {
      _lastHomeTop = nextHomeTop;
      setVars(document.body, { "--home-top": `${nextHomeTop}px` });
    }
  }

  function update() {
    syncTop();

    const scrollY = window.scrollY;
    const winH = window.innerHeight;
    let activeIdx = -1;
    let progress = 0;

    for (let i = 0; i < sections.length; i++) {
      const s = sections[i];
      if (!s) continue;
      const rect = s.getBoundingClientRect();
      if (rect.top <= winH * 0.38) {
        activeIdx = i;
        const sectionTop = scrollY + rect.top;
        progress = Math.min(1, Math.max(0, (scrollY - sectionTop + winH * 0.38) / rect.height));
      }
    }

    // Stany przycisków i adres bieżącej sekcji. replaceState nie zaśmieca
    // historii podczas zwykłego przewijania.
    nodes.forEach((node, i) => {
      node.classList.toggle("is-filled", i <= activeIdx);
      node.classList.toggle("is-active", i === activeIdx);
    });
    const activeId = sections[activeIdx]?.id;
    if (activeId && location.hash !== `#${activeId}`) {
      history.replaceState(history.state, "", `#${activeId}`);
    }

    // Stany linii
    // linia[i] łączy węzeł i z węzłem i+1
    // linia pełna jeśli węzeł i+1 jest osiągnięty (is-filled)
    // linia częściowa jeśli i === activeIdx (w trakcie scrollowania przez sekcję)
    lines.forEach((line, i) => {
      const fill = line.querySelector(".pipeline-line-fill");
      setProgress(fill, i < activeIdx ? 100 : i === activeIdx ? progress * 100 : 0, 2);
    });
  }

  window.addEventListener("scroll", update, { passive: true });
  window.addEventListener("resize", update, { passive: true });
  window.visualViewport?.addEventListener("resize", syncTop, { passive: true });
  window.visualViewport?.addEventListener("scroll", syncTop, { passive: true });
  const sheetObserver = new MutationObserver(() => syncTop());
  sheetObserver.observe(document.body, { attributes: true, attributeFilter: ["class"] });

  // Śledź animację chowania topbara (klasa is-hidden-mobile, transition ~0.22s)
  if (topbar) {
    const observer = new MutationObserver(() => {
      const duration = 260;
      let elapsed = 0;
      const tick = () => {
        syncTop();
        elapsed += 16;
        if (elapsed < duration) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    observer.observe(topbar, { attributes: true, attributeFilter: ["class"] });
  }

  update();
  // Pasek pokazuje się dopiero gotowy: linie, pozycja pod topbarem, tłumaczenia, czcionki
  // i bieżący etap — bez doskakiwania w trakcie wczytywania strony.
  const fontsReady = document.fonts?.ready ? Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1500))]) : Promise.resolve();
  void fontsReady.then(() => requestAnimationFrame(() => { update(); requestAnimationFrame(() => wrap.classList.add("is-ready")); }));
}

/* ---------- FAQ: strzałka rozwijania (ta sama co w listach) ---------- */

function initFaqCarets() {
  document.querySelectorAll(".faq-q").forEach((q) => {
    if (!q.querySelector(".faq-caret")) q.insertAdjacentHTML("beforeend", icon("caret-down", { className: "faq-caret" }));
  });
}

/* ---------- shot carousels ---------- */

// Kafel z data-gallery przewija kadry swojej kategorii (scripts/screens):
// przyciski po bokach podglądu, kropki na dole. Kliknięcie obrazu otwiera
// podgląd z przybliżaniem bieżącego kadru.
function initShotCarousels() {
  document.querySelectorAll(".tile-shot").forEach((shot) => {
    const img = shot.querySelector(".shot-img[data-gallery]");
    const ids = (img?.dataset.gallery || "").split(",").filter(Boolean);
    if (!img || ids.length < 2) return;
    img.removeAttribute("data-i18n-alt");
    let index = Math.max(0, ids.indexOf(img.dataset.shot));
    // Ta sama wersja (?v=, przepisywana przez CI) dla wszystkich kadrów kafla.
    const version = (img.dataset.file || "").match(/\?v=[^&]*/)?.[0] || "";
    const fileOf = (id, suffix = "-preview") => `shots/${id}${suffix}.webp${version}`;
    const preloadNeighbours = () => {
      const lang = getUiLang();
      for (const step of [1, -1, 2]) preloadShot(lang, fileOf(ids[(index + step + ids.length) % ids.length]));
    };

    const nav = (dir, label, iconName) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `btn sm shot-carousel-nav shot-carousel-${label}`;
      btn.dataset.i18nAriaLabel = `home.imageViewer.${label}`;
      btn.setAttribute("aria-label", t(`home.imageViewer.${label}`));
      btn.innerHTML = icon(iconName);
      btn.addEventListener("click", () => go(index + dir));
      return btn;
    };
    const dots = document.createElement("div");
    dots.className = "shot-carousel-dots";
    const dotButtons = ids.map((id, i) => {
      const dot = document.createElement("button");
      dot.type = "button";
      dot.className = "shot-carousel-dot";
      dot.addEventListener("click", () => go(i));
      dots.appendChild(dot);
      return dot;
    });
    shot.append(nav(-1, "prev", "arrow-left"), nav(1, "next", "arrow-right"), dots);
    // Na dotyku kadry zmienia też przesunięcie palcem w bok.
    onSwipe(shot, (dir) => go(index + dir));

    const render = () => {
      const id = ids[index];
      const title = t(`home.shots.${id}`);
      img.dataset.shot = id;
      img.dataset.file = fileOf(id);
      img.dataset.fullFile = fileOf(id, "");
      img.alt = title;
      shot.setAttribute("aria-label", t("home.imageViewer.open", { title }));
      dotButtons.forEach((dot, i) => {
        const active = i === index;
        dot.classList.toggle("is-active", active);
        dot.setAttribute("aria-current", active ? "true" : "false");
        dot.setAttribute("aria-label", `${t(`home.shots.${ids[i]}`)} · ${t("home.imageViewer.counter", { n: i + 1, total: ids.length })}`);
      });
    };
    const go = (next) => {
      index = (next + ids.length) % ids.length;
      render();
      switchLandingImages(getUiLang());
      preloadNeighbours();
    };

    shot.addEventListener("keydown", (e) => {
      if (e.target !== shot || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
      e.preventDefault();
      go(index + (e.key === "ArrowLeft" ? -1 : 1));
    });
    window.addEventListener("i18n:lang", render);
    render();
    // Sąsiednie kadry dopiero, gdy kafel zbliża się do ekranu (lazy jak obraz).
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      io.disconnect();
      const start = () => preloadNeighbours();
      if (img.complete) start(); else img.addEventListener("load", start, { once: true });
    }, { rootMargin: "300px" });
    io.observe(shot);
  });
}

/* ---------- image viewer ---------- */

function initImageViewer() {
  const main = document.querySelector("main.wrap");
  let viewerPromise;
  const getViewer = () => viewerPromise ||= import("../../shared/js/core/image-viewer.js?v=v2026-11-05T19482").then(({ createImageViewer }) => createImageViewer({
    mount: main,
    before: main?.querySelector(":scope > .footer") || null,
    backBtn: document.getElementById("btnImageViewerBack"),
  }));

  const openShot = async (shot) => {
    if (!shot) return;
    const img = shot.querySelector(".shot-img");
    if (!img) return;
    const fullFile = img.dataset.fullFile;
    const fullImage = fullFile ? buildLangImgUrl(getUiLang(), fullFile) : (img.currentSrc || img.src);
    const { open } = await getViewer();
    open(fullImage, img.getAttribute("alt") || "", img);
  };

  document.querySelectorAll(".tile-shot").forEach((shot) => {
    const img = shot.querySelector(".shot-img");
    shot.tabIndex = 0;
    shot.setAttribute("role", "button");
    shot.setAttribute("aria-label", t("home.imageViewer.open", { title: img?.alt || "" }));
  });

  document.addEventListener("click", (e) => {
    if (e.target.closest(".shot-carousel-nav, .shot-carousel-dots")) return;
    void openShot(e.target.closest(".tile-shot")).catch(error => console.error("[image-viewer] open failed", error));
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    if (e.target.closest(".shot-carousel-nav, .shot-carousel-dots")) return;
    const shot = e.target.closest(".tile-shot");
    if (!shot) return;
    e.preventDefault();
    void openShot(shot).catch(error => console.error("[image-viewer] open failed", error));
  });

}

/* ---------- boot ---------- */

document.addEventListener("DOMContentLoaded", async () => {
  // Kadry zaczynają się pobierać od razu, nie czekając na tłumaczenia.
  switchLandingImages(getUiLang());
  // Awaria tłumaczeń nie może zostawić pustej strony (initEntryPage odsłania ją zawsze).
  const stay = await initEntryPage("home", {
    ready: initI18n({ withSwitcher: true }), route: redirectIfSession(),
  }).catch((e) => { console.warn("[index] initialization failed", e?.name); return true; });
  if (!stay) return;
  applyTranslations();
  updateInternalLinks();
  updateHomeSeo();

  const lang = getUiLang();
  switchLandingImages(lang);
  // Zmiana motywu: kadry w nowym motywie (podmiana dopiero po pobraniu).
  window.addEventListener("theme:change", () => switchLandingImages(getUiLang()));
  window.addEventListener("i18n:lang", (e) => {
    switchLandingImages(e.detail.lang);
    updateInternalLinks();
    updateHomeSeo();
    document.querySelectorAll(".tile-shot").forEach((shot) => {
      const title = shot.querySelector(".shot-img")?.alt || "";
      shot.setAttribute("aria-label", t("home.imageViewer.open", { title }));
    });
  });

  initPipeline();
  initShotCarousels();
  initImageViewer();
  initFaqCarets();
  document.querySelector("main[data-skel-step]")?.classList.add("skel-step-ready");

  // Te zapytania są niekrytyczne: landing pozostaje gotowy także przy wolnym
  // lub niedostępnym backendzie, a każde odrzucenie jest jawnie obsłużone.
  void loadRatingStats();
});
