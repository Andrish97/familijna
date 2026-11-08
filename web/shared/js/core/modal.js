import { icon, iconText } from "./icons.js?v=v2026-11-08T15451";
import { setMessage } from "./toast.js?v=v2026-11-08T15451";
import { t } from "../../translation/translation.js?v=v2026-11-08T15451";
import { openDialog, closeDialog, isSheetViewport, animateClose } from "./modal-sheet.js?v=v2026-11-08T15451";
import { setProgress, ratioPct } from "./ui-metrics.js?v=v2026-11-08T15451";

let modalSeq = 0;

const SHEET_FIELDS = "input:not([type=hidden]), select, textarea, [contenteditable=true]";

function modalText(key, fallback) {
  return typeof t === "function" ? t(key) : fallback;
}

function buildModal({
  title,
  text,
  okText,
  cancelText,
  showCancel = true,
  body = null,
  sheet = null,
  modalClass = "",
  closable = true,
  overlayId = "",
  buttons = null,
} = {}) {
  modalSeq += 1;
  const titleId = `uniTitle${modalSeq}`;
  const subId = `uniSub${modalSeq}`;

  const overlay = document.createElement("div");
  overlay.className = "overlay";
  if (overlayId) overlay.id = overlayId;
  overlay.classList.add("uni-overlay"); /* tło: .overlay.uni-overlay w components.css */
  // sheet: rozbudowana treść (np. szczegóły statystyki, podgląd
  // wiadomości) przekazana przez wywołującego — na telefonie zastępuje
  // treść strony zamiast być małym oknem, patrz js/core/modal-sheet.js.
  // Krótkie confirm/alert nigdy tego nie przekazują, więc ich wygląd
  // się nie zmienia. WAŻNE: klasa idzie na .overlay (jak w statycznym
  // HTML wszystkich innych modali), nie na .modal — reguła CSS "ukryj
  // resztę main.wrap" wyklucza z ukrycia po klasie .modal--sheet na
  // BEZPOŚREDNIM dziecku main.wrap (czyli .overlay), nie na jego
  // wewnętrznym .modal.
  if (sheet) overlay.classList.add("modal--sheet");
  // sheet.fit: okno od dołu z wysokością dopasowaną do treści (np. zmiana nazwy)
  if (sheet?.fit) overlay.classList.add("sheet-fit");

  const modal = document.createElement("div");
  modal.className = `modal uni-modal${modalClass ? ` ${modalClass}` : ""}`;
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-labelledby", titleId);
  modal.setAttribute("aria-describedby", subId);

  const head = document.createElement("div");
  head.className = "uni-head";

  const titleEl = document.createElement("div");
  titleEl.className = "mTitle";
  titleEl.id = titleId;
  titleEl.textContent = title;

  const closeBtn = document.createElement("button");
  closeBtn.className = "btn sm";
  closeBtn.type = "button";
  closeBtn.setAttribute("aria-label", modalText("common.modal.closeLabel", "Zamknij"));
  closeBtn.innerHTML = icon("close");

  head.appendChild(titleEl);
  head.appendChild(closeBtn);
  closeBtn.hidden = !closable;

  const sub = document.createElement("div");
  sub.className = "mSub";
  sub.id = subId;
  sub.textContent = text;
  if (!text) sub.hidden = true;

  const bodyWrap = document.createElement("div");
  bodyWrap.className = "uni-body";
  if (body) bodyWrap.appendChild(body);

  const foot = document.createElement("div");
  foot.className = "importRow uni-foot modal-actions fit-row"; // jeden rząd (core/fit-row.js)

  const okBtn = document.createElement("button");
  okBtn.className = "btn sm gold";
  okBtn.type = "button";
  okBtn.innerHTML = `${icon("check")}<span></span>`;
  okBtn.querySelector("span").textContent = okText;

  const cancelBtn = document.createElement("button");
  cancelBtn.className = "btn sm";
  cancelBtn.type = "button";
  cancelBtn.innerHTML = `${icon("close")}<span></span>`;
  cancelBtn.querySelector("span").textContent = cancelText;

  const msg = document.createElement("div");
  msg.className = "importMsg";
  msg.textContent = "";

  foot.appendChild(msg);
  // buttons: własny zestaw przycisków (np. trzy) zamiast Anuluj/OK --
  // [{ value, text, icon?, kind?: "gold"|"danger" }]; kolejność jak w tablicy.
  const choiceBtns = [];
  if (Array.isArray(buttons) && buttons.length) {
    for (const b of buttons) {
      const btn = document.createElement("button");
      btn.className = `btn sm${b.kind ? ` ${b.kind}` : ""}`;
      btn.type = "button";
      btn.dataset.value = String(b.value);
      btn.innerHTML = `${b.icon ? icon(b.icon) : ""}<span></span>`;
      btn.querySelector("span").textContent = b.text;
      if (b.disabled) btn.disabled = true;
      foot.appendChild(btn);
      choiceBtns.push({ btn, value: b.value });
    }
  } else {
    if (showCancel) foot.appendChild(cancelBtn);
    if (okText !== null) foot.appendChild(okBtn);
  }

  modal.appendChild(head);
  modal.appendChild(sub);
  if (body) modal.appendChild(bodyWrap);
  if (foot.querySelector(".btn")) modal.appendChild(foot);

  overlay.appendChild(modal);

  return {
    overlay,
    modal,
    titleEl,
    sub,
    okBtn,
    cancelBtn,
    closeBtn,
    msg,
    choiceBtns,
  };
}

function openModal({
  title,
  text,
  okText,
  cancelText,
  showCancel = true,
  body = null,
  initialFocus = null,
  onReady = null,
  sheet = null,
  modalClass = "",
  closable = true,
  onOk = null,
  controller = null,
  overlayId = "",
  buttons = null,
  onChoice = null,
} = {}) {
  // Na środku zostaje tylko okienko „przeczytaj i potwierdź” (decyzja
  // użytkownika 2026-11-08, E28): okno z polem do wpisania na dotyku
  // (telefon, tablet) wysuwa się od dołu, dopasowane do treści.
  if (!sheet && body?.querySelector?.(SHEET_FIELDS) && isSheetViewport()) sheet = { fit: true };
  return new Promise((resolve) => {
    const fallbackTitle = showCancel
      ? modalText("common.modal.confirmTitle", "Potwierdź")
      : modalText("common.modal.alertTitle", "Informacja");
    const fallbackText = showCancel
      ? modalText("common.modal.confirmText", "Na pewno?")
      : "—";
    const fallbackOk = showCancel
      ? modalText("common.modal.confirmOk", "Tak")
      : modalText("common.modal.alertOk", "OK");
    const fallbackCancel = modalText("common.modal.confirmCancel", "Nie");
    const { overlay, titleEl, sub, okBtn, cancelBtn, closeBtn, msg, choiceBtns } = buildModal({
      title: title ?? fallbackTitle,
      text: text ?? fallbackText,
      okText: okText === null ? null : (okText ?? fallbackOk),
      cancelText: cancelText ?? fallbackCancel,
      showCancel,
      body,
      sheet,
      modalClass,
      closable,
      overlayId,
      buttons,
    });

    try {
      if (typeof onReady === "function") onReady({ overlay, okBtn, cancelBtn, closeBtn, buttons: Object.fromEntries(choiceBtns.map(({ btn, value }) => [value, btn])) });
    } catch {
      // ignore
    }

    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      // Okno znika po animacji zamknięcia (modal-sheet.js), wynik od razu.
      const remove = () => overlay.remove();
      if (sheet) closeDialog(overlay, remove);
      else animateClose(overlay, remove);
      try {
        document.dispatchEvent(new CustomEvent("uni-modal:closed", { detail: { value } }));
      } catch {
        // ignore
      }
      resolve(value);
    };

    // controller: okno sterowane z zewnątrz (np. postęp eksportu) -- zamyka je
    // wywołujący albo, po allowClose(), użytkownik (X, Esc, tło, OK).
    let canClose = closable;
    if (controller) {
      controller.allowClose = () => {
        canClose = true;
        closeBtn.hidden = false;
        okBtn.hidden = false;
        if (okBtn.isConnected) setTimeout(() => okBtn.focus(), 0);
      };
      controller.close = (value = true) => finish(value);
      controller.setText = (value) => { sub.textContent = value || ""; sub.hidden = !value; };
      controller.setTitle = (value) => { if (value) titleEl.textContent = value; };
      controller.setMessage = (value, kind = "") => setMessage(msg, value, kind);
    }

    // onOk: zapis z okna -- zwraca tekst błędu (okno zostaje, błąd w stopce)
    // albo nic/true (okno się zamyka); przyciski zablokowane na czas zapisu.
    let busy = false;
    okBtn.addEventListener("click", async () => {
      if (typeof onOk !== "function") return finish(true);
      if (busy) return;
      busy = true;
      okBtn.disabled = true;
      if (cancelBtn) cancelBtn.disabled = true;
      setMessage(msg);
      try {
        const res = await onOk();
        if (typeof res === "string" && res) { setMessage(msg, res, "error"); return; }
        if (res === false) return;
        finish(true);
      } catch (err) {
        setMessage(msg, String(err?.message || err || ""), "error");
      } finally {
        busy = false;
        okBtn.disabled = false;
        if (cancelBtn) cancelBtn.disabled = false;
      }
    });
    cancelBtn?.addEventListener("click", () => finish(false));
    // Własne przyciski: wynik = value klikniętego; onChoice(value) może zapisać
    // w oknie (tekst błędu -> okno zostaje, false -> zostaje bez komunikatu).
    for (const { btn, value } of choiceBtns) {
      btn.addEventListener("click", async () => {
        if (typeof onChoice !== "function") return finish(value);
        if (busy) return;
        busy = true;
        choiceBtns.forEach(({ btn: b }) => { b.dataset.wasDisabled = b.disabled ? "1" : ""; b.disabled = true; });
        setMessage(msg);
        try {
          const res = await onChoice(value);
          if (typeof res === "string" && res) { setMessage(msg, res, "error"); return; }
          if (res === false) return;
          finish(value);
        } catch (err) {
          setMessage(msg, String(err?.message || err || ""), "error");
        } finally {
          busy = false;
          choiceBtns.forEach(({ btn: b }) => { b.disabled = b.dataset.wasDisabled === "1"; });
        }
      });
    }

    // X: Esc i klik w tło klikają go (modal-sheet.js); ukryty X okna postępu
    // zamyka dopiero po allowClose().
    closeBtn.addEventListener("click", () => { if (canClose) finish(false); });

    // Modal w trybie sheet musi być dzieckiem <main class="wrap">/.explorer
    // (przed .footer), żeby reguła CSS "ukryj resztę treści strony" go
    // objęła i żeby na telefonie zastępował treść strony zamiast lądować
    // za stopką (patrz css/base.css, sekcja "Modal sheet (mobile)").
    const sheetParent = sheet && document.querySelector("main.wrap, main.explorer");
    if (sheetParent) {
      const footer = sheetParent.querySelector(":scope > .footer");
      if (footer) sheetParent.insertBefore(overlay, footer);
      else sheetParent.appendChild(overlay);
    } else {
      document.body.appendChild(overlay);
    }

    if (sheet) openDialog(overlay, { onClose: () => finish(false) });

    const focusTarget = initialFocus || okBtn;
    setTimeout(() => focusTarget?.focus?.(), 0);
  });
}

export function confirmModal({ title, text, okText, cancelText, showCancel = true, body = null, initialFocus = null, onReady, sheet = null, modalClass = "", onOk = null } = {}) {
  return openModal({
    title: title ?? modalText("common.modal.confirmTitle", "Potwierdź"),
    text: text ?? modalText("common.modal.confirmText", "Na pewno?"),
    okText: okText ?? modalText("common.modal.confirmOk", "Tak"),
    cancelText: cancelText ?? modalText("common.modal.confirmCancel", "Nie"),
    showCancel,
    body,
    initialFocus,
    onReady,
    sheet,
    modalClass,
    onOk,
  });
}

/** controller (opcjonalny): po otwarciu dostaje setText(), close() -- okno odświeżane z zewnątrz. */
export function alertModal({ title, text, okText, body = null, onReady, sheet = null, modalClass = "", controller = null, overlayId = "" } = {}) {
  return openModal({
    title: title ?? modalText("common.modal.alertTitle", "Informacja"),
    text: text ?? "—",
    okText: okText ?? modalText("common.modal.alertOk", "OK"),
    showCancel: false,
    body,
    onReady,
    sheet,
    modalClass,
    controller,
    overlayId,
  });
}

/**
 * Okno z własnym zestawem przycisków (np. trzy). Wynik: value klikniętego
 * przycisku albo false (X, Esc, klik w tło).
 * @param {{ title?:string, text?:string, body?:HTMLElement|null,
 *   buttons: {value:any, text:string, icon?:string, kind?:string, disabled?:boolean}[],
 *   onChoice?: (value:any) => any, onReady?: Function, sheet?: object|null, modalClass?: string, overlayId?: string }} opts
 */
export function choiceModal({ title, text = "", body = null, buttons, onChoice = null, onReady = null, sheet = null, modalClass = "", overlayId = "" } = {}) {
  return openModal({ title, text, body, buttons, onChoice, onReady, sheet, modalClass, overlayId, showCancel: false });
}

/**
 * Okno postępu (eksport, przygotowanie pliku): bez X i bez przycisków,
 * Esc i klik w tło go nie zamykają. Zamyka je wywołujący.
 * @returns {{ setText(text:string):void, setMessage(text:string, kind?:string):void, close():void, body:HTMLElement }}
 */
export function progressModal({ title, text = "", doneText } = {}) {
  const body = document.createElement("div");
  body.className = "uni-progress";
  body.innerHTML = `<div class="uni-progress-row"><div class="uni-progress-step"></div><div class="uni-progress-count"></div></div>`
    + `<div class="progress"><div class="progress-bar"></div></div><div class="importMsg uni-progress-msg"></div>`;
  const stepEl = body.querySelector(".uni-progress-step");
  const countEl = body.querySelector(".uni-progress-count");
  const barEl = body.querySelector(".progress-bar");
  const msgEl = body.querySelector(".uni-progress-msg");
  const rowEl = body.querySelector(".uni-progress-row");
  const controller = {};
  controller.closed = openModal({
    title, text, okText: doneText ?? modalText("common.done", "Gotowe"), showCancel: false, body,
    closable: false, controller, modalClass: "modal--narrow",
    onReady: ({ okBtn }) => { okBtn.hidden = true; },
  });
  /** Krok, licznik i pasek; isError/done -- ikona przy kroku i przycisk „Gotowe”. */
  controller.update = ({ step, i = 0, n = 0, msg = "", isError = false, done = false } = {}) => {
    if (step != null) {
      if (isError || done) stepEl.innerHTML = iconText(isError ? "error" : "check", String(step));
      else stepEl.textContent = String(step);
    }
    // bez kroku i liczby elementów (np. jeden plik) wiersz z licznikiem znika
    countEl.textContent = Number(n) > 0 ? `${Number(i) || 0}/${Number(n)}` : "";
    rowEl.hidden = !stepEl.textContent && !countEl.textContent;
    setProgress(barEl, ratioPct(i, n));
    msgEl.textContent = msg ? String(msg) : "";
    msgEl.dataset.kind = isError ? "error" : "";
    if (isError || done) controller.allowClose();
  };
  // komunikat pod paskiem (nie w stopce okna)
  controller.setMessage = (value, kind = "") => { msgEl.textContent = value || ""; msgEl.dataset.kind = kind; };
  /** Sam pasek (0–100) bez licznika, np. eksport jednego pliku. */
  controller.setPercent = (pct, { isError = false } = {}) => {
    setProgress(barEl, pct);
    barEl.dataset.kind = isError ? "error" : "";
    rowEl.hidden = !stepEl.textContent && !countEl.textContent;
  };
  return controller;
}

export function promptModal({
  title,
  text,
  okText,
  cancelText,
  value = "",
  placeholder = "",
  onReady = null,
  maxLength = null,
  selectAll = false,
  validate = null,
  onSubmit = null,
  search = false,
} = {}) {
  const input = document.createElement("input");
  input.type = "text";
  // search: pole jak w oknie „Przenieś do” menedżera bazy (lupa w polu).
  input.className = search ? "searchText uni-inp" : "inp uni-inp";
  input.value = value;
  input.placeholder = placeholder;
  if (maxLength) input.maxLength = maxLength;
  let body = input;
  if (search) {
    input.setAttribute("enterkeyhint", "search");
    body = document.createElement("label");
    body.className = "searchBox searchBox--field";
    body.innerHTML = icon("search");
    body.append(input);
  }

  // validate(value) -> tekst błędu albo nic; onSubmit(value) -> zapis,
  // zwraca tekst błędu (okno zostaje) albo nic (okno się zamyka).
  const onOk = (validate || onSubmit) ? async () => {
    const v = input.value;
    const err = validate ? await validate(v) : null;
    if (err) return err;
    return onSubmit ? onSubmit(v) : true;
  } : null;

  return openModal({
    title: title ?? modalText("common.modal.promptTitle", "Wpisz"),
    text: text ?? modalText("common.modal.promptText", "Podaj wartość:"),
    okText: okText ?? modalText("common.modal.promptOk", "Zapisz"),
    cancelText: cancelText ?? modalText("common.modal.promptCancel", "Anuluj"),
    showCancel: true,
    body,
    initialFocus: input,
    modalClass: "modal--narrow",
    // telefon / tablet dotykowy: roletka od dołu dopasowana do treści
    sheet: isSheetViewport() ? { fit: true } : null,
    onOk,
    onReady: (ctx) => {
      // Enter = Zapisz
      input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); ctx.okBtn.click(); } });
      if (selectAll) setTimeout(() => input.select(), 0);
      onReady?.({ ...ctx, input });
    },
  }).then((ok) => (ok ? input.value : null));
}
