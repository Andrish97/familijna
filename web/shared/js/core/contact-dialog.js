import { t, getUiLang } from "../../translation/translation.js?v=v2026-11-08T16070";
import { openDialog, closeDialog, isSheetViewport } from "./modal-sheet.js?v=v2026-11-08T16070";
import { icon, iconText } from "./icons.js?v=v2026-11-08T16070";
import { getTurnstileToken } from "./turnstile.js?v=v2026-11-08T16070";


let modalEl = null;
const MAX_FILES = 5;
const MAX_FILE_BYTES = 5 * 1024 * 1024;

// Załączniki wysyłane (do 5 plików po 5 MB) i pominięte.
function splitAttachments(fileList) {
  const accepted = [], skipped = [];
  for (const file of Array.from(fileList || [])) {
    if (file.size > MAX_FILE_BYTES || accepted.length >= MAX_FILES) skipped.push(file);
    else accepted.push(file);
  }
  return { accepted, skipped };
}
let isSubmitting = false;
// Okno kontaktu zawsze korzysta ze wspólnego okna od dołu (modal-sheet.js).
let usedSheetMode = false;

function buildModalHtml() {
  return `
    <header class="topbar topbar-layout-4 contact-modal-topbar" hidden>
      <div class="topbar-section topbar-section-1"><button class="btn sm" id="cModalBack" type="button"></button></div>
      <div class="topbar-section topbar-section-2"></div>
      <div class="topbar-section topbar-section-3"></div>
      <div class="topbar-section topbar-section-4"></div>
    </header>
    <div class="modal">
      <div class="mHead">
        <div class="mTitle" id="cModalTitle"></div>
        <button class="btn sm" id="cModalX" type="button" aria-label="Zamknij">${icon("close")}</button>
      </div>
      <div id="cModalForm" class="uni-body contact-form">
        <div class="contact-field">
          <label class="field-label" id="cModalEmailLabel" for="cModalEmail"></label>
          <input class="inp" id="cModalEmail" type="email" autocomplete="email"/>
        </div>
        <div class="contact-field">
          <label class="field-label" id="cModalTicketLabel" for="cModalTicket"></label>
          <input class="inp" id="cModalTicket" type="text" autocomplete="off"/>
        </div>
        <div class="contact-field" id="cModalSubjectField">
          <label class="field-label" id="cModalSubjectLabel" for="cModalSubject"></label>
          <input class="inp" id="cModalSubject" type="text"/>
        </div>
        <div class="contact-field">
          <label class="field-label" id="cModalMessageLabel" for="cModalMessage"></label>
          <textarea class="inp" id="cModalMessage" rows="7"></textarea>
        </div>
        <div class="contact-field">
          <div class="field-label" id="cModalAttachLabel"></div>
          <input type="file" id="cModalAttachments" multiple hidden/>
          <label for="cModalAttachments" class="btn sm contact-attach-btn">
            ${icon("paperclip")}
            <span id="cModalAttachBtnLabel"></span>
          </label>
          <div id="cModalAttachHint" class="contact-hint"></div>
          <div id="cModalFileList" class="contact-files"></div>
        </div>
        <div id="cModalCaptcha" class="contact-captcha" hidden></div>
        <div id="cModalError" class="contact-error" hidden role="alert"></div>
      </div>
      <div id="cModalSuccess" class="uni-body contact-success" hidden>
        <div class="contact-success-icon">${icon("check")}</div>
        <div class="contact-success-title" id="cModalSuccessTitle"></div>
        <div class="contact-success-ticket" id="cModalSuccessTicket"></div>
      </div>
      <div id="cModalFormActions" class="uni-foot modal-actions">
        <button class="btn sm" id="cModalClose" type="button"></button>
        <button class="btn sm gold" id="cModalSubmit" type="button"></button>
      </div>
      <div id="cModalSuccessActions" class="uni-foot modal-actions" hidden>
        <button class="btn sm gold" id="cModalDone" type="button"></button>
      </div>
    </div>`;
}

function applyLabels() {
  const set = (id, key) => { const el = document.getElementById(id); if (el) el.textContent = t(key) || id; };
  set("cModalTitle",        "contact.modal.title");
  set("cModalEmailLabel",   "contact.modal.email");
  set("cModalTicketLabel",  "contact.modal.ticket");
  set("cModalSubjectLabel", "contact.modal.subject");
  set("cModalMessageLabel", "contact.modal.message");
  set("cModalAttachLabel",    "contact.modal.attachments");
  set("cModalAttachBtnLabel", "contact.modal.chooseFiles");
  const setAction = (id, key, iconName) => { const el = document.getElementById(id); if (el) el.innerHTML = iconText(iconName, t(key) || id); };
  setAction("cModalClose",  "common.cancel", "close");
  setAction("cModalSubmit", "contact.modal.submit", "envelope-out");
  set("cModalSuccessTitle", "contact.modal.successTitle");
  setAction("cModalDone",   "common.done", "check");
  const xBtn = document.getElementById("cModalX");
  if (xBtn) xBtn.setAttribute("aria-label", t("common.modal.closeLabel"));
  const backBtn = document.getElementById("cModalBack");
  if (backBtn) backBtn.innerHTML = iconText("arrow-left", t("common.modalBack"));
  if (isSheetViewport() && usedSheetMode) document.querySelectorAll('.sheet-back-active').forEach(button => { button.innerHTML = iconText('arrow-left', t('common.modalBack')); });
  modalEl?.querySelector('.contact-modal-topbar')?.toggleAttribute('hidden', !isSheetViewport() || usedSheetMode);
  const ticketInp = document.getElementById("cModalTicket");
  if (ticketInp) ticketInp.placeholder = t("contact.modal.ticketPlaceholder");
}

// W trakcie wysyłki (także gdy czeka na wyzwanie Turnstile) „Wyślij” zostaje
// z ikoną i etykietą, tylko wyłączony -- dawny sam „…” wyglądał jak menu
// „więcej” i chował główną akcję (uwaga właściciela 2026-10-22); ta sama
// szerokość, więc nagłówek arkusza nie przeskakuje.
function setSubmitBusy(busy) {
  isSubmitting = busy;
  const btn = document.getElementById("cModalSubmit");
  if (!btn) return;
  btn.disabled = busy;
  if (busy) btn.setAttribute("aria-busy", "true");
  else btn.removeAttribute("aria-busy");
}

function ensureModal() {
  if (modalEl) return;
  modalEl = document.createElement("div");
  modalEl.id = "contactModalOverlay";
  modalEl.className = "overlay modal--sheet contact-modal-overlay";
  modalEl.hidden = true;
  modalEl.innerHTML = buildModalHtml();
  const modal = modalEl.querySelector(":scope > .modal");
  modal?.classList.add("uni-modal");
  modal?.setAttribute("role", "dialog");
  modal?.setAttribute("aria-modal", "true");
  modal?.setAttribute("aria-labelledby", "cModalTitle");
  document.body.appendChild(modalEl);

  document.getElementById("cModalClose")?.addEventListener("click", closeContactModal);
  document.getElementById("cModalX")?.addEventListener("click", closeContactModal);
  document.getElementById("cModalBack")?.addEventListener("click", closeContactModal);
  document.getElementById("cModalDone")?.addEventListener("click", closeContactModal);
  document.getElementById("cModalSubmit")?.addEventListener("click", submitContact);
  document.getElementById("cModalTicket")?.addEventListener("input", () => {
    const ticket = document.getElementById("cModalTicket")?.value.trim();
    const subjectField = document.getElementById("cModalSubjectField");
    if (subjectField) subjectField.hidden = !!ticket;
  });

  document.getElementById("cModalAttachments")?.addEventListener("change", (e) => {
    const list = document.getElementById("cModalFileList");
    if (!list) return;
    const { accepted, skipped } = splitAttachments(e.target.files);
    // Nazwa pliku jako tekst (nazwa może zawierać znaczniki HTML).
    list.replaceChildren(...accepted.map(f => {
      const chip = document.createElement("span");
      chip.className = "contact-file";
      chip.textContent = f.name;
      return chip;
    }));
    // Pliki ponad limit nie są wysyłane -- mówimy o tym od razu, przy wyborze.
    const hint = document.getElementById("cModalAttachHint");
    if (hint) hint.textContent = skipped.length ? t("contact.modal.attachSkipped", { files: skipped.map(f => f.name).join(", ") }) : "";
  });

  window.addEventListener("i18n:lang", applyLabels);
}

async function prefillEmail() {
  try {
    const { sb } = await import("./supabase.js?v=v2026-11-08T16070");

    const { data } = await sb().auth.getSession();
    const user = data?.session?.user;
    const isGuest = user?.user_metadata?.is_guest === true || user?.app_metadata?.is_guest === true;
    const email = user?.email;
    if (email && !isGuest) {
      const inp = document.getElementById("cModalEmail");
      if (inp && !inp.value) inp.value = email;
    }
  } catch {}
}

export async function openContactModal(opts = {}) {
  if (document.body?.hasAttribute("data-device-screen")) return;
  ensureModal();
  applyLabels();

  document.getElementById("cModalForm").hidden = false;
  document.getElementById("cModalSuccess").hidden = true;
  document.getElementById("cModalFormActions").hidden = false;
  document.getElementById("cModalSuccessActions").hidden = true;
  const errEl = document.getElementById("cModalError");
  if (errEl) { errEl.hidden = true; errEl.textContent = ""; }

  const fileInput = document.getElementById("cModalAttachments");
  if (fileInput) fileInput.value = "";
  const fileList = document.getElementById("cModalFileList");
  if (fileList) fileList.innerHTML = "";
  const attachHint = document.getElementById("cModalAttachHint");
  if (attachHint) attachHint.textContent = "";

  const ticketInp = document.getElementById("cModalTicket");
  if (opts.ticket && ticketInp) {
    ticketInp.value = opts.ticket;
    const subjectField = document.getElementById("cModalSubjectField");
    if (subjectField) subjectField.hidden = true;
  } else if (ticketInp) {
    ticketInp.value = "";
    const subjectField = document.getElementById("cModalSubjectField");
    if (subjectField) subjectField.hidden = false;
  }

  // Okno od dołu (telefon/tablet dotykowy) leży nad całą stroną, jak inne
  // rozbudowane okna -- zawsze w body, bez przejmowania przycisku wstecz
  // (wcześniej wstawiane do main z z-index:auto chowało pasek okna pod topbarem).
  usedSheetMode = true;
  modalEl.classList.add("modal--sheet");
  document.body.appendChild(modalEl);

  openDialog(modalEl, { onClose: closeContactModal });
  applyLabels();
  await prefillEmail();
  const emailInp = document.getElementById("cModalEmail");
  if (emailInp && !emailInp.value) emailInp.focus();
  else document.getElementById("cModalMessage")?.focus();
}

export function closeContactModal() {
  if (!modalEl) return;
  closeDialog(modalEl);
}

async function submitContact() {
  if (isSubmitting) return;

  const email   = (document.getElementById("cModalEmail")?.value || "").trim();
  const ticket  = (document.getElementById("cModalTicket")?.value || "").trim();
  const subject = (document.getElementById("cModalSubject")?.value || "").trim();
  const message = (document.getElementById("cModalMessage")?.value || "").trim();
  const lang    = getUiLang();
  const errEl   = document.getElementById("cModalError");

  const showErr = (msg) => { if (errEl) { errEl.textContent = msg; errEl.hidden = false; } };

  if (!email || !email.includes("@")) { showErr(t("contact.modal.errEmail")); return; }
  if (!message || message.length < 5) { showErr(t("contact.modal.errMessage")); return; }
  if (!ticket && !subject)            { showErr(t("contact.modal.errSubject")); return; }

  setSubmitBusy(true);
  if (errEl) { errEl.hidden = true; }

  try {
    // Convert attachments to base64
    const attachments = [];
    const fileInput = document.getElementById("cModalAttachments");
    if (fileInput?.files?.length) {
      for (const file of splitAttachments(fileInput.files).accepted) {
        const b64 = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result.split(",")[1]);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        attachments.push({ filename: file.name, mime_type: file.type || "application/octet-stream", data_b64: b64 });
      }
    }

    // Weryfikacja Turnstile po stronie Workera (token jednorazowy).
    let captcha_token;
    try {
      captcha_token = await getTurnstileToken(document.getElementById("cModalCaptcha"), { lang, size: "flexible" });
    } catch {
      showErr(t("auth.captchaRequired"));
      return;
    }
    let res;
    if (ticket) {
      res = await fetch("/_api/contact/append", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, ticket, message, lang, attachments, captcha_token }),
      });
    } else {
      res = await fetch("/_api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, subject: subject || message.slice(0, 80), message, lang, attachments, captcha_token }),
      });
    }

    if (res.status === 429) { showErr(t("contact.rateLimited")); return; }
    if (res.status === 400 || res.status === 503) {
      const failed = await res.clone().json().catch(() => ({}));
      if (String(failed?.error || "").startsWith("captcha")) { showErr(t("auth.captchaRequired")); return; }
    }
    if (!res.ok) throw new Error(await res.text());
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || "send_failed");

    document.getElementById("cModalForm").hidden = true;
    document.getElementById("cModalFormActions").hidden = true;
    document.getElementById("cModalSuccess").hidden = false;
    document.getElementById("cModalSuccessActions").hidden = false;
    const ticketEl = document.getElementById("cModalSuccessTicket");
    if (ticketEl) {
      ticketEl.textContent = json.ticket_number
        ? `${t("contact.modal.ticketLabel")} ${json.ticket_number}`
        : (ticket ? `${t("contact.modal.addedTo")} ${ticket}` : "");
    }
    ["cModalEmail","cModalTicket","cModalSubject","cModalMessage"].forEach(id => {
      const el = document.getElementById(id); if (el) el.value = "";
    });
  } catch (err) {
    showErr(String(err?.message || err));
  } finally {
    setSubmitBusy(false);
  }
}


if (typeof document !== "undefined") {
  window.matchMedia("(max-width:600px)").addEventListener("change", applyLabels);
  window.addEventListener("i18n:lang", applyLabels);
}
