import { escapeHtmlAttribute as esc } from "../../../shared/js/core/html-escape.js?v=v2026-11-08T14374";
// base-explorerjs/tags-modal.js
// Nowy modal tagów (3 warstwy) – spójny z założeniami:
// - na każdej warstwie tylko X i "Zapisz"
// - L1: lista tagów + tri-state + "Dodaj nowy" -> L2(create)
// - L2: nazwa + duży kafel koloru -> klik otwiera L3
// - L3: picker (zostaje), Zapisz wraca do L2, X zamyka cały modal
//
// UWAGA: ten plik nie zna nic o SEARCH/TAG view. To jest czysty modal.

import * as ops from "./ops.js?v=v2026-11-08T14374";
import { acquireResourceLock, acquireResourceLocks } from "../../../shared/js/core/resource-lock.js?v=v2026-11-08T14374";
import { alertModal } from "../../../shared/js/core/modal.js?v=v2026-11-08T14374";
import { openDialog, closeDialog, showModalLayer } from "../../../shared/js/core/modal-sheet.js?v=v2026-11-08T14374";
import { t } from "../../../shared/translation/translation.js?v=v2026-11-08T14374";
import { normHex } from "../../../shared/js/core/color.js?v=v2026-11-08T14374";
import { colorPickerHTML, bindColorPicker } from "../../../shared/js/core/color-picker.js?v=v2026-11-08T14374";
import { normalizeText } from "./data/listing.js?v=v2026-11-08T14374";
import { listTags, listQuestionTagLinks } from "./repo.js?v=v2026-11-08T14374";

// Nazwa i kolor tagu pochodzą od użytkownika (także współdzielących bazę).


// Dozwolone znaki nazwy tagu — ta sama reguła co w bazie (qb_save_tag, 427).
const TAG_NAME_RE = /^[a-zA-Z0-9_ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]+$/;

/* ================= Utils ================= */

function canWrite(state) {
  return state?.role === "owner" || state?.role === "editor";
}

function uniqIds(arr) {
  return Array.from(new Set((arr || []).filter(Boolean)));
}

function hideErr(box) {
  if (!box) return;
  box.hidden = true;
  box.textContent = "";
}

function showErr(box, msg) {
  if (!box) return;
  box.hidden = false;
  box.textContent = String(msg || "");
}

// Nazwy tagów porównujemy jak wyszukiwarka: bez wielkości liter i bez
// polskich znaków („Łatwe” = „latwe”), żeby #latwe nie było niejednoznaczne.
function normTagName(name) {
  return normalizeText(String(name || "").trim().replace(/^#/, ""));
}

function isDuplicateTagName(state, nameRaw, { allowId = null } = {}) {
  const wanted = normTagName(nameRaw);
  if (!wanted) return false;

  const tags = Array.isArray(state.tags) ? state.tags : [];
  return tags.some((t) => {
    if (!t) return false;
    if (allowId && t.id === allowId) return false;
    return normTagName(t.name) === wanted;
  });
}

/* ================= DOM map (ID muszą pasować do Twojego HTML) =================
  Oczekiwane ID:
  overlay: tagsOverlay

  Warstwy:
    tagsL1, tagsL2, tagsL3

  L1:
    tagsL1Close (X)
    tagsL1Save  (Zapisz)
    tagsAddNew  (Dodaj nowy)
    tagsAssignInfo
    tagsAssignList
    tagsAssignErr

  L2:
    tagsL2Close (X)
    tagsL2Save  (Zapisz)
    tagsEditTitle
    tagsEditName
    tagsEditColorTile  (duży kafel – klik => L3)
    tagsEditColorDot   (kropka w kaflu)
    tagsEditErr

  L3:
    tagsL3Close (X)
    tagsL3Save  (Zapisz)  => akceptuje kolor i wraca do L2
    tagsColorBody      (wybór koloru: core/color-picker.js)
*/

function els() {
  const overlay = document.getElementById("tagsOverlay");
  if (!overlay) return null;

  return {
    overlay,

    L1: document.getElementById("tagsL1"),
    L2: document.getElementById("tagsL2"),
    L3: document.getElementById("tagsL3"),

    // L1
    l1Close: document.getElementById("tagsL1Close"),
    l1Save: document.getElementById("tagsL1Save"),
    addNew: document.getElementById("tagsAddNew"),
    assignInfo: document.getElementById("tagsAssignInfo"),
    assignList: document.getElementById("tagsAssignList"),
    assignErr: document.getElementById("tagsAssignErr"),

    // L2
    l2Close: document.getElementById("tagsL2Close"),
    l2Save: document.getElementById("tagsL2Save"),
    l2Back: document.getElementById("tagsL2Back"),
    editTitle: document.getElementById("tagsEditTitle"),
    editName: document.getElementById("tagsEditName"),
    editColorTile: document.getElementById("tagsEditColorTile"),
    editColorDot: document.getElementById("tagsEditColorDot"),
    editErr: document.getElementById("tagsEditErr"),

    // L3
    l3Close: document.getElementById("tagsL3Close"),
    l3Save: document.getElementById("tagsL3Save"),
    l3Back: document.getElementById("tagsL3Back"),
    colorBody: document.getElementById("tagsColorBody"),
  };
}

function showLayer(E, n) {
  showModalLayer([E.L1, E.L2, E.L3][n - 1]);
}

/* ================= Data helpers ================= */

// Rozwijanie folderów -> pytania w poddrzewie: mapę folder -> pytania liczy
// wołający (commands.js: openTagsWindow, z state.d.subtreeQuestionIds) i podaje
// w opts.folderDescQIds. Bez mapy foldery nie są rozwijane (bezpiecznie).
async function expandFoldersToQuestionIds(state, folderIds, opts) {
  const cIds = uniqIds(folderIds);
  if (!cIds.length) return [];

  const map = opts?.folderDescQIds; // Map(folderId -> Set(qid))
  if (!map) return [];

  const out = new Set();
  for (const cid of cIds) {
    const set = map.get(cid);
    if (!set) continue;
    for (const qid of set) out.add(qid);
  }
  return Array.from(out);
}

async function refreshTags(state) {
  state.tags = await listTags(state.baseId);
}

/* ================= Modal main ================= */

export async function openTagsModal(state, opts = {}) {
  const E = els();
  if (!E) return false;
  // Warstwa „Kolor”: wspólny wybór koloru (core/color-picker.js).
  if (E.colorBody) E.colorBody.innerHTML = colorPickerHTML("tagsColor");
  const picker = bindColorPicker(E.colorBody, { value: "#4DA3FF", onChange: showPicked });

  const editor = canWrite(state);

  // opts:
  // mode: "assign" | "create" | "edit"
  // tagId: dla edit
  // selection: { qIds, cIds } – jeśli nie podasz, modal pokaże "Brak zaznaczenia" i zapis L1 nic nie zrobi
  // folderDescQIds: Map(folderId -> Set(qid)) (opcjonalnie) – jeśli chcesz, by foldery się rozwijały do pytań
  // onLinks({ added, removed }) / onTagSaved({ id, before }, { name, color }) – zapis do historii cofania
  const mode = opts.mode || "assign";
  const editTagId = opts.tagId || null;
  const sel = opts.selection || { qIds: [], cIds: [] };

  // Blokada pytań: dla trybu "assign" wiadomo od razu KTÓRE pytania są
  // dotykane (edytowany jest ich komplet tagów) -- blokujemy je na cały
  // czas otwarcia modala. Blokada TAGÓW jest inna: dopóki user nie
  // przełączy konkretnego tagu (tri-state), ten tag nie jest "w edycji" --
  // blokujemy więc tylko faktycznie zmieniane tagi (m.dirty), i dopiero
  // przy Zapisz (patrz saveL1Assign), NIE z góry wszystkie tagi widoczne w
  // modalu. Tryb "edit" (zarządzanie jednym tagiem) blokuje wyłącznie ten
  // jeden tag przez cały czas otwarcia, tak jak dotąd. Tryb "create" nie
  // ma jeszcze UUID do zablokowania.
  const expandedQIdsForLock = mode === "assign"
    ? await expandFoldersToQuestionIds(state, sel.cIds || [], opts)
    : [];
  const allTargetQIdsForLock = mode === "assign"
    ? uniqIds([...(sel.qIds || []), ...expandedQIdsForLock])
    : [];

  let sessionLease = null;
  if (mode === "assign" && allTargetQIdsForLock.length) {
    sessionLease = await acquireResourceLocks(
      allTargetQIdsForLock.map((resourceId) => ({ resourceType: "base_question", resourceId })),
      { context: "base-explorer:tags-assign" }
    );
  } else if (mode === "edit" && editTagId) {
    sessionLease = await acquireResourceLock({
      resourceType: "base_tag",
      resourceId: editTagId,
      context: "base-explorer:tags-edit",
    });
  }
  if (sessionLease && !sessionLease.ok) {
    void alertModal({
      text: sessionLease.error === "gone"
        ? t("resourceLock.goneMessage")
        : t("resourceLock.baseItemMessage"),
    });
    return false;
  }

  const m = {
    layer: 1,
    mode,
    editTagId,
    // tri-state tylko dla L1
    tri: new Map(), // tagId -> "all" | "none" | "some"
    dirty: new Set(), // tagId, które user zmienił
    // L2
    edit: {
      mode: mode === "edit" ? "edit" : "create",
      tagId: mode === "edit" ? editTagId : null,
      name: "",
      color: "#4DA3FF",
    },
    // L3
    pickedColor: "#4DA3FF",
    colorBase: "#4DA3FF",
  };

  // Promise + resolver tworzone od razu, ZANIM podepniemy listenery -- inaczej klik
  // w X/Zapisz w trakcie poniższych `await` (refreshTags/initTriState) trafiłby na
  // resolvePromise wciąż `null` i zawiesiłby ten Promise na zawsze.
  let resolvePromise = null;
  const donePromise = new Promise((resolve) => { resolvePromise = resolve; });

  function close(result) {
    closeDialog(E.overlay);

    E.l1Close?.removeEventListener("click", onClose);
    E.l2Close?.removeEventListener("click", onClose);
    E.l3Close?.removeEventListener("click", onClose);
    E.l2Back?.removeEventListener("click", onLayerBack);
    E.l3Back?.removeEventListener("click", onLayerBack);

    E.l1Save?.removeEventListener("click", onSave);
    E.l2Save?.removeEventListener("click", onSave);
    E.l3Save?.removeEventListener("click", onSave);

    E.addNew?.removeEventListener("click", onAddNew);
    E.editColorTile?.removeEventListener("click", onOpenPicker);

    picker.destroy();

    sessionLease?.release?.();
    resolvePromise(result);
  }

  function go(n) {
    m.layer = n;
    showLayer(E, n);
    hideErr(E.assignErr);
    hideErr(E.editErr);
  }

  function onClose() {
    close(false);
  }

  // „Anuluj” w warstwie: kolor — porzuć zmianę i wróć do tagu; tag — wróć
  // do listy (przypisywanie) albo zamknij okno (samo dodawanie/edycja).
  function layerBack() {
    if (m.layer === 3) {
      picker.set(m.colorBase);
      showPicked(picker.get());
      go(2);
      return true;
    }
    if (m.layer === 2 && mode === "assign") {
      go(1);
      return true;
    }
    return false;
  }

  function onLayerBack() {
    if (!layerBack()) close(false);
  }

  // Klik w tło zamyka jak X (nie w arkuszu na telefonie — tam wyjściem jest Wstecz).
  function renderAssignInfo() {
    if (!E.assignInfo) return;
    const qN = (sel.qIds || []).length;
    const cN = (sel.cIds || []).length;
    const parts = [];
    if (qN) parts.push(t("baseExplorer.tags.selectionQuestions", { count: qN }));
    if (cN) parts.push(t("baseExplorer.tags.selectionFolders", { count: cN }));
    E.assignInfo.textContent = parts.length
      ? t("baseExplorer.tags.selectionSummary", { items: parts.join(" + ") })
      : t("baseExplorer.tags.selectionEmpty");
  }

  function triToUi(tri) {
    return {
      checked: tri === "all",
      indeterminate: tri === "some",
    };
  }

  function cycleTri(tagId) {
    const cur = m.tri.get(tagId) || "none";
    if (cur === "some") {
      void alertModal({ text: t("baseExplorer.tags.partialWarning") });
      m.tri.set(tagId, "all");
      m.dirty.add(tagId);
      return;
    }
    if (cur === "all") {
      m.tri.set(tagId, "none");
      m.dirty.add(tagId);
      return;
    }
    m.tri.set(tagId, "all");
    m.dirty.add(tagId);
  }

  async function initTriState() {
    if (!Array.isArray(state.tags)) await refreshTags(state);

    const tags = (state.tags || []).slice().sort((a, b) => (Number(a.ord) || 0) - (Number(b.ord) || 0));
    const tagIdsAll = tags.map((t) => t.id).filter(Boolean);

    // pytania = qIds + rozwinięte foldery (jeśli dostarczono mapę)
    const qFromFolders = await expandFoldersToQuestionIds(state, sel.cIds || [], opts);
    const allQIds = uniqIds([...(sel.qIds || []), ...(qFromFolders || [])]);

    // brak targetu: wszystko startuje jako "none"
    if (!allQIds.length) {
      for (const tid of tagIdsAll) m.tri.set(tid, "none");
      return;
    }

    // świeże tagi wskazanych pytań — lista id w treści zapytania (dawniej
    // w adresie: przy dużym folderze przekraczała limity adresu i 1000 wierszy)
    const links = await listQuestionTagLinks(state.baseId, allQIds);
    const qMap = new Map(); // qid -> Set(tid)
    for (const l of links) {
      if (!qMap.has(l.question_id)) qMap.set(l.question_id, new Set());
      qMap.get(l.question_id).add(l.tag_id);
    }

    const total = allQIds.length;

    for (const tid of tagIdsAll) {
      let has = 0;
      for (const qid of allQIds) {
        const set = qMap.get(qid);
        if (set && set.has(tid)) has++;
      }
      if (has === 0) m.tri.set(tid, "none");
      else if (has === total) m.tri.set(tid, "all");
      else m.tri.set(tid, "some");
    }
  }

  function renderAssignList() {
    if (!E.assignList) return;
    const tags = (state.tags || []).slice().sort((a, b) => (Number(a.ord) || 0) - (Number(b.ord) || 0));

    E.assignList.innerHTML = tags
      .map((tag) => {
        const tri = m.tri.get(tag.id) || "none";
        const ui = triToUi(tri);

        return `
          <label class="tags-row${editor ? "" : " is-readonly"}" data-tag-id="${esc(tag.id)}" data-state="${tri}">
            <input type="checkbox" data-tag-id="${esc(tag.id)}" aria-checked="${tri === "some" ? "mixed" : ui.checked}" ${ui.checked ? "checked" : ""} ${editor ? "" : "disabled"} />
            <span class="tag-dot"${tag.color ? ` style="--c:${esc(tag.color)}"` : ""}></span>
            <span class="m-p">#${esc(tag.name || "")}</span>
            ${tri === "some" ? `<span class="m-note">${t("baseExplorer.tags.partial")}</span>` : `<span class="m-note is-placeholder" aria-hidden="true">.</span>`}
          </label>
        `;
      })
      .join("");

    const boxes = Array.from(E.assignList.querySelectorAll('input[type="checkbox"][data-tag-id]'));
    for (const box of boxes) {
      const tid = box.dataset.tagId;
      const tri = m.tri.get(tid) || "none";
      box.indeterminate = tri === "some";

      box.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!editor) return;

        cycleTri(tid);
        renderAssignList();
      });
    }
  }

  function enterL2(editMode, tagId) {
    m.edit.mode = editMode;
    m.edit.tagId = tagId || null;

    const current =
      editMode === "edit" && tagId ? (state.tags || []).find((t) => t.id === tagId) || null : null;

    m.edit.name = String(current?.name || "");
    m.edit.color = normHex(current?.color) || "#4DA3FF";
    m.pickedColor = m.edit.color;

    if (E.editTitle) {
      E.editTitle.textContent =
        editMode === "edit"
          ? t("baseExplorer.tags.editModeTitle")
          : t("baseExplorer.tags.createModeTitle");
    }
    if (E.editName) E.editName.value = m.edit.name;

    E.editColorDot?.style.setProperty("--c", m.pickedColor);
    if (E.editColorTile) {
      // jeśli kafel ma mieć też kolor tła – zależy od Twojego HTML/CSS
      E.editColorTile.style.setProperty("--tag-color", m.pickedColor);
    }

    go(2);
    try {
      E.editName?.focus?.();
      E.editName?.setSelectionRange?.(E.editName.value.length, E.editName.value.length);
    } catch {}
  }

  function showPicked(hex) {
    m.pickedColor = hex;
    // od razu aktualizuj L2
    E.editColorDot?.style.setProperty("--c", hex);
    if (E.editColorTile) E.editColorTile.style.setProperty("--tag-color", hex);
  }

  function openPickerFrom(hex) {
    m.colorBase = normHex(hex) || "#4DA3FF";
    picker.set(m.colorBase);
    showPicked(picker.get());
    go(3);
  }

  async function saveL1Assign() {
    if (!editor) {
      close(false);
      return false;
    }

    if (sessionLease && !sessionLease.ok) {
      showErr(E.assignErr, sessionLease.reason === "gone" ? t("resourceLock.goneMessage") : t("resourceLock.forbiddenMessage"));
      return false;
    }

    // target pytania
    const qFromFolders = await expandFoldersToQuestionIds(state, sel.cIds || [], opts);
    const allQIds = uniqIds([...(sel.qIds || []), ...(qFromFolders || [])]);

    // brak targetu: tylko zamknij
    if (!allQIds.length) {
      close(true);
      return true;
    }

    const dirtyTagIds = Array.from(m.dirty || []).filter(Boolean);
    if (!dirtyTagIds.length) {
      close(true);
      return true;
    }

    // Blokada tylko faktycznie zmienianych tagów, dopiero teraz -- patrz
    // komentarz przy sessionLease wyżej. Krótkotrwała, niezależna od
    // sessionLease (pytania): zajęta tuż przed zapisem, zwolniona zaraz po.
    const tagLease = await acquireResourceLocks(
      dirtyTagIds.map((resourceId) => ({ resourceType: "base_tag", resourceId })),
      { context: "base-explorer:tags-assign-save" }
    );
    if (!tagLease?.ok) {
      showErr(E.assignErr, tagLease?.error === "gone" ? t("resourceLock.goneMessage") : t("resourceLock.baseItemMessage"));
      return false;
    }

    // „wszystkie” = nadaj brakujące, „żadne” = zdejmij; jedna transakcja
    const on = dirtyTagIds.filter((tid) => (m.tri.get(tid) || "none") === "all");
    const off = dirtyTagIds.filter((tid) => (m.tri.get(tid) || "none") === "none");
    try {
      const res = await ops.applyTagStates(state.baseId, { questionIds: allQIds }, { on, off });
      opts.onLinks?.({ added: res?.added || [], removed: res?.removed || [] });
    } catch (e) {
      if (!e?.userMessage) throw e;
      showErr(E.assignErr, e.userMessage);
      return false;
    } finally {
      tagLease.release();
    }

    close(true);
    return true;
  }

  async function saveL2Tag() {
    if (!editor) {
      close(false);
      return false;
    }

    hideErr(E.editErr);

    const nameRaw = String(E.editName?.value || "")
      .trim()
      .replace(/^#/, "")
      .slice(0, 40);

    // Bez spacji: litery (także polskie, decyzja 2026-10-20), cyfry i "_"
    if (/\s/.test(nameRaw)) {
      showErr(E.editErr, t("baseExplorer.tags.errors.noSpaces"));
      return false;
    }
    if (!TAG_NAME_RE.test(nameRaw)) {
      showErr(E.editErr, t("baseExplorer.tags.errors.allowedChars"));
      return false;
    }

    // upewnij się, że lista tagów jest świeża (dla duplikatów)
    if (!Array.isArray(state.tags)) await refreshTags(state);

    const allowId = m.edit.mode === "edit" ? (m.edit.tagId || null) : null;
    if (isDuplicateTagName(state, nameRaw, { allowId })) {
      showErr(E.editErr, t("baseExplorer.tags.errors.duplicate"));
      return false;
    }

    const color = String(m.pickedColor || "#4DA3FF").trim();

    const editId = (m.edit.mode === "edit" && m.edit.tagId) ? m.edit.tagId : null;
    if (editId && sessionLease && !sessionLease.ok) {
      showErr(E.editErr, sessionLease.reason === "gone" ? t("resourceLock.goneMessage") : t("resourceLock.forbiddenMessage"));
      return false;
    }
    try {
      const res = await ops.saveTag(state.baseId, editId, nameRaw, color);
      opts.onTagSaved?.(res || {}, { name: nameRaw, color });
    } catch (e) {
      if (!e?.userMessage) throw e;
      showErr(E.editErr, e.userMessage);
      return false;
    }

    await refreshTags(state);

    // Po zapisie L2:
    // - jeśli weszliśmy z "create/edit" bez assign: zamknij modal
    // - jeśli jesteśmy w assign: wróć do L1 i przelicz tri-state (nowy tag startuje jako "none")
    if (mode === "assign") {
      await initTriState();
      renderAssignList();
      go(1);
      return true;
    }

    close(true);
    return true;
  }

  function saveL3Color() {
    // „Zapisz” w pickerze = zaakceptuj kolor i wróć do L2
    // (kolor już jest w m.pickedColor na bieżąco)
    go(2);
    return true;
  }

  async function onSave() {
    try {
      if (m.layer === 1) return await saveL1Assign();
      if (m.layer === 2) return await saveL2Tag();
      if (m.layer === 3) return saveL3Color();
    } catch (e) {
      console.error(e);
      if (m.layer === 1) showErr(E.assignErr, t("baseExplorer.tags.errors.saveAssignFailed"));
      if (m.layer === 2) showErr(E.editErr, t("baseExplorer.tags.errors.saveFailed"));
      // L3: bez errboxa (to tylko powrót)
    }
    return false;
  }

  function onAddNew() {
    if (!editor) return;
    enterL2("create", null);
  }

  function onOpenPicker() {
    if (!editor) return;
    openPickerFrom(m.pickedColor);
  }

  // OPEN
  openDialog(E.overlay, {
    onClose: () => close(false),
    // Tryby create/edit zaczynają się od warstwy 2; nie mają warstwy 1.
    onBack: layerBack,
  });

  // X wszędzie zamyka modal
  E.l1Close?.addEventListener("click", onClose);
  E.l2Close?.addEventListener("click", onClose);
  E.l3Close?.addEventListener("click", onClose);
  E.l2Back?.addEventListener("click", onLayerBack);
  E.l3Back?.addEventListener("click", onLayerBack);

  // Save wszędzie
  E.l1Save?.addEventListener("click", onSave);
  E.l2Save?.addEventListener("click", onSave);
  E.l3Save?.addEventListener("click", onSave);

  // L1: Dodaj nowy
  E.addNew?.addEventListener("click", onAddNew);

  // L2: kafel koloru
  E.editColorTile?.addEventListener("click", onOpenPicker);

  hideErr(E.assignErr);
  hideErr(E.editErr);

  // Start:
  if (!Array.isArray(state.tags)) await refreshTags(state);

  if (mode === "assign") {
    go(1);
    renderAssignInfo();
    await initTriState();
    renderAssignList();
  } else if (mode === "edit") {
    enterL2("edit", editTagId);
  } else {
    enterL2("create", null);
  }

  return await donePromise;
}
