import { test } from "node:test";
import assert from "node:assert/strict";
import { serveStaticAsset } from "../../cloudflare/maintenance-worker/src/lib/origin/assets.js";
import { bindStaticAssets } from "../../cloudflare/maintenance-worker/src/lib/origin/origin.js";

// Pliki strony z bindingu ASSETS (Workers Static Assets).
function assets(t, body, contentType) {
  bindStaticAssets({ ASSETS: { fetch: async () => new Response(body, { headers: { "Content-Type": contentType } }) } });
  t.after(() => bindStaticAssets({}));
}

test("versioned JavaScript gets a year-long immutable cache", async (t) => {
  assets(t, "export const ready = true;", "text/javascript");
  const request = new Request("https://www.familijna.app/bases/js/bases.js?v=test");
  const response = await serveStaticAsset(request, new URL(request.url), { waitUntil() {} }, "https://www.familijna.app");
  assert.match(response.headers.get("Content-Type"), /javascript/);
  assert.equal(response.headers.get("Cache-Control"), "public, max-age=31536000, immutable");
  assert.equal(await response.text(), "export const ready = true;");
});

test("HTML returned as an asset is never given an immutable success", async (t) => {
  assets(t, "<html>wrong page</html>", "text/html");
  const request = new Request("https://www.familijna.app/bases/js/bases.js?v=test");
  const response = await serveStaticAsset(request, new URL(request.url), { waitUntil() {} }, "https://www.familijna.app");
  assert.equal(response.status, 502);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
});
