import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Funkcja Edge lead-finder: lista dozwolonych akcji usługi (sieć Dockera).
import { serviceRoute } from "../../supabase/functions/lead-finder/routes.js";

const RUN = "0f1e2d3c-4b5a-4987-8654-3210fedcba98";

test("akcje -> ścieżki usługi", () => {
  assert.deepEqual(serviceRoute({ action: "status" }), { method: "GET", path: "/api/search-runs/status" });
  assert.deepEqual(serviceRoute({ action: "start", target_count: 7 }), { method: "POST", path: "/api/search-runs?target_count=7" });
  assert.deepEqual(serviceRoute({ action: "start", target_count: 5000 }), { method: "POST", path: "/api/search-runs?target_count=1000" });
  assert.deepEqual(serviceRoute({ action: "start", target_count: "x" }), { method: "POST", path: "/api/search-runs?target_count=50" });
  for (const a of ["pause", "resume", "cancel"]) {
    assert.deepEqual(serviceRoute({ action: a, run_id: RUN.toUpperCase() }), { method: "POST", path: `/api/search-runs/${RUN}/${a}` });
  }
});

test("nieznane akcje i złe identyfikatory odrzucone", () => {
  for (const body of [{}, null, { action: "health" }, { action: "pause" }, { action: "pause", run_id: "../../health" },
    { action: "delete", run_id: RUN }, { action: "start/../health" }, { action: "review" }]) {
    assert.equal(serviceRoute(body), null, JSON.stringify(body));
  }
});

test("funkcja: sekret w nagłówku, adres wewnętrzny Dockera, bez CORS", () => {
  const src = readFileSync(new URL("../../supabase/functions/lead-finder/index.ts", import.meta.url), "utf8");
  assert.match(src, /x-internal-secret/);
  assert.match(src, /http:\/\/familijna-lead-finder:8001/);
  assert.doesNotMatch(src, /Access-Control-Allow-Origin/);
  assert.doesNotMatch(src, /leads\.(familiada\.online|familijna\.app)/);
});

test("question-bank: pytania w osobnym kontenerze (podział usług wyszukiwania)", () => {
  const src = readFileSync(new URL("../../supabase/functions/question-bank/index.ts", import.meta.url), "utf8");
  assert.match(src, /http:\/\/familijna-question-finder:8001/);
  assert.doesNotMatch(src, /familijna-lead-finder/);
});
