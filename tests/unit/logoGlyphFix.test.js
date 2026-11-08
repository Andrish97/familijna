import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fixLegacyGlyphRows } from '../../web/shared/js/core/logo-glyph-fix.js';

// Logo „Wakacje 2026” zapisane przed poprawką fontu 3x10 (2026-11-08): „W”
// miało w nóżkach „▇ ▇” (górny rząd punktów zgaszony) — dziura w literze.
const OLD = ["                              ","                              "," █ █ ◢█◣ █ ╱ ◢█◣ ◢█◣   █ ███  "," █ █ █ █ █╱  █ █ █     █ █    "," █ █ ███ █╲  ███ █     █ ███  "," ▇ ▇ █ █ █ ╲ █ █ █   ◢ █ █    "," ◤Ѵ◥ █ █ █ ▐ █ █ ◥█◤ ◥█◤ ███  ","                              ","                              ","                              "];

test('font 3x10: litera W bez znaku ▇ (pełne nóżki)', async () => {
  const font = JSON.parse(await readFile(new URL('../../web/shared/fonts/display/font_3x10.json', import.meta.url), 'utf8'));
  const all = JSON.stringify(font);
  assert.ok(!all.includes('▇'), 'żaden znak fontu 3x10 nie używa ▇');
  const w = Object.values(font).find((sec) => sec && typeof sec === 'object' && 'W' in sec)?.W ?? font.W;
  assert.deepEqual(w.slice(2, 7), ['█ █', '█ █', '█ █', '█ █', '◤Ѵ◥']);
});

test('zapisane logo ze starym „W” rysowane jak nowe; inne znaki bez zmian', () => {
  const fixed = fixLegacyGlyphRows(OLD);
  assert.equal(fixed[5], ' █ █ █ █ █ ╲ █ █ █   ◢ █ █    ');
  for (const i of [0, 1, 2, 3, 4, 6, 7, 8, 9]) assert.equal(fixed[i], OLD[i]);
  // ▇ poza wzorem „W” (np. z importu) zostaje
  const other = [' ▇ ▇ ', ' ███ '];
  assert.deepEqual(fixLegacyGlyphRows(other), other);
  assert.equal(fixLegacyGlyphRows(['abc']).length, 1);
  assert.equal(fixLegacyGlyphRows(null), null);
});
