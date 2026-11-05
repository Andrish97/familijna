// web/snake/js/snake.js -- ukryta gra w węża na kopii planszy Wyświetlacza.
// Duża plansza (30x10 kafli 5x7) to pole gry: jedno pole = jeden kafel.
// Lewy panel -- wynik, prawy -- rekord, górny -- tempo; long1/long2 -- podpisy.
// Zdarzenia (enter/start/finish) trafiają do statystyk admina (snake-log.js);
// zalogowanym baza zapisuje rekord i liczbę gier.
import { initI18n, t, getUiLang } from "../../shared/translation/translation.js?v=v2026-11-05T19342";
import { hydrateIcons } from "../../shared/js/core/icons.js?v=v2026-11-05T19342";
import { guardViewportWidth } from "../../shared/js/core/device-guard.js?v=v2026-11-05T19342";
import { getUser } from "../../shared/js/core/auth.js?v=v2026-11-05T19342";
import { logSnake } from "../../shared/js/core/snake-log.js?v=v2026-11-05T19342";
import { loadJson, buildGlyphMap, resolveGlyph } from "../../shared/js/display/fonts.js?v=v2026-11-05T19342";
import { layoutLongText, LONG_COLS, LONG_GAP } from "../../shared/js/display/long-text.js?v=v2026-11-05T19342";
import { createDisplays } from "../../shared/js/display/displays.js?v=v2026-11-05T19342";
import { createThemeManager } from "../../shared/js/display/theme_manager.js?v=v2026-11-05T19342";
import { createSnakeGame, stepDelay } from "./snake-game.js?v=v2026-11-05T19342";
import { initFullscreenButton } from "../../shared/js/core/fullscreen.js?v=v2026-11-05T19342";

const OFF = "#2e2e32";
const LIT = "#d7ff3d";
const APPLE = "#ff4040";
const BONUS = "#ffb31a";
// Bonus miga przez ostatnie kroki przed zniknięciem.
const BONUS_BLINK = 10;
const BEST_KEY = "familijna:snake:best";

// Kafle 5x7 (bity od lewej kolumny).
const FULL = [31, 31, 31, 31, 31, 31, 31];
const HEAD = {
  right: [31, 31, 29, 31, 29, 31, 31],
  left: [31, 31, 23, 31, 23, 31, 31],
  up: [31, 21, 31, 31, 31, 31, 31],
  down: [31, 31, 31, 31, 31, 21, 31],
};
const APPLE_TILE = [2, 4, 14, 31, 31, 31, 14];
const BONUS_TILE = [4, 4, 31, 14, 14, 27, 17];
const CRASH = [17, 17, 10, 4, 10, 17, 17];

const $ = (id) => document.getElementById(id);
// Telefon i tablet: sama plansza na cały ekran, telefon tylko w poziomie.
const TOUCH = matchMedia("(pointer: coarse)").matches;
// Wąskie okno (komputer, podzielony ekran tabletu) -- prośba o poszerzenie:
// plansza 16:9 poniżej 640 px jest za mała do gry. Najmniejszy telefon
// w poziomie ma ok. 667 px.
const SNAKE_MIN_WIDTH = 640;
guardViewportWidth({ minWidth: SNAKE_MIN_WIDTH, allowPhoneLandscape: true, requirePhoneLandscape: true, rotateMessageKey: "snake.rotateMessage" });

const i18nReady = initI18n({ withSwitcher: true }).then(() => {
  document.documentElement.classList.remove("page-loading");
  hydrateIcons();
});

// Pełny ekran jak w Przycisku do pojedynku: iPhone/iPad w Safari nie ma
// Fullscreen API -- zamiast tego okno z instrukcją „Do ekranu początkowego”
// (z ikony strona działa jak aplikacja pełnoekranowa). Inne przeglądarki:
// prawdziwy pełny ekran z blokadą poziomu, a gdy się nie da -- zastępczy.
function readLocalBest() {
  try { return Math.max(0, Number(localStorage.getItem(BEST_KEY)) || 0); } catch { return 0; }
}
function writeLocalBest(value) {
  try { localStorage.setItem(BEST_KEY, String(value)); } catch {}
}

async function boot() {
  await i18nReady;
  initFullscreenButton({ button: $("btnFullscreen"), a2hs: $("snakeA2HS"), a2hsClose: $("snakeA2HSClose"), landscape: true });
  const lang = getUiLang();
  const themeMgr = await createThemeManager($("baseSvg"), document.querySelector("#snakeFrame .layer-bg"));
  const displays = createDisplays({ svgGroup: $("displays"), theme: themeMgr.getActiveTheme() });
  const GLYPHS = buildGlyphMap(await loadJson("/shared/fonts/display/font_5x7.json"));
  const { big, left: leftPanel, right: rightPanel, top: topPanel, long1, long2 } = displays;

  // Rysowanie kafla tylko przy zmianie -- 10 tysięcy kropek na planszy.
  const tileCache = new Map();
  const drawTile = (display, tx, ty, rows, color) => {
    const key = `${rows.join(",")}|${color}`;
    const cacheKey = `${display === big ? "b" : display === leftPanel ? "l" : display === rightPanel ? "r" : "t"}${tx},${ty}`;
    if (tileCache.get(cacheKey) === key) return;
    tileCache.set(cacheKey, key);
    const tile = display.tiles[ty]?.[tx];
    if (!tile) return;
    for (let row = 0; row < 7; row++) {
      const bits = rows[row] | 0;
      for (let col = 0; col < 5; col++) tile.dots[row][col].setAttribute("fill", bits & (1 << (4 - col)) ? color : OFF);
    }
  };
  const glyphRows = (ch) => resolveGlyph(GLYPHS, ch);
  const EMPTY = [0, 0, 0, 0, 0, 0, 0];

  const writePanel = (panel, value) => {
    const text = String(Math.max(0, Math.min(999, value | 0))).padStart(3, " ");
    Array.from(text).forEach((ch, i) => drawTile(panel, i, 0, ch === " " ? EMPTY : glyphRows(ch), LIT));
  };

  const writeLong = (panel, text) => {
    const { items, width } = layoutLongText(text, GLYPHS);
    panel.clear();
    let x = Math.max(0, Math.floor((LONG_COLS - width) / 2));
    for (const item of items) {
      if (item.glyph) {
        for (let row = 0; row < 7; row++) {
          const bits = item.glyph[row] | 0;
          for (let c = 0; c < item.width; c++) {
            if (bits & (1 << (4 - (item.from + c)))) panel.setDotColor(row, x + c, LIT);
          }
        }
      }
      x += item.width + LONG_GAP;
      if (x >= LONG_COLS) break;
    }
  };

  // Tekst na dużej planszy: wiersze wyśrodkowane, reszta pól zgaszona.
  const showText = (lines) => {
    const grid = Array.from({ length: big.tilesY }, () => Array(big.tilesX).fill(" "));
    for (const [row, line] of lines) {
      const chars = Array.from(String(line).toUpperCase()).slice(0, big.tilesX);
      const start = Math.floor((big.tilesX - chars.length) / 2);
      chars.forEach((ch, i) => { grid[row][start + i] = ch; });
    }
    grid.forEach((cols, ty) => cols.forEach((ch, tx) => drawTile(big, tx, ty, ch === " " ? EMPTY : glyphRows(ch), LIT)));
  };

  let game = null;
  let timer = 0;
  let mode = "intro"; // intro | play | pause | over
  let best = readLocalBest();
  let account = null; // { best, games } dla zalogowanych
  let blink = false;

  const user = await getUser();
  const progressEl = $("snakeProgress");
  const loginEl = $("snakeLogin");
  const accountEl = $("snakeAccount");
  // Prawy górny róg (obok pełnego ekranu): bez konta zachęta i logowanie,
  // z kontem nazwa zalogowanego konta, a pod nią rekord i liczba gier z konta.
  const showProgress = () => {
    progressEl.textContent = user ? "" : t("snake.progressLocal");
    $("snakeAccountProgress").textContent = account ? t("snake.progressAccount", { best: account.best, games: account.games }) : "";
    loginEl.hidden = !!user;
    accountEl.hidden = !user;
    // Kto gra (nazwa konta) -- tylko informacja, bez przejścia do ustawień konta.
    if (user) {
      const name = user.username || user.email || "";
      $("snakeAccountName").textContent = name;
      accountEl.title = t("snake.signedInAs", { name });
    }
    // Po zalogowaniu powrót do węża (login.js: next=snake z ważnym qr).
    const login = new URL("/login/", location.origin);
    login.searchParams.set("next", "snake");
    login.searchParams.set("qr", new URLSearchParams(location.search).get("qr") || "");
    login.searchParams.set("lang", getUiLang());
    loginEl.href = `${login.pathname}${login.search}`;
  };

  const drawGame = () => {
    const { snake, food, bonus, dir, dead } = game.state;
    const bonusHidden = bonus && bonus.left <= BONUS_BLINK && bonus.left % 2 === 1;
    const cells = new Map();
    snake.forEach((s, i) => cells.set(`${s.x},${s.y}`, i === 0 ? (dead ? CRASH : HEAD[dir]) : FULL));
    for (let ty = 0; ty < big.tilesY; ty++) {
      for (let tx = 0; tx < big.tilesX; tx++) {
        const rows = cells.get(`${tx},${ty}`);
        if (rows) drawTile(big, tx, ty, rows, LIT);
        else if (food && food.x === tx && food.y === ty) drawTile(big, tx, ty, APPLE_TILE, blink ? LIT : APPLE);
        else if (bonus && !bonusHidden && bonus.x === tx && bonus.y === ty) drawTile(big, tx, ty, BONUS_TILE, BONUS);
        else drawTile(big, tx, ty, EMPTY, LIT);
      }
    }
    writePanel(leftPanel, game.state.score);
    writePanel(rightPanel, Math.max(best, game.state.score));
    // Górny panel: odliczanie bonusu, a bez bonusu -- tempo (co 5 jabłek wyżej).
    writePanel(topPanel, bonus ? bonus.left : Math.floor(game.state.apples / 5) + 1);
  };

  const showIntro = () => {
    showText([[2, t("snake.board.title")], [5, t(TOUCH ? "snake.board.swipe" : "snake.board.press")], [7, t(TOUCH ? "snake.board.tap" : "snake.board.click")]]);
    writePanel(leftPanel, 0);
    writePanel(rightPanel, best);
    writePanel(topPanel, 1);
    writeLong(long1, t("snake.long.score"));
    writeLong(long2, t("snake.long.best"));
  };

  // Stan gry na planszy (intro | play | pause | over) -- dla czytników i testów.
  const setToggle = () => { $("snakeFrame").dataset.mode = mode; };

  // Po zjedzeniu bonusu lewy long na chwilę pokazuje „BONUS +N”.
  let flashTimer = 0;
  const flashBonus = (points) => {
    clearTimeout(flashTimer);
    writeLong(long1, t("snake.long.bonus", { points }));
    flashTimer = setTimeout(() => { if (mode === "play") writeLong(long1, t("snake.long.score")); }, 1500);
  };

  const tick = () => {
    const { ate, bonus, dead } = game.step();
    if (ate) blink = false;
    blink = !blink;
    if (dead) { finish(); return; }
    if (bonus) flashBonus(bonus);
    drawGame();
    timer = setTimeout(tick, stepDelay(game.state.apples));
  };

  const start = () => {
    clearTimeout(timer);
    clearTimeout(flashTimer);
    tileCache.clear();
    game = createSnakeGame({ cols: big.tilesX, rows: big.tilesY });
    mode = "play";
    setToggle();
    writeLong(long1, t("snake.long.score"));
    drawGame();
    logSnake("start", { lang: getUiLang() });
    timer = setTimeout(tick, stepDelay(0));
  };

  let showSummary = null;
  const finish = () => {
    clearTimeout(timer);
    clearTimeout(flashTimer);
    mode = "over";
    setToggle();
    drawGame();
    const score = game.state.score;
    const record = score > best;
    if (record) { best = score; writeLocalBest(best); }
    logSnake("finish", { score, lang: getUiLang() }).then((res) => {
      if (user && res?.best != null) { account = { best: res.best, games: res.games }; best = Math.max(best, res.best); showProgress(); }
    });
    // Chwila na zobaczenie „X” na głowie, potem podsumowanie.
    showSummary = () => {
      showText([
        [2, game.state.won ? t("snake.board.won") : t("snake.board.over")],
        [4, t("snake.board.score", { score })],
        ...(record && score > 0 ? [[6, t("snake.board.record")]] : []),
        [8, t(TOUCH ? "snake.board.againTouch" : "snake.board.again")],
      ]);
      writePanel(rightPanel, best);
    };
    setTimeout(() => { if (mode === "over") showSummary(); }, 900);
  };

  const pause = (on) => {
    if (on && mode === "play") {
      clearTimeout(timer);
      mode = "pause";
      writeLong(long1, t("snake.long.paused"));
    } else if (!on && mode === "pause") {
      mode = "play";
      writeLong(long1, t("snake.long.score"));
      timer = setTimeout(tick, stepDelay(game.state.apples));
    }
    setToggle();
  };

  const steer = (dir) => {
    if (mode === "intro" || mode === "over") { start(); game.turn(dir); return; }
    if (mode === "pause") pause(false);
    game.turn(dir);
  };

  const toggle = () => {
    if (mode === "play") pause(true);
    else if (mode === "pause") pause(false);
    else start();
  };

  const KEYS = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right", w: "up", s: "down", a: "left", d: "right", W: "up", S: "down", A: "left", D: "right" };
  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (document.documentElement.classList.contains("showA2HS")) { if (e.key === "Escape") $("snakeA2HSClose").click(); return; }
    if (KEYS[e.key]) { e.preventDefault(); steer(KEYS[e.key]); }
    else if (e.key === " " || e.key === "Enter") { if (e.target?.closest?.("a, button")) return; e.preventDefault(); toggle(); }
  });
  // Dotyk: jak zwykły Wyświetlacz -- przesunięcie palcem skręca (i zaczyna
  // grę), stuknięcie w planszę to start/pauza. Bez przycisków na ekranie.
  let touch = null;
  document.addEventListener("touchstart", (e) => {
    if (e.target.closest("a, button, .a2hs, .lang-menu")) return;
    const p = e.touches[0];
    touch = { x: p.clientX, y: p.clientY };
  }, { passive: true });
  document.addEventListener("touchmove", (e) => {
    if (!touch) return;
    const p = e.touches[0];
    const dx = p.clientX - touch.x, dy = p.clientY - touch.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
    steer(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : (dy > 0 ? "down" : "up"));
    touch = { x: p.clientX, y: p.clientY };
  }, { passive: true });
  document.addEventListener("touchend", () => { touch = null; }, { passive: true });
  // Start/pauza tylko po stuknięciu w dużą tablicę (pole gry), nie w całą
  // ramkę -- chybione stuknięcie obok przycisku języka nie uruchamia gry.
  const bigBoard = $("displays").firstElementChild;
  bigBoard.classList.add("snake-big");
  bigBoard.addEventListener("click", toggle);

  document.addEventListener("visibilitychange", () => { if (document.hidden) pause(true); });
  // Przełącznik języka (lewy górny róg): napisy na planszy i pod nią od razu w nowym języku.
  window.addEventListener("i18n:lang", () => {
    if (mode === "intro") showIntro();
    else if (mode === "over" && showSummary) showSummary();
    writeLong(long1, t(mode === "pause" ? "snake.long.paused" : "snake.long.score"));
    writeLong(long2, t("snake.long.best"));
    showProgress();
  });
  // Obrót telefonu do pionu w trakcie gry zasłania planszę prośbą o obrót.
  matchMedia("(orientation: portrait)").addEventListener("change", (e) => { if (TOUCH && e.matches) pause(true); });
  // Tak samo, gdy okno zwęzi się poniżej minimum (device-guard zasłania planszę).
  new MutationObserver(() => { if (document.documentElement.dataset.deviceGuard !== "ok") pause(true); })
    .observe(document.documentElement, { attributes: true, attributeFilter: ["data-device-guard"] });

  showIntro();
  setToggle();
  showProgress();
  document.querySelector("main[data-skel-step]")?.classList.add("skel-step-ready");
  const res = await logSnake("enter", { lang });
  if (user && res?.best != null) {
    account = { best: res.best, games: res.games };
    best = Math.max(best, res.best);
    if (mode === "intro") writePanel(rightPanel, best);
    showProgress();
  }
}

boot().catch((e) => console.error("[snake]", e));
