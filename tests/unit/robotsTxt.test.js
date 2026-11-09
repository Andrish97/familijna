import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { publicUrl } from "../../web/shared/js/core/public-seo.js";
import { gamePath, catalogPath } from "../../web/marketplace/js/public.js";

// Dopasowanie jak Google: * = dowolny ciąg, $ = koniec; wygrywa najdłuższa reguła,
// przy remisie Allow.
const rules = readFileSync(new URL("../../web/robots.txt", import.meta.url), "utf8")
  .split("\n").map((line) => line.replace(/#.*/, "").trim())
  .map((line) => /^(Allow|Disallow):\s*(\S+)/i.exec(line)).filter(Boolean)
  .map(([, kind, pattern]) => ({ allow: /^allow$/i.test(kind), pattern,
    re: new RegExp("^" + pattern.replace(/[.+?^${}()|[\]\\]/g, (c) => (c === "$" ? "$" : `\\${c}`)).replace(/\*/g, ".*")) }));
function allowed(url) {
  const u = new URL(url, "https://www.familijna.app");
  const path = u.pathname + u.search;
  const hit = rules.filter((r) => r.re.test(path)).sort((a, b) => b.pattern.length - a.pattern.length || b.allow - a.allow)[0];
  return !hit || hit.allow;
}

test("robots.txt: canonical public URLs stay crawlable", () => {
  for (const lang of ["pl", "en", "uk"]) {
    assert.ok(allowed(publicUrl("manual", lang)), `manual ${lang}`);
    assert.ok(allowed(publicUrl("manual", lang, "11")), `manual ch ${lang}`);
    assert.ok(allowed(publicUrl("privacy", lang)), `privacy ${lang}`);
    assert.ok(allowed(catalogPath(lang)), `catalog ${lang}`);
    assert.ok(allowed(gamePath({ slug: "matura-i-egzaminy" }, lang)), `game ${lang}`);
    assert.ok(allowed(lang === "pl" ? "/" : `/?lang=${lang}`), `home ${lang}`);
  }
});

test("robots.txt: URLs with the return context (ret) are not crawled", () => {
  for (const url of [
    "/manual/?ch=11&ret=/marketplace/game/matura-i-egzaminy&lang=en",
    "/privacy/?ret=/manual/?ch%3D20",
    "/privacy/?ret=%2Fmanual%2F%3Fch%3D2%26ret%3D%252Fmarketplace&lang=en",
  ]) assert.equal(allowed(url), false, url);
  assert.ok(allowed("/manual/?ch=3&lang=en"));
});
