// Dawna litera „W” fontu 3x10 (logo w trybie Tekst) miała w nóżkach „▇ ▇”:
// znak ▇ (blok 7/8) ma zgaszony górny rząd punktów, więc w „W” była pozioma
// dziura. Font poprawiony 2026-11-08 („█ █”); logo zapisane wcześniej mają
// stare znaki w bazie — poprawiamy je przy rysowaniu i przy odczycie napisu.
// Tylko dokładny wzór „W” (▇ ▇ nad ◤Ѵ◥), inne znaki bez zmian.
const OLD = "▇ ▇";
const BELOW = "◤Ѵ◥";
const NEW = "█ █";

export function fixLegacyGlyphRows(rows) {
  if (!Array.isArray(rows) || !rows.some((r) => String(r ?? "").includes(OLD))) return rows;
  const out = rows.map((r) => String(r ?? ""));
  for (let y = 0; y + 1 < out.length; y++) {
    let x = out[y].indexOf(OLD);
    while (x >= 0) {
      if (out[y + 1].slice(x, x + 3) === BELOW) out[y] = out[y].slice(0, x) + NEW + out[y].slice(x + 3);
      x = out[y].indexOf(OLD, x + 1);
    }
  }
  return out;
}
