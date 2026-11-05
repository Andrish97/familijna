// js/core/rating-system.js
import { sb } from "./supabase.js?v=v2026-11-05T19534";
import { t } from "../../translation/translation.js?v=v2026-11-05T19534";
import { alertModal, choiceModal, confirmModal } from "./modal.js?v=v2026-11-05T19534";
import { icon } from "./icons.js?v=v2026-11-05T19534";


const RATING_LS_PREFIX = "fam:app_rated:";
const RATING_DISMISSED_PREFIX = "fam:app_rating_dismissed_at:";
const RATING_SUPPRESSED_PREFIX = "fam:app_rating_suppressed:";
const LEGACY_DISMISSED_KEY = "fam:app_rating_dismissed_at";
const LEGACY_SUPPRESSED_KEY = "fam:app_rating_suppressed";
let activePrompt = null;

function readStorage(key) {
    try { return localStorage.getItem(key); } catch { return null; }
}

function writeStorage(key, value) {
    try { localStorage.setItem(key, value); } catch { /* Storage can be disabled. */ }
}

export async function initRatingSystem(user) {
    if (!user || user.is_guest) return;
    if (activePrompt) return activePrompt;
    activePrompt = showRatingIfEligible(user).finally(() => { activePrompt = null; });
    return activePrompt;
}

async function showRatingIfEligible(user) {
    const ratedKey = `${RATING_LS_PREFIX}${user.id}`;
    const dismissedKey = `${RATING_DISMISSED_PREFIX}${user.id}`;
    const suppressedKey = `${RATING_SUPPRESSED_PREFIX}${user.id}`;

    // 1. Jeśli już ocenił (LS lub DB sprawdzane później) - nie pokazuj
    if (readStorage(ratedKey)) return;

    // 2. Jeśli użytkownik kliknął "Nie pytaj więcej" - nie pokazuj
    if (readStorage(suppressedKey) || readStorage(LEGACY_SUPPRESSED_KEY)) {
        writeStorage(suppressedKey, "true");
        return;
    }

    // 3. Sprawdź 7 dni od rejestracji
    const createdAtMs = Date.parse(user.created_at || "");
    if (!Number.isFinite(createdAtMs)) return;
    const now = new Date();
    const diffFromCreation = (now.getTime() - createdAtMs) / (1000 * 60 * 60 * 24);
    if (diffFromCreation < 7) return;

    // 4. Sprawdź czy modal był niedawno zamknięty (ponowne przypomnienie po 7 dniach)
    const dismissedAt = readStorage(dismissedKey) || readStorage(LEGACY_DISMISSED_KEY);
    if (dismissedAt) {
        const lastDismissed = new Date(parseInt(dismissedAt));
        const diffFromDismissal = (now - lastDismissed) / (1000 * 60 * 60 * 24);
        if (diffFromDismissal < 7) return;
        writeStorage(dismissedKey, dismissedAt);
    }

    // 5. Sprawdź w Supabase (na wypadek wyczyszczonego LS)
    const { data: existingRating, error } = await sb()
        .from("app_ratings")
        .select("id")
        .eq("user_id", user.id)
        .maybeSingle();

    if (error) {
        console.error("[rating] Error checking existing rating:", error);
        return;
    }

    if (existingRating) {
        writeStorage(ratedKey, "true");
        return;
    }

    // Pokaż modal
    await showRatingModal(user.id, { ratedKey, dismissedKey, suppressedKey });
}

// Prośba o ocenę: wspólne choiceModal (modal.js) z trzema przyciskami.
// X / Esc / klik w tło działa jak „Później” (wróci za 7 dni).
async function showRatingModal(userId, storageKeys) {
  const { body, stars, commentEl, selected } = ratingBody();
  const result = await choiceModal({
    title: t("common.rating.modal.title"),
    text: t("common.rating.modal.sub"),
    body,
    modalClass: "rating-modal",
    overlayId: "ratingOverlay",
    buttons: [
      { value: "never", text: t("common.rating.modal.never"), icon: "cancel", kind: "danger" },
      { value: "later", text: t("common.rating.modal.later"), icon: "hourglass" },
      { value: "send", text: t("common.rating.modal.send"), icon: "envelope-out", kind: "gold", disabled: true },
    ],
    onReady: ({ buttons }) => wireStars(stars, selected, () => { buttons.send.disabled = false; }),
    onChoice: async (value) => {
      if (value !== "send") return;
      const { error } = await sb().from("app_ratings").insert({
        user_id: userId,
        stars: selected.value,
        comment: commentEl.value.trim() || null,
      });
      if (error) {
        console.error("[rating] Error saving rating:", error);
        return t("common.rating.modal.error");
      }
    },
  });
  if (result === "send") {
    writeStorage(storageKeys.ratedKey, "true");
    await alertModal({ title: t("common.rating.modal.thanksTitle"), text: t("common.rating.modal.thanksSub"), okText: t("common.done") });
    return "rated";
  }
  if (result === "never") {
    writeStorage(storageKeys.suppressedKey, "true");
    return "never";
  }
  writeStorage(storageKeys.dismissedKey, Date.now().toString());
  return "later";
}

// Gwiazdki i komentarz -- wspólne dla prośby o ocenę i okna z Konta.
function ratingBody(current = null) {
  const body = document.createElement("div");
  body.className = "rating-editor";
  body.innerHTML = `
      <div class="stars-row">
          ${[1, 2, 3, 4, 5].map(v => `<button class="star-btn" type="button" data-value="${v}" aria-label="${v}/5">${icon("star")}</button>`).join("")}
      </div>
      <textarea class="inp rating-comment" rows="3" maxlength="2000" placeholder="${t("common.rating.modal.commentPlaceholder")}"></textarea>`;
  const stars = body.querySelectorAll(".star-btn");
  const commentEl = body.querySelector(".rating-comment");
  commentEl.value = current?.comment || "";
  const selected = { value: Number(current?.stars) || 0 };
  highlightStars(selected.value, stars);
  return { body, stars, commentEl, selected };
}

function wireStars(stars, selected, onPick) {
  stars.forEach(btn => {
    btn.addEventListener("mouseenter", () => highlightStars(btn.dataset.value, stars));
    btn.addEventListener("mouseleave", () => highlightStars(selected.value, stars));
    btn.addEventListener("click", () => {
      selected.value = parseInt(btn.dataset.value);
      highlightStars(selected.value, stars);
      onPick?.();
    });
  });
}

/**
 * Okno oceny z Konta: wystawienie albo zmiana dotychczasowej oceny
 * (wspólne confirmModal z modal.js).
 * @param {string} userId
 * @param {{stars:number, comment:string|null}|null} current
 * @returns {Promise<boolean>} true po zapisaniu
 */
export function openRatingEditor(userId, current = null) {
  const { body, stars, commentEl, selected } = ratingBody(current);
  return confirmModal({
    title: t(current ? "common.rating.account.editTitle" : "common.rating.modal.title"),
    text: t("common.rating.modal.sub"),
    okText: t(current ? "common.rating.account.save" : "common.rating.modal.send"),
    cancelText: t("common.cancel"),
    body,
    modalClass: "rating-modal",
    onReady: ({ overlay, okBtn }) => {
      overlay.id = "ratingEditOverlay";
      okBtn.disabled = !selected.value;
      wireStars(stars, selected, () => { okBtn.disabled = false; });
    },
    onOk: async () => {
      if (!selected.value) return false;
      const { error } = await sb().from("app_ratings").upsert({
        user_id: userId,
        stars: selected.value,
        comment: commentEl.value.trim() || null,
      }, { onConflict: "user_id" });
      if (error) {
        console.error("[rating] Error saving rating:", error);
        return t("common.rating.modal.error");
      }
      writeStorage(`${RATING_LS_PREFIX}${userId}`, "true");
    },
  });
}

function highlightStars(count, stars) {
    stars.forEach(s => {
        s.classList.toggle("active", parseInt(s.dataset.value) <= count);
    });
}
