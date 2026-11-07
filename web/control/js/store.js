// control/js/store.js
// Ten sam kształt co dzisiejszy control/js/store.js (state + emit()/
// subscribe()), ale hydrate() NAPRAWDĘ wznawia stan z public.game_state
// zamiast bezwarunkowo go kasować (control/js/store.js:338-343 — "Stan gry
// nie jest przywracany między sesjami"). To jest dokładnie ta luka, którą
// cała przebudowa ma zamknąć.
//
// Obecność urządzeń (kto jest online) celowo NIE wchodzi do tego stanu —
// zostaje w public.device_presence (osobny, częsty polling), reużyty bez
// zmian przez control/js/presence.js. Ten store trzyma wyłącznie to, co
// jest decyzją/faktem o samej grze (plan, sekcja 2 "0.").
//
// gameRounds.js/gameFinal.js NIE importują tego pliku — dostają store przez
// wstrzyknięcie zależności (ten sam wzorzec co dzisiejsze createRounds/
// createFinal), więc dają się testować w gołym Node z atrapą store.

import { sb } from "../../shared/js/core/supabase.js?v=v2026-11-07T22371";
import { createPersist, StaleWriteError } from "./persist.js?v=v2026-11-07T22371";
import { makeDefaultState, DEFAULT_SETTINGS, PERSISTED_KEYS } from "../../shared/js/gameplay/gameStateShape.js?v=v2026-11-07T22371";
import { expiredTimerOnHydrate } from "./timerResume.js?v=v2026-11-07T22371";
import { createWriteOrder, confirmedRevisionOnly } from "./writeOrder.js?v=v2026-11-07T22371";
import { sortAnswersByPoints } from "../../shared/js/core/answer-order.js?v=v2026-11-07T22371";


// Zapis wystarczy: baza sama wysyła nowy wiersz urządzeniom i Control
// (prywatne kanały, migracje 508–510) — bez dzwonków.

export { StaleWriteError, makeDefaultState, DEFAULT_SETTINGS };

function buildDetail(state) {
  const detail = {};
  for (const key of PERSISTED_KEYS) detail[key] = state[key];
  return detail;
}

export { expiredTimerOnHydrate };

export function createStore(gameId) {
  const listeners = new Set();
  const state = makeDefaultState(gameId);
  const persist = createPersist(gameId);

  function emit() {
    for (const fn of listeners) fn(state);
  }

  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  function applyRow(row) {
    if (!row) return;
    // Surowy wiersz z bazy (rev/step/phase/... w snake_case), obok stanu
    // camelCase powyżej — soundReactor.js diffuje TO pole przez
    // web/js/gameplay/deriveEvents.js (które oczekuje kształtu wiersza game_state,
    // nie zrzutowanego camelCase stanu). Prywatne, nie część PERSISTED_KEYS.
    state.__row = row;
    state.rev = row.rev ?? 0;
    state.topCard = row.top_card;
    state.step = row.step;
    state.phase = row.phase ?? null;
    state.controlTeam = row.control_team ?? null;
    state.soundCueKey = row.sound_cue_key ?? null;
    state.soundCueSeq = row.sound_cue_seq ?? 0;

    const d = row.detail || {};
    for (const key of PERSISTED_KEYS) {
      if (d[key] !== undefined) state[key] = d[key];
    }
    // Stare game_state wiersze mogą nadal mieć odpowiedzi w kolejności ord.
    // Uporządkujemy wyłącznie tablice do prezentacji; zapisane ord zostaje
    // bez zmian i nadal identyfikuje akcje odsłaniania oraz dopasowania.
    if (Array.isArray(state.rounds?.answers)) {
      state.rounds.answers = sortAnswersByPoints(state.rounds.answers);
    }
    for (const question of state.final?.questions || []) {
      if (Array.isArray(question?.answers)) question.answers = sortAnswersByPoints(question.answers);
    }
  }

  // ---- prawdziwe wznowienie ----
  async function hydrate() {
    const { data, error } = await sb()
      .from("game_state")
      .select("*")
      .eq("game_id", gameId)
      .maybeSingle();
    if (error) {
      console.warn("[store] hydrate: nie udało się odczytać game_state", error);
      return null;
    }
    if (!data) return null; // nowa gra, Control jeszcze nigdy nic nie zapisał
    applyRow(data);
    emit();
    return expiredTimerOnHydrate(state);
  }

  // Zserializowane — engine.js's dispatch() serializuje WŁASNE wywołania, ale
  // to nie jedyny wywołujący commit(): app.js's proste ustawienia (checkboxy
  // "Bez tabletu prowadzącego"/"Fizyczny przycisk", QR na Wyświetlaczu,
  // wyciszenie...) wołają store.commit() WPROST, z pominięciem tej kolejki —
  // zgłoszony na żywo dowód (szybkie odznaczanie/zaznaczanie checkboxa
  // urządzeń): "Błąd: stale_write" wyskakujący operatorowi jako goły alert.
  // Dwa (albo więcej) commit() wystrzelone bez odczekania na siebie ścigają
  // się o ten sam `rev` — retry-po-stale_write niżej jest tylko JEDNORAZOWY,
  // więc trzeci nakładający się zapis i tak by przegrał. Kolejka tutaj (ten
  // sam wzorzec co engine.js's dispatch()) gwarantuje, że KAŻDY zapis do
  // game_state — z dowolnego miejsca w appce, nie tylko z silnika reguł gry —
  // w pełni się kończy, zanim zacznie się następny, więc dwa commit() nigdy
  // nie widzą tego samego `rev` naraz.
  //
  // Payload budowany TU, SYNCHRONICZNIE, od razu przy wywołaniu commit() —
  // NIE leniwie dopiero w commitNow() (które czeka w kolejce, czasem setki
  // ms). Bez tego dwa commit() wystrzelone blisko siebie z RÓŻNYCH źródeł
  // (np. dwa checkboxy urządzeń, dwa suwaki głośności, "Losuj ponownie" dla
  // rund i finału) mogły złapać się nawzajem w locie: payload budowany
  // leniwie, dopiero gdy przyszła kolej w kolejce, czytał state.settings/
  // rounds/final PO TYM, jak applyRow() z WCZEŚNIEJSZEGO, już potwierdzonego
  // zapisu zdążyło nadpisać state TYMI SAMYMI polami z serwera (które go
  // jeszcze nie znały) — co bezpowrotnie kasowało nowszą, jeszcze
  // niewysłaną lokalną zmianę, zanim ten drugi zapis w ogóle zdążył ją
  // wysłać. Zgłoszone na żywo (control2.spec.js's test "physicalBuzzer +
  // noHostTablet"): oba checkboxy zaznaczone szybko po sobie, druga flaga
  // nigdy nie docierała do bazy — bez żadnego błędu, wyglądało jak "nic się
  // nie odświeża". `detail` musi być PRAWDZIWĄ, głęboką kopią
  // (structuredClone) — PERSISTED_KEYS to zagnieżdżone obiekty (settings/
  // rounds/final/...), płytkie przypisanie (buildDetail sam w sobie) dzieli
  // te same referencje z `state`, więc późniejsza mutacja i tak przeciekałaby
  // do już "zbudowanego" payloadu, unieważniając cały ten fix.
  let _writeQueue = Promise.resolve();
  const writeOrder = createWriteOrder();
  // Potwierdzony wiersz: pełne zastosowanie tylko, gdy nie czeka nowszy zapis
  // (writeOrder.js) — inaczej lokalny, nowszy stan zostaje, a z serwera
  // bierzemy rewizję i blokadę.
  function applyConfirmed(row) {
    if (writeOrder.newerQueued()) {
      state.rev = row.rev ?? state.rev;
      state.__row = confirmedRevisionOnly(state.__row, row);
    } else {
      applyRow(row);
    }
  }
  function enqueueWrite(run) {
    writeOrder.enqueue();
    const settled = () => run().finally(() => writeOrder.settle());
    const result = _writeQueue.then(settled, settled);
    _writeQueue = result.catch(() => {});
    return result;
  }
  function commit({ soundCueKey, lockMs } = {}) {
    const payload = {
      step: state.step,
      topCard: state.topCard,
      phase: state.phase,
      controlTeam: state.controlTeam,
      soundCueKey: soundCueKey ?? null,
      lockMs: lockMs == null ? null : Math.ceil(lockMs),
      detail: structuredClone(buildDetail(state)),
    };
    return enqueueWrite(() => commitNow(payload));
  }

  // ---- zapis: pełny wiersz, synchronicznie potwierdzony (plan, sekcja 4) ----
  // payload: zbudowany i zamrożony PRZEZ commit() wyżej, synchronicznie, w
  // momencie wywołania -- nie tutaj (patrz komentarz przy commit()).
  async function commitNow(payload) {
    // Dźwięk (soundReactor.js) i "dzwonek" budzący Wyświetlacz siedziały
    // dotąd za TYM SAMYM emit() — dopiero po pełnym network round-tripie
    // niżej. Dzwonek zostaje tam (Wyświetlacz i tak musi doczytać
    // POTWIERDZONY wiersz przez RPC, wcześniejszy dzwonek byłby pusty),
    // ale dźwięk grał zauważalnie później niż plansza na Wyświetlaczu —
    // zgłoszone, zaakceptowane świadomie jako kompromis: rozgłoś OD RAZU
    // (emit() niżej, PRZED await) optymistyczny wiersz zbudowany z już
    // zmutowanego lokalnie stanu (reducer w engine.js's dispatchNow()
    // ustawia store.state.step/phase/... PRZED wywołaniem commit() —
    // "optymistyczny" znaczy tu wyłącznie "jeszcze niepotwierdzony przez
    // serwer", nie "zgadywany"). sound_cue_seq liczony 1:1 wg tej samej
    // reguły co SQL (game_state_write, migracja 263: rośnie przy KAŻDYM
    // zapisie z niepustym soundCueKey, NIE tylko gdy klucz różni się od
    // poprzedniego — dwa różne zdarzenia w grze, np. dwa trafienia z rzędu,
    // często dzielą ten sam klucz "answer_correct"/"answer_wrong", a mimo to
    // każde z nich ma zagrać dźwięk osobno; migracja 260 tego nie robiła,
    // co gubiło dźwięk przy drugim z pary — patrz komentarz w migracji 263)
    // — więc druga, prawdziwa notyfikacja po potwierdzeniu zwykle nie
    // znajdzie już nic nowego (ten sam seq) i nie zagra drugi raz. W rzadkim
    // przegranym wyścigu z Buzzerem (StaleWriteError niżej) ten wiersz
    // zostanie skorygowany przez hydrate() — zaakceptowane ryzyko, nie błąd.
    const newKey = payload.soundCueKey;
    const optimisticKey = newKey ?? state.soundCueKey;
    const optimisticSeq = newKey != null ? (state.soundCueSeq || 0) + 1 : (state.soundCueSeq || 0);
    state.__row = {
      ...state.__row,
      top_card: payload.topCard,
      step: payload.step,
      phase: payload.phase,
      control_team: payload.controlTeam,
      sound_cue_key: optimisticKey,
      sound_cue_seq: optimisticSeq,
      detail: payload.detail,
      // Rewizja, którą nada serwer (game_state_write: rev + 1 przy zgodnym
      // expectedRev). Pomiar potwierdzenia planszy w app.js liczy od niej.
      __target_rev: (state.rev || 0) + 1,
    };
    state.soundCueKey = optimisticKey;
    state.soundCueSeq = optimisticSeq;
    emit();

    // TYMCZASOWA diagnostyka (do usunięcia po znalezieniu przyczyny
    // "Zatrzymaj"/"X" trwale disabled w control2.spec.js) -- czy
    // persist.write() w ogóle się rozstrzyga, i w jakim czasie, w ramach
    // _writeQueue (ta sama kolejka co setLock() niżej -- jeśli COKOLWIEK
    // tu zawiśnie, wszystko za nim w kolejce, włącznie z setLock(), nigdy
    // nie dostanie swojej kolejki).
    async function attempt() {
      const _t0 = Date.now();
      console.log(`[e2e-diag-state] t=${_t0} commitNow.attempt START step=${payload.step} expectedRev=${state.rev}`);
      const row = await persist.write({ ...payload, expectedRev: state.rev });
      console.log(`[e2e-diag-state] t=${Date.now()} commitNow.attempt WRITE-OK afterMs=${Date.now() - _t0} newRev=${row.rev}`);
      applyConfirmed(row);
      emit();
      return row;
    }

    try {
      return await attempt();
    } catch (e) {
      console.log(`[e2e-diag-state] t=${Date.now()} commitNow.attempt THREW: ${e?.constructor?.name} ${e?.message}`);
      if (!(e instanceof StaleWriteError)) throw e;
      // Warstwa 2 (familijna-server/docs/plan-testy-i-poprawki.md) zrobiła dokładnie to, co
      // powinna — ktoś inny zdążył podbić rev pierwszy, zanim nasz zapis
      // dotarł. Odkąd commit() (wyżej) serializuje WSZYSTKIE własne
      // wywołania niezależnie od tego, skąd przyszły, jedyny realny "ktoś
      // inny" to Buzzer (game_state_buzzer_press, zapis z pominięciem tego
      // store'a — patrz plan, sekcja 1/4). Zamiast twardego błędu operatorowi: doczytaj
      // świeży wiersz (hydrate aktualizuje state.rev, w tym wszystko inne co
      // się zmieniło) i spróbuj RAZ jeszcze DOKŁADNIE tę samą, zamierzoną
      // zmianę z nowym rev — dokładnie ten "bezpieczny retry" z planu,
      // wcześniej opisany ale nigdy nie zaimplementowany.
      await hydrate();
      return await attempt();
    }
  }

  // Migracja 264 — ustawia game_state.locked_until w bazie, PO
  // potwierdzeniu głównego zapisu (wołający liczy `ms` z POTWIERDZONEGO
  // sound_cue_key, dokładnie jak dziś dla klienckiego lockedUntil w
  // control/js/app.js). Przez tę samą kolejkę co commit() — żeby nigdy
  // nie wyścigał się z kolejnym, prawdziwym zapisem treści.
  function setLock(ms) {
    // TYMCZASOWA diagnostyka -- patrz komentarz przy commitNow.attempt().
    // Loguje MOMENT WEJŚCIA DO KOLEJKI (przed .then), żeby było widać, czy
    // setLock() w ogóle zdąża dostać swoją kolej w _writeQueue, czy czeka
    // za czymś, co nigdy się nie rozstrzyga.
    console.log(`[e2e-diag-state] t=${Date.now()} setLock ENQUEUE ms=${ms}`);
    return enqueueWrite(() => setLockNow(ms));
  }

  async function setLockNow(ms) {
    const _t0 = Date.now();
    console.log(`[e2e-diag-state] t=${_t0} setLockNow START ms=${ms} expectedRev=${state.rev}`);
    try {
      // p_lock_ms jest w bazie typu integer -- realny czas dźwięku (z
      // metadanych pliku mp3, control/js/actionGate.js's timing.dur())
      // przychodzi jako float z ułamkiem ms (np. 19751.995), co Postgres
      // odrzuca (22P02 invalid input syntax for type integer). Zaokrąglenie
      // o ~1ms nie ma znaczenia dla samej blokady.
      let row;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          row = await persist.setLock({ expectedRev: state.rev, lockMs: Math.round(ms) });
          break;
        } catch (error) {
          if (ms !== 0 || !(error instanceof StaleWriteError) || attempt === 2) throw error;
          await hydrate();
        }
      }
      console.log(`[e2e-diag-state] t=${Date.now()} setLockNow OK afterMs=${Date.now() - _t0} newRev=${row.rev}`);
      applyConfirmed(row);
      emit();
    } catch (e) {
      console.log(`[e2e-diag-state] t=${Date.now()} setLockNow CATCH afterMs=${Date.now() - _t0}: ${e?.constructor?.name} ${e?.message}`);
      // Restart requires a confirmed unlock; never silently proceed while locked.
      if (ms === 0) throw e;
      // Najlepszy wysiłek — treść stanu jest już poprawnie zapisana przez
      // wcześniejszy commit(), tylko serwerowa blokada się nie ustawiła
      // (np. rev już nieaktualny, bo coś innego zdążyło napisać pierwsze).
      // Klencki lockedUntil (control/js/app.js) działa niezależnie, więc
      // to nie jest błąd, który operator musi widzieć jako alert.
      console.warn("[store] setLock nie powiodło się (nieszkodliwe):", e);
    }
  }

  // Migracja 267 — WYŁĄCZNIE detail.settings.uiLang, przez osobne, lekkie
  // RPC (persist.setUiLang), celowo NIE przez _writeQueue/commit(): język
  // operatora jest metadaną niezależną od reszty rozgrywki (zgłoszone: nie
  // ma czekać w kolejce na koniec dźwięku/animacji trwającej akcji gry —
  // w przeciwieństwie do commit()/setLock() ta funkcja świadomie omija
  // zarówno kolejkę, jak i serwerowy locked_until, patrz komentarz w
  // migracji i w persist.js).
  async function setUiLang(lang) {
    state.settings.uiLang = lang;
    emit();
    const row = await persist.setUiLang(lang);
    applyRow(row);
    emit();
  }

  // Migracja 268 -- ten sam wzorzec co setUiLang() wyżej, dla
  // detail.settings.soundMuted (patrz komentarz w persist.js/migracji).
  async function setSoundMuted(muted) {
    state.settings.soundMuted = muted;
    emit();
    const row = await persist.setSoundMuted(muted);
    applyRow(row);
    emit();
  }

  // Cudzy wiersz z kanału Control (naciśnięcie Przycisku, zdarzenie state):
  // tylko nowszy niż znany i nie w trakcie własnego zapisu (jego odpowiedź
  // niesie już stan; wiadomość nowsza od niej sprawdza wołający po
  // whenIdle()). Zwraca wygasłe timery jak hydrate().
  function applyExternalRow(row) {
    if (!row || !(Number(row.rev) > Number(state.rev)) || writeOrder.pending()) return null;
    applyRow(row);
    emit();
    return expiredTimerOnHydrate(state);
  }
  const whenIdle = () => _writeQueue.then(() => {});

  return { state, subscribe, emit, hydrate, commit, setLock, setUiLang, setSoundMuted, applyRow, applyExternalRow, whenIdle, writing: () => writeOrder.pending() };
}
