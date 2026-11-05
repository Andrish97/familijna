// js/core/resource-lock.js
// Ogólna blokada "ten zasób jest edytowany gdzie indziej", wspólna dla
// całego projektu (edytor gry, ustawienia, ankieta, logo, baza pytań,
// rozgrywka) — jeden mechanizm zamiast osobnej implementacji per strona.
// Overlay skopiowany ze sprawdzonego wzorca device-guard.js/guest-mode.js,
// ale z treścią/przyciskami parametryzowanymi per wywołanie.
//
// Model (familijna-server/docs/blokady-zasobow.md, sekcja 8 — Realtime):
//  * Arbitrem jest baza: JEDNO wywołanie `acquire_edit_locks` zajmuje cały zestaw
//    zasobów strony (np. game:G wyłącznie + logos współdzielone) atomowo —
//    wszystko albo nic, w stałej kolejności; odnowienie i zwolnienie też jednym
//    wywołaniem. Wiersz w `edit_locks` wygasa po TTL 120 s (bezpiecznik).
//  * Realtime Presence mówi, które karty ŻYJĄ: karta trzymająca zasób jest
//    obecna na kanale `edit-lock:<typ>:<id>`. Karta czekająca na zajęty zasób
//    słucha kanału zasobu, który jej przeszkadza (`blocker_type` / `blocker_id`
//    z odpowiedzi bazy — logos ↔ logo:L to różne klucze), i gdy trzymającej karty
//    tam nie ma, a od 25 s nie odnowiła blokady (`expire_edit_locks_absent`),
//    usuwa jej blokadę i wchodzi od razu — zamiast czekać na TTL. Karta żywa
//    odnawia co 8 s także w tle (Web Worker, `background-ticker.js`), więc nie
//    traci blokady nawet przy chwilowym zerwaniu WebSocketu.
//  * Zwolnienie: `release_edit_locks` (przy zamykaniu karty z `keepalive`),
//    zejście z Presence i sygnał RELEASED — czekająca karta reaguje natychmiast;
//    polling co 5 s zostaje jako zapas (np. Realtime niedostępny).
import { applyTranslations, t, withLangParam } from "../../translation/translation.js?v=v2026-11-05T20153";
import { sb, SUPABASE_URL, SUPABASE_ANON_KEY } from "./supabase.js?v=v2026-11-05T20153";
import { blockingScreen, setBlockingIcon, setBlockingOpen } from "./blocking-screen.js?v=v2026-11-05T20153";
import { startTicker } from "./background-ticker.js?v=v2026-11-05T20153";


const TAB_ID_KEY = "familijna:tabId";
const HEARTBEAT_MS = 8000; // znacznie poniżej TTL (120 s, edit_lock_ttl() w bazie) i karencji (25 s)
const RETRY_POLL_MS = 5000; // dopóki zablokowani: zapas niezależny od Realtime
const SIGNAL_DEBOUNCE_MS = 250; // zdarzenia Presence przychodzą seriami (sync + leave)
const LOCK_TTL_MS = 120000; // musi być zgodne z edit_lock_ttl() w bazie (migracja 316)
const CHANNEL_PREFIX = "edit-lock";
// Zasoby, na które ktoś może CZEKAĆ (strony gry, logo, cała baza) — tylko one
// mają kanał Presence. Elementy bazy (pytania, foldery, tagi) nie mają
// czekających okien: konflikt to komunikat w oknie, nie oczekiwanie.
const PRESENCE_TYPES = new Set(["game", "logo", "logos", "base"]);

function randomId() {
  try {
    if (crypto?.randomUUID) return crypto.randomUUID();
  } catch {}
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function getTabId() {
  try {
    let id = sessionStorage.getItem(TAB_ID_KEY);
    if (!id) {
      id = randomId();
      sessionStorage.setItem(TAB_ID_KEY, id);
    }
    return id;
  } catch {
    // sessionStorage niedostępny (tryb prywatny itp.) — blokada nadal
    // działa, tylko każde odświeżenie tej karty liczy się jako nowa karta
    return randomId();
  }
}

// ---------------------------------------------------------------- baza

// Ostatni znany token sesji — pagehide nie może czekać na async getSession().
let lastAccessToken = null;
async function refreshAccessToken() {
  try {
    const { data } = await sb().auth.getSession();
    lastAccessToken = data?.session?.access_token || lastAccessToken;
  } catch {}
}

function normalizeItems(resources, { mode = "exclusive", context = null } = {}) {
  const unique = new Map();
  for (const r of (resources || [])) {
    const type = r?.type ?? r?.resourceType;
    const id = r?.id ?? r?.resourceId;
    if (!type || !id) continue;
    unique.set(`${type}:${id}`, {
      type,
      id,
      mode: r.mode || mode,
      message: r.message,
      title: r.title,
      context: r.context ?? context,
    });
  }
  return Array.from(unique.values());
}

function rpcResources(items) {
  return items.map((it) => ({ type: it.type, id: it.id, mode: it.mode }));
}

// Cały zestaw jednym wywołaniem (migracja 479: tryb per zasób). Odmowa zwraca
// wynik pierwszej przeszkody: `error`, `resource` (który z naszych), `blocker_type`,
// `blocker_id`, `blocker_mode`, `blocker_context`.
async function acquireSet(items, context) {
  void refreshAccessToken();
  const { data, error } = await sb().rpc("acquire_edit_locks", {
    p_resources: rpcResources(items),
    p_tab_id: getTabId(),
    p_context: context ?? null,
    p_mode: "exclusive",
  });
  if (error) throw error;
  return data;
}

async function releaseSet(items) {
  try {
    await sb().rpc("release_edit_locks", { p_resources: rpcResources(items), p_tab_id: getTabId() });
  } catch {}
}

// Zwolnienie przy zamykaniu karty: fetch z keepalive przeglądarka dokańcza
// po zamknięciu strony (zwykłe sb().rpc bywa ubijane) — bez tego blokada
// wisiałaby do wygaszenia przez czekającą kartę albo TTL.
function releaseSetKeepalive(items) {
  if (!lastAccessToken) return false;
  try {
    fetch(`${SUPABASE_URL}/rest/v1/rpc/release_edit_locks`, {
      method: "POST",
      keepalive: true,
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${lastAccessToken}`,
      },
      body: JSON.stringify({ p_resources: rpcResources(items), p_tab_id: getTabId() }),
    }).catch(() => {});
    return true;
  } catch {
    return false;
  }
}

// Usuwa blokady kart nieobecnych na kanale Presence zasobu, które od 25 s nie
// odnowiły blokady (migracja 479). Wołane tylko z pełnym stanem Presence.
async function expireAbsent(type, id, presentTabs) {
  try {
    const { data } = await sb().rpc("expire_edit_locks_absent", {
      p_resource_type: type,
      p_resource_id: id,
      p_present_tabs: presentTabs,
      p_tab_id: getTabId(),
    });
    return Number(data?.removed) || 0;
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------- Realtime

function lockTopic(type, id) {
  return `${CHANNEL_PREFIX}:${type}:${id}`;
}

// Sygnał RELEASED przez REST (nie wymaga subskrypcji; `keepalive` przeżywa
// zamknięcie karty). Czekające karty i tak dostają zejście z Presence — to zapas
// na kanał, który u czekającego nie zdążył się zasubskrybować.
function broadcastReleased(type, id, { keepalive = false } = {}) {
  try {
    fetch(`${SUPABASE_URL}/realtime/v1/api/broadcast`, {
      method: "POST",
      keepalive,
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({ messages: [{ topic: lockTopic(type, id), event: "RELEASED", payload: {} }] }),
    }).catch(() => {});
  } catch {}
}

// Jeden kanał na zasób, współdzielony przez trzymających (track) i czekających
// (nasłuch) w tej karcie; znika, gdy nikt go nie używa.
const channels = new Map();

function lockChannel(type, id) {
  const topic = lockTopic(type, id);
  let entry = channels.get(topic);
  if (entry) return entry;

  const tabId = getTabId();
  const ch = sb().channel(topic, { config: { presence: { key: tabId } } });
  entry = { topic, ch, status: "IDLE", synced: false, refs: 0, tracked: null, listeners: new Set() };

  const notify = (kind) => {
    for (const fn of entry.listeners) {
      try { fn(kind); } catch (e) { console.warn("[resource-lock] listener failed:", e); }
    }
  };
  ch.on("presence", { event: "sync" }, () => { entry.synced = true; notify("sync"); });
  ch.on("presence", { event: "leave" }, () => notify("leave"));
  ch.on("broadcast", { event: "RELEASED" }, () => notify("released"));
  ch.subscribe((status) => {
    entry.status = status;
    if (status === "SUBSCRIBED") {
      // Po każdym (ponownym) dołączeniu trzeba ponownie zgłosić obecność.
      if (entry.tracked) ch.track(entry.tracked).catch(() => {});
    } else {
      entry.synced = false;
    }
    notify("status");
  });

  channels.set(topic, entry);
  return entry;
}

function channelRef(type, id) {
  const entry = lockChannel(type, id);
  entry.refs += 1;
  let dropped = false;
  return {
    entry,
    drop() {
      if (dropped) return;
      dropped = true;
      entry.refs -= 1;
      if (entry.refs > 0) return;
      channels.delete(entry.topic);
      try { sb().removeChannel(entry.ch); } catch {}
    },
  };
}

// Karty obecne na kanale: klucz Presence = identyfikator karty.
function presentTabs(entry) {
  const tabs = new Set();
  try {
    const state = entry.ch.presenceState() || {};
    for (const [key, metas] of Object.entries(state)) {
      tabs.add(key);
      for (const meta of (metas || [])) if (meta?.tab) tabs.add(String(meta.tab));
    }
  } catch {}
  return Array.from(tabs);
}

// Trzymanie: obecność na kanałach zasobów zestawu (tylko typy z Presence).
function holdPresence(items, context) {
  const tabId = getTabId();
  const refs = [];
  for (const it of items) {
    if (!PRESENCE_TYPES.has(it.type)) continue;
    const ref = channelRef(it.type, it.id);
    ref.entry.tracked = { tab: tabId, mode: it.mode, context: it.context ?? context ?? null };
    if (ref.entry.status === "SUBSCRIBED") ref.entry.ch.track(ref.entry.tracked).catch(() => {});
    refs.push(ref);
  }
  return {
    drop() {
      for (const ref of refs) {
        ref.entry.tracked = null;
        try { ref.entry.ch.untrack().catch(() => {}); } catch {}
        ref.drop();
      }
    },
  };
}

// Czekanie: nasłuch kanału zasobu, który przeszkadza (może się zmieniać —
// po zwolnieniu gry przeszkodą może być pula logo).
function createBlockerWatch(onSignal) {
  let ref = null;
  let key = null;
  let debounce = null;
  const listener = (kind) => {
    if (kind === "status") return;
    clearTimeout(debounce);
    debounce = setTimeout(onSignal, SIGNAL_DEBOUNCE_MS);
  };
  return {
    pointAt(type, id) {
      if (!type || !id) return;
      const next = `${type}:${id}`;
      if (next === key) return;
      ref?.entry.listeners.delete(listener);
      ref?.drop();
      key = next;
      ref = PRESENCE_TYPES.has(type) ? channelRef(type, id) : null;
      ref?.entry.listeners.add(listener);
    },
    // Stan Presence do wygaszenia martwych kart — tylko gdy kanał ma pełny obraz.
    present() {
      if (!ref || ref.entry.status !== "SUBSCRIBED" || !ref.entry.synced) return null;
      return { type: key.split(":")[0], id: key.slice(key.indexOf(":") + 1), tabs: presentTabs(ref.entry) };
    },
    stop() {
      clearTimeout(debounce);
      ref?.entry.listeners.delete(listener);
      ref?.drop();
      ref = null;
      key = null;
    },
  };
}

// ---------------------------------------------------------------- overlay

function ensureOverlay() {
  const overlay = blockingScreen("resourceLockGuard", [{ key: "Back", i18n: "resourceLock.back", iconName: "arrow-left" }]);
  setBlockingIcon(overlay, "warning");
  return overlay;
}

function showOverlay({ title, message, backHref }) {
  const overlay = ensureOverlay();
  applyTranslations(overlay);
  overlay.querySelector("#resourceLockGuardTitle").textContent = title || t("resourceLock.title");
  overlay.querySelector("#resourceLockGuardMsg").textContent = message || "";

  const backBtn = overlay.querySelector("#resourceLockGuardBack");
  backBtn.onclick = async () => {
    if (backHref) { location.href = withLangParam(backHref); return; }
    try {
      if (window.history.length > 1) { history.back(); return; }
    } catch {}
    let target = "/";
    try {
      const { data, error } = await sb().auth.getUser();
      if (!error && data?.user) target = "/games/";
    } catch {}
    location.replace(withLangParam(target));
  };

  setBlockingOpen(overlay, true);
}

/**
 * Ten sam pełnoekranowy overlay dla innych twardych blokad niż "ktoś to
 * edytuje" -- np. baza odrzuciła zapis, bo ankieta gry właśnie się otworzyła
 * (reguły gry, migracja 274). Jeden wygląd dla "tego nie możesz teraz
 * edytować", bez wpisu w edit_locks.
 */
export function showBlockingOverlay({ title, message, backHref }) {
  showOverlay({ title, message, backHref });
}

// ---------------------------------------------------------------- blokada strony

/**
 * Blokada wejścia na stronę, która trzyma JEDEN albo KILKA zasobów naraz
 * (familijna-server/docs/blokady-zasobow.md, sekcje 6 i 8) — wołać PO auth, PRZED
 * wyrenderowaniem edytowalnej treści.
 *
 *   opcje: { title, backHref, context, forbiddenTitle, forbiddenMessage }
 *   resources: [{ type, id, mode, message, title?, context? }]
 *     mode    — "exclusive" (domyślnie) albo "shared" (wiele kart naraz;
 *               wyklucza tylko trzymanie wyłączne, patrz „Zgodność zasobów”)
 *     message — komunikat, gdy TEN zasób jest zajęty (tekst albo funkcja
 *               (odpowiedź_bazy) => tekst, np. gdy powód zależy od tego, kto
 *               trzyma)
 *
 * Cały zestaw jest zajmowany JEDNYM wywołaniem bazy, atomowo (wszystko albo
 * nic) w stałej kolejności; komunikat pierwszej przeszkody (w podanej
 * kolejności zasobów) trafia na overlay. Zajęte → overlay; karta słucha
 * Presence zasobu, który przeszkadza (zejście trzymającej karty, RELEASED),
 * wygasza blokady martwych kart i sprawdza co ~5 s w zapasie; gdy da się
 * zająć całość, strona wczytuje się sama.
 *
 * Zwraca { ok: true, release } albo { ok: false } (overlay już pokazany,
 * wywołujący robi return i nic więcej nie renderuje).
 *
 * Dopóki karta żyje, blokady są odnawiane co ~8 s (licznik w Web Workerze —
 * nie zwalnia w karcie w tle) oraz od razu po powrocie karty na wierzch. Gdy
 * odnowienie zwróci `locked` (blokadę w międzyczasie ktoś wziął — uśpiony
 * laptop, wygaszona przez czekającą kartę), strona blokuje się w całości.
 * Zwalnianie tylko przy faktycznym zamknięciu / nawigacji (pagehide) — NIE
 * przy schowaniu karty, bo alt-tab podczas edycji nie powinien oddawać blokady.
 */
export async function guardResourceLocks(resources, { title, backHref, context = null, forbiddenTitle, forbiddenMessage } = {}) {
  const items = normalizeItems(resources, { context }).map((it) => ({ ...it, title: it.title ?? title }));

  let released = false;
  let lost = false;
  let renewing = false;
  let stopHeartbeat = null;
  let stopRetry = null;
  let watch = null;
  let presence = null;

  function showGoneOverlay() {
    showOverlay({
      title: t("resourceLock.goneTitle"),
      message: t("resourceLock.goneMessage"),
      backHref,
    });
  }

  function showForbiddenOverlay() {
    showOverlay({
      title: forbiddenTitle || t("resourceLock.forbiddenTitle"),
      message: forbiddenMessage || t("resourceLock.forbiddenMessage"),
      backHref,
    });
  }

  function showLostOverlay() {
    showOverlay({
      title: t("resourceLock.lostTitle"),
      message: t("resourceLock.lostMessage"),
      backHref,
    });
  }

  // Który z NASZYCH zasobów odmówiono (komunikat) i który zasób przeszkadza (kanał).
  function refusedItem(res) {
    const type = res?.resource?.type;
    const id = res?.resource?.id;
    return items.find((it) => it.type === type && String(it.id) === String(id)) || items[0];
  }
  function blockerOf(res, item) {
    return { type: res?.blocker_type || item.type, id: res?.blocker_id || item.id };
  }

  const first = items.length ? await acquireSet(items, context) : { ok: true };

  if (!first?.ok) {
    const item = refusedItem(first);

    if (first?.error === "gone") {
      // Zasób usunięty gdzie indziej, zanim zdążyliśmy wejść — inny
      // komunikat niż "zajęte przez kogoś" i bez pollingu odzyskania (to
      // się nigdy nie "zwolni").
      showGoneOverlay();
      return { ok: false, gone: true };
    }
    if (first?.error === "forbidden") {
      showForbiddenOverlay();
      return { ok: false, forbidden: true };
    }

    const message = typeof item.message === "function" ? item.message(first) : item.message;
    showOverlay({ title: item.title, message, backHref });

    let checking = false;
    // Gdy zasoby się zwolnią, NIE chowamy tu tylko overlayu — strona już raz
    // przerwała renderowanie edytowalnej treści przy pierwszej porażce
    // (wywołujący dostaje { ok:false } i robi return), więc samo schowanie
    // overlayu zostawiłoby pustą, niewyrenderowaną stronę pod spodem.
    // Przeładowanie od zera jest proste i niezawodne: świeży boot() strony
    // przejdzie normalnie przez guardResourceLocks i realnie wyrenderuje
    // treść, zamiast próbować "wznowić" stan w locie.
    async function recheckAndReload() {
      if (released || checking) return;
      checking = true;
      try {
        // Martwa karta (zamknięta bez pagehide, zabita przeglądarka, uśpiony
        // telefon): nie ma jej na Presence i nie odnawia blokady → wygaszamy.
        const seen = watch.present();
        if (seen) await expireAbsent(seen.type, seen.id, seen.tabs);

        const again = await acquireSet(items, context).catch(() => null);
        if (released) return;
        if (again?.ok) {
          stop();
          // Zajęte na czas próby zostaje trzymane — przeładowana strona odnowi je
          // tą samą kartą; pagehide zwolni, gdyby przeładowanie się nie udało.
          location.reload();
        } else if (again?.error === "gone") {
          // Zniknęło całkiem, zanim zwolniła je karta, na którą czekaliśmy —
          // dalsze odpytywanie nic już nie zmieni.
          stop();
          showGoneOverlay();
        } else if (again?.error === "forbidden") {
          stop();
          showForbiddenOverlay();
        } else if (again?.error === "locked") {
          // Przeszkoda mogła się zmienić (gra zwolniona, teraz pula logo).
          const b = blockerOf(again, refusedItem(again));
          watch.pointAt(b.type, b.id);
        }
      } finally {
        checking = false;
      }
    }

    function stop() {
      released = true;
      if (stopRetry) stopRetry();
      watch?.stop();
    }

    watch = createBlockerWatch(recheckAndReload);
    const b = blockerOf(first, item);
    watch.pointAt(b.type, b.id);
    // Zapas niezależny od Realtime (także zasoby bez Presence): najpóźniej po
    // TTL po stronie serwera karta i tak wejdzie.
    stopRetry = startTicker(recheckAndReload, RETRY_POLL_MS);

    return { ok: false };
  }

  presence = holdPresence(items, context);

  async function renewAll() {
    if (released || lost || renewing || !items.length) return;
    renewing = true;
    try {
      const res = await acquireSet(items, context).catch((e) => {
        console.warn("[resource-lock] heartbeat failed:", e);
        return null;
      });
      if (released || lost || !res || res.ok) return;
      lost = true;
      stopHeartbeat?.();
      presence?.drop();
      if (res.error === "gone") {
        // Zasób zniknął w trakcie edycji (usunięty gdzie indziej, np. przez
        // Warstwę 2 krzyżowych blokad albo mimo niej). Overlay na wierzchu
        // już wyrenderowanej treści blokuje dalszą interakcję — nie trzeba
        // nic chować/przerenderowywać pod spodem.
        showGoneOverlay();
      } else if (res.error === "forbidden") {
        // Utrata prawa edycji w trakcie sesji (np. rola współdzielenia
        // zdegradowana albo odebrany dostęp do bazy). Ten sam wzorzec co
        // "gone" -- overlay na wierzchu, bez pollingu odzyskania.
        showForbiddenOverlay();
      } else {
        // Blokadę w międzyczasie przejęła inna karta (nasza wygasła —
        // uśpiony komputer — albo czekająca karta wygasiła ją jako martwą).
        // Pełna blokada strony; reszty nie trzymamy, skoro nic tu już nie wolno
        // (odmowa zestawu wycofała w bazie to, co byśmy odnowili).
        showLostOverlay();
        void releaseSet(items);
      }
    } finally {
      renewing = false;
    }
  }

  stopHeartbeat = startTicker(renewAll, HEARTBEAT_MS);

  // Powrót karty na wierzch: odnów od razu, nie czekaj na licznik.
  const onVisible = () => {
    if (document.visibilityState === "visible") void renewAll();
  };
  document.addEventListener("visibilitychange", onVisible);

  // Zwraca Promise zwolnienia: strona, która wychodzi własnym przyciskiem
  // (np. „Wstecz” edytora logo), czeka na nie przed nawigacją -- przy samym
  // pagehide przeglądarka potrafi ubić żądanie w trakcie przejścia.
  const release = async ({ keepalive = false } = {}) => {
    if (released) return;
    released = true;
    stopHeartbeat?.();
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("pagehide", releaseOnHide);
    if (!items.length) return;
    if (keepalive) releaseSetKeepalive(items);
    const done = lost ? Promise.resolve() : releaseSet(items);
    presence?.drop();
    for (const it of items) if (PRESENCE_TYPES.has(it.type)) broadcastReleased(it.type, it.id, { keepalive });
    await done;
  };

  // Zamknięcie karty: keepalive przeżywa zamknięcie; zejście z Presence i
  // RELEASED budzą czekające karty.
  const releaseOnHide = () => { void release({ keepalive: true }); };
  window.addEventListener("pagehide", releaseOnHide);

  return { ok: true, release: () => release() };
}

/**
 * Jedna blokada strony — skrót do guardResourceLocks() z jednym zasobem.
 */
export function guardResourceLock({ resourceType, resourceId, mode, message, title, backHref, context }) {
  return guardResourceLocks(
    [{ type: resourceType, id: resourceId, mode, message }],
    { title, backHref, context }
  );
}

// ---------------------------------------------------------------- blokada akcji / okna

/**
 * Zajmuje zestaw blokad bez pełnoekranowego guarda — na czas jednej operacji
 * albo otwartego okna (pytanie/folder/tag w bazie, okno zmiany nazwy na liście).
 * Jedno wywołanie bazy na cały zestaw: stała kolejność (bez zakleszczeń),
 * odmowa na którymkolwiek zasobie wycofuje całość i zwraca jej wynik
 * (`error`, `resource`, `blocker_*`). Wywołujący sam pokazuje konflikt i MUSI
 * wywołać release().
 *
 * Zwrócony lease ma mutowalne `ok`/`reason` -- gdy odnowienie wykryje, że
 * zasób zniknął (`gone`), wywołujący stracił prawo edycji (`forbidden`) albo
 * blokadę przejęła inna karta (`locked`), `ok` przechodzi na `false`. Sesje
 * dłuższe niż jeden zapis (otwarte okno) MUSZĄ sprawdzić `lease.ok` tuż przed
 * realnym zapisem -- RLS i druga warstwa w bazie i tak zablokują sam zapis,
 * to tylko zamienia generyczny błąd na jasny komunikat.
 */
export async function acquireResourceLocks(resources, { context = null, mode = "exclusive" } = {}) {
  const items = normalizeItems(resources, { mode, context });
  if (!items.length) return { ok: true, reason: null, release() {} };

  const first = await acquireSet(items, context);
  if (!first?.ok) return first || { ok: false, error: "locked" };

  let released = false;
  const lease = { ok: true, reason: null };
  const presence = holdPresence(items, context);

  const stopHeartbeat = startTicker(async () => {
    if (released) return;
    const result = await acquireSet(items, context).catch((error) => {
      console.warn("[resource-lock] lease heartbeat failed:", error);
      return null;
    });
    if (released || !result || result.ok) return;
    if (result.error === "gone" || result.error === "forbidden" || result.error === "locked") {
      lease.ok = false;
      lease.reason = result.error;
      stopHeartbeat();
      presence.drop();
    }
  }, HEARTBEAT_MS);

  const release = ({ keepalive = false } = {}) => {
    if (released) return;
    released = true;
    stopHeartbeat();
    window.removeEventListener("pagehide", releaseOnHide);
    if (keepalive) releaseSetKeepalive(items);
    void releaseSet(items);
    presence.drop();
    for (const it of items) if (PRESENCE_TYPES.has(it.type)) broadcastReleased(it.type, it.id, { keepalive });
  };
  const releaseOnHide = () => release({ keepalive: true });
  window.addEventListener("pagehide", releaseOnHide);
  lease.release = () => release();
  return lease;
}

/**
 * Jedna blokada akcji / okna — skrót do acquireResourceLocks() z jednym zasobem.
 */
export async function acquireResourceLock({ resourceType, resourceId, context = null, mode = "exclusive" } = {}) {
  if (!resourceType || !resourceId) return { ok: false, error: "missing_resource" };
  return acquireResourceLocks([{ type: resourceType, id: resourceId, mode }], { context, mode });
}

/**
 * Sprawdza, czy zasób ma teraz aktywną blokadę gdzie indziej — BEZ jej
 * zajmowania. Do jednorazowych akcji spoza "wyłącznego edytora" (np.
 * `games.js`'s rename/reset), które nie otwierają własnej sesji, ale
 * piszą do tych samych danych — patrz familijna-server/docs/plan-testy-i-poprawki.md,
 * sekcja "Model: zasób ma stan busy/free".
 */
export async function isResourceBusy(resourceType, resourceId) {
  // limit(1) zamiast maybeSingle(): zasób trzymany współdzielenie ma kilka wierszy.
  const { data, error } = await sb()
    .from("edit_locks")
    .select("resource_type")
    .eq("resource_type", resourceType)
    .eq("resource_id", resourceId)
    .gt("heartbeat_at", new Date(Date.now() - LOCK_TTL_MS).toISOString())
    .limit(1);
  if (error) throw error;
  return !!data?.length;
}
