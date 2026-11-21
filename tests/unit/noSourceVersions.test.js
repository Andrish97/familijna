// Zapadka (decyzja 2026-11-21): źródła w web/ są bez ?v=. Wersje z treści plików
// dokłada build przy wdrożeniu (npm run build:site w deploy-worker.yml), więc
// znacznik w źródle byłby tylko szumem w historii i konfliktach przy scalaniu.
// Naprawa: node scripts/strip-source-versions.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { stripVersions } from "../../scripts/strip-source-versions.mjs";

test("źródła strony (web/) nie zawierają znaczników wersji ?v=", () => {
  const found = stripVersions({ check: true });
  assert.deepEqual(found, [], "uruchom: node scripts/strip-source-versions.mjs");
});
