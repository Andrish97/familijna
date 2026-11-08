import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('font 3x10: litera W bez znaku ▇ (pełne nóżki)', async () => {
  const font = JSON.parse(await readFile(new URL('../../web/shared/fonts/display/font_3x10.json', import.meta.url), 'utf8'));
  const all = JSON.stringify(font);
  assert.ok(!all.includes('▇'), 'żaden znak fontu 3x10 nie używa ▇');
  const w = Object.values(font).find((sec) => sec && typeof sec === 'object' && 'W' in sec)?.W ?? font.W;
  assert.deepEqual(w.slice(2, 7), ['█ █', '█ █', '█ █', '█ █', '◤Ѵ◥']);
});
