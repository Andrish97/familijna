import { sb } from "./supabase.js?v=v2026-11-08T15440";

function pickRpcRow(data, fnName) {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error(`${fnName}: empty response`);
  return row;
}

/**
 * Per-user cooldowns (requires authenticated session).
 * DB is source of truth (cross-device).
 */
export async function cooldownGet(actionKeys = []) {
  const keys = Array.isArray(actionKeys) ? actionKeys : [];
  if (!keys.length) return new Map();

  const { data, error } = await sb().rpc("cooldown_get", { p_action_keys: keys });
  if (error) throw error;

  const map = new Map();
  (data || []).forEach((row) => {
    if (!row?.action_key || !row?.next_allowed_at) return;
    const ms = Date.parse(row.next_allowed_at);
    if (Number.isFinite(ms)) map.set(row.action_key, ms);
  });
  return map;
}

export async function cooldownReserve(actionKey, cooldownSeconds) {
  const { data, error } = await sb().rpc("cooldown_reserve", {
    p_action_key: String(actionKey),
    p_cooldown_seconds: Number(cooldownSeconds),
  });
  if (error) throw error;

  const row = pickRpcRow(data, "cooldown_reserve");
  return {
    ok: !!row?.ok,
    nextAllowedAtMs: row?.next_allowed_at ? Date.parse(row.next_allowed_at) : 0,
  };
}

export async function cooldownRelease(actionKey, maxAgeSeconds = 60) {
  const { data, error } = await sb().rpc("cooldown_release", {
    p_action_key: String(actionKey),
    p_max_age_seconds: Number(maxAgeSeconds),
  });
  if (error) throw error;
  return !!data;
}

/**
 * Nakładki dla scope='email' (auth:reset_password/guest_upgrade_email/
 * signup_confirm) -- md5 target_key liczony PO STRONIE BAZY, bo login.js woła to jeszcze przed
 * zalogowaniem i w przeglądarce nie ma żadnej implementacji md5.
 */
export async function mailCooldownEmailCheck(actionKey, email) {
  const { data, error } = await sb().rpc("mail_cooldown_email_check", {
    p_action_key: String(actionKey),
    p_email: String(email || "").trim().toLowerCase(),
  });
  if (error) throw error;
  const row = pickRpcRow(data, "mail_cooldown_email_check");
  return {
    ok: !!row?.ok,
    nextAllowedAtMs: row?.next_allowed_at ? Date.parse(row.next_allowed_at) : 0,
  };
}

export async function mailCooldownEmailReserve(actionKey, email) {
  const { data, error } = await sb().rpc("mail_cooldown_email_reserve", {
    p_action_key: String(actionKey),
    p_email: String(email || "").trim().toLowerCase(),
  });
  if (error) throw error;
  const row = pickRpcRow(data, "mail_cooldown_email_reserve");
  return {
    ok: !!row?.ok,
    nextAllowedAtMs: row?.next_allowed_at ? Date.parse(row.next_allowed_at) : 0,
  };
}

/**
 * Jeden wspólny formater czasu pozostałego -- zastępuje 4 zdublowane,
 * rozjechane wersje (account.js's formatRemaining M:SS, bases.js's martwe
 * msLeftLabel Xh Ym, subscriptions.js (cooldownTextFromUntil)
 * zaokrąglające do pełnych godzin). Dobiera format wg rozmiaru: <1h ->
 * M:SS (krótkie cooldowny auth:*), <24h -> "Xh Ym", inaczej -> "Xd Yh".
 */
export function formatCooldownRemaining(ms) {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  if (totalSec < 3600) {
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  }
  const totalMin = Math.floor(totalSec / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h < 24) return `${h}h ${m}m`;
  const d = Math.floor(h / 24);
  const hLeft = h % 24;
  return hLeft ? `${d}d ${hLeft}h` : `${d}d`;
}

/**
 * Lekki, reużywalny "ticker" licznika cooldownu -- uogólnienie
 * account.js's bindCooldown/tickCooldowns (żywy, już działający wzorzec:
 * 1s-interval gdy coś aktywne, rzadziej gdy nic, disable elementów na
 * czas cooldownu). Każda strona tworzy WŁASNĄ instancję (createCooldownTicker())
 * -- nie jeden globalny singleton współdzielony między niezwiązanymi
 * stronami.
 *
 * bind({ key, labelEl, disableEls, formatText }) -- rejestruje cel;
 * formatText(ms) domyślnie formatCooldownRemaining.
 * setEndMs(key, ms) -- ustawia/aktualizuje koniec cooldownu dla klucza
 * (np. po odczycie terminu cooldownu zwróconego przez RPC).
 * getRemainingMs(key) -- odczyt bez tykania.
 */
export function createCooldownTicker() {
  const bindings = [];
  const endMs = new Map();
  let timer = null;
  let tickDelayMs = 5000;

  function getRemainingMs(key) {
    return Math.max(0, (endMs.get(key) || 0) - Date.now());
  }

  function tick() {
    let anyActive = false;
    for (const { key, labelEl, disableEls, formatText, onTick } of bindings) {
      const rem = getRemainingMs(key);
      const active = rem > 0;
      if (active) anyActive = true;
      if (labelEl) {
        labelEl.hidden = !active;
        labelEl.textContent = active ? (formatText || formatCooldownRemaining)(rem) : "";
      }
      (disableEls || []).forEach((el) => {
        if (!el) return;
        if (active) el.disabled = true;
        else if (!el.dataset.locked) el.disabled = false;
      });
      // Dla potrzeb poza textContent/disabled (np. atrybut title) --
      // subscriptions.js's przyciski resend pokazują czas w
      // tooltipie, nie w osobnym elemencie tekstowym.
      if (onTick) onTick(rem, active);
    }
    const nextDelay = anyActive ? 1000 : 5000;
    if (tickDelayMs !== nextDelay) {
      tickDelayMs = nextDelay;
      if (timer) {
        clearInterval(timer);
        timer = setInterval(tick, tickDelayMs);
      }
    }
  }

  return {
    bind({ key, labelEl, disableEls, formatText, onTick }) {
      bindings.push({ key, labelEl, disableEls, formatText, onTick });
    },
    // Dla list przebudowywanych w kółko (subscriptions.js) --
    // czyści stare wiązania (DOM i tak już zniknął przy re-renderze) przed
    // ponownym bind() dla nowo wyrenderowanych wierszy, inaczej tablica
    // rośnie bez końca i "tick" bije też stare, odłączone elementy.
    resetBindings() {
      bindings.length = 0;
    },
    setEndMs(key, ms) {
      endMs.set(key, Number(ms) || 0);
      tick();
    },
    getRemainingMs,
    start() {
      if (timer) return;
      timer = setInterval(tick, tickDelayMs);
      tick();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
    tick,
  };
}
