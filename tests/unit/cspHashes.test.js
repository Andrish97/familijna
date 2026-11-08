// E24 R12: CSP stron bez 'unsafe-inline' — hashe skryptów wbudowanych aktualne,
// żaden wbudowany skrypt nie zawiera ?v= (wersjonowanie zmieniałoby hash).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { render } from "../../scripts/csp-hashes.mjs";

test("csp-hashes.js zgodny ze skryptami wbudowanymi w web/", () => {
  const cur = fs.readFileSync(new URL("../../cloudflare/maintenance-worker/src/lib/core/csp-hashes.js", import.meta.url), "utf8");
  assert.equal(cur, render(), "uruchom: node scripts/csp-hashes.mjs");
});

test("egzekwowana CSP stron: bez unsafe-inline/unsafe-eval, z hashami", async () => {
  const { withSecurityHeaders } = await import("../../cloudflare/maintenance-worker/src/lib/core/security-headers.js");
  const { INLINE_SCRIPT_HASHES } = await import("../../cloudflare/maintenance-worker/src/lib/core/csp-hashes.js");
  const res = withSecurityHeaders(new Request("https://www.familijna.app/games/"), new Response("<p>x</p>", { headers: { "Content-Type": "text/html" } }));
  const csp = res.headers.get("Content-Security-Policy");
  const script = csp.split(";").map((p) => p.trim()).find((p) => p.startsWith("script-src"));
  assert.ok(script && !script.includes("unsafe-inline") && !script.includes("unsafe-eval") && !script.includes("jsdelivr"), script);
  for (const h of INLINE_SCRIPT_HASHES) assert.ok(script.includes(h));
});
