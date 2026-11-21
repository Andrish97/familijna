// js/core/game-state-sync.js
// Monotoniczny, serializowany odbiór wierszy stanu gry: z kanału z bazy
// (applyRow, game-state-subscribe.js) i z odczytów RPC przy starcie oraz po
// ponownym dołączeniu (fetchGuarded). Nieudany odczyt planuje ponowną próbę,
// a zawieszone żądanie przerywa limit czasu po stronie fetchRow.

const MAX_RETRY_MS = 30_000;

export function createRowSync({ fetchRow, onRow, onError, onProgress = null, onReadStatus = null, retryMs = 2000, sameRevChanged = null, setTimer = setTimeout, now = () => globalThis.performance?.now?.() ?? Date.now() }) {
  let lastRev = -1;
  let lastRow = null;
  let fetching = false;
  let pendingRefetch = false;
  let pendingRow = null;
  let retryScheduled = false;

  function isNewer(data, baseRev = lastRev, baseRow = lastRow) {
    if (data.rev > baseRev) return true;
    // Opcjonalnie: ten sam rev, ale zmieniło się pole zapisywane bez podbicia
    // rev (game_state_set_lock zmienia tylko locked_until).
    return data.rev === baseRev && !!baseRow && !!sameRevChanged && sameRevChanged(baseRow, data);
  }

  function newerThanPending(data) {
    return !pendingRow || isNewer(data, pendingRow.row.rev, pendingRow.row);
  }

  async function acceptRow(data, source = "rpc", receivedAt = now(), fetchMs = 0) {
    if (!data || !isNewer(data)) return false;
    const previousRev = lastRev;
    lastRev = data.rev;
    lastRow = data;
    let renderError = null;
    const appliedAt = now();
    try {
      await onRow(data, source);
    } catch (error) {
      // AbortError = obsługę wiersza przerwał nowszy stan (tak samo traktuje
      // go kolejka renderu Wyświetlacza) — to nie błąd renderu (eksport 25.10:
      // fałszywe render_error z render_ms 0).
      if (error?.name !== "AbortError") {
        renderError = error;
        console.warn("[game-state-sync] onRow rzucił wyjątek:", error);
      }
    }
    try {
      onProgress?.({
        row: data, source, previousRev, receivedMs: Math.max(0, Math.round(appliedAt - receivedAt)),
        fetchMs: Math.max(0, Math.round(fetchMs)), renderMs: Math.max(0, Math.round(now() - appliedAt)),
        renderError,
      });
    } catch (error) { console.warn("[game-state-sync] progress listener failed:", error); }
    return true;
  }

  function drainPending() {
    if (fetching) return;
    if (pendingRow) {
      const pending = pendingRow;
      pendingRow = null;
      fetching = true;
      void acceptRow(pending.row, pending.source, pending.receivedAt, 0).finally(() => {
        fetching = false;
        drainPending();
      });
      return;
    }
    if (pendingRefetch) {
      // Zakolejkowany odczyt zachowuje źródło (np. rpc_doorbell) — bez tego
      // seria dzwonków w finale dawała fallback_applied z trigger "rpc"
      // (eksport 29.10, 10:07–10:12).
      const source = pendingRefetch === true ? undefined : pendingRefetch;
      pendingRefetch = false;
      void fetchGuarded(source);
    }
  }

  // Kolejne nieudane odczyty: odstęp rośnie 2 s → 4 → 8 → … → 30 s (incydent
  // 21.11: karta po utracie dzierżawy odpytywała co 2 s bez końca, ~25 odmów/min).
  // Udany odczyt wraca do retryMs.
  let failedReads = 0;
  function scheduleRetry() {
    if (retryScheduled) return;
    retryScheduled = true;
    const delay = Math.min(MAX_RETRY_MS, retryMs * 2 ** Math.min(failedReads, 6));
    failedReads += 1;
    setTimer(() => { retryScheduled = false; fetchGuarded(); }, delay);
  }

  async function fetchOnce(source = "rpc") {
    const startedAt = now();
    let data;
    try {
      const res = await fetchRow();
      if (res.error) {
        onReadStatus?.({ ok: false, source, error: res.error, fetchMs: Math.max(0, Math.round(now() - startedAt)) });
        onError?.(res.error); scheduleRetry(); return;
      }
      data = res.data;
    } catch (error) {
      onReadStatus?.({ ok: false, source, error, fetchMs: Math.max(0, Math.round(now() - startedAt)) });
      onError?.(error);
      scheduleRetry();
      return;
    }
    failedReads = 0;
    onReadStatus?.({ ok: true, source, revision: Number(data?.rev), fetchMs: Math.max(0, Math.round(now() - startedAt)) });
    if (!data) return; // Control jeszcze nigdy nic nie zapisał dla tej gry
    await acceptRow(data, source, now(), Math.max(0, now() - startedAt)); // polling/bootstrap może nadrobić pominięty wiersz
  }

  async function fetchGuarded(source = "rpc") {
    if (fetching) { pendingRefetch = source; return; }
    fetching = true;
    try {
      await fetchOnce(source);
    } finally {
      fetching = false;
      drainPending();
    }
  }

  // Wiersz z Realtime lub odpowiedzi game_state_buzzer_press. Render jest
  // serializowany tak samo jak odpowiedź RPC; podczas animacji zachowujemy
  // tylko najnowszą odebraną rewizję.
  function applyRow(row, source = "broadcast") {
    if (!row || !isNewer(row)) return;
    const pending = { row, source, receivedAt: now() };
    if (fetching) {
      if (newerThanPending(row)) pendingRow = pending;
      return;
    }
    pendingRow = pending;
    drainPending();
  }

  function reset() {
    lastRev = -1;
    lastRow = null;
    pendingRow = null;
    pendingRefetch = false;
  }

  // receivedRev: najwyższa odebrana rewizja, także czekająca na koniec
  // animacji — porównanie z heartbeatem nie bierze jej za zgubioną.
  return { fetchGuarded, applyRow, reset, get lastRev() { return lastRev; },
    get receivedRev() { return Math.max(lastRev, pendingRow?.row.rev ?? -1); } };
}
