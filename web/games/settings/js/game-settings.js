import { bindDrawer } from "../../../shared/js/core/drawer.js?v=v2026-11-03T23205";
// Ustawienia gry (/games/settings/?id=<gra>): zwykła strona z ręcznym zapisem.
// Podgląd Wyświetlacza i Prowadzącego:
// ramki /control/display/?preview=1 (shared/js/gameplay/previewRow.js).
import { t, getUiLang } from "../../../shared/translation/translation.js?v=v2026-11-03T23205";
import { linkTo, backHref, backTarget } from "../../../shared/js/core/nav-map.js?v=v2026-11-03T23205";
import { initPage } from "../../../shared/js/core/page-init.js?v=v2026-11-03T23205";
import { normHex } from "../../../shared/js/core/color.js?v=v2026-11-03T23205";
import { colorPickerHTML, bindColorPicker } from "../../../shared/js/core/color-picker.js?v=v2026-11-03T23205";
import { sb } from "../../../shared/js/core/supabase.js?v=v2026-11-03T23205";
import { loadQuestions, guardGameState } from "../../../shared/js/core/game-validate.js?v=v2026-11-03T23205";
import { loadFont5x7, buildLogoPreviewCanvas } from "../../../shared/js/core/logo-preview.js?v=v2026-11-03T23205";
import { v as cacheBust } from "../../../shared/js/core/cache-bust.js?v=v2026-11-03T23205";
import { alertModal, confirmModal } from "../../../shared/js/core/modal.js?v=v2026-11-03T23205";
import { toast } from "../../../shared/js/core/toast.js?v=v2026-11-03T23205";
import { initUiSelect } from "../../../shared/js/core/ui-select.js?v=v2026-11-03T23205";
import { chooseDisplayTheme } from "../../../shared/js/display/theme-config.js?v=v2026-11-03T23205";
import { parseThemeFile, customThemeKey, customThemeId } from "../../../shared/js/display/theme-file.js?v=v2026-11-03T23205";
import { loadBuiltinThemes } from "../../../shared/js/display/theme-registry.js?v=v2026-11-03T23205";
import { buildDisplayPreviewRow } from "../../../shared/js/gameplay/previewRow.js?v=v2026-11-03T23205";
import { LONG_MAX_INPUT, measureLongText, clipLongText, dropUnsupported } from "../../../shared/js/display/long-text.js?v=v2026-11-03T23205";

import { loadSfxManifest, getSfxCategories, setSfxCustomBlob, clearSfxCustomFile, clearAllSfxCustomFiles, getSfxCustomFiles, setSfxVolume, buildSfxUrl, createSfxAudio, playSfxAudio, setSfxAudioVolume, stopSfxAudio } from "../../../shared/js/core/sfx.js?v=v2026-11-03T23205";
import {
  uploadGameSound, deleteGameSound, deleteAllGameSounds,
} from "../../../shared/js/core/sfx-cloud.js?v=v2026-11-03T23205";
import { guardResourceLocks } from "../../../shared/js/core/resource-lock.js?v=v2026-11-03T23205";
import { updateChecked, ROW_GONE } from "../../../shared/js/core/db-guard.js?v=v2026-11-03T23205";
import { icon } from "../../../shared/js/core/icons.js?v=v2026-11-03T23205";
import { blockingScreen, setBlockingIcon, setBlockingOpen } from "../../../shared/js/core/blocking-screen.js?v=v2026-11-03T23205";
import { isPhoneScreen } from "../../../shared/js/core/device-guard.js?v=v2026-11-03T23205";
import { ADVANCED_LIMITS, parseIntInRange, parseMultipliers, finalMaxPoints, roundsMaxPoints } from "./advanced-limits.js?v=v2026-11-03T23205";

// Telefon: listy pytań bez przeciągania (dotknięcie przenosi, strzałki ustawiają kolejność).
const DRAG = !isPhoneScreen();
const DRAGGABLE = DRAG ? "true" : "false";

const qs = new URLSearchParams(location.search);
const gameId = qs.get("id");

// ===== DEFAULTS =====
const DEFAULT_SETTINGS = {
  teams: { teamA: "", teamB: "" },
  display: {
    colors: { A: "#FF8C1A", B: "#138A50", BACKGROUND: "#152238", DOT: "#D7FF3D" },
    theme: null,
    logoId: null,
    hostLogoMode: "source",
  },
  game: {
    hasFinal: true,
    finalQuestionsMode: "random",
    roundsQuestionsMode: "random",
    advanced: {
      roundMultipliers: [1, 1, 1, 2, 3],
      finalMinPoints: 300,
      finalTarget: 200,
      endScreenMode: "money",
      finalPrizeMultiplier: 3,
      mainPrizeAmount: 25000,
    },
  },
  questions: { final: [], rounds: [] },
  sound: {
    volumes: {},   // key → 0–100 (int procent)
    variants: {},  // key → nazwa pliku, np. "classic.mp3"
  },
};

function mergeSettings(saved) {
  const s = saved || {};
  const defs = DEFAULT_SETTINGS;
  const savedAdv = s.game?.advanced || {};
  const defsAdv = defs.game.advanced;
  return {
    teams: {
      teamA: s.teams?.teamA ?? defs.teams.teamA,
      teamB: s.teams?.teamB ?? defs.teams.teamB,
    },
    display: {
      colors: {
        A: normHex(s.display?.colors?.A) ?? defs.display.colors.A,
        B: normHex(s.display?.colors?.B) ?? defs.display.colors.B,
        BACKGROUND: normHex(s.display?.colors?.BACKGROUND) ?? defs.display.colors.BACKGROUND,
        DOT: normHex(s.display?.colors?.DOT) ?? defs.display.colors.DOT,
      },
      theme: s.display?.theme ?? defs.display.theme,
      logoId: s.display?.logoId ?? defs.display.logoId,
      hostLogoMode: s.display?.hostLogoMode === "pixel" ? "pixel" : "source",
    },
    game: {
      hasFinal: s.game?.hasFinal ?? defs.game.hasFinal,
      finalQuestionsMode: s.game?.finalQuestionsMode ?? defs.game.finalQuestionsMode,
      roundsQuestionsMode: s.game?.roundsQuestionsMode ?? defs.game.roundsQuestionsMode,
      advanced: {
        roundMultipliers: Array.isArray(savedAdv.roundMultipliers) ? savedAdv.roundMultipliers : defsAdv.roundMultipliers,
        finalMinPoints: typeof savedAdv.finalMinPoints === "number" ? savedAdv.finalMinPoints : defsAdv.finalMinPoints,
        finalTarget: typeof savedAdv.finalTarget === "number" ? savedAdv.finalTarget : defsAdv.finalTarget,
        endScreenMode: savedAdv.endScreenMode || defsAdv.endScreenMode,
        finalPrizeMultiplier: typeof savedAdv.finalPrizeMultiplier === "number" ? savedAdv.finalPrizeMultiplier : defsAdv.finalPrizeMultiplier,
        mainPrizeAmount: typeof savedAdv.mainPrizeAmount === "number" ? savedAdv.mainPrizeAmount : defsAdv.mainPrizeAmount,
      },
    },
    questions: {
      final: Array.isArray(s.questions?.final) ? s.questions.final : [],
      rounds: Array.isArray(s.questions?.rounds) ? s.questions.rounds : [],
    },
    sound: {
      volumes:  (s.sound?.volumes  && typeof s.sound.volumes  === "object") ? { ...s.sound.volumes }  : {},
      variants: (s.sound?.variants && typeof s.sound.variants === "object") ? { ...s.sound.variants } : {},
    },
  };
}

// ===== STATE =====
let localSettings = mergeSettings(null);
let lastSavedSettingsRaw = null; // ostatni znany serwerowi settings — CAS przy zapisie (Warstwa 2)
let isDirty = false;
let activeCat = "teams";
let builtinThemes = [];
// Domyślny motyw z rejestru (web/shared/themes/index.json „default”); gra bez motywu go używa.
let defaultThemeKey = "";
let themeRaw = [];
let themeList = [];
// Import motywów: dostęp nadaje panel admina; motywy konta są na liście w każdej grze.
let themeAccess = { canImport: false, limit: 20, themes: [] };
let allQuestions = [];
let _logoFont = null;
let _defaultLogoPayload = null;
let _loadedLogos = [];

// Display preview iframe
let _displayIframe = null;
let _displayReady = false;
let _hostIframe = null;
let _hostReady = false;

// Color modal state — labels populated lazily from t()

// ===== ELEMENTS =====
const titleEl = document.getElementById("gsTitle");
const btnSaveAll = document.getElementById("btnSaveAll");
const btnResetAll = document.getElementById("btnResetAll");
const btnPlay = document.getElementById("btnPlay");
const content = document.getElementById("gsContentInner");
const sidebar = document.getElementById("gsSidebar");
const sidebarToggle = document.getElementById("gsSidebarToggle");
const sidebarBackdrop = document.getElementById("gsSidebarBackdrop");
const sidebarFinale = document.getElementById("sidebarFinale");
const sidebarRounds = document.getElementById("sidebarRounds");

// ===== DIRTY / SAVE =====
let ready = false;        // ustawienia wczytane, zmiany się liczą
let changeSeq = 0;        // rośnie z każdą zmianą; zapis wie, czy w trakcie przyszło coś nowego
let saving = null;        // Promise trwającego zapisu
let stopped = false;      // konflikt zapisu: dalszy autozapis wstrzymany
let soundTouched = false; // zmiana wariantów/plików dźwięku: po zapisie zsynchronizuj bucket
let customSoundKeys = new Set();
const invalidInputs = new Map();
let leaving = false;
let pageLock = null;      // blokada zasobów strony (release przed wyjściem)

// data-state (dirty / saved / error / conflict) opisuje wynik ostatniego
// zapisu niezależnie od widocznego tekstu; błędy pokazuje toast.
function setSaveState(state) {
  const el = document.getElementById("gsFooterMsg");
  if (el) el.dataset.state = state;
  if (btnSaveAll) btnSaveAll.dataset.iconState = state;
}

function setDirtyIndicator(isUnsaved) {
  const el = document.getElementById("gsFooterMsg");
  if (!el) return;
  setSaveState(isUnsaved ? "dirty" : "saved");
  el.textContent = isUnsaved ? (t("gameSettings.unsaved")) : "";
  el.classList.toggle("hidden", !isUnsaved);
}

function markDirty() {
  if (!ready || stopped) return;
  isDirty = true;
  changeSeq++;
  setDirtyIndicator(true);
}

function markSoundDirty() {
  soundTouched = true;
  markDirty();
}

// Przy wyjściu niezapisane zmiany są porzucane dopiero po potwierdzeniu.
async function leaveTo(href) {
  if (leaving) return;
  leaving = true;
  if (isDirty) {
    const confirmed = await confirmModal({ text: t("gameSettings.unsavedConfirm") });
    if (!confirmed) {
      leaving = false;
      return;
    }
  }
  ready = false;
  await pageLock?.release?.().catch(() => {});
  location.href = href;
}

// Zwraca true, gdy po zapisie nic nie zostało do zapisania.
async function saveAll() {
  if (!ready || !isDirty || stopped) return true;
  if (saving) {
    await saving;
    return isDirty ? saveAll() : true;
  }
  if (btnSaveAll) btnSaveAll.disabled = true;
  btnSaveAll?.setAttribute("aria-busy", "true");
  setSaveState("saving");
  const seq = changeSeq;
  let ok = false;
  saving = (async () => {
    try {
      // Warstwa 2 (świeżość referencji): allQuestions/final/rounds mogły
      // wczytać się raz przy starcie i od tego czasu ktoś (np. w edytorze,
      // inna karta) mógł usunąć któreś z wybranych pytań. Odśwież przed
      // zapisem i wyczyść martwe odniesienia — inaczej settings zapisałoby
      // wskazanie na już nieistniejące pytanie.
      try {
        const freshQuestions = await loadQuestions(gameId);
        const freshIds = new Set(freshQuestions.map(q => q.id));
        localSettings.questions.final = localSettings.questions.final.filter(q => freshIds.has(q.id));
        localSettings.questions.rounds = localSettings.questions.rounds.filter(q => freshIds.has(q.id));
        allQuestions = freshQuestions;
      } catch (e) {
        console.warn("[game-settings] refresh questions before save failed:", e);
      }

      const hasFinal = localSettings.game.hasFinal === true;

      // Finał wyłączony — oddaj jego pytania do puli rund PRZED wyczyszczeniem
      // listy finałowej. Zmiana może zostać zapisana bez otwierania zakładki
      // Rundy, więc renderRounds() nie może być jedynym miejscem uzupełnienia.
      if (!hasFinal) {
        const inRounds = new Set(localSettings.questions.rounds.map(q => String(q.id)));
        const returned = localSettings.questions.final.filter(q => q?.id && !inRounds.has(String(q.id)));
        localSettings.questions.rounds = [...localSettings.questions.rounds, ...returned];
        localSettings.questions.final = [];
        if (localSettings.game.finalQuestionsMode !== "random") localSettings.game.finalQuestionsMode = "random";
      }

      // Walidacja: finał w trybie "pick" wymaga dokładnie 5 pytań
      if (hasFinal && localSettings.game.finalQuestionsMode === "pick") {
        const count = localSettings.questions.final.length;
        if (count !== 5) {
          await alertModal({ text: t("gameSettings.saveErrorFinalNeed5", { count }) });
          setActiveCat("finale");
          return;
        }
      }

      // Walidacja: wybrano "Własny" bez wgranego pliku
      {
        let cfCheck = new Map();
        try { cfCheck = await getSfxCustomFiles(gameId); } catch {}
        const missing = getSfxCategories().filter(cat =>
          localSettings.sound.variants[cat.key] === VARIANT_CUSTOM && !cfCheck.get(cat.key)
        );
        customSoundKeys = new Set(cfCheck.keys());
        if (missing.length) {
          const names = missing.map(cat => t("gameSettings.sfxDesc." + cat.key) || cat.key).join(", ");
          await alertModal({ text: (t("gameSettings.saveErrorCustomNoFile")).replace("{names}", names) });
          setActiveCat("sound");
          return;
        }
      }

      // Niepoprawne pola Ustawień gry: zapis wstrzymany z informacją,
      // zamiast po cichu wracać do poprzednich wartości (zgłoszone 2026-10-21).
      if (invalidInputs.size) {
        await alertModal({ text: t("gameSettings.game.saveInvalid") });
        setActiveCat("game");
        return;
      }

      // Uzupełnij filenames w sound settings (do streszczenia w Control)
      await _syncSoundFilenames();

      const payload = JSON.parse(JSON.stringify(localSettings));
      // CAS: nadpisz TYLKO jeśli settings w bazie wciąż równe temu, co
      // wczytaliśmy (albo co sami ostatnio zapisaliśmy) — inaczej dwie karty
      // otwarte na tych samych ustawieniach mogłyby bezpowrotnie skasować
      // nawzajem swoje zmiany. 0 dopasowanych wierszy = ktoś inny zapisał
      // w międzyczasie (albo gra zniknęła) → updateChecked rzuca ROW_GONE.
      await updateChecked("games", { id: gameId, settings: lastSavedSettingsRaw }, { settings: payload });
      lastSavedSettingsRaw = payload;
      if (changeSeq === seq) isDirty = false;
      ok = true;
      setDirtyIndicator(isDirty);

      // Synchronizuj custom pliki audio z bucketem (po sukcesie zapisu do DB);
      // tylko gdy dźwięk się zmienił — nie przy każdej literze w nazwie drużyny.
      if (soundTouched) {
        soundTouched = false;
        await _syncSoundBucket().catch(e => {
          soundTouched = true;
          console.warn("[game-settings] bucket sync partial failure:", e);
        });
      }
    } catch (e) {
      console.error("[game-settings] save error:", e);
      if (e?.code === ROW_GONE) {
        // Ktoś zapisał te ustawienia w międzyczasie: nie nadpisujemy.
        stopped = true;
        setSaveState("conflict");
        toast(t("gameSettings.saveConflict"), { kind: "error" });
        return;
      }
      setSaveState("error");
      toast(t("gameSettings.saveErrorPrefix") + (e?.message || e?.code || String(e)), { kind: "error" });
    }
  })();
  try {
    await saving;
  } finally {
    saving = null;
    if (btnSaveAll) btnSaveAll.disabled = false;
    btnSaveAll?.removeAttribute("aria-busy");
    if (btnSaveAll?.dataset.iconState === "saving") setSaveState(isDirty ? "dirty" : "idle");
  }
  return ok && !isDirty;
}

async function _getSoundUserId() {
  const { data: { user } } = await sb().auth.getUser();
  return user?.id ?? null;
}

// Uzupełnia localSettings.sound.filenames na podstawie IndexedDB customFiles
async function _syncSoundFilenames() {
  let customFiles = new Map();
  try { customFiles = await getSfxCustomFiles(gameId); } catch {}
  if (!localSettings.sound.filenames) localSettings.sound.filenames = {};
  for (const cat of getSfxCategories()) {
    const key = cat.key;
    const custom = customFiles.get(key);
    if (custom?.filename) {
      localSettings.sound.filenames[key] = custom.filename;
    } else {
      delete localSettings.sound.filenames[key];
    }
  }
  // Wyczyść obiekt jeśli pusty
  if (Object.keys(localSettings.sound.filenames).length === 0) {
    delete localSettings.sound.filenames;
  }
}

// Upload custom files do bucketu, usuń te których już nie ma
async function _syncSoundBucket() {
  if (!gameId) return;
  const userId = await _getSoundUserId();
  if (!userId) return;

  let customFiles = new Map();
  try { customFiles = await getSfxCustomFiles(gameId); } catch {}

  const cats = getSfxCategories();
  await Promise.all(cats.map(async cat => {
    const key = cat.key;
    const variant = localSettings.sound.variants[key];
    const custom = customFiles.get(key);

    if (variant === "__custom__" && custom?.blob) {
      // Wgraj plik do bucketu
      await uploadGameSound(sb(), userId, gameId, key, custom.blob);
    } else if (variant !== "__custom__") {
      // Wariant z listy — usuń ewentualny stary custom z bucketu (błąd 404 ignorowany)
      await deleteGameSound(sb(), userId, gameId, key);
    }
  }));
}

// ===== SUB-TAB GRAYING =====
function updateSubTabStates() {
  const hasFinal = localSettings.game.hasFinal === true;
  const finalRandom = localSettings.game.finalQuestionsMode !== "pick";
  const roundsRandom = localSettings.game.roundsQuestionsMode !== "pick";

  if (sidebarFinale) {
    sidebarFinale.classList.toggle("gs-sidebar-item-disabled", !hasFinal || finalRandom);
  }
  if (sidebarRounds) {
    sidebarRounds.classList.toggle("gs-sidebar-item-disabled", roundsRandom);
  }
}

// ===== NAVIGATION =====
function setActiveCat(cat) {
  activeCat = cat;
  sidebar?.querySelectorAll(".gs-sidebar-item").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.cat === cat);
  });
  renderCat(cat);
}

// ===== COLOR MODAL =====
// Trzeci kolor (wejście T): nazwę pola podaje motyw (inputs.T.label);
// motyw bez T — „Trzeci kolor”, pole wyszarzone.
function backgroundLabel(key) {
  const entry = themeRaw.find(item => item.key === key);
  return entry?.backgroundLabel?.[getUiLang()] || entry?.backgroundLabel?.pl || t("gameSettings.display.colorThird");
}

function getColorLabels() {
  return {
    A: t("gameSettings.display.colorA"),
    B: t("gameSettings.display.colorB"),
    BACKGROUND: backgroundLabel(localSettings.display.theme || defaultThemeKey),
    DOT: t("gameSettings.display.colorDot"),
  };
}

async function openColorModal(key) {
  const body = document.createElement("div");
  body.innerHTML = colorPickerHTML("gsColor");
  let picked = normHex(localSettings.display.colors[key]) || "#000000";
  const picker = bindColorPicker(body, { value: picked, onChange: (hex) => { picked = hex; } });
  const confirmed = await confirmModal({
    title: getColorLabels()[key] || key,
    text: "",
    okText: t("common.save"),
    cancelText: t("common.cancel"),
    body,
    // Telefon: arkusz od dołu jak okno koloru tagów w menedżerze bazy.
    sheet: { backBtn: document.getElementById("btnBack") },
    initialFocus: body.querySelector("#gsColorHex"),
  });
  picker.destroy();
  if (confirmed) applyColor(key, picked);
}

function applyColor(key, hex) {
  localSettings.display.colors[key] = hex;
  markDirty();
  content?.querySelectorAll(`[data-color-key="${key}"]`).forEach(el => {
    el.style.setProperty("--c", hex);
  });
  postPreviewRow();
}

// ===== STRING HELPERS =====
function escAttr(s) {
  return String(s ?? "").replaceAll("&", "&amp;").replaceAll('"', "&quot;");
}

function escText(s) {
  return String(s ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function parkDisplayIframe() {
  const holder = document.getElementById("gsLivePreviewWrap");
  if (holder) holder.hidden = true;
}

function showDisplayIframe() {
  const holder = document.getElementById("gsLivePreviewWrap");
  if (holder) holder.hidden = false;
}

// ===== RENDER CATEGORIES =====
function renderCat(cat) {
  if (!content) return;
  // Zawsze zatrzymaj podgląd przed innerHTML (iframe nie rusza się w DOM)
  stopDisplayPreview();
  switch (cat) {
    case "teams":     renderTeams();     break;
    case "display":   renderDisplay();   break;
    case "sound":     renderSound().catch(console.error);     break;
    case "questions": renderQuestions(); break;
    case "finale":    renderFinale();    break;
    case "rounds":    renderRounds();    break;
    case "game":      renderGame();      break;
  }
}

// --- DRUŻYNY ---
function renderTeams() {
  content.innerHTML = `
    <div class="gs-cat-title">${t("gameSettings.categories.teams")}</div>
    <div class="gs-section">
      <div class="gs-field">
        <div class="field-label">${t("gameSettings.teams.nameA")}</div>
        <input class="inp" id="gsTeamA" value="${escAttr(localSettings.teams.teamA)}" maxlength="${LONG_MAX_INPUT}" placeholder="${escAttr(t("gameSettings.teams.placeholderA"))}"/>
        <div class="hint gs-team-measure" id="gsTeamAMeasure" aria-live="polite"></div>
      </div>
      <div class="gs-field">
        <div class="field-label">${t("gameSettings.teams.nameB")}</div>
        <input class="inp" id="gsTeamB" value="${escAttr(localSettings.teams.teamB)}" maxlength="${LONG_MAX_INPUT}" placeholder="${escAttr(t("gameSettings.teams.placeholderB"))}"/>
        <div class="hint gs-team-measure" id="gsTeamBMeasure" aria-live="polite"></div>
      </div>
      <div class="hint">${t("gameSettings.teams.defaultHint").replace("{a}", t("gameSettings.teams.defaultA")).replace("{b}", t("gameSettings.teams.defaultB"))}</div>
    </div>
  `;

  // Nazwa drużyny ma się zmieścić w długim polu Wyświetlacza (long-text.js):
  // liczy się rzeczywista szerokość znaków z czcionki Wyświetlacza (puste
  // kolumny glifów są pomijane, jak w edytorze napisów logo). Znaki, których
  // Wyświetlacz nie ma, są pomijane razem ze spacją za nimi (jak na
  // Wyświetlaczu), a pole nie przyjmie więcej, niż Wyświetlacz pokaże;
  // bez liczników -- komunikat mówi tylko, co i dlaczego nie zostało przyjęte.
  const rejected = { A: { clipped: false, chars: [] }, B: { clipped: false, chars: [] } };
  const measure = (key) => {
    const box = document.getElementById(`gsTeam${key}Measure`);
    if (!box) return;
    const m = measureLongText(localSettings.teams[`team${key}`], _logoFont);
    const chars = [...new Set([...rejected[key].chars, ...m.invalid])];
    const lines = [];
    if (rejected[key].clipped || !m.fits) lines.push(t("gameSettings.teams.displayFull"));
    if (chars.length) lines.push(t("gameSettings.teams.displayRejected", { chars: chars.join(" ") }));
    box.textContent = lines.join(" ");
    box.hidden = lines.length === 0;
    box.classList.toggle("is-warn", lines.length > 0);
  };
  for (const key of ["A", "B"]) {
    document.getElementById(`gsTeam${key}`)?.addEventListener("input", e => {
      const typed = e.target.value;
      const supported = dropUnsupported(typed, _logoFont);
      const clipped = clipLongText(supported, _logoFont);
      rejected[key] = {
        clipped: clipped !== supported,
        chars: [...new Set(Array.from(typed).filter((ch) => ch.trim() && !Array.from(supported).includes(ch)))],
      };
      if (clipped !== typed) e.target.value = clipped;
      localSettings.teams[`team${key}`] = clipped;
      measure(key);
      markDirty();
      postPreviewRow();
    });
    measure(key);
  }
  if (!_logoFont) loadFont5x7().then((font) => { _logoFont = font; measure("A"); measure("B"); }).catch(() => {});
}

// --- WYGLĄD ---
// Podgląd Wyświetlacza: strona sama osadza /control/display?preview=1
// (control/display/js/main.js's bootPreview() — tryb podglądu: zero
// autoryzacji/subskrypcji, tylko postMessage z gotowym wierszem game_state)
// i przesyła mu spreparowany wiersz (shared/js/gameplay/previewRow.js).
// Wybrane logo (localSettings.display.logoId) może jeszcze nie być zapisane
// (autozapis idzie z opóźnieniem) — przekazujemy jego surowy payload wprost
// do podglądu, bo scene.js czyta logo z bazy. null = domyślne logo.
function resolveLogoPreview() {
  const id = localSettings.display.logoId;
  if (!id) return null;
  const logo = _loadedLogos.find(l => l.id === id);
  return logo ? { type: logo.type, payload: logo.payload } : null;
}

function postPreviewRow() {
  try {
    const row = buildDisplayPreviewRow({ teams: localSettings.teams, display: localSettings.display, logoPreview: resolveLogoPreview() });
    if (_displayReady && _displayIframe?.contentWindow) _displayIframe.contentWindow.postMessage({ type: "familijna:preview-row", row }, "*");
    if (_hostReady && _hostIframe?.contentWindow) _hostIframe.contentWindow.postMessage({ type: "familijna:preview-row", row }, "*");
  } catch {}
}

function createDisplayIframe() {
  if (_displayIframe) return;
  const holder = document.getElementById("gsDisplayIframeHolder");
  if (!holder) return;

  _displayIframe = document.createElement("iframe");
  _displayIframe.id = "gsDisplayPreview";
  _displayIframe.src = "/control/display/?preview=1";
  _displayIframe.className = "gs-preview-frame";
  _displayIframe.title = "Display preview";
  _displayReady = false;

  // control/display/js/main.js's bootPreview() posła "familijna:preview-ready" po
  // starcie sceny — sygnał gotowości zamiast pollowania obecności
  // window.handleCommand (który już nie istnieje, komend nie ma).
  window.addEventListener("message", (e) => {
    if (e.data?.type !== "familijna:preview-ready") return;
    if (e.source !== _displayIframe?.contentWindow) return;
    _displayReady = true;
    // Podgląd ma być żywy niezależnie od aktywnej zakładki (operator zmienia
    // nazwę drużyny na zakładce "Drużyny", bez przełączania na "Wygląd") --
    // warunek `activeCat === "display"` tu był błędem: postPreviewRow()
    // wcześniej (np. z handlera #gsTeamA input) cicho wychodził wczesnym
    // returnem, dopóki _displayReady było false (patrz komentarz przy
    // postPreviewRow()) -- ten input NIGDY nie był ponownie wysłany, jeśli
    // akurat trafił przed odebraniem "familijna:preview-ready", więc zmiana
    // ginęła bezpowrotnie zamiast dotrzeć z opóźnieniem. Zgłoszone (e2e
    // "modal ustawień gry — zmiana nazwy drużyny odświeża podgląd
    // Wyświetlacza"): #gsTeamA.fill() na zakładce "Drużyny" nigdy nie
    // docierał do podglądu.
    postPreviewRow();
  });

  holder.appendChild(_displayIframe);
}

function createHostIframe() {
  if (_hostIframe) return;
  const holder = document.getElementById("gsHostIframeHolder");
  if (!holder) return;
  _hostIframe = document.createElement("iframe");
  _hostIframe.id = "gsHostPreview";
  _hostIframe.src = "/control/host/?preview=1";
  _hostIframe.className = "gs-preview-frame";
  _hostIframe.title = t("gameSettings.display.hostPreview");
  _hostReady = false;
  window.addEventListener("message", e => {
    if (e.data?.type !== "familijna:host-preview-ready" || e.source !== _hostIframe?.contentWindow) return;
    _hostReady = true;
    postPreviewRow();
  });
  holder.appendChild(_hostIframe);
}

function stopDisplayPreview() {
  parkDisplayIframe();
}

function resolveThemeLabels() {
  const lang = getUiLang() || "pl";
  const custom = themeAccess.themes.map(th => ({
    key: customThemeKey(th.id), label: th.name,
    usesBackground: th.uses_background !== false, defaultBackground: th.background || undefined,
    backgroundLabel: th.background_label || null,
  }));
  themeRaw = [...builtinThemes, ...custom];
  const current = localSettings.display.theme;
  if (customThemeId(current) && !themeRaw.some(e => e.key === current)) {
    themeRaw.push({ key: current, label: t("gameSettings.display.themeUnavailable") });
  }
  themeList = themeRaw.map(e => ({
    key: e.key,
    label: typeof e.label === "object" ? (e.label[lang] ?? e.label["pl"] ?? e.key) : (e.label || e.key),
  }));
}

function themeErrorText(code, detail = "") {
  const key = `gameSettings.display.themeErrors.${code}`;
  const text = t(key);
  return (text === key ? t("gameSettings.display.themeErrors.invalid") : text).replace("{detail}", detail);
}

async function invokeThemes(body) {
  const { data, error } = await sb().functions.invoke("display-themes", { body });
  if (!error) return data;
  try { return await error.context.json(); } catch { return { ok: false, error: "server_error" }; }
}

function themeFilesHTML() {
  if (!themeAccess.canImport && !themeAccess.themes.length) return "";
  const tags = themeAccess.themes.map(th => `
      <div class="sfx-file-tag">
        <span class="sfx-file-name" title="${escAttr(th.name)}">${escText(th.name)}</span>
        <button class="btn-plain sfx-file-remove" type="button" data-theme-delete="${escAttr(th.id)}" title="${escAttr(t("gameSettings.display.themeDelete"))}" aria-label="${escAttr(t("gameSettings.display.themeDelete"))}">${icon("trash")}</button>
      </div>`).join("");
  const upload = themeAccess.canImport
    ? `<button class="btn sfx-add-btn" type="button" id="btnThemeImport">${icon("upload")} ${t("gameSettings.display.themeImport")}</button>
       <input type="file" id="gsThemeFile" accept=".json,application/json" hidden/>`
    : "";
  return `
    <div class="gs-theme-files">${tags}${upload}</div>
    ${themeAccess.canImport ? `<div class="hint">${t("gameSettings.display.themeImportHint")}</div>` : ""}`;
}

function selectTheme(key) {
  const next = chooseDisplayTheme(localSettings.display, themeRaw.find(entry => entry.key === key), defaultThemeKey);
  if (next === localSettings.display) return false;
  localSettings.display = next;
  markDirty();
  return true;
}

function bindThemeFiles() {
  const input = document.getElementById("gsThemeFile");
  document.getElementById("btnThemeImport")?.addEventListener("click", () => {
    if (themeAccess.themes.length >= themeAccess.limit) {
      alertModal({ text: t("gameSettings.display.themeLimit").replace("{limit}", themeAccess.limit) });
      return;
    }
    input?.click();
  });
  input?.addEventListener("change", async () => {
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    const text = await file.text().catch(() => "");
    // Ten sam walidator sprawdza plik na serwerze; tu tylko szybka odpowiedź.
    const local = parseThemeFile(text);
    if (!local.ok) { alertModal({ text: themeErrorText(local.error, local.detail) }); return; }
    const btn = document.getElementById("btnThemeImport");
    if (btn) btn.disabled = true;
    const res = await invokeThemes({ action: "upload", text });
    if (btn) btn.disabled = false;
    if (!res?.ok) {
      const code = res?.error === "invalid_theme" ? res.reason : res?.error;
      alertModal({ text: themeErrorText(code || "server_error", res?.detail || "") });
      return;
    }
    themeAccess.themes.push({ ...res.theme, created_at: new Date().toISOString() });
    resolveThemeLabels();
    selectTheme(customThemeKey(res.theme.id));
    toast(t("gameSettings.display.themeUploaded").replace("{name}", res.theme.name));
    renderDisplay();
  });
  content.querySelectorAll("[data-theme-delete]").forEach(btn => btn.addEventListener("click", async () => {
    const id = btn.dataset.themeDelete;
    const theme = themeAccess.themes.find(th => th.id === id);
    if (!theme) return;
    if (!await confirmModal({ text: t("gameSettings.display.themeDeleteConfirm").replace("{name}", theme.name) })) return;
    btn.disabled = true;
    const res = await invokeThemes({ action: "delete", id });
    if (!res?.ok && res?.error !== "not_found") {
      btn.disabled = false;
      alertModal({ text: themeErrorText(res?.error || "server_error") });
      return;
    }
    themeAccess.themes = themeAccess.themes.filter(th => th.id !== id);
    if (localSettings.display.theme === customThemeKey(id)) {
      localSettings.display = { ...localSettings.display, theme: null };
      markDirty();
    }
    resolveThemeLabels();
    renderDisplay();
  }));
}

function renderDisplay() {
  const c = localSettings.display.colors;
  const colorLabels = getColorLabels();
  const swatches = ["A", "B", "BACKGROUND", "DOT"].map(key => `
    <div class="colorItem">
      <div class="field-label">${escText(colorLabels[key])}</div>
      <button class="swatchBtn" data-color-key="${key}" style="--c:${c[key]}" title="${key}" type="button"></button>
    </div>
  `).join("");

  const effectiveTheme = localSettings.display.theme || defaultThemeKey;

  content.innerHTML = `
    <div class="gs-cat-title">${t("gameSettings.categories.display")}</div>
    <div class="gs-section">
      <div class="field-label">${t("gameSettings.display.colors")}</div>
      <div class="colorRow">${swatches}</div>
    </div>
    <div class="gs-section">
      <div class="field-label">${t("gameSettings.display.theme")}</div>
      <div class="ui-select" id="gsThemeSelect">
        <button class="btn inp ui-select-btn" type="button" aria-haspopup="listbox" aria-expanded="false">
          <span class="ui-select-label">—</span>
          <span class="ui-select-caret" aria-hidden="true"><i class="ico" data-icon="caret-down"></i></span>
        </button>
        <div class="ui-select-menu" role="listbox"></div>
      </div>
      ${themeFilesHTML()}
    </div>
    <div class="gs-section">
      <div class="field-label">${t("gameSettings.display.logo")}</div>
      <div id="gsLogoGrid" class="gs-logo-grid"></div>
    </div>
    <div class="gs-section">
      <div class="field-label">${t("gameSettings.display.hostLogoMode")}</div>
      <div class="toggle-group gs-host-logo-mode" role="radiogroup" aria-label="${escAttr(t("gameSettings.display.hostLogoMode"))}">
        <label class="toggle-item">
          <input type="radio" name="gsHostLogoMode" value="pixel" ${localSettings.display.hostLogoMode === "pixel" ? "checked" : ""}/>
          <span class="toggle-slider">${escText(t("gameSettings.display.hostLogoPixel"))}</span>
        </label>
        <label class="toggle-item">
          <input type="radio" name="gsHostLogoMode" value="source" ${localSettings.display.hostLogoMode === "source" ? "checked" : ""}/>
          <span class="toggle-slider">${escText(t("gameSettings.display.hostLogoSource"))}</span>
        </label>
      </div>
      <div class="hint">${t("gameSettings.display.hostLogoHint")}</div>
    </div>
    <div class="sfx-foot">
      <button class="btn" id="btnDisplayReset" type="button">${icon("refresh")} ${t("gameSettings.resetSection")}</button>
    </div>
  `;

  content.querySelectorAll(".swatchBtn").forEach(btn => {
    btn.addEventListener("click", () => openColorModal(btn.dataset.colorKey));
  });
  content.querySelectorAll("[name='gsHostLogoMode']").forEach(radio => radio.addEventListener("change", () => {
    localSettings.display.hostLogoMode = radio.value === "pixel" ? "pixel" : "source";
    markDirty();
    postPreviewRow();
  }));

  // Trzeci kolor (T): znaczenie i wartość domyślną podaje motyw; motyw bez T go nie używa.
  const syncBackgroundSwatch = (key) => {
    const swatch = content.querySelector('.swatchBtn[data-color-key="BACKGROUND"]');
    const entry = themeRaw.find(item => item.key === key);
    const unused = entry?.usesBackground === false;
    const label = backgroundLabel(key);
    swatch.closest(".colorItem").querySelector(".field-label").textContent = label;
    swatch.disabled = unused;
    swatch.title = unused ? t("gameSettings.display.backgroundUnused") : label;
    swatch.style.setProperty("--c", localSettings.display.colors.BACKGROUND);
  };
  syncBackgroundSwatch(effectiveTheme);

  initUiSelect(document.getElementById("gsThemeSelect"), {
    options: themeList.map(th => ({ value: th.key, label: th.label })),
    value: effectiveTheme,
    onChange: (val) => {
      if (!selectTheme(val)) return;
      syncBackgroundSwatch(val);
      postPreviewRow();
    },
  });
  bindThemeFiles();

  document.getElementById("btnDisplayReset")?.addEventListener("click", async () => {
    if (!await confirmModal({ text: t("gameSettings.resetSectionConfirm") })) return;
    localSettings.display = JSON.parse(JSON.stringify(DEFAULT_SETTINGS.display));
    markDirty();
    renderDisplay();
  });

  // Iframe jest zawsze w gsDisplayIframeHolder (sibling gsContentInner) — tylko show/hide
  showDisplayIframe();
  if (_displayReady) postPreviewRow();
  renderLogoGrid();
}

async function renderLogoGrid() {
  const grid = document.getElementById("gsLogoGrid");
  if (!grid) return;

  grid.innerHTML = `<div class="hint">${t("gameSettings.display.logoLoading")}</div>`;

  if (!_logoFont) {
    try { _logoFont = await loadFont5x7(); } catch {}
  }
  if (!_defaultLogoPayload) {
    try {
      const r = await fetch(await cacheBust("/shared/data/logo_familijna.json"), { cache: "force-cache" });
      if (r.ok) _defaultLogoPayload = await r.json();
    } catch {}
  }

  try {
    const { data, error } = await sb()
      .from("user_logos")
      .select("id,name,type,payload")
      .order("updated_at", { ascending: false });
    if (error) throw error;
    _loadedLogos = data || [];
    // After loading: update preview iframe with the selected logo
    if (_displayReady) postPreviewRow();
  } catch (e) {
    if (document.getElementById("gsLogoGrid")) {
      grid.innerHTML = `<div class="hint">${escText(e?.message || String(e))}</div>`;
    }
    return;
  }

  // Check tab still active
  if (!document.getElementById("gsLogoGrid")) return;

  grid.innerHTML = "";
  const selectedId = localSettings.display.logoId;

  grid.appendChild(makeLogoTile(null, selectedId));
  for (const logo of _loadedLogos) {
    grid.appendChild(makeLogoTile(logo.id, selectedId));
  }

  grid.querySelectorAll(".gs-logo-tile").forEach(tile => {
    tile.addEventListener("click", () => {
      const rawId = tile.dataset.logoId;
      const id = rawId === "default" ? null : rawId;
      localSettings.display.logoId = id;
      markDirty();
      grid.querySelectorAll(".gs-logo-tile").forEach(t => t.classList.remove("is-selected"));
      tile.classList.add("is-selected");
      postPreviewRow();
    });
  });
}

function makeLogoTile(id, selectedId) {
  const key = id ?? "default";
  const name = id === null ? t("gameSettings.display.logoDefault") : (_loadedLogos.find(l => l.id === id)?.name || "—");
  const logoObj = id === null
    ? (_defaultLogoPayload ? { type: "GLYPH_30x10", payload: _defaultLogoPayload } : null)
    : _loadedLogos.find(l => l.id === id) || null;
  const sel = (id === null && selectedId === null) || (id !== null && id === selectedId);

  const el = document.createElement("div");
  el.className = "gs-logo-tile" + (sel ? " is-selected" : "");
  el.dataset.logoId = String(key);

  const prev = document.createElement("div");
  prev.className = "gs-logo-prev";
  const canvas = buildLogoPreviewCanvas(logoObj, _logoFont, 180, 84);
  prev.appendChild(canvas);
  el.appendChild(prev);

  const label = document.createElement("div");
  label.className = "gs-logo-name";
  label.textContent = name;
  el.appendChild(label);

  return el;
}

// --- DŹWIĘK ---
const VARIANT_CUSTOM = "__custom__";

async function renderSound() {
  content.innerHTML = `
    <div class="gs-cat-title">${t("gameSettings.categories.sound")}</div>
    <div class="gs-section">
      <div class="sfx-table" id="sfxTableGs"></div>
    </div>
    <div class="sfx-foot">
      <button class="btn" id="btnSoundReset" type="button">${icon("refresh")} ${t("gameSettings.sfxResetAll")}</button>
    </div>
  `;

  try { await loadSfxManifest(); } catch (e) {
    const tbl = document.getElementById("sfxTableGs");
    if (tbl) tbl.innerHTML = `<div class="field-error" role="alert">Błąd ładowania dźwięków: ${escText(e?.message || String(e))}</div>`;
    return;
  }

  const categories = getSfxCategories();
  const lang = getUiLang() || "pl";

  let customFiles = new Map();
  try { customFiles = await getSfxCustomFiles(gameId); } catch {}

  customSoundKeys = new Set(customFiles.keys());
  const tableEl = document.getElementById("sfxTableGs");
  if (!tableEl) return;

  const variantInsts = new Map(); // key → ui-select instance

  for (const cat of categories) {
    const key = cat.key;
    const volPct = localSettings.sound.volumes[key] ?? 100;
    const custom = customFiles.get(key);
    // Aktywny wariant: "__custom__" jeśli mamy własny plik, inaczej zapisany lub domyślny
    const activeVariant = custom ? VARIANT_CUSTOM
      : (localSettings.sound.variants[key] || (cat.sounds[0]?.file || "classic.mp3").split("?")[0]);
    const desc = t("gameSettings.sfxDesc." + key) || key;

    const row = document.createElement("div");
    row.className = "sfx-row";
    row.dataset.key = key;

    // Opcje dla ui-select: warianty twórcy + "Własny" na końcu
    const variantOptions = cat.sounds.map(s => {
      const file = s.file.split("?")[0];
      const label = s.label?.[lang] || s.file;
      return { value: file, label };
    });
    variantOptions.push({ value: VARIANT_CUSTOM, label: t("gameSettings.sfxCustom") });

    // Tag z własnym plikiem (widoczny tylko gdy custom)
    const fileTagHtml = custom
      ? `<div class="sfx-file-tag">
           <span class="sfx-file-name" title="${escAttr(custom.filename)}">${escText(custom.filename)}</span>
           <button class="btn-plain sfx-file-remove" type="button" data-sfx-clear="${escAttr(key)}" title="Usuń" aria-label="Usuń">${icon("trash")}</button>
         </div>`
      : "";

    // Przycisk "Wybierz plik" — widoczny tylko gdy wybrany "Własny" i nie ma jeszcze pliku
    const showUploadBtn = !custom && activeVariant === VARIANT_CUSTOM;
    const uploadBtnHtml = `<button class="btn sfx-add-btn" type="button" data-sfx-file="${escAttr(key)}"${showUploadBtn ? "" : " hidden"}>${icon("upload")} ${t("gameSettings.sfxChooseFile")}</button>`;

    // Przycisk odtwarzania — zablokowany gdy Własny bez pliku
    const previewDisabled = activeVariant === VARIANT_CUSTOM && !custom;

    row.innerHTML = `
      <div class="sfx-row-desc">${escText(desc)}</div>
      <div class="ui-select sfx-variant-select" data-sfx-variant="${escAttr(key)}">
        <button class="btn sm ui-select-btn" type="button" aria-haspopup="listbox" aria-expanded="false">
          <span class="ui-select-label">—</span>
          <span class="ui-select-caret" aria-hidden="true"><i class="ico" data-icon="caret-down"></i></span>
        </button>
        <div class="ui-select-menu" role="listbox"></div>
      </div>
      <button class="btn sm icon" type="button" data-sfx-preview="${escAttr(key)}" title="Podgląd"${previewDisabled ? " disabled" : ""}>${icon("play")}</button>
      <div class="sfx-vol-wrap">
        <input class="sfx-vol sound-volume-slider" type="range" min="0" max="100" step="1" value="${volPct}" data-sfx-vol="${escAttr(key)}"/>
        <span class="sfx-vol-label" id="sfxVol_${escAttr(key)}">${volPct}%</span>
      </div>
      <div class="sfx-file-wrap">
        ${fileTagHtml}${uploadBtnHtml}
        <input class="sfx-file-input" type="file" accept="audio/mpeg,audio/wav,audio/ogg" data-sfx-key="${escAttr(key)}"/>
      </div>
    `;

    // Inicjalizacja ui-select dla tego wiersza
    const variantRoot = row.querySelector(".sfx-variant-select");
    const variantInst = initUiSelect(variantRoot, {
      options: variantOptions,
      value: activeVariant,
      onChange: (val) => {
        const uploadBtn = row.querySelector("[data-sfx-file]");
        const previewBtn = row.querySelector("[data-sfx-preview]");
        if (val === VARIANT_CUSTOM) {
          const hasCustom = !!customFiles.get(key);
          if (uploadBtn) uploadBtn.hidden = hasCustom;
          if (previewBtn) previewBtn.disabled = !hasCustom;
          const fileTag = row.querySelector(".sfx-file-tag");
          if (fileTag) fileTag.hidden = !hasCustom;
          localSettings.sound.variants[key] = VARIANT_CUSTOM;
          markSoundDirty();
        } else {
          if (uploadBtn) uploadBtn.hidden = true;
          if (previewBtn) previewBtn.disabled = false;
          const fileTag = row.querySelector(".sfx-file-tag");
          if (fileTag) fileTag.hidden = true;
          localSettings.sound.variants[key] = val;
          markSoundDirty();
        }
      },
    });
    variantInsts.set(key, variantInst);

    tableEl.appendChild(row);
  }

  // Podgląd — play/stop toggle
  let _previewAudio = null;
  let _previewBtn   = null;
  let _previewUrl   = null; // blob URL do zwolnienia

  function _stopPreview() {
    if (_previewAudio) stopSfxAudio(_previewAudio, { dispose: true });
    if (_previewUrl)   { URL.revokeObjectURL(_previewUrl); _previewUrl = null; }
    if (_previewBtn)   { _previewBtn.innerHTML = icon("play"); delete _previewBtn.dataset.playing; }
    _previewAudio = null;
    _previewBtn   = null;
  }

  tableEl.querySelectorAll("[data-sfx-preview]").forEach(btn => {
    btn.addEventListener("click", () => {
      // Stop jeśli to ten sam przycisk
      if (_previewBtn === btn) { _stopPreview(); return; }
      _stopPreview();

      const key = btn.dataset.sfxPreview;
      const val = variantInsts.get(key)?.getValue() ?? VARIANT_CUSTOM;
      const vol = (localSettings.sound.volumes[key] ?? 100) / 100;

      let audio, blobUrl = null;
      if (val === VARIANT_CUSTOM) {
        const custom = customFiles.get(key);
        if (!custom?.blob) return;
        blobUrl = URL.createObjectURL(custom.blob);
        audio = createSfxAudio(blobUrl);
      } else {
        const cat = categories.find(c => c.key === key);
        if (!cat) return;
        audio = createSfxAudio(buildSfxUrl(cat.folder, val));
      }
      playSfxAudio(audio, vol).catch(() => {});
      audio.addEventListener("ended", _stopPreview, { once: true });

      _previewAudio = audio;
      _previewBtn   = btn;
      _previewUrl   = blobUrl;
      btn.innerHTML = icon("stop");
      btn.dataset.playing = "1";
    });
  });

  // Zmiana głośności podczas odtwarzania podglądu
  tableEl.querySelectorAll(".sfx-vol").forEach(slider => {
    slider.addEventListener("input", () => {
      const key = slider.dataset.sfxVol;
      if (_previewBtn?.dataset.sfxPreview === key && _previewAudio) {
        setSfxAudioVolume(_previewAudio, parseInt(slider.value, 10) / 100);
      }
    });
  }, true); // capture=true żeby odpalić przed istniejącym listenerem

  // Głośność
  tableEl.querySelectorAll(".sfx-vol").forEach(slider => {
    slider.addEventListener("input", () => {
      const key = slider.dataset.sfxVol;
      const pct = parseInt(slider.value, 10);
      localSettings.sound.volumes[key] = pct;
      const lbl = document.getElementById(`sfxVol_${key}`);
      if (lbl) lbl.textContent = `${pct}%`;
      setSfxVolume(key, pct / 100);
      markDirty();
    });
  });

  // Trigger input pliku
  tableEl.querySelectorAll("[data-sfx-file]").forEach(btn => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.sfxFile;
      tableEl.querySelector(`input[data-sfx-key="${key}"]`)?.click();
    });
  });

  // Upload własnego pliku
  tableEl.querySelectorAll(".sfx-file-input").forEach(input => {
    input.addEventListener("change", async () => {
      const key = input.dataset.sfxKey;
      const file = input.files?.[0];
      input.value = "";
      if (!file) return;

      const cat = categories.find(c => c.key === key);
      const limitSec = cat?.limitSec || 30;

      // Bez AudioContext nie da się sprawdzić pliku -- wtedy go nie blokujemy.
      // Gdy jest, a pliku nie da się odtworzyć, to nie jest dźwięk (np. tekst
      // z rozszerzeniem .mp3) -- wcześniej taki plik przechodził po cichu.
      let ctx = null;
      try { ctx = new AudioContext(); } catch { ctx = null; }
      if (ctx) {
        let decoded = null;
        try {
          decoded = await ctx.decodeAudioData(await file.arrayBuffer());
        } catch {
          decoded = null;
        } finally {
          ctx.close().catch(() => {});
        }
        if (!decoded) {
          alertModal({ text: t("gameSettings.sfxNotAudio") });
          return;
        }
        if (decoded.duration > limitSec) {
          alertModal({ text: (t("gameSettings.sfxTooLong")).replace("{limit}", limitSec) });
          return;
        }
      }

      try {
        await setSfxCustomBlob(key, file, file.name, gameId);
        customFiles.set(key, { blob: file, filename: file.name });
        customSoundKeys.add(key);
        localSettings.sound.variants[key] = VARIANT_CUSTOM;
        markSoundDirty();
        // Odblokuj podgląd po wgraniu pliku
        const row = input.closest(".sfx-row");
        const previewBtn = row?.querySelector("[data-sfx-preview]");
        if (previewBtn) previewBtn.disabled = false;
        renderSound();
      } catch (e) {
        alertModal({ text: `Błąd: ${e?.message || String(e)}` });
      }
    });
  });

  // Usuń własny plik → pokaż "Wybierz plik", usuń tag, usuń z bucketu
  tableEl.querySelectorAll("[data-sfx-clear]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const key = btn.dataset.sfxClear;
      // IndexedDB
      try { await clearSfxCustomFile(key, gameId); } catch {}
      // Bucket (fire-and-forget, błąd nie blokuje UI)
      _getSoundUserId().then(userId => {
        if (userId) deleteGameSound(sb(), userId, gameId, key).catch(console.warn);
      });
      customFiles.delete(key);
      customSoundKeys.delete(key);
      delete localSettings.sound.variants[key];
      markSoundDirty();

      const row = btn.closest(".sfx-row");
      if (!row) return;
      // Usuń tag z nazwą pliku
      btn.closest(".sfx-file-tag")?.remove();
      // Pokaż "Wybierz plik" i zablokuj podgląd (Własny nadal wybrany, brak pliku)
      const uploadBtn = row.querySelector("[data-sfx-file]");
      if (uploadBtn) uploadBtn.hidden = false;
      const previewBtn = row.querySelector("[data-sfx-preview]");
      if (previewBtn) previewBtn.disabled = true;
    });
  });

  // Reset wszystkich dźwięków
  document.getElementById("btnSoundReset")?.addEventListener("click", async () => {
    if (!await confirmModal({ text: t("gameSettings.sound.resetConfirm") })) return;

    const customKeys = [...customFiles.keys()];
    localSettings.sound = { volumes: {}, variants: {} };

    // IndexedDB
    try { await clearAllSfxCustomFiles(gameId); } catch {}

    // Bucket (fire-and-forget)
    if (customKeys.length > 0) {
      _getSoundUserId().then(userId => {
        if (userId) deleteAllGameSounds(sb(), userId, gameId, customKeys).catch(console.warn);
      });
    }

    markSoundDirty();
    renderSound();
  });
}

// --- PYTANIA — USTAWIENIA ---
function renderQuestions() {
  const g = localSettings.game;
  const hasFinal = g.hasFinal === true;
  const finalRandom = g.finalQuestionsMode !== "pick";
  const roundsRandom = g.roundsQuestionsMode !== "pick";

  content.innerHTML = `
    <div class="gs-cat-title">${t("gameSettings.categories.questions")}</div>
    <div class="gs-section">
      <div class="sectionBlock">
        <div class="section-title">${t("gameSettings.questions.finaleSection")}</div>
        <div class="setting-item">
          <div class="field-label">${t("gameSettings.finale.hasFinal")}</div>
          <div class="toggle-group">
            <label class="toggle-item">
              <input type="radio" name="gsHasFinal" value="yes" ${hasFinal ? "checked" : ""}/>
              <span class="toggle-slider">${escText(t("gameSettings.finale.yes"))}</span>
            </label>
            <label class="toggle-item">
              <input type="radio" name="gsHasFinal" value="no" ${!hasFinal ? "checked" : ""}/>
              <span class="toggle-slider">${escText(t("gameSettings.finale.no"))}</span>
            </label>
          </div>
        </div>
        <div class="setting-item" id="gsFinalModeField"${hasFinal ? "" : " hidden"}>
          <div class="field-label">${t("gameSettings.questions.finalModeLabel")}</div>
          <div class="toggle-group">
            <label class="toggle-item">
              <input type="radio" name="gsFinalMode" value="random" ${finalRandom ? "checked" : ""}/>
              <span class="toggle-slider">${escText(t("gameSettings.questions.modeRandom"))}</span>
            </label>
            <label class="toggle-item">
              <input type="radio" name="gsFinalMode" value="pick" ${!finalRandom ? "checked" : ""}/>
              <span class="toggle-slider">${escText(t("gameSettings.questions.modeManual"))}</span>
            </label>
          </div>
          <div class="hint">${t("gameSettings.questions.finalModeHint")}</div>
        </div>
      </div>
      <div class="sectionBlock">
        <div class="section-title">${t("gameSettings.questions.roundsSection")}</div>
        <div class="setting-item">
          <div class="field-label">${t("gameSettings.questions.roundsModeLabel")}</div>
          <div class="toggle-group">
            <label class="toggle-item">
              <input type="radio" name="gsRoundsMode" value="random" ${roundsRandom ? "checked" : ""}/>
              <span class="toggle-slider">${escText(t("gameSettings.questions.modeRandom"))}</span>
            </label>
            <label class="toggle-item">
              <input type="radio" name="gsRoundsMode" value="pick" ${!roundsRandom ? "checked" : ""}/>
              <span class="toggle-slider">${escText(t("gameSettings.questions.modeOrdered"))}</span>
            </label>
          </div>
          <div class="hint">${t("gameSettings.questions.roundsModeHint")}</div>
          ${hasFinal && finalRandom && !roundsRandom ? `<div class="hint">${icon("warning")} ${t("gameSettings.questions.finalRandomRoundsOrderedWarning")}</div>` : ""}
        </div>
      </div>
    </div>
  `;

  content.querySelectorAll("[name='gsHasFinal']").forEach(radio => {
    radio.addEventListener("change", () => {
      localSettings.game.hasFinal = radio.value === "yes";
      if (!localSettings.game.hasFinal) {
        // Od razu przywróć pytania finału do listy rund — operator może
        // zapisać ustawienia bez otwierania osobnej zakładki Rundy.
        const inRounds = new Set(localSettings.questions.rounds.map(q => String(q.id)));
        const returned = localSettings.questions.final.filter(q => q?.id && !inRounds.has(String(q.id)));
        localSettings.questions.rounds = [...localSettings.questions.rounds, ...returned];
        localSettings.questions.final = [];
        localSettings.game.finalQuestionsMode = "random";
      }
      markDirty();
      updateSubTabStates();
      renderQuestions();
    });
  });

  content.querySelectorAll("[name='gsFinalMode']").forEach(radio => {
    radio.addEventListener("change", () => {
      localSettings.game.finalQuestionsMode = radio.value;
      markDirty();
      updateSubTabStates();
    });
  });

  content.querySelectorAll("[name='gsRoundsMode']").forEach(radio => {
    radio.addEventListener("change", () => {
      localSettings.game.roundsQuestionsMode = radio.value;
      markDirty();
      updateSubTabStates();
    });
  });
}

// --- PYTANIA — FINAŁ ---
function renderFinale() {
  const picked = localSettings.questions.final;
  const pickedIds = new Set(picked.map(q => q.id));
  const pool = allQuestions.filter(q => !pickedIds.has(q.id));

  content.innerHTML = `
    <div class="gs-cat-title">${t("gameSettings.categories.finale")}</div>
    <div class="gs-section">
      <div class="hint gs-list-hint">${t(DRAG ? "gameSettings.finale.dragHint" : "gameSettings.finale.tapHint")}</div>
      <div class="gs-badge-row">
        <span class="tag tag--gold">${t("gameSettings.finalBadge")} <b>${picked.length}</b>/5</span>
      </div>
      <div class="finalLists">
        <div class="finalCol">
          <div class="mini"><div class="hint">${t("gameSettings.finalPoolHint")}</div></div>
          <div class="qList" id="gsFinalePool">
            ${pool.length === 0
              ? `<div class="empty-state empty-state--inline">${t("gameSettings.finalPoolEmpty")}</div>`
              : pool.map(q => `<div class="qRow" data-qid="${escAttr(q.id)}" draggable="${DRAGGABLE}">
                  <div class="meta">${q.ord}</div>
                  <div class="txt">${escText(q.text)}</div>
                </div>`).join("")}
          </div>
        </div>
        <div class="finalCol">
          <div class="mini"><div class="hint">${t("gameSettings.finalListHint")}</div></div>
          <div class="qList" id="gsGsFinalePicked">
            ${picked.length === 0
              ? `<div class="empty-state empty-state--inline">${DRAG ? t("gameSettings.finalPickEmpty") : t("gameSettings.finale.tapEmpty")}</div>`
              : picked.map(q => `<div class="qRow${DRAG ? " gs-draggable" : ""}" draggable="${DRAGGABLE}" data-qid="${escAttr(q.id)}">
                  <div class="meta">${q.ord}</div>
                  <div class="txt">${escText(q.text)}</div>
                </div>`).join("")}
          </div>
        </div>
      </div>
    </div>
  `;

  const poolEl = document.getElementById("gsFinalePool");
  const pickedEl = document.getElementById("gsGsFinalePicked");

  // Klik w puli → dodaj do finału
  poolEl?.addEventListener("click", e => {
    const row = e.target.closest(".qRow");
    if (!row) return;
    if (localSettings.questions.final.length >= 5) return;
    const id = row.dataset.qid;
    const q = allQuestions.find(q => q.id === id);
    if (!q || localSettings.questions.final.some(p => p.id === id)) return;
    localSettings.questions.final = [...localSettings.questions.final, q];
    // Usuń z listy rund (żeby nie było duplikatu)
    localSettings.questions.rounds = localSettings.questions.rounds.filter(r => r.id !== id);
    markDirty();
    renderFinale();
  });

  // Klik w finałowej → usuń
  pickedEl?.addEventListener("click", e => {
    const row = e.target.closest(".qRow");
    if (!row) return;
    const id = row.dataset.qid;
    if (!id) return;
    const q = allQuestions.find(q => q.id === id);
    localSettings.questions.final = localSettings.questions.final.filter(p => p.id !== id);
    // Przywróć do rund (na końcu) jeśli jeszcze nie ma
    if (q && !localSettings.questions.rounds.some(r => r.id === id)) {
      localSettings.questions.rounds = [...localSettings.questions.rounds, q];
    }
    markDirty();
    renderFinale();
  });

  if (!DRAG) return;

  // Drag: przenoszenie między kolumnami
  setupFinaleColumnDnd(poolEl, pickedEl);

  // Drag: sortowanie wewnątrz finałowej listy
  if (pickedEl) {
    initDragSort(pickedEl, () => localSettings.questions.final, v => { localSettings.questions.final = v; }, renderFinale);
  }
}

function setupFinaleColumnDnd(poolEl, pickedEl) {
  if (!poolEl || !pickedEl) return;
  let dragId = null;
  let dragSide = null; // "pool" | "picked"

  function onDragStart(side, e) {
    const row = e.target.closest(".qRow");
    if (!row) return;
    dragId = row.dataset.qid;
    dragSide = side;
    e.dataTransfer.effectAllowed = "move";
  }

  function onDragOver(targetSide, e) {
    if (!dragId) return;
    if (dragSide === targetSide) return; // nie przenosimy w obrębie tej samej kolumny tu (initDragSort to obsługuje)
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    (targetSide === "pool" ? poolEl : pickedEl).classList.add("droptarget");
  }

  function onDragLeave(targetSide) {
    (targetSide === "pool" ? poolEl : pickedEl).classList.remove("droptarget");
  }

  function onDrop(targetSide, e) {
    e.preventDefault();
    poolEl.classList.remove("droptarget");
    pickedEl.classList.remove("droptarget");
    if (!dragId || dragSide === targetSide) return;
    if (targetSide === "picked") {
      if (localSettings.questions.final.length >= 5) return;
      const q = allQuestions.find(q => q.id === dragId);
      if (!q || localSettings.questions.final.some(p => p.id === dragId)) return;
      localSettings.questions.final = [...localSettings.questions.final, q];
      localSettings.questions.rounds = localSettings.questions.rounds.filter(r => r.id !== dragId);
    } else {
      const q = allQuestions.find(q => q.id === dragId);
      localSettings.questions.final = localSettings.questions.final.filter(p => p.id !== dragId);
      if (q && !localSettings.questions.rounds.some(r => r.id === dragId)) {
        localSettings.questions.rounds = [...localSettings.questions.rounds, q];
      }
    }
    dragId = null; dragSide = null;
    markDirty();
    renderFinale();
  }

  poolEl.addEventListener("dragstart", e => onDragStart("pool", e));
  pickedEl.addEventListener("dragstart", e => onDragStart("picked", e));
  poolEl.addEventListener("dragover", e => onDragOver("pool", e));
  pickedEl.addEventListener("dragover", e => onDragOver("picked", e));
  poolEl.addEventListener("dragleave", () => onDragLeave("pool"));
  pickedEl.addEventListener("dragleave", () => onDragLeave("picked"));
  poolEl.addEventListener("drop", e => onDrop("pool", e));
  pickedEl.addEventListener("drop", e => onDrop("picked", e));
}

// --- PYTANIA — RUNDY ---
// Pytania z listy finału są wykluczane z puli rund TYLKO gdy finał jest
// faktycznie włączony — inaczej martwa lista pytań finałowych (np. po
// wcześniejszym wyłączeniu finału bez wyczyszczenia wyboru) bezsensownie
// zawężałaby pulę pytań do rund, mimo że finał się nigdy nie odpali.
function effectiveFinalIds() {
  return localSettings.game.hasFinal === true
    ? new Set(localSettings.questions.final.map(q => q.id))
    : new Set();
}

function renderRounds() {
  const finaleIds = effectiveFinalIds();

  // Zbuduj pełną listę: najpierw zapisana kolejność (bez finalowych), potem brakujące
  const pickedIds = new Set(localSettings.questions.rounds.map(q => q.id));
  const missing = allQuestions.filter(q => !pickedIds.has(q.id) && !finaleIds.has(q.id));
  if (missing.length > 0) {
    // Uzupełnij bez markDirty — to inicjalizacja domyślna
    localSettings.questions.rounds = [...localSettings.questions.rounds, ...missing];
  }
  // Przefiltruj rounds — usuń pytania które są teraz w finale
  const questions = localSettings.questions.rounds.filter(q => !finaleIds.has(q.id));

  content.innerHTML = `
    <div class="gs-cat-title">${t("gameSettings.categories.rounds")}</div>
    <div class="gs-section">
      <div class="hint gs-list-hint">${t(DRAG ? "gameSettings.rounds.hint" : "gameSettings.rounds.hintPhone")}</div>
      <div class="roundsOrderList" id="gsRoundsOrderList">
        ${questions.map((q, i) => `
          <div class="roundsOrderItem" draggable="${DRAGGABLE}" data-qid="${escAttr(q.id)}">
            ${DRAG ? `<div class="roundsOrderHandle">${icon("grip")}</div>` : ""}
            <div class="roundsOrderNum">${i + 1}</div>
            <div class="roundsOrderText">${escText(q.text)}</div>
            <div class="roundsOrderActions">
              <button class="btn sm icon roundsOrderBtn" type="button" data-dir="up" title="${escAttr(t("gameSettings.rounds.up"))}" ${i === 0 ? "disabled" : ""}>${icon("arrow-up")}</button>
              <button class="btn sm icon roundsOrderBtn" type="button" data-dir="down" title="${escAttr(t("gameSettings.rounds.down"))}" ${i === questions.length - 1 ? "disabled" : ""}>${icon("arrow-down")}</button>
            </div>
          </div>
        `).join("")}
      </div>
    </div>
  `;

  const listEl = document.getElementById("gsRoundsOrderList");
  if (!listEl) return;

  // Przyciski ↑↓ — operujemy na przefiltrowanej liście (bez finałowych)
  listEl.addEventListener("click", e => {
    const btn = e.target.closest(".roundsOrderBtn");
    if (!btn) return;
    const item = btn.closest(".roundsOrderItem");
    if (!item) return;
    const id = item.dataset.qid;
    const dir = btn.dataset.dir;
    const finaleSet = effectiveFinalIds();
    const arr = localSettings.questions.rounds.filter(q => !finaleSet.has(q.id));
    const idx = arr.findIndex(q => q.id === id);
    if (idx < 0) return;
    const newIdx = dir === "up" ? idx - 1 : idx + 1;
    if (newIdx < 0 || newIdx >= arr.length) return;
    [arr[idx], arr[newIdx]] = [arr[newIdx], arr[idx]];
    localSettings.questions.rounds = arr;
    markDirty();
    renderRounds();
  });

  // Drag & drop (bez przeciągania na telefonie)
  if (DRAG) setupRoundsOrderDnd(listEl);
}

function setupRoundsOrderDnd(listEl) {
  let dragged = null;

  listEl.querySelectorAll(".roundsOrderItem").forEach(item => {
    item.addEventListener("dragstart", e => {
      dragged = item;
      item.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
    });
    item.addEventListener("dragend", () => {
      if (dragged) dragged.classList.remove("dragging");
      listEl.querySelectorAll(".roundsOrderItem").forEach(el => el.classList.remove("gs-row-drag-over-top", "gs-row-drag-over-bot"));
      // Zapisz nową kolejność z DOM (tylko widoczne, bez finalowych)
      const finaleSet = effectiveFinalIds();
      const newOrder = [...listEl.querySelectorAll(".roundsOrderItem")]
        .map(el => localSettings.questions.rounds.find(q => q.id === el.dataset.qid))
        .filter(Boolean);
      // Zachowaj w rounds tylko pytania nie-finalowe, w nowej kolejności
      localSettings.questions.rounds = newOrder.filter(q => !finaleSet.has(q.id));
      markDirty();
      dragged = null;
      renderRounds();
    });
    item.addEventListener("dragover", e => {
      e.preventDefault();
      if (!dragged || dragged === item) return;
      const rect = item.getBoundingClientRect();
      const half = rect.top + rect.height / 2;
      item.classList.toggle("gs-row-drag-over-top", e.clientY < half);
      item.classList.toggle("gs-row-drag-over-bot", e.clientY >= half);
    });
    item.addEventListener("dragleave", () => {
      item.classList.remove("gs-row-drag-over-top", "gs-row-drag-over-bot");
    });
    item.addEventListener("drop", e => {
      e.preventDefault();
      if (!dragged || dragged === item) return;
      const rect = item.getBoundingClientRect();
      const half = rect.top + rect.height / 2;
      if (e.clientY < half) {
        listEl.insertBefore(dragged, item);
      } else {
        listEl.insertBefore(dragged, item.nextSibling);
      }
      item.classList.remove("gs-row-drag-over-top", "gs-row-drag-over-bot");
    });
  });
}

// --- DRAG-AND-DROP SORT (dla finału - reorder wewnątrz kolumny) ---
function initDragSort(listEl, getItems, setItems, reRender) {
  let dragged = null;

  listEl.querySelectorAll(".gs-draggable").forEach(row => {
    row.addEventListener("dragstart", e => {
      dragged = row;
      row.classList.add("gs-row-dragging");
      e.dataTransfer.effectAllowed = "move";
    });
    row.addEventListener("dragend", () => {
      if (dragged) dragged.classList.remove("gs-row-dragging");
      listEl.querySelectorAll(".gs-row-drag-over-top, .gs-row-drag-over-bot").forEach(el => {
        el.classList.remove("gs-row-drag-over-top", "gs-row-drag-over-bot");
      });
      const newOrder = [...listEl.querySelectorAll(".gs-draggable")].map(el => {
        return getItems().find(q => q.id === el.dataset.qid);
      }).filter(Boolean);
      setItems(newOrder);
      markDirty();
      dragged = null;
      reRender();
    });
    row.addEventListener("dragover", e => {
      e.preventDefault();
      if (!dragged || dragged === row) return;
      const rect = row.getBoundingClientRect();
      const half = rect.top + rect.height / 2;
      row.classList.toggle("gs-row-drag-over-top", e.clientY < half);
      row.classList.toggle("gs-row-drag-over-bot", e.clientY >= half);
    });
    row.addEventListener("dragleave", () => {
      row.classList.remove("gs-row-drag-over-top", "gs-row-drag-over-bot");
    });
    row.addEventListener("drop", e => {
      e.preventDefault();
      if (!dragged || dragged === row) return;
      const rect = row.getBoundingClientRect();
      const half = rect.top + rect.height / 2;
      if (e.clientY < half) {
        listEl.insertBefore(dragged, row);
      } else {
        listEl.insertBefore(dragged, row.nextSibling);
      }
      row.classList.remove("gs-row-drag-over-top", "gs-row-drag-over-bot");
    });
  });
}

// --- USTAWIENIA GRY ---
// Pole z niepoprawną wartością pokazuje to, co wpisano (z komunikatem),
// a nie po cichu poprzednią wartość.
function fieldValue(id, fallback) {
  return invalidInputs.has(id) ? invalidInputs.get(id) : String(fallback);
}

// Punkty odpowiedzi pytań gry — do podpowiedzi progów (cache wg listy pytań).
let answerPointsCache = { key: "", map: null, promise: null };
async function loadAnswerPoints() {
  const ids = allQuestions.map((q) => q.id);
  const key = ids.join(",");
  if (answerPointsCache.key === key && answerPointsCache.map) return answerPointsCache.map;
  if (answerPointsCache.key === key && answerPointsCache.promise) return answerPointsCache.promise;
  const promise = (async () => {
    const map = new Map(ids.map((id) => [String(id), []]));
    if (ids.length) {
      const { data, error } = await sb().from("answers").select("question_id,fixed_points").in("question_id", ids);
      if (error) throw error;
      for (const row of data || []) map.get(String(row.question_id))?.push(Number(row.fixed_points) || 0);
    }
    answerPointsCache = { key, map, promise: null };
    return map;
  })();
  answerPointsCache = { key, map: null, promise };
  return promise;
}

// Podpowiedzi (nie blokują zapisu): najwyższy możliwy wynik finału i rund
// przy obecnych pytaniach, mnożnikach i trybach wyboru pytań.
async function showAdvancedSuggestions() {
  const targetHint = document.getElementById("gsFinalTargetSuggest");
  const minHint = document.getElementById("gsFinalMinPtsSuggest");
  if (!targetHint && !minHint) return;
  let points;
  try { points = await loadAnswerPoints(); } catch (error) { console.warn("[game-settings] answer points:", error); return; }
  if (!document.getElementById("gsFinalTargetSuggest")) return;
  const g = localSettings.game;
  const adv = g.advanced;
  const pts = (q) => points.get(String(q.id)) || [];
  const finalPicked = g.finalQuestionsMode === "pick" ? (localSettings.questions.final || []) : [];
  const finalIds = new Set(finalPicked.map((q) => String(q.id)));
  const finalCandidates = g.finalQuestionsMode === "pick" ? finalPicked : allQuestions;
  const finalMax = g.hasFinal === true ? finalMaxPoints(finalCandidates.map(pts)) : null;
  const roundsOrdered = g.roundsQuestionsMode === "pick";
  const roundsList = roundsOrdered ? (localSettings.questions.rounds || []) : allQuestions.filter((q) => !finalIds.has(String(q.id)));
  const roundsMax = roundsMaxPoints(roundsList.map(pts), adv.roundMultipliers, { ordered: roundsOrdered });
  const paint = (el, max, value, okKey, warnKey) => {
    if (!el) return;
    if (max == null) { el.textContent = ""; el.classList.remove("is-warn"); return; }
    const over = Number.isFinite(value) && value > max;
    el.textContent = t(over ? warnKey : okKey, { max });
    el.classList.toggle("is-warn", over);
  };
  paint(targetHint, finalMax, adv.finalTarget, "gameSettings.game.finalTargetSuggest", "gameSettings.game.finalTargetAbove");
  paint(minHint, roundsList.length ? roundsMax : null, adv.finalMinPoints, "gameSettings.game.finalMinPointsSuggest", "gameSettings.game.finalMinPointsAbove");
}

function renderGame() {
  const adv = localSettings.game.advanced;
  const hasFinal = localSettings.game.hasFinal === true;
  const endMode = adv.endScreenMode || "money";

  content.innerHTML = `
    <div class="gs-cat-title">${t("gameSettings.categories.game")}</div>
    <div class="gs-section">
      <div class="sectionBlock">
        <div class="section-title">${t("gameSettings.game.roundsScoreSection")}</div>
        <div class="setting-item">
          <div class="field-label">${t("gameSettings.game.roundMultipliers")}</div>
          <input class="inp" id="gsMultipliers" value="${escAttr(fieldValue("gsMultipliers", adv.roundMultipliers.join(", ")))}" placeholder="1, 1, 1, 2, 3"/>
          <div class="hint">${t("gameSettings.game.roundMultipliersHint")}</div>
          <div class="field-error" id="gsMultipliersMsg" role="alert"></div>
        </div>
      </div>
      <div class="sectionBlock">
        <div class="section-title">${t("gameSettings.game.finaleSection")}</div>
        <div class="setting-item">
          <div class="field-label">${t("gameSettings.game.finalMinPoints")}</div>
          <input class="inp inp--short" id="gsFinalMinPts" type="number" min="0" max="9999" value="${escAttr(fieldValue("gsFinalMinPts", adv.finalMinPoints))}"/>
          <div class="hint">${t("gameSettings.game.finalMinPointsHint")}</div>
          <div class="field-error" id="gsFinalMinPtsMsg" role="alert"></div>
          <div class="gs-field-suggest" id="gsFinalMinPtsSuggest"></div>
        </div>
        <div class="setting-item" id="gsFinalTargetField"${hasFinal ? "" : " hidden"}>
          <div class="field-label">${t("gameSettings.game.finalTarget")}</div>
          <input class="inp inp--short" id="gsFinalTarget" type="number" min="1" max="${ADVANCED_LIMITS.finalTarget.max}" value="${escAttr(fieldValue("gsFinalTarget", adv.finalTarget))}"/>
          <div class="field-error" id="gsFinalTargetMsg" role="alert"></div>
          <div class="gs-field-suggest" id="gsFinalTargetSuggest"></div>
        </div>
      </div>
      <div class="sectionBlock">
        <div class="section-title">${t("gameSettings.game.endScreenSection")}</div>
        <div class="setting-item">
          <div class="field-label">${t("gameSettings.game.endModeLabel")}</div>
          <div class="choice-list">
            <label class="choice">
              <input type="radio" name="gsEndMode" value="logo" ${endMode === "logo" ? "checked" : ""}/>${t("gameSettings.game.endModeLogoShort")}
            </label>
            <label class="choice">
              <input type="radio" name="gsEndMode" value="points" ${endMode === "points" ? "checked" : ""}/>${t("gameSettings.game.endModePointsShort")}
            </label>
            <label class="choice" id="gsEndModeMoneyLabel"${hasFinal ? "" : " hidden"}>
              <input type="radio" name="gsEndMode" value="money" ${endMode === "money" ? "checked" : ""}/>${t("gameSettings.game.endModeMoneyShort")}
            </label>
          </div>
        </div>
        <div class="setting-item gs-prize-row" id="gsPrizeSettingsRow"${hasFinal && endMode === "money" ? "" : " hidden"}>
          <div>
            <div class="field-label">${t("gameSettings.game.prizeAmount")}</div>
            <input class="inp" id="gsMainPrize" type="number" min="1" max="99999" value="${escAttr(fieldValue("gsMainPrize", adv.mainPrizeAmount))}"/>
            <div class="field-error" id="gsMainPrizeMsg" role="alert"></div>
          </div>
          <div>
            <div class="field-label">${t("gameSettings.game.prizeMultiplier")}</div>
            <input class="inp" id="gsPrizeMultiplier" type="number" min="1" max="10" value="${escAttr(fieldValue("gsPrizeMultiplier", adv.finalPrizeMultiplier))}"/>
            <div class="field-error" id="gsPrizeMultiplierMsg" role="alert"></div>
          </div>
          <div class="hint gs-prize-hint">${t("gameSettings.game.prizeHint")}</div>
        </div>
      </div>
    </div>
    <div class="sfx-foot">
      <button class="btn" id="btnGameReset" type="button">${icon("refresh")} ${t("gameSettings.resetSection")}</button>
    </div>
  `;

  // Każda zmiana pola jest sprawdzana od razu: poprawna wartość trafia do
  // ustawień, niepoprawna zostaje w polu z komunikatem i wstrzymuje zapis.
  const numberFields = [
    ["gsFinalMinPts", "finalMinPoints"],
    ["gsFinalTarget", "finalTarget"],
    ["gsMainPrize", "mainPrizeAmount"],
    ["gsPrizeMultiplier", "finalPrizeMultiplier"],
  ];
  function setFieldError(id, message) {
    const input = document.getElementById(id);
    const msg = document.getElementById(`${id}Msg`);
    input?.classList.toggle("is-invalid", !!message);
    if (input) input.setAttribute("aria-invalid", message ? "true" : "false");
    if (msg) msg.textContent = message || "";
  }
  function checkNumberField(id, key) {
    const input = document.getElementById(id);
    if (!input) return;
    const limits = ADVANCED_LIMITS[key];
    const value = parseIntInRange(input.value, limits);
    if (value == null) {
      invalidInputs.set(id, input.value);
      setFieldError(id, t("gameSettings.game.invalidNumber", { min: limits.min, max: limits.max }));
    } else {
      localSettings.game.advanced[key] = value;
      invalidInputs.delete(id);
      setFieldError(id, "");
    }
  }
  function checkMultipliers() {
    const input = document.getElementById("gsMultipliers");
    if (!input) return;
    const parts = parseMultipliers(input.value);
    if (!parts) {
      invalidInputs.set(input.id, input.value);
      setFieldError(input.id, t("gameSettings.game.invalidMultipliers"));
    } else {
      localSettings.game.advanced.roundMultipliers = parts;
      invalidInputs.delete(input.id);
      setFieldError(input.id, "");
    }
  }
  for (const [id, key] of numberFields) {
    document.getElementById(id)?.addEventListener("input", () => { checkNumberField(id, key); markDirty(); void showAdvancedSuggestions(); });
    if (invalidInputs.has(id)) checkNumberField(id, key);
  }
  document.getElementById("gsMultipliers")?.addEventListener("input", () => { checkMultipliers(); markDirty(); void showAdvancedSuggestions(); });
  if (invalidInputs.has("gsMultipliers")) checkMultipliers();
  void showAdvancedSuggestions();

  content.querySelectorAll("[name='gsEndMode']").forEach(radio => {
    radio.addEventListener("change", () => {
      localSettings.game.advanced.endScreenMode = radio.value;
      markDirty();
      const prizeRow = document.getElementById("gsPrizeSettingsRow");
      if (prizeRow) {
        prizeRow.hidden = !(localSettings.game.hasFinal === true && radio.value === "money");
      }
    });
  });

  document.getElementById("btnGameReset")?.addEventListener("click", async () => {
    if (!await confirmModal({ text: t("gameSettings.resetSectionConfirm") })) return;
    localSettings.game.advanced = { ...DEFAULT_SETTINGS.game.advanced };
    for (const id of ["gsMultipliers", "gsFinalMinPts", "gsFinalTarget", "gsMainPrize", "gsPrizeMultiplier"]) invalidInputs.delete(id);
    markDirty();
    renderGame();
  });
}

// Persisted gameplay session guard. The resource lease protects simultaneous
// page edits; this separate database record protects an in-progress match even
// after the Control tab has been closed.
async function guardActiveGameSession() {
  const requestStatus = async () => {
    const { data, error } = await sb().rpc("control_game_settings_status", { p_game_id: gameId });
    if (error) throw error;
    if (!data?.ok) throw new Error(data?.error || t("gameSettings.ingameGuard.statusError"));
    return data;
  };

  let status = await requestStatus();
  if (!status.in_progress) return true;

  // Ekran blokady (core/blocking-screen.js) + odliczanie i błąd nad przyciskami.
  const overlay = blockingScreen("ingameGuard", [
    { key: "Back", i18n: "gameSettings.ingameGuard.back", iconName: "arrow-left" },
    { key: "Cancel", i18n: "gameSettings.ingameGuard.cancel", iconName: "close", accent: true },
  ]);
  setBlockingIcon(overlay, "warning");
  overlay.querySelector("#ingameGuardTitle").textContent = t("gameSettings.ingameGuard.title");
  overlay.querySelector("#ingameGuardMsg").textContent = t("gameSettings.ingameGuard.message");
  overlay.querySelector(".blocking-actions").insertAdjacentHTML("beforebegin",
    `<div id="ingameGuardCountdown" class="msg" aria-live="polite"></div><div id="ingameGuardError" class="field-error" role="alert" hidden></div>`);
  setBlockingOpen(overlay, true);

  return new Promise((resolve) => {
    let done = false;
    let refreshing = false;
    let cancelling = false;
    const countdown = overlay.querySelector("#ingameGuardCountdown");
    const errorEl = overlay.querySelector("#ingameGuardError");
    const backButton = overlay.querySelector("#ingameGuardBack");
    const cancelButton = overlay.querySelector("#ingameGuardCancel");
    let deadline = Date.parse(status.expires_at || "");

    const finish = (allowed) => {
      if (done) return;
      done = true;
      clearInterval(timer);
      setBlockingOpen(overlay, false);
      overlay.remove();
      resolve(allowed);
    };
    const updateCountdown = () => {
      if (!Number.isFinite(deadline)) {
        countdown.textContent = t("gameSettings.ingameGuard.noDeadline");
        return 0;
      }
      const seconds = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      const minutes = Math.floor(seconds / 60);
      const remainder = seconds % 60;
      countdown.textContent = t("gameSettings.ingameGuard.expiresIn", {
        time: `${minutes}:${String(remainder).padStart(2, "0")}`,
      });
      return seconds;
    };
    const timer = setInterval(async () => {
      if (updateCountdown() > 0 || refreshing || done) return;
      refreshing = true;
      try {
        status = await requestStatus();
        if (!status.in_progress) finish(true);
        else deadline = Date.parse(status.expires_at || "");
      } catch (error) {
        errorEl.textContent = error?.message || t("gameSettings.ingameGuard.statusError");
        errorEl.hidden = false;
      } finally {
        refreshing = false;
      }
    }, 1000);
    updateCountdown();

    backButton.addEventListener("click", async () => {
      backButton.disabled = true;
      cancelButton.disabled = true;
      await pageLock?.release?.().catch(() => {});
      // Adres otwarty wprost (bez ret): Moje gry, jak po wejściu z Moich gier --
      // rodzic z mapy (Control) wpuściłby z powrotem do gry w toku.
      location.href = new URLSearchParams(location.search).has("ret") ? backHref("gameSettings") : linkTo("games");
      finish(false);
    });
    cancelButton.addEventListener("click", async () => {
      if (cancelling || done) return;
      cancelling = true;
      backButton.disabled = true;
      cancelButton.disabled = true;
      errorEl.hidden = true;
      try {
        const { data, error } = await sb().rpc("control_game_cancel_for_settings", { p_game_id: gameId });
        if (error) throw error;
        if (!data?.ok) throw new Error(data?.error || t("gameSettings.ingameGuard.cancelError"));
        finish(true);
      } catch (error) {
        errorEl.textContent = error?.message || t("gameSettings.ingameGuard.cancelError");
        errorEl.hidden = false;
        backButton.disabled = false;
        cancelButton.disabled = false;
        cancelling = false;
      }
    });
  });
}

// ===== MAIN =====
async function main() {
  // Dostęp, nakładka wąskiego okna / telefonu, „Wstecz”, „Wskazówki” i konto
  // wg mapy. Przy wyjściu pytamy o porzucenie niezapisanych zmian.
  const user = await initPage("gameSettings", {
    account: { showAuthEntry: false },
    onBack: (href) => leaveTo(href),
    onManual: (href) => leaveTo(href),
  });
  if (!user) return; // initPage przekierował na logowanie

  if (!gameId) {
    location.href = linkTo("games");
    return;
  }

  // Load game, themes and questions in parallel
  const [gameResult, themesJson, questionsList, myThemes] = await Promise.all([
    sb().from("games").select("id,name,settings").eq("id", gameId).single(),
    loadBuiltinThemes().catch(() => ({ themes: [] })),
    loadQuestions(gameId).catch(() => []),
    sb().rpc("my_display_themes").then(r => r.data).catch(() => null),
  ]);

  const { data: game, error: gameErr } = gameResult;
  if (gameErr || !game) {
    // Cudza, usunięta albo zmyślona gra w adresie (brak wiersza, zły
    // identyfikator): ta sama blokada „Brak gry.” z powrotem do listy co przy
    // grze niegotowej -- wcześniej strona pokazywała surowy błąd bazy po angielsku.
    if (!gameErr || gameErr.code === "PGRST116" || gameErr.code === "22P02") {
      await guardGameState(gameId, "play");
      return;
    }
    if (content) content.innerHTML = `<p class="callout callout--bad" role="alert">${escText(t("gameSettings.loadError"))}${escText(gameErr?.message || t("gameSettings.unknownError"))}</p>`;
    return;
  }

  // Blokady strony (familijna-server/docs/blokady-zasobow.md, sekcja 6): game:G wyłącznie
  // (wspólny klucz z edytorem, ankietą i Control) + logos współdzielone (cała
  // pula logo użytkownika; id = użytkownik). Najpierw gra, potem pula logo.
  const { data: { user: lockUser } } = await sb().auth.getUser();
  const lock = await guardResourceLocks([
    { type: "game", id: gameId, mode: "exclusive", message: t("resourceLock.gameMessage") },
    { type: "logos", id: lockUser?.id, mode: "shared", message: t("resourceLock.logoEditBlocksSettings") },
  ], { context: "settings", backHref: backHref("gameSettings") });
  if (!lock.ok) return;
  pageLock = lock;

  // The resource guard above handles an open Control tab with game:G held.
  // Only a released card can reach the persistent active-session guard.
  if (!(await guardActiveGameSession())) return;

  // Blokada stanu: ustawienia gry tylko dla gry, którą da się grać.
  if (!(await guardGameState(gameId, "play"))) return;

  lastSavedSettingsRaw = game.settings ?? {};

  if (titleEl) titleEl.textContent = game.name || "—";
  document.title = `${game.name || t("gameSettings.defaultGameName")} — ${t("gameSettings.pageTitle")}`;

  localSettings = mergeSettings(game.settings);
  // Walidacja działa także bez otwierania zakładki Dźwięk. Zachowaj własne
  // pliki zapisane w chmurze, gdy tę grę otwarto na innym urządzeniu.
  await loadSfxManifest();
  const customFiles = await getSfxCustomFiles(gameId);
  for (const [key, variant] of Object.entries(localSettings.sound.variants)) {
    if (variant !== VARIANT_CUSTOM || customFiles.has(key)) continue;
    const { data: blob, error } = await sb().storage.from("user-sounds").download(`${user.id}/${gameId}/${key}`);
    if (error) {
      if (String(error.status || error.statusCode) === "404" || /not found|does not exist/i.test(error.message || "")) continue;
      throw error;
    }
    const filename = game.settings?.sound?.filenames?.[key] || `${key}.mp3`;
    await setSfxCustomBlob(key, blob, filename, gameId);
    customFiles.set(key, { blob, filename });
  }
  customSoundKeys = new Set(customFiles.keys());

  // Cleanup: usuń pytania finałowe z rounds (mogły tam trafić przed wdrożeniem tej logiki)
  // — tylko gdy finał faktycznie włączony, inaczej martwa lista finałowa
  // (po wcześniejszym wyłączeniu finału) niepotrzebnie zawężałaby pulę rund.
  {
    const finalSet = effectiveFinalIds();
    if (finalSet.size > 0) {
      localSettings.questions.rounds = localSettings.questions.rounds.filter(q => !finalSet.has(q.id));
    }
  }

  defaultThemeKey = themesJson.defaultKey || "";
  builtinThemes = (themesJson.themes || []).map(theme => ({
    key: theme.key, label: theme.label, usesBackground: !!theme.inputs.T,
    defaultBackground: theme.inputs.T?.default, backgroundLabel: theme.inputs.T?.label || null,
  }));
  if (myThemes) themeAccess = { canImport: myThemes.can_import === true, limit: myThemes.limit || 20, themes: myThemes.themes || [] };
  allQuestions = questionsList;

  resolveThemeLabels();

  // Przycisk "Graj" tylko gdy gra ma pytania
  if (btnPlay) {
    const enteredFromControl = backTarget("gameSettings")?.pageId === "control";
    if (allQuestions.length > 0 && !enteredFromControl) {
      btnPlay.classList.remove("hidden");
    }
    btnPlay.addEventListener("click", () => {
      // Wejście z Control: "Graj" robi to samo co "Wstecz" (bez dokładania poziomu ret).
      void leaveTo(backTarget("gameSettings")?.pageId === "control"
        ? backHref("gameSettings")
        : linkTo("control", { id: gameId }));
    });
  }

  updateSubTabStates();

  const sectionDrawer = bindDrawer({ panel: sidebar, backdrop: sidebarBackdrop, toggle: sidebarToggle });

  // Sidebar clicks
  sidebar?.addEventListener("click", e => {
    const btn = e.target.closest(".gs-sidebar-item");
    if (!btn || btn.classList.contains("gs-sidebar-item-disabled")) return;
    const cat = btn.dataset.cat;
    if (cat) setActiveCat(cat);
    sectionDrawer?.close();
  });
  // Save button
  btnSaveAll?.addEventListener("click", saveAll);

  // Reset to defaults
  btnResetAll?.addEventListener("click", async () => {
    if (!await confirmModal({ text: t("gameSettings.resetAllConfirm") })) return;

    // Wyczyść custom pliki dźwiękowe (IndexedDB + bucket)
    let customKeys = [];
    try { customKeys = [...(await getSfxCustomFiles(gameId)).keys()]; } catch {}
    try { await clearAllSfxCustomFiles(gameId); } catch {}
    if (customKeys.length > 0) {
      _getSoundUserId().then(userId => {
        if (userId) deleteAllGameSounds(sb(), userId, gameId, customKeys).catch(console.warn);
      });
    }

    localSettings = mergeSettings(null);
    invalidInputs.clear();
    customSoundKeys.clear();
    markSoundDirty();
    updateSubTabStates();
    setActiveCat(activeCat);
  });

  // Podgląd Wyświetlacza — ta strona sama osadza /control/display?preview=1 i
  // przesyła mu postMessage (patrz postPreviewRow() wyżej).
  createDisplayIframe();
  createHostIframe();

  setActiveCat("teams");
  document.querySelectorAll('[data-skel-step]').forEach(el => el.classList.add('skel-step-ready'));
  ready = true;
  window.addEventListener("beforeunload", e => {
    if (!ready || leaving || !isDirty) return;
    e.preventDefault();
    e.returnValue = "";
  });

  window.addEventListener("i18n:lang", () => {
    resolveThemeLabels();
    renderCat(activeCat);
  });
}

main().catch(err => {
  console.error("[game-settings]", err);
  void pageLock?.release?.().catch(() => {});
  if (content) content.innerHTML = `<p class="callout callout--bad" role="alert">${escText(t("gameSettings.errorPrefix"))}${escText(String(err?.message || err))}</p>`;
});
