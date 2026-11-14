// Tryb zapasowy kanału urządzenia (game-state-subscribe.js): gdy kanał na
// żywo nie działa > POLL_FALLBACK_AFTER_MS, widoczna karta czyta stan z bazy
// co POLL_MS; po połączeniu kanału odpytywanie się kończy (eksport 13.11).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../../web/shared/js/core/game-state-subscribe.js", import.meta.url), "utf8")
  .replace(/^import .*;$/gm, "")
  .replace(/export const /g, "const ")
  .replace(/export function/g, "function");

function harness() {
  let now = 0;
  let timers = [];
  let nextTimer = 1;
  const setTimeoutFake = (fn, ms = 0) => { const id = nextTimer++; timers.push({ id, at: now + ms, fn }); return id; };
  const clearTimeoutFake = (id) => { timers = timers.filter((t) => t.id !== id); };
  async function advance(ms) {
    const end = now + ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      const next = timers[0];
      if (!next || next.at > end) break;
      timers.shift();
      now = next.at;
      next.fn();
      await new Promise((resolve) => setImmediate(resolve));
    }
    now = end;
    await new Promise((resolve) => setImmediate(resolve));
  }
  const fetches = [];
  const diagnostics = [];
  const live = [];
  const subscribeCallbacks = [];
  let retryRun = null;
  const channelObj = () => {
    const ch = {
      on() { return ch; },
      subscribe(cb) { subscribeCallbacks.push(cb); return ch; },
    };
    return ch;
  };
  const doc = { visibilityState: "visible", hasFocus: () => true, addEventListener() {}, removeEventListener() {} };
  const context = {
    console: { info() {}, warn() {} },
    document: doc,
    navigator: { onLine: true },
    performance: { now: () => now },
    setTimeout: setTimeoutFake,
    clearTimeout: clearTimeoutFake,
    Date, Math, Number, String, Set, JSON, Promise, Object, Error,
    AbortSignal: { timeout: () => ({}) },
    globalThis: {},
    window: {
      addEventListener() {}, removeEventListener() {},
      supabase: { createClient: () => ({ realtime: { setAuth: async () => {} }, channel: channelObj, removeChannel: async () => {} }) },
    },
    sb: () => ({ functions: { invoke: async () => ({ data: { token: "t", expires_in: 3600 }, error: null }) } }),
    REALTIME_OPTIONS: {}, SUPABASE_ANON_KEY: "anon", SUPABASE_URL: "https://api.test",
    createNetworkMonitor: () => ({ start() {}, stop() {}, probeNow() {} }),
    measureNetwork: () => ({}),
    createRowSync: () => ({
      fetchGuarded: async (src) => { fetches.push(src); },
      applyRow() {}, reset() {}, lastRev: -1,
    }),
    realtimeSocketCloseDetails: () => ({}),
    observeRealtimeSocketClose: () => true,
    createDirectRetryScheduler: ({ run }) => ({
      schedule() { retryRun = run; return 15_000; },
      cancel() {}, reset() {},
    }),
  };
  const createSubscription = vm.runInNewContext(`${source}; createSubscription;`, context);
  const sub = createSubscription({
    gameId: "g", deviceType: "display", key: "k",
    getLeaseArgs: () => ({ p_connection_id: "c", p_epoch: 1 }),
    log: (event) => diagnostics.push(event),
    onLiveChange: (value) => live.push(value),
    onRow() {},
  });
  return { sub, advance, fetches, diagnostics, live, subscribeCallbacks, doc, retry: () => retryRun?.() };
}

test("kanał nie działa: po 5 s odczyt z bazy co 2 s, po połączeniu kanału koniec odpytywania", async () => {
  const h = harness();
  await h.sub.start();
  await h.advance(0);
  assert.deepEqual(h.fetches, ["rpc_bootstrap"]);
  h.subscribeCallbacks.at(-1)("CHANNEL_ERROR");
  await h.advance(4_900);
  assert.equal(h.sub.isPolling(), false, "przed 5 s bez odpytywania");
  await h.advance(100);
  assert.equal(h.sub.isPolling(), true);
  assert.deepEqual(h.live, [false]);
  await h.advance(4_000);
  assert.equal(h.fetches.filter((s) => s === "rpc_poll").length, 3, "odczyt od razu i co 2 s");

  // Karta w tle: bez odczytów (po powrocie i tak jest resync).
  h.doc.visibilityState = "hidden";
  const before = h.fetches.length;
  await h.advance(6_000);
  assert.equal(h.fetches.length, before);
  h.doc.visibilityState = "visible";

  // Kanał wraca: koniec odpytywania, Control dostaje realtime_live = true.
  h.retry();
  await h.advance(0);
  h.subscribeCallbacks.at(-1)("SUBSCRIBED");
  await h.advance(0);
  assert.equal(h.sub.isPolling(), false);
  assert.deepEqual(h.live, [false, true]);
  const polls = h.fetches.filter((s) => s === "rpc_poll").length;
  await h.advance(10_000);
  assert.equal(h.fetches.filter((s) => s === "rpc_poll").length, polls, "po połączeniu bez odczytów co 2 s");
  h.sub.stop();
});

test("krótka przerwa kanału (< 5 s) nie włącza trybu zapasowego", async () => {
  const h = harness();
  await h.sub.start();
  await h.advance(0);
  h.subscribeCallbacks.at(-1)("SUBSCRIBED");
  await h.advance(0);
  h.subscribeCallbacks.at(-1)("CHANNEL_ERROR");
  await h.advance(2_000);
  h.retry();
  await h.advance(0);
  h.subscribeCallbacks.at(-1)("SUBSCRIBED");
  await h.advance(10_000);
  assert.equal(h.sub.isPolling(), false);
  assert.deepEqual(h.live, []);
  assert.equal(h.fetches.includes("rpc_poll"), false);
  h.sub.stop();
});
