// E30: czat AI na stronach aplikacji. Montuje go initPage dla konta
// zarejestrowanego (goście: brak czatu — decyzja 5). Przycisk w górnym pasku
// (obok Wskazówek) otwiera wspólne okno silnika (.overlay.modal--sheet,
// openDialog/closeDialog z core/modal-sheet.js; na telefonie zasłonka od
// dołu z paskiem, ?dialog=aiChatOverlay w historii, Wstecz zamyka) — decyzja
// użytkownika 2026-11-23: „ma używać tego samego modala co wszystko”.
//
// Ciągłość między stronami: stan (otwarte okno, rozmowa, szkic) w
// sessionStorage; otwarte okno wraca po przejściu na inną stronę bez
// animacji. Historia rozmowy jest na koncie (history.js). Odpowiedź
// przerwana przejściem: historia zapisana po wiadomości użytkownika, po
// wczytaniu przycisk „Dokończ odpowiedź”. Przejście na inną stronę na prośbę
// czatu (open_page) — po zakończeniu odpowiedzi; zmiana danych pokazanych na
// stronie — po odpowiedzi strona wczytuje się ponownie (okno zostaje otwarte).
import { t, getUiLang } from "../../translation/translation.js";
import { icon } from "../core/icons.js";
import { confirmModal } from "../core/modal.js";
import { openDialog, closeDialog } from "../core/modal-sheet.js";
import { linkTo } from "../core/nav-map.js";
import { activeKey, keyStatus } from "./keys.js";
import { startConversation, sendMessage, continueReply, displayItems, awaitingReply } from "./chat.js";
import { getChat, saveChat, listChats, deleteChat, chatTitle } from "./history.js";
import { PROVIDERS } from "./providers.js";
import { browserToolEnv } from "./env-browser.js";
import { pointHere, queuePoint, runQueuedPoint, clearPointer } from "./pointer.js";
import { NEEDS_ID } from "./tools/targets.js";

const STORE = "familijna:ai-panel";
export const AI_DIALOG_ID = "aiChatOverlay";
// Strony, których dane czat może zmienić — po zmianie wczytują się ponownie.
const RELOAD_ON_CHANGE = new Set(["games", "editor", "gameSettings", "polls", "bases", "baseExplorer", "logoEditor", "friends", "subscribers", "tasks"]);

function readState() {
  try { return JSON.parse(sessionStorage.getItem(STORE) || "{}") || {}; } catch { return {}; }
}
function writeState(patch) {
  const next = { ...readState(), ...patch };
  try { sessionStorage.setItem(STORE, JSON.stringify(next)); } catch { /* tryb prywatny: bez pamięci */ }
  return next;
}

function el(tag, className, attrs = {}) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "text") n.textContent = v;
    else n.setAttribute(k, v);
  }
  return n;
}

function iconButton(name, label, extra = "") {
  const b = el("button", `btn sm icon ${extra}`.trim(), { type: "button", "aria-label": label, title: label });
  b.innerHTML = icon(name);
  return b;
}

const toolLabel = (name) => {
  const s = t(`aiChat.tools.${name}`);
  return s && s !== `aiChat.tools.${name}` ? s : name;
};

/**
 * Czat dla strony pageId. Wołany raz przez initPage.
 * @param {{ pageId: string }} opts
 */
export async function mountAiPanel({ pageId }) {
  if (document.getElementById(AI_DIALOG_ID)) return;
  const slot = document.querySelector(".topbar-section-3");
  if (!slot) return;

  const toggle = iconButton("chat", t("aiChat.open"), "ai-toggle");
  toggle.id = "btnAiChat";
  toggle.setAttribute("aria-controls", AI_DIALOG_ID);
  toggle.setAttribute("aria-expanded", "false");
  slot.insertBefore(toggle, slot.firstChild);

  const overlay = el("div", "overlay modal--sheet ai-chat-overlay", { id: AI_DIALOG_ID });
  overlay.hidden = true;
  const panel = el("div", "modal modal--fill ai-chat", { role: "dialog", "aria-modal": "true", "aria-labelledby": "aiChatTitle" });
  const head = el("div", "mHead");
  const title = el("div", "mTitle", { id: "aiChatTitle", text: t("aiChat.title") });
  // asystent Familijnej: ile wiadomości zostało dziś (decyzja 26)
  // Od razu podpowiedź: własny klucz = bez dziennego limitu Familijnej.
  const quotaLine = el("div", "hint ai-quota");
  const quotaText = el("span");
  const ownKeyLink = el("a", "link ai-quota-own", { href: linkTo("account", { hash: "ai" }), text: t("aiChat.ownKeyHint") });
  quotaLine.append(quotaText, " ", ownKeyLink);
  quotaLine.hidden = true;
  const btnHistory = iconButton("folder-open", t("aiChat.history"));
  const btnNew = iconButton("plus", t("aiChat.newChat"));
  const btnClose = el("button", "btn sm", { type: "button", "aria-label": t("aiChat.close") });
  btnClose.innerHTML = icon("close");
  head.append(title, btnClose);
  // Akcje okna: na komputerze pod nagłówkiem, na telefonie obok tytułu (silnik).
  const actions = el("div", "modal-actions ai-chat-actions");
  actions.append(btnHistory, btnNew);

  const body = el("div", "uni-body sheet-fill ai-chat-body");
  const chats = el("div", "ai-chats sheet-scroll");
  chats.hidden = true;
  const log = el("div", "ai-log sheet-scroll", { role: "log", "aria-live": "polite" });

  const form = el("form", "ai-form");
  const input = el("textarea", "inp ai-input", { rows: "2", placeholder: t("aiChat.placeholder"), "aria-label": t("aiChat.placeholder") });
  const btnSend = iconButton("send", t("aiChat.send"), "gold");
  btnSend.type = "submit";
  const btnStop = iconButton("stop", t("aiChat.stop"));
  btnStop.hidden = true;
  form.append(input, btnSend, btnStop);

  body.append(chats, log, form);
  panel.append(head, quotaLine, actions, body);
  overlay.append(panel);
  // Okno trafia do strony dopiero przy pierwszym otwarciu — zamknięte nie
  // dokłada do strony drugiego okna (.overlay/.modal) obok jej własnych.
  const attach = () => { if (!overlay.isConnected) document.body.append(overlay); };
  let state = readState();
  let conversation = null;
  let chatId = state.chatId || null;
  let busy = false;
  let abort = null;
  let pendingHref = null;
  let pendingPoint = null;
  const newLogos = new Set();
  let changed = false;

  const lang = getUiLang?.() || "pl";

  // Otwarcie i zamknięcie wspólnym oknem silnika. instant — powrót otwartego
  // okna po przejściu na inną stronę (bez animacji wejścia, adres bez nowego
  // wpisu w historii).
  function setOpen(open, { instant = false } = {}) {
    const isOpen = !overlay.hidden;
    toggle.setAttribute("aria-expanded", String(open));
    state = writeState({ open });
    if (open && !isOpen) {
      overlay.classList.toggle("is-instant", instant);
      attach();
      openDialog(overlay, { onClose: () => setOpen(false), restore: instant });
      if (instant) requestAnimationFrame(() => requestAnimationFrame(() => overlay.classList.remove("is-instant")));
      else input.focus();
      requestAnimationFrame(scrollEnd);
    } else if (!open && isOpen) {
      closeDialog(overlay);
    }
  }

  function scrollEnd() { log.scrollTop = log.scrollHeight; }

  // Podgląd logo utworzonego w tej odpowiedzi (draw_logo, create_text_logo) —
  // tak jak na tablicy; usunięte logo (brak wiersza) pomijane.
  async function showNewLogos() {
    if (!newLogos.size) return;
    const ids = [...newLogos];
    newLogos.clear();
    try {
      const { data } = await ctx.db.from("user_logos").select("id,name,type,payload").in("id", ids);
      if (!data?.length) return;
      const { loadFont5x7, buildLogoPreviewCanvas } = await import("../core/logo-preview.js");
      const glyphs = await loadFont5x7();
      for (const logo of data) {
        const fig = el("figure", "ai-logo-preview");
        fig.append(buildLogoPreviewCanvas(logo, glyphs, 300, 140), el("figcaption", "hint", { text: logo.name }));
        log.append(fig);
      }
      scrollEnd();
    } catch (e) {
      console.warn("[ai] logo preview", e);
    }
  }

  function addItem(item) {
    if (item.role === "tool") {
      const row = el("div", "ai-msg ai-msg--tool");
      row.innerHTML = `${icon("check")}<span></span>`;
      row.querySelector("span").textContent = toolLabel(item.tool);
      log.append(row);
      return row;
    }
    const row = el("div", `ai-msg ai-msg--${item.role}`, { text: item.text || "" });
    log.append(row);
    return row;
  }

  function addNotice(text, kind = "info", action = null) {
    const box = el("div", `callout callout--${kind} ai-notice`);
    box.append(el("div", "", { text }));
    if (action) box.append(action);
    log.append(box);
    scrollEnd();
    return box;
  }

  function render() {
    log.textContent = "";
    if (conversation) for (const item of displayItems(conversation.kind, conversation.history)) addItem(item);
    if (!log.childElementCount) log.append(el("div", "hint ai-empty", { text: t("aiChat.empty") }));
    scrollEnd();
  }

  function setBusy(on) {
    busy = on;
    btnSend.hidden = on;
    btnStop.hidden = !on;
    input.disabled = on;
    overlay.classList.toggle("is-busy", on);
  }

  function showQuota(q) {
    if (!q || !Number.isFinite(Number(q.daily)) || !Number(q.daily)) { quotaLine.hidden = true; return; }
    if (conversation) conversation.quotaDaily = Number(q.daily);
    quotaText.textContent = t("aiChat.quota", { remaining: Number(q.remaining ?? 0), daily: Number(q.daily) });
    quotaLine.hidden = false;
  }

  async function ensureKey() {
    const key = await activeKey().catch(() => null);
    if (key) return key;
    log.querySelector(".ai-empty")?.remove();
    log.querySelector(".ai-no-key")?.remove();
    const locked = (await keyStatus().catch(() => "none")) === "locked";
    const go = el("a", "btn sm gold", { href: linkTo("account", { hash: "ai" }), text: t(locked ? "aiChat.unlockAction" : "aiChat.noKeyAction") });
    addNotice(t(locked ? "aiChat.locked" : "aiChat.noKey"), "info", go).classList.add("ai-no-key");
    return null;
  }

  async function loadConversation() {
    const key = await activeKey().catch(() => null);
    if (!key) { conversation = null; render(); await ensureKey(); return; }
    let history = [];
    if (chatId) {
      try {
        const chat = await getChat(chatId);
        // inny dostawca niż zapisana rozmowa — nowa rozmowa (format historii)
        if (chat.provider === key.provider) history = chat.history || [];
        else chatId = null;
      } catch { chatId = null; }
      writeState({ chatId });
    }
    conversation = startConversation({ provider: key.provider, model: key.model, key: key.key, lang, pageId, history });
    conversation.onQuota = showQuota;
    showQuota(key.quota || null);
    render();
    if (awaitingReply(PROVIDERS[key.provider]?.kind, history)) {
      const again = el("button", "btn sm", { type: "button", text: t("aiChat.resume") });
      const note = addNotice(t("aiChat.interrupted"), "warn", again);
      again.addEventListener("click", () => { note.remove(); void runTurn(null); });
    }
  }

  async function persist() {
    if (!conversation) return;
    const first = displayItems(conversation.kind, conversation.history).find((x) => x.role === "user");
    try {
      chatId = await saveChat({ id: chatId, title: chatTitle(first?.text), provider: conversation.provider, model: conversation.model, history: conversation.history });
      writeState({ chatId });
    } catch (e) {
      console.warn("[ai] history save failed", e);
    }
  }

  const ctx = {
    lang,
    pageId,
    navigate(href) { pendingHref = href; },
    // Wskazanie miejsca (show_on_page) — po zakończeniu odpowiedzi: okno czatu
    // się zamyka, żeby było widać stronę; „Wróć do czatu” otwiera je z powrotem.
    pointAt({ page, place, id, text }) {
      const sameItem = !NEEDS_ID.has(page) || new URLSearchParams(location.search).get("id") === id;
      if (page === pageId && sameItem) {
        pendingPoint = { place, id, text };
        return { ok: true, will_show: true };
      }
      queuePoint({ page, place, id, text });
      const href = ctx.navigateTo(page, NEEDS_ID.has(page) ? id : null);
      return href ? { ok: true, opening_page: href } : { error: "unknown_page" };
    },
    changed(c) {
      changed = true;
      if (c?.type === "logo" && c.id) newLogos.add(c.id);
    },
    async confirm({ kind, tool }) {
      return confirmModal({
        title: t(kind === "send" ? "aiChat.confirm.sendTitle" : "aiChat.confirm.irreversibleTitle"),
        text: t(kind === "send" ? "aiChat.confirm.sendText" : "aiChat.confirm.irreversibleText", { action: toolLabel(tool) }),
        okText: t("aiChat.confirm.ok"),
        cancelText: t("aiChat.confirm.cancel"),
      });
    },
  };

  // Jedna tura: text = nowa wiadomość, null = dokończenie przerwanej odpowiedzi.
  async function runTurn(text) {
    if (busy) return;
    if (!conversation && !(await ensureKey())) return;
    if (!conversation) await loadConversation();
    if (!conversation) return;
    // środowisko narzędzi (baza, karta, maile…) — raz na stronę
    if (!ctx.db) Object.assign(ctx, await browserToolEnv({ navigate: (href) => ctx.navigate(href) }));
    log.querySelector(".ai-empty")?.remove();
    setBusy(true);
    abort = new AbortController();
    pendingHref = null;
    pendingPoint = null;
    clearPointer();
    changed = false;
    newLogos.clear();
    let live = null;
    const opts = {
      signal: abort.signal,
      onText(fragment) {
        if (!live) live = addItem({ role: "assistant", text: "" });
        live.textContent += fragment;
        scrollEnd();
      },
      onStep(s) {
        live = null;
        for (const c of s.calls) addItem({ role: "tool", tool: c.name });
        scrollEnd();
      },
      // zapis zaraz po wiadomości — przejście na inną stronę jej nie gubi
      onUserMessage: () => { void persist(); },
    };
    try {
      if (text !== null) {
        addItem({ role: "user", text });
        scrollEnd();
        await sendMessage(conversation, text, ctx, opts);
      } else {
        await continueReply(conversation, ctx, opts);
      }
    } catch (e) {
      if (e?.name !== "AbortError") {
        const note = addNotice(e?.message || String(e), "bad");
        // limit asystenta Familijnej: własny klucz albo prośba o większy limit
        if (["dailyLimit", "globalLimit", "builtinOff"].includes(e?.code)) {
          const own = el("a", "btn sm gold", { href: linkTo("account", { hash: "ai" }), text: t("aiChat.addOwnKey") });
          note.append(own);
          if (e.code === "dailyLimit") showQuota({ remaining: 0, daily: conversation?.quotaDaily || 0 });
        }
      }
    } finally {
      setBusy(false);
      abort = null;
      await persist();
    }
    await showNewLogos();
    if (pendingPoint) {
      const point = pendingPoint;
      pendingPoint = null;
      setOpen(false);
      await pointHere(pageId, point, pointActions);
      return;
    }
    if (pendingHref) {
      // przejście po wskazanie: okno czatu zamknięte, wskazanie po wczytaniu strony
      let pointing = false;
      try { pointing = !!sessionStorage.getItem("familijna:ai-point"); } catch { pointing = false; }
      if (pointing) state = writeState({ open: false });
      location.assign(pendingHref);
      return;
    }
    if (changed && RELOAD_ON_CHANGE.has(pageId)) location.reload();
  }

  async function showChats() {
    chats.hidden = !chats.hidden;
    if (chats.hidden) return;
    chats.textContent = "";
    let list = [];
    try { list = await listChats(); } catch { /* bez listy */ }
    if (!list.length) { chats.append(el("div", "hint", { text: t("aiChat.historyEmpty") })); return; }
    for (const c of list) {
      const row = el("div", "ai-chat-row");
      const open = el("button", "btn-plain ai-chat-open", { type: "button", text: c.title || t("aiChat.untitled") });
      const del = iconButton("trash", t("aiChat.deleteChat"));
      open.addEventListener("click", async () => {
        chatId = c.id;
        writeState({ chatId });
        chats.hidden = true;
        await loadConversation();
      });
      del.addEventListener("click", async () => {
        await deleteChat(c.id).catch(() => {});
        if (chatId === c.id) { chatId = null; writeState({ chatId }); await loadConversation(); }
        row.remove();
      });
      row.append(open, del);
      chats.append(row);
    }
  }

  toggle.addEventListener("click", () => setOpen(overlay.hidden));
  btnClose.addEventListener("click", () => setOpen(false));
  btnHistory.addEventListener("click", () => { void showChats(); });
  btnNew.addEventListener("click", async () => {
    if (busy) return;
    chatId = null;
    writeState({ chatId });
    chats.hidden = true;
    await loadConversation();
  });
  btnStop.addEventListener("click", () => abort?.abort());
  input.value = state.draft || "";
  input.addEventListener("input", () => { writeState({ draft: input.value }); });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); }
  });
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text || busy) return;
    input.value = "";
    writeState({ draft: "" });
    void runTurn(text);
  });

  // Dymek wskazania: „Wróć do czatu” otwiera okno; „Zrobione — dalej” otwiera
  // je i wysyła wiadomość, żeby czat sprawdził krok i pokazał następny.
  const pointActions = {
    onBack: () => setOpen(true),
    onNext: () => { setOpen(true); void runTurn(t("aiChat.pointer.doneMessage")); },
  };

  const urlOpen = new URLSearchParams(location.search).get("dialog") === AI_DIALOG_ID;
  if (state.open || urlOpen) setOpen(true, { instant: true });
  void runQueuedPoint(pageId, pointActions);
  await loadConversation();
}
