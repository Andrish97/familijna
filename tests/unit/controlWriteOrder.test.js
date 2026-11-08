import { test } from "node:test";
import assert from "node:assert/strict";
import { createWriteOrder, confirmedRevisionOnly } from "../../web/control/js/writeOrder.js";

test("nowszy zapis w kolejce jest widoczny tylko, gdy czeka coś poza bieżącym", () => {
  const order = createWriteOrder();
  order.enqueue();
  assert.equal(order.newerQueued(), false);
  order.enqueue();
  assert.equal(order.newerQueued(), true);
  order.settle();
  assert.equal(order.newerQueued(), false);
  order.settle(); order.settle();
  order.enqueue();
  assert.equal(order.newerQueued(), false, "licznik nie schodzi poniżej zera");
});

test("potwierdzenie starszego zapisu bierze z serwera tylko rewizję i blokadę", () => {
  const local = { rev: 3, step: "setup_finish", top_card: "devices", detail: { a: 1 } };
  const server = { rev: 4, step: "devices_display", top_card: "devices", locked_until: "2026-10-23T14:00:00Z", detail: { a: 0 } };
  assert.deepEqual(confirmedRevisionOnly(local, server), {
    rev: 4, step: "setup_finish", top_card: "devices", detail: { a: 1 }, locked_until: "2026-10-23T14:00:00Z",
  });
});

test("potwierdzenie starszego zapisu nie przenosi rewizji docelowej wiersza optymistycznego", () => {
  const local = { rev: 3, step: "r_play", sound_cue_seq: 7, __target_rev: 4 };
  const confirmed = confirmedRevisionOnly(local, { rev: 4, locked_until: null });
  assert.equal(confirmed.rev, 4);
  assert.equal("__target_rev" in confirmed, false, "pomiar planszy liczy od potwierdzonej rewizji");
});

test("pending() widzi każdy zapis w toku lub w kolejce", () => {
  const order = createWriteOrder();
  assert.equal(order.pending(), false);
  order.enqueue();
  assert.equal(order.pending(), true);
  order.settle();
  assert.equal(order.pending(), false);
});

test("wiersz z RPC metadanej (język, wyciszenie) nie zastępuje stanu w trakcie własnego zapisu", async () => {
  const { metadataRowApplies } = await import("../../web/control/js/writeOrder.js");
  const order = createWriteOrder();
  assert.equal(metadataRowApplies(order), true);
  order.enqueue();
  assert.equal(metadataRowApplies(order), false, "zapis „Przycisk fizyczny” w toku — flaga nie może wrócić z wiersza języka");
  order.settle();
  assert.equal(metadataRowApplies(order), true);
});
