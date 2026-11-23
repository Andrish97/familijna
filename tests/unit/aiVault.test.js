// E30: sejf kluczy AI (web/shared/js/ai/vault.js) — szyfrowanie w przeglądarce,
// baza widzi tylko szyfrogram; atrapy serwera i pamięci urządzenia.
import test from "node:test";
import assert from "node:assert/strict";
import { createVault } from "../../web/shared/js/ai/vault.js";

function fakeRemote() {
  let row = null;
  return { get: async () => (row ? structuredClone(row) : null), save: async (r) => { row = structuredClone(r); }, remove: async () => { row = null; }, peek: () => row };
}
function fakeDevice() {
  const m = new Map();
  return { get: async (a) => m.get(a) || null, put: async (a, k) => { m.set(a, k); }, forget: async (a) => { m.delete(a); } };
}
const opts = (remote, device = fakeDevice()) => ({ remote, account: "u1", device, iterations: 1000 });

test("sejf: założenie, klucze, aktywny, lista bez wartości, szyfrogram w bazie", async () => {
  const remote = fakeRemote();
  const v = createVault(opts(remote));
  assert.equal(await v.status(), "none");
  await assert.rejects(v.create("krótkie"), (e) => e.code === "password_too_short");
  await v.create("hasło-do-kluczy");
  assert.equal(await v.status(), "open");
  const a = await v.add({ label: "Praca", provider: "anthropic", key: "sk-ant-SECRET-1234" });
  const b = await v.add({ label: "Dom", provider: "gemini", model: "gemini-3-flash", key: "AIza-SECRET-9876" });
  assert.equal(v.active().id, a, "pierwszy dodany jest aktywny");
  await v.setActive(b);
  assert.equal(v.active().key, "AIza-SECRET-9876");
  const list = v.list();
  assert.equal(list.active, b);
  assert.deepEqual(list.keys.map((x) => [x.label, x.provider, x.last4]), [["Praca", "anthropic", "1234"], ["Dom", "gemini", "9876"]]);
  assert.ok(list.keys.every((x) => !("key" in x)), "lista nie zawiera wartości klucza");
  const stored = JSON.stringify(remote.peek());
  assert.ok(!stored.includes("SECRET") && !stored.includes("Praca"), "w bazie tylko szyfrogram");
  await v.remove(b);
  assert.equal(v.active().id, a, "po usunięciu aktywnego aktywny jest pierwszy");
});

test("sejf: inne urządzenie wymaga hasła, złe hasło odrzucone, to samo urządzenie pamięta", async () => {
  const remote = fakeRemote();
  const device = fakeDevice();
  const v = createVault(opts(remote, device));
  await v.create("hasło-do-kluczy");
  await v.add({ provider: "openai", key: "sk-123456" });

  const sameDevice = createVault(opts(remote, device));
  assert.equal(await sameDevice.status(), "open");
  assert.equal(sameDevice.active().key, "sk-123456");

  const other = createVault(opts(remote));
  assert.equal(await other.status(), "locked");
  assert.equal(other.active(), null);
  await assert.rejects(other.unlock("złe-hasło-x"), (e) => e.code === "wrong_password");
  await other.unlock("hasło-do-kluczy");
  assert.equal(other.active().key, "sk-123456");

  await other.lock();
  assert.equal(await createVault(opts(remote)).status(), "locked");
  await other.destroy();
  assert.equal(remote.peek(), null);
});
