import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Prośba o ocenę tylko na spokojnych stronach (decyzja użytkownika 2026-11-27):
// listy i Konto -- nigdy w edytorach, Control, ankiecie w toku ani przy głosowaniu.
const src = readFileSync(new URL("../../web/shared/js/core/rating-system.js", import.meta.url), "utf8");
const pageInit = readFileSync(new URL("../../web/shared/js/core/page-init.js", import.meta.url), "utf8");
const pages = new Set(JSON.parse(src.match(/RATING_PROMPT_PAGES = new Set\((\[[^\]]*\])\)/)[1]));

test("prośba o ocenę: tylko listy i Konto", () => {
  assert.deepEqual([...pages].sort(), ["account", "bases", "games", "logoEditor", "marketplace", "tasks"]);
  for (const busy of ["control", "editor", "gameSettings", "baseExplorer", "polls", "manual", "privacy", "connectDevice"]) {
    assert.equal(pages.has(busy), false, busy);
  }
});

test("prośba o ocenę: initPage podaje stronę, pokazanie i wybór są zapisywane", () => {
  assert.match(pageInit, /showAccountNotices\(user, id\)/);
  assert.match(pageInit, /initRatingSystem\(user, \{ page \}\)/);
  assert.match(src, /logPrompt\("shown", page\)/);
  for (const outcome of ["sent", "never", "later", "closed"]) assert.match(src, new RegExp(`"${outcome}"`));
});
