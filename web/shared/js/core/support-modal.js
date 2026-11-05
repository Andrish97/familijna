import { t } from "../../translation/translation.js?v=v2026-11-05T18064";
import { icon } from "./icons.js?v=v2026-11-05T18064";

// „Postaw kawę”: dobrowolne wsparcie twórcy, bez żadnych korzyści w aplikacji.
// Filiżanka w stopce (obok Kontaktu, bez napisu) otwiera okno z wyjaśnieniem
// i wyborem kawy; złoty przycisk otwiera buycoffee.to z wybraną kawą.
// Pusty adres = brak przycisku w stopce.
export const SUPPORT_URL = "https://buycoffee.to/familijna.app";

function supportHost() {
  try { return new URL(SUPPORT_URL).host.replace(/^www\./, ""); } catch { return ""; }
}

function label(key, fallback) {
  const value = t(key);
  return value === key ? fallback : value;
}

// Rozmiary jak w widżecie buycoffee.to (?coffeeSize=…); kwoty ustawione w profilu.
export const SUPPORT_SIZES = Object.freeze([
  { size: "small", amount: "5 zł" },
  { size: "medium", amount: "15 zł" },
  { size: "large", amount: "25 zł" },
]);

function supportSizeUrl(size) {
  const url = new URL(SUPPORT_URL);
  url.searchParams.set("coffeeSize", size);
  return url.toString();
}

function applyButtonLabels(button) {
  const text = label("support.footerBtn", "Postaw kawę");
  button.setAttribute("aria-label", text);
  button.dataset.tooltip = text;
}

// Okno jak inne okna wyboru (np. „Zmień typ” w Moich grach): tekst, lista opcji
// z radiem, na dole Anuluj i złoty przycisk, który otwiera wybraną kawę.
// Kliknięcie tuż po wejściu na stronę może wyprzedzić wczytanie słownika.
function translationsReady() {
  if (t("support.title") !== "support.title") return Promise.resolve();
  return new Promise((resolve) => {
    window.addEventListener("i18n:lang", () => resolve(), { once: true });
    setTimeout(resolve, 3000);
  });
}

export async function openSupportModal() {
  if (!SUPPORT_URL) return false;
  await translationsReady();
  const [{ confirmModal }, { isSheetViewport }] = await Promise.all([
    import("./modal.js?v=v2026-11-05T18064"), import("./modal-sheet.js?v=v2026-11-05T18064"),
  ]);
  const box = document.createElement("div");
  box.className = "support-sizes";
  box.setAttribute("role", "radiogroup");
  box.setAttribute("aria-label", t("support.pick"));
  SUPPORT_SIZES.forEach(({ size, amount }, i) => {
    const option = document.createElement("label");
    option.className = `support-size support-size--${size}`;
    option.innerHTML = `<input type="radio" name="supportSize"><span class="support-size-ico">${icon("coffee")}</span><span class="support-size-name"></span><span class="support-size-amount"></span>`;
    const input = option.querySelector("input");
    input.value = size;
    input.checked = i === 0;
    option.querySelector(".support-size-name").textContent = t(`support.size.${size}`);
    option.querySelector(".support-size-amount").textContent = amount;
    box.append(option);
  });
  const note = document.createElement("p");
  note.className = "support-modal-note";
  note.textContent = t("support.external", { host: supportHost() });
  box.append(note);

  return confirmModal({
    title: t("support.title"),
    text: `${t("support.lead")}\n\n${t("support.text")}`,
    body: box,
    okText: t("support.go"),
    cancelText: t("common.cancel"),
    modalClass: "support-modal",
    // telefon / tablet dotykowy: roletka od dołu, jak inne okna
    sheet: isSheetViewport() ? {} : null,
    onOk: () => {
      // Otwarcie w tym samym kliknięciu, żeby przeglądarka nie blokowała karty.
      const size = box.querySelector('input[name="supportSize"]:checked')?.value || SUPPORT_SIZES[0].size;
      window.open(supportSizeUrl(size), "_blank", "noopener");
      return true;
    },
  });
}

/** Dokłada filiżankę obok przycisku Kontakt w zwykłej stopce strony. */
export function ensureSupportEntryPoint() {
  if (!SUPPORT_URL || document.body?.hasAttribute("data-device-screen")) return;
  // Inne wejścia do okna (np. odpowiedź w FAQ strony głównej) czekają ukryte na adres.
  document.querySelectorAll("[data-support-modal][hidden]").forEach((el) => { el.hidden = false; });
  if (document.querySelector(".btn-support-footer")) return;
  const contact = document.querySelector(".footer:not(.contact-footer-entry--floating) .btn-contact-footer");
  if (!contact) return;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "btn-support-footer";
  button.innerHTML = icon("coffee", { animation: "steam" });
  applyButtonLabels(button);

  // Kontakt jako ostatnie dziecko stopki trzyma prawą krawędź -- kawa i Kontakt
  // trafiają razem do jednej grupy, żeby układ stopki się nie zmienił.
  if (contact.parentElement.classList.contains("footer")) {
    const group = document.createElement("span");
    group.className = "footer-actions";
    contact.replaceWith(group);
    group.append(button, contact);
  } else {
    contact.parentElement.classList.add("footer-actions");
    contact.before(button);
  }

  window.addEventListener("i18n:lang", () => applyButtonLabels(button));
}

if (typeof document !== "undefined") {
  document.addEventListener("click", (e) => {
    if (e.target.closest(".btn-support-footer, [data-support-modal]")) openSupportModal();
  });
}
