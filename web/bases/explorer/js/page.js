// base-explorerjs/page.js
// Start strony menedżera bazy: użytkownik, baza, rola, blokada współdzielona,
// pierwsze wczytanie (data/store.js), narysowanie (render.js) i podpięcie
// wejść (ui/*). Logika akcji: actions/registry.js + commands.js.

import { alertModal } from "../../../shared/js/core/modal.js";
import { guardResourceLocks } from "../../../shared/js/core/resource-lock.js";
import { initI18n, t } from "../../../shared/translation/translation.js";
import { backHref } from "../../../shared/js/core/nav-map.js";
import { initPage } from "../../../shared/js/core/page-init.js";
import { createState, setRole, goTo } from "./state.js";
import { reload } from "./data/store.js";
import { renderAll, renderToolbar, renderList, isNarrow } from "./render.js";
import { createHistory } from "./history.js";
import { getBaseMeta, getBaseRole } from "./repo.js";
import { openFolder, openTrash } from "./commands.js";
import { wireToolbarButtons } from "./ui/toolbar.js";
import { wireList } from "./ui/list.js";
import { wireTree } from "./ui/tree.js";
import { wireLeft } from "./ui/left.js";
import { wireDnd } from "./ui/dnd.js";
import { wireSearch } from "./ui/search.js";
import { guardRoutedSheet } from "./ui/sheet-guard.js";
import { wireLeftView } from "./ui/left-view.js";
import { wireKeyboard } from "./ui/keyboard.js";

const baseNameEl = document.getElementById("baseName");

function skeletonReady() {
  document.querySelectorAll(".toolbar[data-skel-step], .explorer[data-skel-step]")
    .forEach((step) => step.classList.add("skel-step-ready"));
}

function topbarReady(name) {
  if (baseNameEl) baseNameEl.textContent = name;
  document.querySelector(".topbar")?.classList.add("topbar-ready");
}

// Miejsce z adresu: ?folder=<id> albo ?trash=1 (kosz tylko dla edytujących).
function initialPlace(state) {
  const params = new URLSearchParams(location.search);
  const folderId = params.get("folder");
  if (folderId && state.d.folderById.has(folderId)) return folderId;
  if (params.get("trash") === "1" && state.canEdit) return "trash";
  return null;
}

// Ścieżka nad listą: klik w element = przejście tam.
function wireBreadcrumbs(state) {
  document.getElementById("breadcrumbs")?.addEventListener("click", async (e) => {
    const crumb = e.target.closest(".crumb[data-kind]");
    if (!crumb) return;
    const { kind, id } = crumb.dataset;
    if (kind === "trash") await openTrash(state);
    else await openFolder(state, kind === "crumb" ? id : null);
  });
}

(async function init() {
  const i18nP = initI18n({ withSwitcher: true });
  const userP = initPage("baseExplorer", {
    ready: i18nP,
    // nazwa bazy w topbarze jest znana dopiero po pobraniu metadanych
    deferTopbarReady: true,
  });
  // Metadane bazy od razu, równolegle z sesją (RLS i tak sprawdza token).
  const earlyId = new URLSearchParams(location.search).get("id");
  const metaP = earlyId ? getBaseMeta(earlyId) : null;
  metaP?.catch(() => {});
  await i18nP;
  document.documentElement.classList.remove("page-loading");

  const user = await userP;
  if (!user) return; // initPage przekierował na logowanie

  const baseId = earlyId;
  if (!baseId) {
    topbarReady("");
    void alertModal({ text: t("baseExplorer.errors.missingBaseId") });
    location.href = backHref("baseExplorer");
    return;
  }

  const state = createState({ baseId, role: "viewer" });
  state.user = user;
  state.userId = user.id;
  // cofanie / ponawianie w pamięci karty; zmiana historii odświeża pasek
  state.history = createHistory({ onChange: () => renderToolbar(state) });

  try {
    state.baseMeta = await metaP;
    topbarReady(state.baseMeta?.name || t("baseExplorer.defaults.baseName"));

    const r = await getBaseRole(baseId, user.id, state.baseMeta);
    setRole(state, r.role);

    // Menedżer trzyma base:B współdzielenie (współpracownicy mogą mieć bazę
    // otwartą naraz). Trzymanie wyłączne (zmiana nazwy / usuwanie całej bazy)
    // zatrzymuje wejście pełnoekranowym komunikatem; odebrany dostęp daje
    // `forbidden` przy odnowieniu. Czytelnik nie trzyma nic.
    if (state.canEdit) {
      const lock = await guardResourceLocks(
        [{ type: "base", id: baseId, mode: "shared", message: t("resourceLock.baseChangingMessage") }],
        {
          context: "base-explorer",
          backHref: backHref("baseExplorer"),
          forbiddenTitle: t("resourceLock.baseAccessRevokedTitle"),
          forbiddenMessage: t("resourceLock.baseAccessRevokedMessage"),
        }
      );
      if (!lock.ok) return;
    }

    await reload(state);
    const place = initialPlace(state);
    if (place) goTo(state, place);
    state._syncUrl = true;

    renderAll(state);

    // przyciski widoków lewego panelu powstają w szkielecie paska (renderToolbar)
    wireLeftView(state);

    wireToolbarButtons(document.getElementById("toolbar"), state);
    wireSearch(state);
    wireList(state);
    wireTree(state);
    wireLeft(state);
    wireDnd(state);
    wireBreadcrumbs(state);
    for (const id of ["tagsOverlay", "exportOverlay", "questionOverlay"]) guardRoutedSheet(document.getElementById(id));
    wireKeyboard(state);
    skeletonReady();

    window.addEventListener("i18n:lang", () => renderAll(state));
    // telefon ↔ komputer (obrót, zmiana okna): inne szerokości kolumn
    let narrow = isNarrow();
    window.addEventListener("resize", () => {
      if (isNarrow() === narrow) return;
      narrow = isNarrow();
      renderList(state);
    });
  } catch (e) {
    console.error(e);
    // działające Wstecz, ale bez nazwy zastępczej udającej nazwę bazy
    topbarReady("");
    skeletonReady();
    void alertModal({ text: t(e?.code === "NO_ACCESS" ? "baseExplorer.errors.noAccess" : "baseExplorer.errors.loadFailed") });
  }
})();
