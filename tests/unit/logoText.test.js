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

test("logo z kształtów (draw_logo): kropki 150×70, napis czcionką 5×7, wycięcia, format jak edytor", async () => {
  const fs = await import("node:fs");
  const { drawLogoBits, packBits, previewAscii, DOT_W } = await import("../../web/shared/js/core/logo-draw.js");
  const { unpackBits } = await import("../../web/logos/js/render.js");
  const font = JSON.parse(fs.readFileSync(new URL("../../web/shared/fonts/display/font_5x7.json", import.meta.url), "utf8"));
  const at = (bits, x, y) => bits[y * DOT_W + x];

  const r = drawLogoBits({ shapes: [
    { type: "rect", x: 0, y: 0, w: 10, h: 10 },
    { type: "rect", x: 2, y: 2, w: 2, h: 2, color: "off" },
    { type: "rect", x: 20, y: 0, w: 10, h: 10, fill: false },
    { type: "text", x: 40, y: 0, text: "a" },
  ] }, font);
  assert.deepEqual(r.warnings, []);
  assert.equal(at(r.bits, 0, 0), 1);
  assert.equal(at(r.bits, 2, 2), 0, "wycięcie");
  assert.equal(at(r.bits, 25, 5), 0, "obrys bez środka");
  assert.equal(at(r.bits, 20, 5), 1);
  // „A” w czcionce 5×7: górny wiersz 01110
  assert.deepEqual([40, 41, 42, 43, 44].map((x) => at(r.bits, x, 0)), [0, 1, 1, 1, 0]);
  assert.deepEqual(unpackBits(packBits(r.bits)), r.bits, "bity w formacie edytora");
  assert.equal(previewAscii(r.bits).split("\n").length, 35);

  const bad = drawLogoBits({ shapes: [{ type: "text", x: 140, y: 0, text: "€Ж" , scale: 3 }, { type: "blob" }] }, font);
  assert.ok(bad.warnings.some((w) => /outside/.test(w)) && bad.warnings.some((w) => /unknown type/.test(w)));
});
