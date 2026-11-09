import { test } from "node:test";
import assert from "node:assert/strict";
import { gameSeoDescription, marketSeo } from "../../web/marketplace/js/public.js";
import pl from "../../web/shared/translation/pl/marketplace.js";
import en from "../../web/shared/translation/en/marketplace.js";
import uk from "../../web/shared/translation/uk/marketplace.js";

// Bing Webmaster Tools 2026-11: „meta description too short” na stronach gier
// (opis był samym opisem autora albo tytułem).
const tFor = (dict) => (key, params = {}) => key.split(".").reduce((a, k) => a?.[k], dict)
  .replace(/\{(\w+)\}/g, (m, k) => params[k] ?? m);

test("game meta description: title sentence + author text, 100-160 chars, all languages", () => {
  for (const dict of [pl, en, uk]) {
    const t = tFor(dict);
    const short = gameSeoDescription({ title: "Kino", description: "" }, t);
    assert.ok(short.startsWith("Kino — "), short);
    assert.ok(short.length >= 80 && short.length <= 160, `${short.length}: ${short}`);
    const long = gameSeoDescription({ title: "Wesele", description: "Pytania o tradycje weselne ".repeat(12) }, t);
    assert.ok(long.length <= 160 && long.endsWith("…"), `${long.length}: ${long}`);
    assert.ok(!/\{title\}/.test(long));
  }
});

test("marketSeo uses the composed description for games, catalog text otherwise", () => {
  const t = tFor(pl);
  const game = { title: "Kino", description: "Filmy i aktorzy.", slug: "kino" };
  assert.equal(marketSeo("pl", t, game).description, gameSeoDescription(game, t));
  assert.equal(marketSeo("pl", t).description, pl.marketplace.seoDescription);
});
