// control/js/devices.js
// Parowanie urządzeń (linki + 6-cyfrowe kody) — CAŁKOWICIE poza
// public.game_state, tak jak dziś (plan, sekcja 2 punkt "0."): to fakt
// "jak się połączyć", nie stan gry. W odróżnieniu od dzisiejszego
// control/js/devices.js — ZERO wysyłania komend (sendDisplayCmd/
// sendHostCmd/sendBuzzerCmd/kolejki nie istnieją tu wcale). Tryb Display
// (BLACK/QR/GAME) to już nie komenda wysyłana stąd — to zwykły zapis
// detail.display.mode przez engine.js/store.js, czytany przez Display samo.
//
// Kody 6-cyfrowe: reużywają bez zmian istniejące, już bezpieczne RPC
// (generate_device_connect_code / resolve_device_connect_code, migracja
// 2026-05-30_203) — to czysty lookup "kod -> share_key", niezwiązany z
// komendami, nie wymaga żadnej zmiany dla v2.

import { getUiLang } from "../../shared/translation/translation.js?v=v2026-11-08T14583";
import { sb } from "../../shared/js/core/supabase.js?v=v2026-11-08T14583";
import { t } from "../../shared/translation/translation.js?v=v2026-11-08T14583";


// Linki urządzeń wychodzą z aplikacji (mail, QR, zakładki), więc zawsze przez /go/.
function makeUrl(device, gameId, key, { lang } = {}) {
  const u = new URL("/go/", location.origin);
  u.searchParams.set("d", device);
  u.searchParams.set("id", gameId);
  u.searchParams.set("key", key);
  if (lang) u.searchParams.set("lang", lang);
  return u.toString();
}

export function createDevices({ game }) {
  const keyByType = new Map();
  async function sessionKey(deviceType) {
    if (keyByType.has(deviceType)) return keyByType.get(deviceType);
    const { data, error } = await sb().rpc("control_runtime_device_link", {
      p_game_id: game.id, p_device_type: deviceType,
    });
    if (error || !data?.ok || !data?.token) throw new Error(data?.error || t("control.errors.deviceLink"));
    keyByType.set(deviceType, data.token);
    return data.token;
  }

  async function buildUrls(lang) {
    const targetLang = lang || getUiLang();
    const [displayKey, hostKey, buzzerKey] = await Promise.all([
      sessionKey("display"), sessionKey("host"), sessionKey("buzzer"),
    ]);
    return {
      displayUrl: makeUrl("display", game.id, displayKey, { lang: targetLang }),
      hostUrl: makeUrl("host", game.id, hostKey, { lang: targetLang }),
      buzzerUrl: makeUrl("buzzer", game.id, buzzerKey, { lang: targetLang }),
    };
  }

  async function generateConnectCode(deviceType) {
    const shareKey = await sessionKey(deviceType);
    const { data, error } = await sb().rpc("generate_device_connect_code", {
      p_game_id: game.id,
      p_device_type: deviceType,
      p_share_key: shareKey,
      p_game_name: game.name || null,
    });
    if (error || !data?.ok) return null;
    return data.code;
  }

  async function copyToClipboard(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
  }

  return { buildUrls, generateConnectCode, copyToClipboard };
}
