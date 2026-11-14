// Worker: zrzuty Wskazówek w gotowej treści z wersją z bieżącego wydania (asset-hashes.json).
import test from "node:test";
import assert from "node:assert/strict";
import { versionManualShots } from "../../cloudflare/maintenance-worker/src/lib/ssr/public-pages.js";

test("zrzuty Wskazówek dostają ?v=h<skrót> z mapy wydania", () => {
  const html = '<img src="/manual/img/pl/a-desktop.webp"><img src="/manual/img/pl/light/a-desktop.webp"><img src="/manual/img/pl/nowy.webp"><img src="/manual/img/pl/b.webp?v=h1234">';
  const out = versionManualShots(html, { "manual/img/pl/a-desktop.webp": "0123456789abcdef", "manual/img/pl/light/a-desktop.webp": "fedcba9876543210" });
  assert.equal(out, '<img src="/manual/img/pl/a-desktop.webp?v=h0123456789abcdef"><img src="/manual/img/pl/light/a-desktop.webp?v=hfedcba9876543210"><img src="/manual/img/pl/nowy.webp"><img src="/manual/img/pl/b.webp?v=h1234">');
  // Brak mapy (asset-hashes.json niedostępny): treść bez zmian.
  assert.equal(versionManualShots(html, null), html);
});
