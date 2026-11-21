import { test } from "node:test";
import assert from "node:assert/strict";
import { createRowSync } from "../../web/shared/js/core/game-state-sync.js";

const row = (rev, extra = {}) => ({ rev, locked_until: null, ...extra });
const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));

test("błąd odczytu planuje ponowną próbę, więc urządzenie dogania stan bez kolejnego dzwonka", async () => {
  const seen = [], errors = [];
  let calls = 0;
  const sync = createRowSync({
    fetchRow: async () => (++calls === 1 ? { error: new Error("net") } : { data: row(7) }),
    onRow: (r) => seen.push(r.rev),
    onError: (e) => errors.push(e),
    retryMs: 1,
  });
  await sync.fetchGuarded();
  assert.equal(errors.length, 1);
  await tick(20);
  assert.deepEqual(seen, [7]);
});

test("wyjątek z fetchRow (np. przerwane żądanie) też jest ponawiany", async () => {
  const seen = [];
  let calls = 0;
  const sync = createRowSync({
    fetchRow: async () => { if (++calls === 1) throw new Error("abort"); return { data: row(3) }; },
    onRow: (r) => seen.push(r.rev),
    retryMs: 1,
  });
  await sync.fetchGuarded();
  await tick(20);
  assert.deepEqual(seen, [3]);
});

test("po przerwanym odczycie okresowy odczyt nie czeka na retry i dostaje świeży wiersz", async (t) => {
  const seen = [];
  let calls = 0;
  const sync = createRowSync({
    fetchRow: () => (++calls === 1 ? Promise.reject(new Error("timeout")) : Promise.resolve({ data: row(9) })),
    onRow: (r) => seen.push(r.rev),
    retryMs: 100000,
    setTimer: (fn, ms) => {
      const timer = setTimeout(fn, ms);
      t.after(() => clearTimeout(timer));
      return timer;
    },
  });
  await sync.fetchGuarded();
  await sync.fetchGuarded();
  assert.deepEqual(seen, [9]);
});

test("starszy lub ten sam rev jest pomijany, nowszy stosowany", async () => {
  const seen = [];
  const queue = [row(5), row(4), row(5), row(6)];
  const sync = createRowSync({ fetchRow: async () => ({ data: queue.shift() }), onRow: (r) => seen.push(r.rev) });
  for (let i = 0; i < 4; i++) await sync.fetchGuarded();
  assert.deepEqual(seen, [5, 6]);
});

test("ten sam rev ze zmienioną blokadą (game_state_set_lock) jest stosowany, gdy wołający o to prosi", async () => {
  const seen = [];
  const queue = [row(5, { locked_until: "A" }), row(5, { locked_until: "A" }), row(5, { locked_until: "B" })];
  const sync = createRowSync({
    fetchRow: async () => ({ data: queue.shift() }),
    onRow: (r) => seen.push(r.locked_until),
    sameRevChanged: (a, b) => a.locked_until !== b.locked_until,
  });
  for (let i = 0; i < 3; i++) await sync.fetchGuarded();
  assert.deepEqual(seen, ["A", "B"]);
});

test("wyjątek z onRow nie zatrzymuje kolejnych odczytów", async () => {
  const seen = [];
  const queue = [row(1), row(2)];
  const origWarn = console.warn;
  console.warn = () => {};
  try {
    const sync = createRowSync({
      fetchRow: async () => ({ data: queue.shift() }),
      onRow: (r) => { seen.push(r.rev); if (r.rev === 1) throw new Error("render"); },
    });
    await sync.fetchGuarded();
    await sync.fetchGuarded();
  } finally { console.warn = origWarn; }
  assert.deepEqual(seen, [1, 2]);
});

test("wiersz Realtime jest stosowany bez dodatkowego odczytu RPC", async () => {
  const seen = [];
  let calls = 0;
  const sync = createRowSync({
    fetchRow: async () => { calls++; return { data: row(1) }; },
    onRow: (r) => seen.push(r.rev),
  });
  await sync.fetchGuarded();
  sync.applyRow(row(3));
  sync.applyRow(row(2)); // spóźniony payload nie cofa stanu
  await tick();
  assert.deepEqual(seen, [1, 3]);
  assert.equal(calls, 1);
});

test("renderowanie wierszy Realtime jest serializowane i scala kolejkę do najnowszej rewizji", async () => {
  const seen = [];
  let release;
  let rendering = false;
  const firstRender = new Promise((resolve) => { release = resolve; });
  const sync = createRowSync({
    fetchRow: async () => ({ data: row(1) }),
    onRow: async (r) => {
      assert.equal(rendering, false, "rendery nie mogą się nakładać");
      rendering = true;
      seen.push(r.rev);
      if (r.rev === 2) await firstRender;
      rendering = false;
    },
  });
  await sync.fetchGuarded();
  sync.applyRow(row(2));
  await tick();
  sync.applyRow(row(3));
  sync.applyRow(row(4));
  release();
  await tick(20);
  assert.deepEqual(seen, [1, 2, 4]);
});


test("postęp synchronizacji rozróżnia źródło i raportuje błąd renderowania bez zatrzymania odbioru", async () => {
  const progress = [];
  const seen = [];
  const origWarn = console.warn;
  console.warn = () => {};
  try {
    const sync = createRowSync({
      fetchRow: async () => ({ data: row(4) }),
      onRow: (value) => { seen.push(value.rev); if (value.rev === 4) throw Object.assign(new Error("render"), { name: "RenderError" }); },
      onProgress: (event) => progress.push(event),
      now: (() => { let time = 10; return () => ++time; })(),
    });
    await sync.fetchGuarded();
    sync.applyRow(row(5));
    await tick();
  } finally { console.warn = origWarn; }
  assert.deepEqual(seen, [4, 5]);
  assert.equal(progress.length, 2);
  assert.equal(progress[0].source, "rpc");
  assert.equal(progress[0].previousRev, -1);
  assert.equal(progress[0].renderError.name, "RenderError");
  assert.equal(progress[1].source, "broadcast");
  assert.equal(progress[1].previousRev, 4);
  assert.equal(progress[1].renderError, null);
});

test("status odczytu rejestruje pojedynczy wynik RPC z rewizją i czasem", async () => {
  const statuses = [];
  const sync = createRowSync({
    fetchRow: async () => ({ data: row(12) }),
    onRow: () => {},
    onReadStatus: (status) => statuses.push(status),
    now: (() => { let time = 100; return () => ++time; })(),
  });
  await sync.fetchGuarded();
  assert.equal(statuses.length, 1);
  assert.equal(statuses[0].ok, true);
  assert.equal(statuses[0].revision, 12);
  assert.equal(typeof statuses[0].fetchMs, "number");
});

test("receivedRev obejmuje wiersz czekający na koniec animacji (heartbeat nie bierze go za zgubiony)", async () => {
  let release;
  const animation = new Promise((resolve) => { release = resolve; });
  const sync = createRowSync({
    fetchRow: async () => ({ data: row(1) }),
    onRow: async (r) => { if (r.rev === 2) await animation; },
  });
  await sync.fetchGuarded();
  sync.applyRow(row(2));
  await tick();
  sync.applyRow(row(3));
  assert.equal(sync.lastRev, 2);
  assert.equal(sync.receivedRev, 3);
  release();
  await tick(20);
  assert.equal(sync.lastRev, 3);
  assert.equal(sync.receivedRev, 3);
});

test("przerwanie obsługi wiersza (AbortError) nie jest raportowane jako błąd renderowania", async () => {
  const progress = [];
  const sync = createRowSync({
    fetchRow: async () => ({ data: row(4) }),
    onRow: () => { throw Object.assign(new Error("superseded"), { name: "AbortError" }); },
    onProgress: (event) => progress.push(event),
  });
  await sync.fetchGuarded();
  assert.equal(progress.length, 1);
  assert.equal(progress[0].renderError, null);
});

test("odczyt zakolejkowany w trakcie innego zachowuje źródło (rpc_doorbell)", async () => {
  const sources = [];
  let rev = 1;
  let release;
  const sync = createRowSync({
    fetchRow: () => new Promise((resolve) => { release = () => resolve({ data: row(rev++) }); }),
    onRow: () => {},
    onReadStatus: ({ source }) => sources.push(source),
  });
  const first = sync.fetchGuarded("rpc_doorbell");
  await sync.fetchGuarded("rpc_doorbell"); // w trakcie pierwszego — do kolejki
  release();
  await first;
  await tick();
  release();
  await tick();
  assert.deepEqual(sources, ["rpc_doorbell", "rpc_doorbell"]);
});

test("kolejne nieudane odczyty: odstęp rośnie (2 s → 4 → 8 … do 30 s), udany odczyt go zeruje", async () => {
  const delays = [];
  let pending = null;
  let fail = true;
  const sync = createRowSync({
    fetchRow: async () => (fail ? { error: new Error("forbidden") } : { data: row(9) }),
    onRow: () => {},
    retryMs: 2000,
    setTimer: (fn, ms) => { delays.push(ms); pending = fn; },
  });
  await sync.fetchGuarded();
  for (let i = 0; i < 7; i++) { const fn = pending; pending = null; fn(); await tick(2); }
  assert.deepEqual(delays, [2000, 4000, 8000, 16000, 30000, 30000, 30000, 30000]);
  fail = false;
  { const fn = pending; pending = null; fn(); await tick(2); }
  fail = true;
  delays.length = 0;
  await sync.fetchGuarded();
  assert.deepEqual(delays, [2000], "po udanym odczycie znowu od 2 s");
});
