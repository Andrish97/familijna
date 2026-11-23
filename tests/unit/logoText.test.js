// Logo tekstowe (shared/js/core/logo-text.js): ta sama funkcja w edytorze logo
// i w czacie AI — napis mieści się albo nie, nieznane znaki są zgłaszane.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { compileText, TEXT_TILES_X, TEXT_TILES_Y } from "../../web/shared/js/core/logo-text.js";

const font = JSON.parse(fs.readFileSync(new URL("../../web/shared/fonts/display/font_3x10.json", import.meta.url), "utf8"));

test("logo tekstowe: krótki napis mieści się i jest wyśrodkowany", () => {
  const r = compileText("RODZINA", font);
  assert.equal(r.fit, true);
  assert.deepEqual(r.invalid, []);
  assert.equal(r.rows.length, TEXT_TILES_Y);
  assert.ok(r.rows.every((row) => row.length === TEXT_TILES_X));
  const lit = (i) => r.rows.some((row) => row[i] !== " ");
  assert.equal(lit(0), false, "lewa krawędź pusta");
  assert.equal(lit(TEXT_TILES_X - 1), false, "prawa krawędź pusta");
});

test("logo tekstowe: za długi napis i znaki spoza czcionki", () => {
  assert.equal(compileText("FAMILIJNA RODZINNA GRA", font).fit, false);
  assert.deepEqual(compileText("A€", font).invalid, ["€"]);
});
