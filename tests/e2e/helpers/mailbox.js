const { generateE2EToken } = require("./e2e-token");
const { RUN_ID } = require("./e2e-lease-client");

const API_BASE = "https://www.familijna.app/_e2e_api";

function authHeaders(extra = {}) {
  const secret = process.env.E2E_BYPASS_SECRET;
  if (!secret) throw new Error("Brak E2E_BYPASS_SECRET");
  // X-E2E-Run: skrzynki e2e+ (E25) tylko dla przebiegu, który je wypożyczył.
  return { "X-E2E-Token": generateE2EToken(secret), "X-E2E-Run": RUN_ID, ...extra };
}

// Zerwane połączenie (ECONNRESET) powtarzamy -- wszystkie wywołania skrzynki
// są powtarzalne (odczyt, czyszczenie, zwolnienie blokady).
async function api(path, options = {}) {
  let response;
  for (let attempt = 1; ; attempt++) {
    try {
      response = await fetch(`${API_BASE}${path}`, { ...options, headers: authHeaders(options.headers) });
      break;
    } catch (err) {
      if (attempt >= 3) throw err;
      console.log(`[e2e-diag] mailbox ${path.split("?")[0]} fetch failed (${err.cause?.code || err.message}), retry ${attempt}`);
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`E2E mailbox ${response.status}: ${JSON.stringify(data)}`);
  return data;
}

async function clearMailbox(recipient) {
  await api(`/emails?recipient=${encodeURIComponent(recipient)}`, { method: "DELETE" });
}

// "Minęła godzina" dla blokady wysyłki per adres testowy (np. auth:guest_upgrade_email).
async function releaseMailCooldown(recipient, actionKey) {
  await api("/mail-cooldowns/release", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ recipient, action_key: actionKey }),
  });
}

// Blokada wysyłki dla pary właściciel–odbiorca (base:share, poll:share), jak po
// wcześniejszym udostępnieniu; jako zalogowany właściciel z `page`. -> [{ ok, next_allowed_at }]
async function reservePairCooldown(page, actionKey, targetKey) {
  const token = await page.evaluate(async () => (await window.__sbClient.auth.getSession()).data.session.access_token);
  const data = await api("/mail-cooldowns/reserve-pair", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ action_key: actionKey, target_key: targetKey }),
  });
  return data.rows;
}

async function resetMailProviderLimits() {
  await api("/mail-limits/reset", { method: "POST" });
  console.log("[e2e-mail] provider limits reset before delivery test");
}

// accept(row) — opcjonalny dodatkowy filtr (np. pominięcie spóźnionej kopii maila z poprzedniego testu).
async function waitForEmail({ recipient, after, subject, timeout = 90_000, trigger = true, accept }) {
  let triggered = !trigger;
  const startedAt = Date.now();
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    // Pojedyncze zerwane połączenie (ECONNRESET) nie przerywa czekania -- kolejne odpytanie za 2 s.
    let data;
    try {
      data = await api(`/emails?recipient=${encodeURIComponent(recipient)}&after=${encodeURIComponent(after)}`);
    } catch (error) {
      if (!/fetch failed/i.test(String(error?.message))) throw error;
      console.log("[e2e-mail] odpytanie skrzynki nieudane, ponawiam:", error.cause?.code || error.message);
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      continue;
    }
    const email = (data.emails || []).find((row) => (!subject || subject.test(row.subject || "")) && (!accept || accept(row)));
    if (email) {
      console.log("[e2e-mail] received", JSON.stringify({ recipient, elapsedMs: Date.now() - startedAt, receivedAt: email.received_at }));
      return email;
    }
    if (!triggered) {
      const result = await api('/mail-trigger', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipient, after }),
      });
      triggered = result.selected > 0;
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  try {
    const delivery = await api(`/mail-delivery?recipient=${encodeURIComponent(recipient)}&after=${encodeURIComponent(after)}`);
    console.log("[e2e-mail] delivery diagnosis", JSON.stringify({ recipient, ...delivery }));
  } catch (error) { console.log("[e2e-mail] delivery diagnosis unavailable:", error.message); }
  throw new Error(`Nie otrzymano maila dla ${recipient} w ${timeout} ms`);
}

function extractHttpLinks(email) {
  const source = `${email?.body_html || ""}\n${email?.body || ""}`.replace(/&amp;/g, "&");
  // Tekstowa wersja maila (np. tworzona przez dostawcę z HTML) zapisuje adresy
  // jako „opis (https://…)” — końcowy nawias i interpunkcja nie należą do adresu.
  return [...new Set((source.match(/https?:\/\/[^\s"'<>]+/g) || []).map(link => link.replace(/[).,;]+$/, "")))];
}

async function readMailDelivery({ recipient, after }) {
  return api(`/mail-delivery?recipient=${encodeURIComponent(recipient)}&after=${encodeURIComponent(after)}`);
}

module.exports = { releaseMailCooldown, reservePairCooldown, readMailDelivery, clearMailbox, waitForEmail, extractHttpLinks, resetMailProviderLimits };
