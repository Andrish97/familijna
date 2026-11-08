import { t } from "../../translation/translation.js?v=v2026-11-08T18554";
import { ensureSupportEntryPoint } from "./support-modal.js?v=v2026-11-08T18554";

let dialog = null;
let opening = null;
export function openContactModal(opts = {}) {
  if (document.body?.hasAttribute("data-device-screen")) return Promise.resolve();
  if (opening) return opening;
  opening = import("./contact-dialog.js?v=v2026-11-08T18554").then(module => {
    dialog = module;
    return module.openContactModal(opts);
  }).finally(() => { opening = null; });
  return opening;
}
export function closeContactModal() { dialog?.closeContactModal(); }

function ensureContactEntryPoint() {
  if (document.body?.hasAttribute("data-device-screen")) return;
  if (document.querySelector('[data-contact-modal], .btn-contact-footer')) return;
  let footer = document.querySelector('.footer');
  if (!footer) {
    footer = document.createElement('footer');
    footer.className = 'footer contact-footer-entry';
    const host = document.querySelector('main.wrap');
    if (host) host.append(footer);
    else { footer.classList.add('contact-footer-entry--floating'); document.body.append(footer); }
  }
  const button = document.createElement('button');
  button.type = 'button'; button.className = 'btn-contact-footer';
  button.setAttribute('data-contact-modal',''); button.setAttribute('data-i18n','common.contactBtn');
  const label = t('common.contactBtn');
  button.textContent = label === 'common.contactBtn' ? 'Kontakt' : label;
  footer.append(button);
}

if (typeof document !== "undefined") {
  const ensureFooterEntryPoints = () => { ensureContactEntryPoint(); ensureSupportEntryPoint(); };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ensureFooterEntryPoints, { once: true });
  else ensureFooterEntryPoints();
  document.addEventListener("click", (e) => {
    if (e.target.closest("[data-contact-modal], .btn-contact-footer")) void openContactModal().catch(error => console.error("[contact] open failed", error));
  });
}
