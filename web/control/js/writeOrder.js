// js/writeOrder.js
// Kolejka zapisów Control (store.js): potwierdzenie STARSZEGO zapisu nie może
// nadpisać lokalnego stanu, gdy w kolejce czeka już nowszy zapis. Zgłoszone
// (e2e control2 :144, 2026-10-23): przełączniki na kroku Urządzenia zapisują
// stan, operator od razu klika „Dalej”, a odpowiedź wcześniejszego zapisu
// cofała krok na „Urządzenia” do czasu zapisu „Dalej” — przy wolnym albo
// nieudanym zapisie na stałe.

export function createWriteOrder() {
  let pending = 0;
  return {
    enqueue() { pending += 1; },
    settle() { pending = Math.max(0, pending - 1); },
    // Wywoływane w trakcie bieżącego zapisu (liczy się on sam).
    newerQueued() { return pending > 1; },
    // Jakikolwiek zapis w toku lub w kolejce (app.js: nie dociągaj wtedy
    // cudzego stanu z migawki — to zwykle nasz własny, jeszcze niepotwierdzony).
    pending() { return pending > 0; },
  };
}

// Wiersz po potwierdzeniu starszego zapisu: lokalny (nowszy) stan zostaje,
// z serwera tylko rewizja (expectedRev następnego zapisu) i blokada.
export function confirmedRevisionOnly(localRow, serverRow) {
  const { __target_rev: _target, ...local } = localRow || {};
  return { ...local, rev: serverRow.rev, locked_until: serverRow.locked_until ?? null };
}

// Wiersz z RPC metadanej (język, wyciszenie — poza kolejką zapisów) zastępuje
// stan tylko, gdy żaden własny zapis nie jest w toku ani w kolejce; inaczej
// cofnąłby lokalne, jeszcze niepotwierdzone zmiany.
export function metadataRowApplies(order) {
  return !order.pending();
}
