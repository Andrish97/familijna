// Jednorazowa zachęta do powiadomień push (E29, decyzja użytkownika 2026-11-08):
// pasek na stronie Gier — w zainstalowanej aplikacji i w przeglądarce, nigdy
// dla gościa. „Włącz” dopiero wtedy wywołuje prośbę przeglądarki (zgoda
// tylko po kliknięciu); „Nie teraz” chowa pasek na stałe na tym urządzeniu.
// Nie pokazuje się, gdy przeglądarka już zdecydowała (zgoda/blokada) albo
// nie obsługuje powiadomień (iPhone bez ekranu początkowego).
import { t } from "../../translation/translation.js?v=v2026-11-08T23062";
import { pushSupport, enablePush } from "./push.js?v=v2026-11-08T23062";
import { toast } from "./toast.js?v=v2026-11-08T23062";

const DISMISSED_KEY = "push:prompt_dismissed";

function dismissed() {
  try { return localStorage.getItem(DISMISSED_KEY) === "1"; } catch { return true; }
}
function dismiss() {
  try { localStorage.setItem(DISMISSED_KEY, "1"); } catch {}
}

export function maybeShowPushPrompt(user) {
  if (!user || user.is_guest || dismissed()) return;
  if (pushSupport() !== "ok" || Notification.permission !== "default") return;
  if (document.getElementById("pushPrompt")) return;

  const bar = document.createElement("div");
  bar.id = "pushPrompt";
  bar.className = "notice-bar";

  const text = document.createElement("span");
  text.textContent = t("pushPrompt.text");

  const enableBtn = document.createElement("button");
  enableBtn.type = "button";
  enableBtn.className = "btn-plain";
  enableBtn.textContent = t("pushPrompt.enable");
  enableBtn.addEventListener("click", async () => {
    enableBtn.disabled = true;
    try {
      await enablePush([]);
      toast(t("pushPrompt.enabled"));
      dismiss();
    } catch (e) {
      const key = e?.message === "blocked" ? "pushPrompt.blocked" : e?.message === "dismissed" ? null : "pushPrompt.failed";
      if (e?.message === "blocked") dismiss();
      if (key) toast(t(key), { kind: "error" });
    }
    bar.remove();
  });

  const laterBtn = document.createElement("button");
  laterBtn.type = "button";
  laterBtn.className = "btn-plain";
  laterBtn.textContent = t("pushPrompt.later");
  laterBtn.addEventListener("click", () => { dismiss(); bar.remove(); });

  bar.append(text, enableBtn, laterBtn);
  document.body.prepend(bar);
}
