import { bindDrawer } from "../../../shared/js/core/drawer.js?v=v2026-11-09T11593";
// base-explorer/js/mobile.js
// Obsługa mobilna: drawer lewego panelu + długie tapnięcie jako zamiennik PPM

const LONG_PRESS_MS = 500;
const MOVE_THRESHOLD = 10; // px — anuluj long press jeśli palec się przesunął
const DOUBLE_TAP_MS = 300; // max ms między tapnięciami

/* ================= Drawer ================= */

// Panel otwierają przyciski widoków (ui/left-view.js: drzewo / tagi /
// kategorie); onChange — po każdej zmianie (np. odświeżenie przycisków).
export function initDrawer({ onChange } = {}) {
  const panel = document.getElementById("explorerLeft");
  const overlay = document.getElementById("drawerOverlay");
  if (!panel || !overlay) return null;

  const drawer = bindDrawer({ panel, backdrop: overlay, anchor: document.getElementById("toolbar"),
    onChange: (open) => {
      const root = document.documentElement;
      document.body.classList.toggle("explorer-drawer-open", open && root.scrollHeight > root.clientHeight);
      onChange?.();
    },
  });
  const { close } = drawer;

  document.addEventListener("modal-sheet:enter", close);
  document.addEventListener("explorer:close-drawer", close); // okna menedżera także bez trybu od dołu

  // Na życzenie: zaznaczenie/nawigacja (klik ani dblclick) w drzewie/tagach
  // NIE zamyka drawera automatycznie -- lista po prawej i tak aktualizuje
  // się w tle, user zamyka drawer ręcznie (ten sam przycisk / klik w overlay).
  return drawer;
}

/* ================= Long press → context menu ================= */

/**
 * Dodaje obsługę długiego tapnięcia na elemencie.
 * Wywołuje callback(x, y, target) po LONG_PRESS_MS ms bez ruchu.
 * Nie blokuje normalnych kliknięć.
 */
// el -> timestamp ostatniego pointerdown dotykiem/rysikiem (do
// isTouchContextMenuWindow, patrz niżej).
const touchDownAt = new WeakMap();

export function addLongPress(el, callback) {
  if (!el) return;

  let timer = null;
  let startX = 0;
  let startY = 0;
  // palce na elemencie: drugi palec to ramka (ui/marquee.js), nie menu
  const pointers = new Set();

  function cancel() {
    if (timer) { clearTimeout(timer); timer = null; }
  }

  el.addEventListener("pointerdown", (e) => {
    // tylko dotyk lub stylus (nie mysz — mysz ma contextmenu)
    if (e.pointerType === "mouse") return;

    pointers.add(e.pointerId);
    cancel();
    if (pointers.size > 1) return;
    startX = e.clientX;
    startY = e.clientY;
    touchDownAt.set(el, Date.now());

    timer = setTimeout(() => {
      timer = null;
      callback(e.clientX, e.clientY, e.target);
    }, LONG_PRESS_MS);
  }, { passive: true });

  el.addEventListener("pointermove", (e) => {
    if (e.pointerType === "mouse") return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (Math.hypot(dx, dy) > MOVE_THRESHOLD) cancel();
  }, { passive: true });

  const lift = (e) => { pointers.delete(e.pointerId); cancel(); };
  el.addEventListener("pointerup", lift, { passive: true });
  el.addEventListener("pointercancel", lift, { passive: true });
}

/**
 * Czy dany element jest w oknie czasowym tuż po dotykowym pointerdown, w
 * którym przeglądarka MOGŁABY sama wygenerować natywne zdarzenie
 * "contextmenu" niezależne od naszego JS-a (teoretyczne ryzyko na
 * prawdziwym touchscreenie, którego e2e -- oparte na syntetycznych
 * PointerEventach -- nie odtwarza). Wołający (desktopowy listener
 * "contextmenu" w ui/list.js, ui/tree.js, ui/left.js) ma ignorować menu w tym oknie niezależnie od
 * tego czy nasz long-press "się udał" czy został anulowany ruchem.
 * Zaimplementowane jako WCZESNY GUARD wewnątrz JEDYNEGO listenera
 * "contextmenu" na danym elemencie (a nie jako osobny, konkurujący
 * listener) -- prostsze i odporne na kolejność rejestracji z
 * `wireActions()`, niezależnie od tego czy realny wyścig kiedykolwiek się
 * materializuje.
 */
export function isTouchContextMenuWindow(el) {
  const t = touchDownAt.get(el);
  return typeof t === "number" && (Date.now() - t) < LONG_PRESS_MS + 300;
}

/* ================= Double tap ================= */

/**
 * Emuluje dblclick dla urządzeń dotykowych.
 * Wywołuje callback(target) przy dwóch tapnięciach w DOUBLE_TAP_MS ms.
 */
export function addDoubleTap(el, callback) {
  if (!el) return;
  let lastTap = 0;
  let lastTarget = null;

  el.addEventListener("touchend", (e) => {
    const now = Date.now();
    const target = e.target;
    if (now - lastTap < DOUBLE_TAP_MS && lastTarget === target) {
      e.preventDefault();
      callback(target);
      lastTap = 0;
    } else {
      lastTap = now;
      lastTarget = target;
    }
  }, { passive: false });
}

export function isTouchDevice() {
  // coarse = dotyk/rysik, fine = mysz/touchpad
  // any-pointer:fine oznacza że jest też mysz — wtedy traktujemy jako desktop
  return window.matchMedia("(pointer: coarse) and (hover: none)").matches;
}
