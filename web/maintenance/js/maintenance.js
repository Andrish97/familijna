import { initI18n, t, withLangParam } from "../../shared/translation/translation.js?v=v2026-11-05T21155";
import { formatMaintenanceCountdown, formatMaintenanceReturnAt } from "../../shared/js/core/maintenance-format.js?v=v2026-11-05T21155";
import { getUser } from "../../shared/js/core/auth.js?v=v2026-11-05T21155";

const ENDPOINT = "/maintenance-state.json?v=v2026-11-05T21155";

const POLL_MS = 30000;

const FALLBACKS = {
  messageTitle: "Trwa przerwa techniczna",
  messageText:
    "System jest chwilowo niedostępny.\nZa jakiś czas wszystko wróci do normy i będzie można kontynuować pracę.",
  inactiveTitle: "Brak prac technicznych",
  inactiveText: "Aktualnie nie trwają żadne prace.",
  returnAtTitle: "Trwa przerwa techniczna",
  returnAtText:
    "System jest chwilowo niedostępny.\nPowrót nastąpi:",
  countdownTitle: "Trwa przerwa techniczna",
  countdownText:
    "System jest chwilowo niedostępny.\nPowrót nastąpi:",
  countdownDone: "Serwis jest ponownie dostępny. Odśwież stronę.",
};

const els = {
  title: document.getElementById("title"),
  description: document.getElementById("description"),
  countdown: document.getElementById("countdown"),
  standardContent: document.getElementById("standardContent"),
  customContent: document.getElementById("customContent"),
};

let countdownTimer = null;
let redirectTimer = null;
let lastState = null;
let hasSession = false;
let sessionReady = null;
const isTv = document.documentElement.dataset.tvLayout === "true";

function setText(el, text) {
  if (el) el.textContent = text;
}

function tr(key, fallback) {
  const value = t(key);
  if (!value || value === key) return fallback;
  return value;
}

function scheduleRedirect() {
  if (redirectTimer) return;
  redirectTimer = setTimeout(() => {
    void redirectToReturnTarget();
  }, 1500);
}

function redirectNow() {
  void redirectToReturnTarget();
}

function returnTarget() {
  if (isTv) return "/connect/?tv=1";
  return hasSession ? "/games/" : "/";
}

async function redirectToReturnTarget() {
  if (!isTv && !sessionReady) {
    sessionReady = getUser()
      .then((user) => { hasSession = Boolean(user); })
      .catch(() => { hasSession = false; });
  }
  if (sessionReady) await sessionReady;
  window.location.replace(withLangParam(returnTarget()));
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function formatCountdownDisplay(ms) {
  return formatMaintenanceCountdown(ms, document.documentElement.lang);
}

function formatReturnAt(date) {
  return formatMaintenanceReturnAt(date, document.documentElement.lang);
}

function stopCountdown() {
  if (countdownTimer) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
}

function updateCountdown(targetDate, isCountdownMode) {
  if (!targetDate) return false;
  const diff = targetDate.getTime() - Date.now();

  const formatted = isCountdownMode ? formatCountdownDisplay(diff) : formatReturnAt(targetDate);

  // Update all standard elements
  if (els.countdown) {
    els.countdown.hidden = false;
    setText(els.countdown, formatted);
  }

  // Update all inline timers
  const inlines = document.querySelectorAll(".countdown-inline");
  inlines.forEach(el => setText(el, formatted));

  if (diff <= 0) {
    if (isCountdownMode) {
      setText(els.description, tr("maintenance.countdownDone", FALLBACKS.countdownDone));
      if (els.countdown) els.countdown.hidden = true;
      scheduleRedirect();
      return false;
    }
  }

  if (isCountdownMode) {
    setText(
      els.description,
      tr("maintenance.countdownText", FALLBACKS.countdownText)
    );
  }

  return true;
}

function startCountdown(targetDate, isCountdownMode) {
  stopCountdown();
  if (!targetDate) return;
  if (!updateCountdown(targetDate, isCountdownMode)) return;
  countdownTimer = setInterval(() => {
    if (!updateCountdown(targetDate, isCountdownMode)) {
      stopCountdown();
    }
  }, 1000);
}

function esc(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderFallback() {
  if (els.standardContent) els.standardContent.hidden = false;
  if (els.customContent) els.customContent.hidden = true;
  setText(els.title, tr("maintenance.messageTitle", FALLBACKS.messageTitle));
  setText(els.description, tr("maintenance.messageText", FALLBACKS.messageText));
  if (els.countdown) els.countdown.hidden = true;
  stopCountdown();
}

function renderState(state) {
  const mode = typeof state?.mode === "string" ? state.mode : "message";
  const enabled = typeof state?.enabled === "boolean" ? state.enabled : null;
  const returnAt = parseDate(state?.returnAt);
  const useStandard = state?.useStandardText ?? (state?.customComments?.pl || state?.customComments?.en || state?.customComments?.uk ? false : true);

  // Select comment based on browser language
  const userLang = (document.documentElement.lang || "pl").toLowerCase();
  let customComment = "";
  if (state?.customComments) {
    const comments = state.customComments;
    // Panel administracyjny pozwala uzupełnić tylko część języków. Pusta
    // karta jest gorsza od jawnego fallbacku do istniejącego komentarza.
    if (userLang.startsWith("pl")) customComment = comments.pl || comments.en || comments.uk || "";
    else if (userLang.startsWith("uk")) customComment = comments.uk || comments.pl || comments.en || "";
    else customComment = comments.en || comments.pl || comments.uk || "";
  }

  if (enabled === false || mode === "off") {
    redirectNow();
    return;
  }

  stopCountdown();

  // Tytuł zawsze widoczny (pobierany z i18n)
  const titleText = tr("maintenance.title", FALLBACKS.messageTitle);
  setText(els.title, titleText);

  if (useStandard || !customComment) {
    if (els.standardContent) els.standardContent.hidden = false;
    if (els.customContent) els.customContent.hidden = true;

    if (els.countdown) els.countdown.hidden = true;

    if (mode === "message") {
      setText(els.description, tr("maintenance.messageText", FALLBACKS.messageText));
      return;
    }

    if (mode === "returnAt") {
      setText(els.description, tr("maintenance.returnAtText", FALLBACKS.returnAtText));
      if (els.countdown) {
        els.countdown.hidden = false;
        setText(els.countdown, returnAt ? formatReturnAt(returnAt) : "—");
      }
      return;
    }

    if (mode === "countdown") {
      if (returnAt && returnAt.getTime() > Date.now()) {
        startCountdown(returnAt, true);
      } else if (returnAt) {
        setText(els.description, tr("maintenance.countdownDone", FALLBACKS.countdownDone));
        if (els.countdown) els.countdown.hidden = true;
        scheduleRedirect();
      } else {
        setText(
          els.description,
          tr("maintenance.countdownText", FALLBACKS.countdownText).replace("{countdown}", "00:00:00")
        );
        if (els.countdown) {
          els.countdown.hidden = false;
          setText(els.countdown, "00:00:00");
        }
      }
      return;
    }
  } else {
    // Treść własna
    if (els.standardContent) els.standardContent.hidden = true;
    if (els.customContent) {
      els.customContent.hidden = false;

      let html = esc(customComment).replace(/\n/g, "<br>");
      html = html.replace(/#timer/g, '<span class="countdown-inline">—</span>');
      els.customContent.innerHTML = `<div class="custom-maintenance-content">${html}</div>`;

      if (customComment.includes("#timer")) {
        if (mode === "countdown" || mode === "returnAt") {
          startCountdown(returnAt, mode === "countdown");
        }
      }
    }
  }
}

async function loadState() {
  const response = await fetch(ENDPOINT, { cache: "no-store" });
  if (!response.ok) throw new Error("Failed to load maintenance state");
  const data = await response.json();
  if (!data || typeof data !== "object") throw new Error("Invalid maintenance state");
  return data;
}

async function refresh() {
  try {
    const state = await loadState();
    lastState = state;
    renderState(state);
  } catch (err) {
    lastState = null;
    renderFallback();
  }
}

(async () => {
  try {
    await initI18n({ withSwitcher: true, apply: true });
  } catch (err) {
    console.error("[maintenance] i18n nieaktywny:", err);
  } finally {
    document.documentElement.classList.remove('page-loading');
    document.querySelector('.topbar')?.classList.add('topbar-ready');
  }
  await refresh();
  document.querySelector("main[data-skel-step]")?.classList.add("skel-step-ready");
  window.addEventListener("i18n:lang", () => {
    if (lastState) {
      renderState(lastState);
    } else {
      renderFallback();
    }
  });
  setInterval(refresh, POLL_MS);
})();
