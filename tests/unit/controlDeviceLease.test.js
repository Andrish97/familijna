import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../../web/shared/js/core/device-lease.js", import.meta.url), "utf8")
  .replace(/^import .*;$/gm, "")
  .replace(/export function/g, "function");

// Atrapy modułów diagnostyki sesji (session-log.js, keep-alive.js).
function sessionLogStubs(sink = { events: [], options: null }) {
  return {
    createSessionLog(options) {
      sink.options = options;
      return { push: event => sink.events.push(event), flush: async () => {}, flushOnExit() {}, stop() {} };
    },
    collectDeviceInfo: async () => ({ event_type: "device_info", device_class: "phone" }),
    watchPageLifecycle: () => () => {},
    watchRuntimeErrors: () => () => {},
    onWakeLockChange: () => () => {},
  };
}

test("lease wygasły po wznowieniu karty rejestruje nową instancję i odzyskuje primary", async () => {
  const calls = [];
  const listeners = new Map();
  const timers = new Map();
  let nextId = 0;
  let nextHeartbeat = null;
  const responses = {
    control_device_instance_register: { mode: "lease", state: "primary", epoch: 1 },
  };
  const client = {
    rpc(name, params) {
      calls.push({ name, params });
      const response = name === "control_device_instance_heartbeat"
        ? nextHeartbeat
        : responses[name];
      return { abortSignal: async () => ({ data: response, error: null }) };
    },
  };
  const context = {
    sb: () => client,
    t: key => key,
    document: {
      visibilityState: "visible", hasFocus: () => true,
      addEventListener() {}, removeEventListener() {}, getElementById: () => null,
    },
    window: {
      addEventListener(name, fn) { listeners.set(name, fn); },
      removeEventListener(name) { listeners.delete(name); },
    },
    crypto: { randomUUID: () => `connection-${++nextId}` },
    AbortSignal,
    getDevicePresenceMeta: () => ({}),
    ...sessionLogStubs(), navigator: { onLine: true },
    startTicker(fn, ms) { timers.set(ms, fn); return () => timers.delete(ms); },
  };
  const create = vm.runInNewContext(`${source}; createDeviceLease;`, context);
  const lease = create({ gameId: "game", deviceType: "host", key: "key" });
  await lease.start();
  const originalId = lease.connectionId;

  nextHeartbeat = { mode: "lease", state: "expired", epoch: null };
  responses.control_device_instance_register = { mode: "lease", state: "primary", epoch: 3 };
  listeners.get("focus")();
  await new Promise(resolve => setImmediate(resolve));

  assert.deepEqual(calls.map(call => call.name), [
    "control_device_instance_register",
    "control_device_instance_heartbeat",
    "control_device_instance_register",
  ]);
  assert.notEqual(lease.connectionId, originalId);
  assert.equal(calls[1].params.p_connection_id, originalId);
  assert.equal(calls[2].params.p_connection_id, lease.connectionId);
  assert.equal(lease.actionArgs().p_connection_id, lease.connectionId);
  assert.equal(lease.actionArgs().p_epoch, 3);
  lease.stop();
  assert.equal(listeners.has("focus"), false);
  assert.equal(listeners.has("online"), false);
  assert.equal(timers.size, 0);
});

test("dziennik sesji urządzenia: start instancji głównej, parametry lease i czas w tle przy powrocie", async () => {
  const sink = { events: [], options: null };
  const docListeners = new Map();
  const doc = {
    visibilityState: "visible", hasFocus: () => true, wasDiscarded: false,
    addEventListener(name, fn) { docListeners.set(name, fn); }, removeEventListener() {}, getElementById: () => null,
  };
  const client = { rpc() { return { abortSignal: async () => ({ data: { mode: "lease", state: "primary", epoch: 5 }, error: null }) }; } };
  const context = {
    sb: () => client, t: key => key, document: doc, navigator: { onLine: true },
    window: { addEventListener() {}, removeEventListener() {} },
    crypto: { randomUUID: () => "connection-log" }, AbortSignal, Date,
    getDevicePresenceMeta: () => ({}), startTicker: () => () => {}, ...sessionLogStubs(sink),
  };
  const create = vm.runInNewContext(`${source}; createDeviceLease;`, context);
  const lease = create({ gameId: "game", deviceType: "display", key: "key" });
  await lease.start();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(sink.options.rpc, "control2_device_log");
  assert.equal(sink.options.canSend(), true);
  assert.deepEqual(JSON.parse(JSON.stringify(sink.options.params())), {
    p_game_id: "game", p_device_type: "display", p_key: "key", p_connection_id: "connection-log", p_epoch: 5,
  });
  assert.deepEqual(sink.events.map(event => event.event_type), ["page_state", "device_info"]);
  assert.equal(sink.events[0].reason, "initial");
  doc.visibilityState = "hidden";
  docListeners.get("visibilitychange")();
  doc.visibilityState = "visible";
  docListeners.get("visibilitychange")();
  const back = sink.events.at(-1);
  assert.equal(back.visibility, "visible");
  assert.equal(typeof back.hidden_duration_ms, "number");
  assert.equal(typeof back.since_heartbeat_ms, "number");
  lease.log({ event_type: "runtime_error", phase: "render" });
  assert.equal(sink.events.at(-1).event_type, "runtime_error");
  lease.stop();
});

test("refresh() po powrocie karty czeka na heartbeat w toku i zwraca nową rolę (bez drugiego żądania)", async () => {
  const calls = [];
  let release;
  let response = { mode: "lease", state: "primary", epoch: 1 };
  const client = {
    rpc(name) {
      calls.push(name);
      return { abortSignal: async () => {
        if (name === "control_device_instance_heartbeat") await new Promise(resolve => { release = resolve; });
        return { data: response, error: null };
      } };
    },
  };
  const context = {
    sb: () => client, t: key => key,
    document: { visibilityState: "visible", hasFocus: () => true, addEventListener() {}, removeEventListener() {}, getElementById: () => null },
    window: { addEventListener() {}, removeEventListener() {} },
    crypto: { randomUUID: () => "connection-r" }, AbortSignal,
    getDevicePresenceMeta: () => ({}), startTicker: () => () => {}, ...sessionLogStubs(), navigator: { onLine: true },
  };
  const create = vm.runInNewContext(`${source}; createDeviceLease;`, context);
  const lease = create({ gameId: "game", deviceType: "buzzer", key: "key" });
  await lease.start();
  lease.setMeta({});
  await new Promise(resolve => setImmediate(resolve));
  response = { mode: "lease", state: "waiting", epoch: null };
  let settled = null;
  const refreshed = lease.refresh().then(state => { settled = state; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(settled, null, "czeka na heartbeat w toku");
  release();
  await refreshed;
  assert.equal(settled, "waiting");
  assert.deepEqual(calls, ["control_device_instance_register", "control_device_instance_heartbeat"]);
  lease.stop();
});

test("heartbeat z wyjątkiem connection_expired (baza oznaczyła połączenie jako wygasłe) rejestruje nową instancję", async () => {
  const calls = [];
  let heartbeatError = null;
  let registerEpoch = 1;
  const client = {
    rpc(name, params) {
      calls.push({ name, params });
      return { abortSignal: async () => name === "control_device_instance_heartbeat"
        ? { data: null, error: heartbeatError }
        : { data: { mode: "lease", state: "primary", epoch: registerEpoch }, error: null } };
    },
  };
  const listeners = new Map();
  let nextId = 0;
  const context = {
    sb: () => client, t: key => key,
    document: { visibilityState: "visible", hasFocus: () => true, addEventListener() {}, removeEventListener() {}, getElementById: () => null },
    window: { addEventListener(name, fn) { listeners.set(name, fn); }, removeEventListener() {} },
    crypto: { randomUUID: () => `connection-${++nextId}` }, AbortSignal,
    getDevicePresenceMeta: () => ({}), startTicker: () => () => {}, ...sessionLogStubs(), navigator: { onLine: true },
  };
  const create = vm.runInNewContext(`${source}; createDeviceLease;`, context);
  const lease = create({ gameId: "game", deviceType: "display", key: "key" });
  await lease.start();
  const originalId = lease.connectionId;

  heartbeatError = { message: "connection_expired", code: "P0001" };
  registerEpoch = 4;
  listeners.get("focus")();
  await new Promise(resolve => setImmediate(resolve));

  assert.deepEqual(calls.map(call => call.name), [
    "control_device_instance_register",
    "control_device_instance_heartbeat",
    "control_device_instance_register",
  ]);
  assert.notEqual(lease.connectionId, originalId);
  assert.equal(calls[2].params.p_connection_id, lease.connectionId);
  assert.equal(calls[2].params.p_meta.takeover, undefined, "bez przejęcia — kolejka jak przy wznowieniu");
  assert.equal(lease.state, "primary");
  assert.equal(lease.actionArgs().p_epoch, 4);

  // Inny błąd (np. limit czasu) nie zmienia połączenia.
  heartbeatError = { message: "TimeoutError" };
  const idBefore = lease.connectionId;
  listeners.get("focus")();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(lease.connectionId, idBefore);
  assert.equal(lease.state, "unavailable");
  lease.stop();
});
