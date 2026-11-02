import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../../web/control/js/presence.js", import.meta.url), "utf8")
  .replace(/^import .*;$/m, "").replace("export function", "function");

test("jedna migawka control_devices_snapshot: flagi, dźwięk Wyświetlacza i blokada przy błędzie", async () => {
  let now = Date.now();
  let pendingResolve;
  let pending = false;
  const changes = [];
  const timers = new Map();
  const calls = [];
  const device = (extra = {}) => ({ primary_online: true, waiting_count: 0, last_seen_at: new Date(now).toISOString(),
    visibility: "visible", focused: true, audio_unlocked: false, meta: {}, ...extra });
  let snapshot = { ok: true, devices: { display: device(), host: device(), buzzer: device() } };
  let error = null;
  const client = {
    from() { throw new Error("Control czyta stan urządzeń wyłącznie migawką RPC"); },
    rpc(name, params) {
      calls.push(name);
      assert.equal(name, "control_devices_snapshot");
      assert.equal(params.p_game_id, "test");
      return { abortSignal: () => pending
        ? new Promise(resolve => { pendingResolve = resolve; })
        : Promise.resolve({ data: snapshot, error }) };
    },
  };
  const context = {
    sb: () => client, AbortSignal,
    Date: class extends Date { static now() { return now; } },
    setInterval: (fn, ms) => { timers.set(ms, fn); return ms; },
    clearInterval: ms => timers.delete(ms),
    document: { visibilityState: "visible", addEventListener() {}, removeEventListener() {} },
    window: { addEventListener() {}, removeEventListener() {} },
  };
  const create = vm.runInNewContext(`${source}; createPresence;`, context);
  const transient = [];
  const presence = create({ gameId: "test", onChange: event => changes.push(JSON.parse(JSON.stringify(event))), onTransientError: event => transient.push(event) });
  const settle = () => new Promise(resolve => setImmediate(resolve));
  presence.start();
  await settle();
  assert.deepEqual(changes.at(-1).flags, { display: true, host: true, buzzer: true });
  assert.equal(changes.at(-1).displayAudioUnlocked, false);
  assert.equal(changes.at(-1).deviceDiagnostics.display.ageMs, 0);
  assert.equal(changes.at(-1).deviceDiagnostics.display.visibility, "visible");

  const unchanged = changes.length;
  await presence.refresh();
  assert.equal(changes.length, unchanged, "bez zmian nie przerysowujemy panelu");

  snapshot = { ok: true, devices: { ...snapshot.devices, display: device({ audio_unlocked: true }) } };
  await presence.refresh();
  assert.equal(changes.at(-1).displayAudioUnlocked, true);

  snapshot = { ok: true, devices: { ...snapshot.devices, display: device({ primary_online: false, audio_unlocked: true }) } };
  await presence.refresh();
  assert.equal(changes.at(-1).flags.display, false);
  assert.equal(changes.at(-1).displayAudioUnlocked, false, "odblokowanie liczy się tylko dla aktywnej głównej instancji");

  snapshot = { ok: true, devices: { display: device(), host: device() } };
  await presence.refresh();
  assert.deepEqual(changes.at(-1).flags, { display: true, host: true, buzzer: false });

  pending = true;
  const beforePending = changes.length;
  timers.get(750)();
  assert.equal(changes.length, beforePending, "oczekiwanie na odczyt nie zgłasza rozłączenia");
  timers.get(750)();
  assert.equal(calls.length, 6, "kolejny odczyt nie startuje, póki poprzedni trwa");
  pendingResolve({ data: null, error: { code: "57014", message: "timeout" } });
  await settle();
  assert.equal(transient.length, 1, "pierwszy nieudany odczyt przy świeżej migawce trafia tylko do diagnostyki");
  assert.equal(changes.length, beforePending, "i nie blokuje gry");
  pending = false;
  error = { code: "57014", message: "timeout" };
  await presence.refresh();
  assert.equal(changes.at(-1).errorSource, "lease_status", "drugi nieudany odczyt z rzędu blokuje akcje");
  assert.deepEqual(changes.at(-1).flags, { display: true, host: true, buzzer: false },
    "przy błędzie zostaje ostatni stan, a Control blokuje akcje do poprawnego odczytu");

  error = null;
  await presence.refresh();
  assert.equal(changes.at(-1).error, null);
  presence.stop();
  assert.equal(timers.size, 0);
});

test("nieudany odczyt bez świeżej migawki blokuje od razu", async () => {
  let now = 1_000_000;
  let fail = false;
  const changes = [];
  const transient = [];
  const device = { primary_online: true, waiting_count: 0, last_seen_at: new Date(now).toISOString(), visibility: "visible", focused: true, meta: {} };
  const client = { rpc: () => ({ abortSignal: () => Promise.resolve(fail
    ? { data: null, error: null, status: 0 }
    : { data: { ok: true, devices: { display: device, host: device, buzzer: device } }, error: null }) }) };
  const context = {
    sb: () => client, AbortSignal,
    Date: class extends Date { static now() { return now; } },
    setInterval: () => 1, clearInterval: () => {},
    document: { visibilityState: "visible", addEventListener() {}, removeEventListener() {} },
    window: { addEventListener() {}, removeEventListener() {} },
  };
  const create = vm.runInNewContext(`${source}; createPresence;`, context);
  const presence = create({ gameId: "test", onChange: event => changes.push(event), onTransientError: event => transient.push(event) });
  await presence.refresh();
  fail = true;
  now += 11_000;
  await presence.refresh();
  assert.equal(transient.length, 0);
  assert.equal(changes.at(-1).errorSource, "status_read");
});
