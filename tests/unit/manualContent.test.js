// Podręcznik (E13): treść /manual/ zgodna ze źródłem w docs/podrecznik,
// odnośniki „→ N.M” i przyciski „?” stron prowadzą do istniejących miejsc.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { buildAll, refHref, PAGE_LINKS } from "../../scripts/manual/build-content.mjs";
import { PAGES } from "../../web/shared/js/core/nav-map.js";

const LANGS = ["pl", "en", "uk"].filter((l) => fs.existsSync(new URL(`../../web/manual/content/${l}.js`, import.meta.url)));
const load = async (lang) => (await import(`../../web/manual/content/${lang}.js`)).default;

test("spis treści i rozdziały są zgodne z pełnym źródłem w każdym języku", async () => {
  const generated = await buildAll({ chunks: true });
  const loaders = (await import("../../web/manual/content/chapter-loaders.js")).default;
  for (const [relative, source] of Object.entries(generated)) {
    const file = new URL(`../../web/manual/content/${relative.endsWith(".js") ? relative : `${relative}.js`}`, import.meta.url);
    const actual = fs.readFileSync(file, "utf8");
    // Wersjoner deploymentu dopisuje ?v= do dynamicznych importów mapy.
    assert.equal(relative === "chapter-loaders.js" ? actual.replace(/\?v=[a-zA-Z0-9T:-]+/g, "") : actual, source, `${relative}: nieaktualny plik`);
  }
  for (const lang of LANGS) {
    const full = await load(lang);
    const meta = (await import(`../../web/manual/content/meta/${lang}.js`)).default;
    assert.deepEqual(meta.parts, full.parts);
    assert.deepEqual(meta.chapters, full.chapters.map(({ html, ...chapter }) => chapter));
    for (const chapter of full.chapters) assert.equal((await loaders[lang][chapter.id]()).default, chapter.html);
  }
});
const anchors = (manual) => {
  const set = new Set();
  for (const c of manual.chapters) {
    set.add(c.id);
    for (const s of c.sections) set.add(s.id);
  }
  return set;
};

test("treść strony jest wygenerowana z aktualnych plików docs/podrecznik", async () => {
  const built = await buildAll();
  for (const [lang, content] of Object.entries(built)) {
    const file = new URL(`../../web/manual/content/${lang}.js`, import.meta.url);
    assert.equal(fs.readFileSync(file, "utf8"), content, `${lang}: uruchom node scripts/manual/build-content.mjs`);
  }
});

test("wszystkie języki podręcznika mają te same rozdziały i podrozdziały", async () => {
  const pl = await load("pl");
  for (const lang of LANGS) {
    const m = await load(lang);
    assert.deepEqual(m.parts.map((p) => p.chapters), pl.parts.map((p) => p.chapters), lang);
    assert.deepEqual(m.chapters.map((c) => [c.id, c.sections.map((s) => s.id)]), pl.chapters.map((c) => [c.id, c.sections.map((s) => s.id)]), lang);
  }
});

test("odnośniki w treści prowadzą do istniejących rozdziałów i podrozdziałów", async () => {
  for (const lang of LANGS) {
    const m = await load(lang);
    const known = anchors(m);
    for (const c of m.chapters) {
      for (const [, href] of c.html.matchAll(/class="m-ref" href="([^"]+)"/g)) {
        const target = href.replace(/^\?ch=/, "").replace(/#s-/, "#").split("#");
        const id = target[1] ? target[1].replace(/-/g, ".") : target[0];
        assert.ok(known.has(id), `${lang} rozdz. ${c.id}: odnośnik do nieistniejącego ${id}`);
        assert.equal(href, refHref(id));
      }
    }
  }
});

test("przycisk „?” każdej strony prowadzi do istniejącego miejsca podręcznika", async () => {
  const known = anchors(await load("pl"));
  for (const [id, page] of Object.entries(PAGES)) {
    if (!page.manual) continue;
    assert.ok(known.has(String(page.manual)), `${id}: manual "${page.manual}" nie istnieje w podręczniku`);
  }
});

test("treść nie zawiera surowych znaczników Markdown", async () => {
  for (const lang of LANGS) {
    for (const c of (await load(lang)).chapters) {
      const text = c.html.replace(/<pre[\s\S]*?<\/pre>/g, "").replace(/<[^>]+>/g, "");
      assert.doesNotMatch(text, /\*\*|^#{1,3}\s|\]\(http/m, `${lang} rozdz. ${c.id}`);
    }
  }
});

test("nazwy stron w treści prowadzą do stron z mapy, a ich „←” wraca do podręcznika", async () => {
  for (const [id, link] of Object.entries(PAGE_LINKS)) {
    assert.ok(PAGES[id], `${id}: brak w nav-map`);
    assert.equal(PAGES[id].path, link.path, `${id}: inna ścieżka niż w nav-map`);
    assert.ok(PAGES[id].from === "*" || PAGES[id].from.includes("manual"), `${id}: brak "manual" w from`);
  }
  for (const lang of LANGS) {
    const manual = await load(lang);
    const used = new Set(manual.chapters.flatMap((c) => [...c.html.matchAll(/data-page="([^"]+)"/g)].map((m) => m[1])));
    assert.ok(used.size >= 5, `${lang}: za mało odnośników do stron (${used.size})`);
    for (const id of used) assert.ok(PAGE_LINKS[id], `${lang}: nieznana strona ${id}`);
  }
});

test("zrzuty w treści mają scenę w scripts/screens i opublikowany plik", async () => {
  const { createRequire } = await import("node:module");
  const scenes = createRequire(import.meta.url)("../../scripts/screens/scenes.cjs");
  const ids = new Set(scenes.map((s) => s.id));
  for (const lang of LANGS) {
    const manual = await load(lang);
    const shots = manual.chapters.flatMap((c) => [...c.html.matchAll(/src="\/manual\/(img\/([a-z]+)\/([a-z0-9-]+)-(desktop|phone-landscape|tablet-landscape|phone|tablet)\.webp)"/g)]);
    for (const [, file, shotLang, scene] of shots) {
      assert.equal(shotLang, lang, `${file}: zrzut w innym języku niż treść`);
      assert.ok(ids.has(scene), `${file}: brak sceny ${scene} w scripts/screens/scenes.cjs`);
      assert.ok(fs.existsSync(new URL(`../../web/manual/${file}`, import.meta.url)), `${file}: uruchom scripts/screens/publish-manual.cjs`);
    }
  }
});

test("Wskazówki: przycisk i odnośnik trzymają kropkę/przecinek w tym samym wierszu", async () => {
  const { glueTrailingPunctuation } = await import("../../scripts/manual/build-content.mjs");
  assert.equal(glueTrailingPunctuation('wybierz <span class="m-control"><i data-icon="x"></i>Zapisz</span>.'),
    'wybierz <span class="m-nobr"><span class="m-control"><i data-icon="x"></i>Zapisz</span>.</span>');
  // Odnośnik jest zwykłym tekstem (inline) — bez kleju, może się łamać jak tekst.
  assert.equal(glueTrailingPunctuation('zob. <a class="m-ref" href="?ch=1"><i></i>Final</a>),'), 'zob. <a class="m-ref" href="?ch=1"><i></i>Final</a>),');
  assert.equal(glueTrailingPunctuation('<span class="m-control">A</span> i dalej'), '<span class="m-control">A</span> i dalej');
});

test("Wskazówki: „[ i ]” (klawisze) nie staje się przyciskiem — budowanie się zatrzymuje", async () => {
  const { parseManual } = await import("../../scripts/manual/build-content.mjs");
  assert.throws(() => parseManual(["# 1. Test\n\nKlawisze [ i ] zmieniają grubość.\n"], new Map()), /klawisze/);
});
