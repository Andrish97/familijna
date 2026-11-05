// control/host/js/render.js
// Host "jest głupi" jak Display — tylko wyświetla tekst + zasłania/odsłania
// pasmo 2, bez żadnej własnej logiki gry. W odróżnieniu od Display nie ma
// osobnego "silnika rysowania" — to zwykłe operacje DOM (patrz plan,
// sekcja 5: "tu cały plik jest prostszy").
//
// Zasada z planu (sekcja 2a): Host NIGDY nie pokazuje banku, X, timera ani
// wskaźnika kontroli — tylko tytuł/pytanie (pasmo 1) i listę odpowiedzi z
// podświetleniem odkrytych (pasmo 2).
//
// Zasłona pasma 2 (cover2): authoritative source to detail.host.covered
// (Control decyduje KIEDY w ogóle coś jest do zasłonięcia — finał). Ręczne
// odsłonięcie przez gest przesunięcia na tablecie prowadzącego to WYŁĄCZNIE
// lokalny podgląd (peek) — nigdy nie zapisuje się do game_state, bo to nie
// jest fakt o grze, tylko wygoda tego jednego urządzenia. Każda nowa zmiana
// stanu (nowy wiersz) resetuje peek z powrotem do authoritative wartości.
//
// i18n: cały tekst pasma 1/2 idzie przez t() z tych samych kluczy co dawniej
// control/js/gameRounds.js's roundsHost()/control/js/gameFinal.js's
// finalHost() (translation/<lang>/control.js) — audyt znalazł, że ten plik miał
// to wcześniej na sztywno po polsku, więc zmiana języka w Control (patrz
// web/js/gameplay/gameStateShape.js's settings.uiLang) nie miała żadnego wpływu na
// treść, którą prowadzący faktycznie czyta.
<<<<<<< HEAD
import { t } from "../../../shared/translation/translation.js?v=v2026-11-05T23344";
=======
import { t } from "../../../shared/translation/translation.js?v=v2026-11-05T23344";
>>>>>>> origin/main


const $ = (id) => document.getElementById(id);
const rh = (key, vars) => t(`control.roundsHost.${key}`, vars);
const fh = (key, vars) => t(`control.finalHost.${key}`, vars);
const fu = (key, vars) => t(`control.finalUi.${key}`, vars);

// control/js/gameRounds.js's hostAnswersLines(): prowadzący widzi PEŁNĄ
// treść i punkty KAŻDEJ odpowiedzi od razu, niezależnie od tego, czy jest
// już odsłonięta dla widzów — inaczej nie mógłby ocenić, czy to, co
// powiedział kontestant, w ogóle pasuje do listy. Odsłonięcie zmienia tam
// kolor linii na zielony (control/js/gameRounds.js's hostTag("#2ecc71", ...)
// przez własny parser znaczników [kolor]tekst[/] w dzisiejszym
// js/pages/host.js) — 1:1 przywrócone tu jako klasa CSS (.hostGreen w
// css/host.css) zamiast tamtego parsera, patrz setLines()/appendFragment()
// niżej.
// Naprawiona luka: wcześniejsza wersja chowała tekst i punkty pod "______"
// aż do odsłonięcia, co w praktyce robiłoby ekran Prowadzącego bezużytecznym.
function answerLine(ord, text, pts, revealed) {
  const line = `${ord}) ${text} (${pts})`;
  return revealed ? { text: line, cls: "hostGreen" } : line;
}

// "Wiersz" to: zwykły string (kolor atramentu z motywu), {text,cls} (cała
// linia jednym kolorem) albo tablica takich fragmentów (mieszana linia,
// np. "Status: " zwykłe + wynik kolorowy — dokładnie jak dawne
// hostTag("u", label) + hostGreen(status) w control/js/gameFinal.js).
function appendFragment(el, frag) {
  if (typeof frag === "string") {
    el.appendChild(document.createTextNode(frag));
    return;
  }
  const span = document.createElement("span");
  if (frag.cls) span.className = frag.cls;
  span.textContent = frag.text;
  el.appendChild(span);
}

function setLines(el, lines) {
  el.textContent = "";
  lines.forEach((line) => {
    const row = document.createElement("div");
    row.className = "hostTextLine";
    const cell = document.createElement("span");
    cell.className = "hostTextCellContent";
    if (Array.isArray(line)) line.forEach((frag) => appendFragment(cell, frag));
    else if (line) appendFragment(cell, line);
    row.appendChild(cell);
    el.appendChild(row);
  });
}

export function createHostRenderer() {
  const paperText1 = $("paperText1");
  const paperText2 = $("paperText2");
  const cover2 = $("cover2");
  const cover2Swipe = $("cover2Swipe");
  const p2Hint = $("p2Hint");

  let authoritativeCovered = false;
  let enabled = true;
  let peeked = false;
  let timerHandle = null;

  function stopTimerTick() {
    if (timerHandle) { clearInterval(timerHandle); timerHandle = null; }
  }

  // Zgłoszony, realny bug: #cover2Swipe/#p2Hint miały statyczny, zaszyty
  // na sztywno tekst "—" w host2.html -- operator nie miał żadnej
  // wskazówki, że w ogóle istnieje gest przesunięcia, w który kierunek, ani
  // że cokolwiek się stało po geście (sama zasłona wizualnie nie zmienia
  // się poza pozycją). 1:1 odtworzone z js/pages/host.js's
  // updateSwipeHint() (stary host.html) — jedyna zmiana: orientacja czytana
  // z html.portrait/.landscape (control/host/js/main.js's setupOrientationClass)
  // zamiast osobnej lokalnej funkcji getOrientation(). cover2Swipe (WEWNĄTRZ
  // zasłony, widoczny gdy zasłonięte) pokazuje co zrobić ŻEBY odsłonić;
  // p2Hint (POZA zasłoną, widoczny tylko gdy odkryte — patrz css/host.css)
  // zawsze pokazuje jak zasłonić z powrotem.
  function updateSwipeHint() {
    if (!enabled) {
      if (cover2Swipe) cover2Swipe.textContent = "";
      if (p2Hint) p2Hint.textContent = "";
      return;
    }
    const portrait = document.documentElement.classList.contains("portrait");
    const covered = authoritativeCovered && !peeked;
    const onCover = portrait
      ? (covered ? t("host.swipeRevealDown") : t("host.swipeCoverUp"))
      : (covered ? t("host.swipeRevealRight") : t("host.swipeCoverLeft"));
    if (cover2Swipe) cover2Swipe.textContent = onCover;
    if (p2Hint) p2Hint.textContent = portrait ? t("host.swipeCoverUp") : t("host.swipeCoverLeft");
  }

  function applyCover() {
    const covered = authoritativeCovered && !peeked;
    cover2?.classList.toggle("coverOn", covered);
    cover2?.classList.toggle("coverOff", !covered);
    // Zgłoszony, realny bug: brakowało tego -- css/host.css's #p2Hint
    // widoczność idzie przez html.p2Open (patrz stare js/pages/host.js),
    // które tu nigdy nie było ustawiane, więc #p2Hint był NA STAŁE
    // niewidoczny niezależnie od stanu zasłony.
    document.documentElement.classList.toggle("p2Open", !covered);
    updateSwipeHint();
  }

  // content: zwykły string (jak dawniej) albo tablica "wierszy" (patrz
  // setLines() wyżej) — używana tam, gdzie trzeba pokolorować fragment tekstu.
  function setPane1(content) {
    if (!paperText1) return;
    if (Array.isArray(content)) setLines(paperText1, content);
    else setLines(paperText1, String(content || "").split("\n"));
  }
  function setPane2(content) {
    if (!paperText2) return;
    if (Array.isArray(content)) setLines(paperText2, content);
    else setLines(paperText2, String(content || "").split("\n"));
  }

  // control/js/gameRounds.js's hostTitleForRounds() — dokładnie te same 4
  // warianty tytułu wg fazy (translation/pl/control.js: roundTitle*). Pominięty:
  // stary system miał piąty, przejściowy wariant "POJEDYNEK" trwający
  // ułamek sekundy tuż po rozstrzygnięciu pojedynku (duel.enabled=false na
  // chwilę przed zmianą fazy) — bez odpowiednika w nowym silniku (nie ma
  // takiej przejściowej flagi), więc cały czas trwania DUEL pokazuje
  // "PRZYCISK", tak jak widoczna jest niemal cała reszta tego czasu i tak.
  function roundTitle(row) {
    const rn = row.detail.rounds.roundNo;
    switch (row.phase) {
      case "DUEL": return rh("roundTitleDuelBuzzer", { round: rn });
      case "PLAY": return rh("roundTitlePlay", { round: rn });
      case "STEAL": return rh("roundTitleSteal", { round: rn });
      case "REVEAL": return rh("roundTitleReveal", { round: rn });
      default: return rh("roundTitleDefault", { round: rn });
    }
  }

  function renderRounds(row) {
    const r = row.detail.rounds;
    const title = roundTitle(row);
    const answerLines = (r.answers || [])
      .map((a, i) => answerLine(i + 1, a.text, a.fixed_points, (r.revealed || []).includes(a.ord)));

    // Pytanie jest tajemnicą TYLKO w kroku przycisku (DUEL, łącznie z próbą
    // pierwszej/najwyżej punktowanej odpowiedzi — to wciąż ta sama faza) —
    // zamiast osobnej zasłony dla pasma 1, po prostu przenosimy pytanie na
    // pasmo 2, które i tak jest już zasłonięte (cover2, patrz applyCover()).
    // Od PLAY wraca na swoje zwykłe miejsce — nie jest już tajemnicą.
    if (row.phase === "DUEL") {
      setPane1(title);
      setPane2([r.question?.text || "", "", ...answerLines]);
      return;
    }
    const passHint = row.phase === "PLAY" && r.allowPass && !r.passUsed ? `\n\n${rh("passAvailable")}` : "";
    setPane1(`${title}\n\n${r.question?.text || ""}`);
    if (passHint) {
      const hint = document.createElement("div");
      hint.className = "host-pass-hint";
      hint.textContent = rh("passAvailable");
      paperText1?.appendChild(hint);
    }
    setPane2(answerLines);
  }

  // Dokładnie ten sam zestaw informacji co dzisiejsze gameFinal.js's
  // hostMappingLeft/hostMappingRight (pytanie, co wpisał gracz, status
  // dopasowania, pełna lista możliwych odpowiedzi z zaznaczoną trafioną),
  // łącznie z kolorami statusu (przywrócone, patrz komentarz przy answerLine()).
  function renderFinalMapping(row, round, idx) {
    const f = row.detail.final;
    const question = f.questions?.[idx];
    const mapArr = f.runtime[round === 1 ? "map1" : "map2"];
    const row1 = mapArr[idx] || {};
    const entryKey = round === 1 ? "p1" : "p2";
    const input = (f.runtime[entryKey][idx]?.text || "").trim();
    const rep = round === 2 && f.runtime.p2[idx]?.repeat === true;

    const title = round === 1 ? fh("titleRevealRound1") : fh("titleRevealRound2");
    setPane1(`${title}\n\n${fh("questionLabel", { n: idx + 1 })}: ${question?.text || ""}`);

    const lines = [];
    if (round === 2) {
      const p1Text = f.runtime.map1[idx]?.outText || f.runtime.p1[idx]?.text || "";
      lines.push(`${fh("player1Label")}: ${p1Text || fu("fallbackAnswer")}`, "");
    }
    if (!rep && input) lines.push(`${fh("enteredLabel")}: ${input}`);
    // Kolory statusu 1:1 z dawnym control/js/gameFinal.js's hostGreenStrike/
    // hostRed/hostYellowUnderline (patrz komentarz przy answerLine() wyżej).
    let status, statusCls;
    if (rep) { status = fh("statusRepeat"); statusCls = "hostYellow"; }
    else if (!input) { status = fh("statusEmpty"); statusCls = "hostRed"; }
    else if (row1.kind === "MATCH" && row1.matchId) { status = fh("statusMatch"); statusCls = "hostGreen"; }
    else { status = fh("statusMissing"); statusCls = "hostYellow"; }
    lines.push([`${fh("statusLabel")}: `, { text: status, cls: statusCls }], "");
    lines.push(fh("answersListLabel"));
    const sorted = question?.answers || [];
    for (const a of sorted) {
      const text = `${a.text} (${a.fixed_points})`;
      const isMatch = row1.kind === "MATCH" && row1.matchId === a.id;
      lines.push(isMatch ? { text, cls: "hostGreen hostStrike" } : text);
    }
    setPane2(lines);
  }

  // control/js/gameFinal.js's hostEntryStatus(): per-pytanie status widoczny
  // NA ŻYWO w trakcie wpisywania (nie tylko przy odsłanianiu) — bez tego
  // prowadzący nie wie, które pytania gracz już wypełnił.
  function entryStatus(f, round, idx) {
    const key = round === 1 ? "p1" : "p2";
    const row = f.runtime[key][idx] || {};
    if (round === 2 && row.repeat === true) return fh("entryRepeat");
    return (row.text || "").trim().length > 0 ? fh("entryDone") : fh("entryEmpty");
  }

  function renderFinalEntry(row, round) {
    const f = row.detail.final;
    const timer = f.runtime?.timer;
    const phaseKey = round === 1 ? "P1" : "P2";
    const counting = timer?.running && timer.phase === phaseKey;
    const titleKey = round === 1 ? "titleRound1" : "titleRound2";
    const titleTimerKey = round === 1 ? "titleRound1Timer" : "titleRound2Timer";

    const tick = () => {
      const remaining = Math.max(0, Math.ceil((timer.endsAt - Date.now()) / 1000));
      setPane1(fh(titleTimerKey, { seconds: remaining }));
      if (remaining <= 0) stopTimerTick();
    };
    if (counting) { tick(); timerHandle = setInterval(tick, 1000); }
    else setPane1(fh(titleKey));

    const lines = (f.questions || []).map((q, i) => `${i + 1}) ${q.text} — ${entryStatus(f, round, i)}`);
    setPane2(lines.join("\n"));
  }

  // control/js/gameFinal.js's hostUpdate(): kroki poza wpisywaniem/mapowaniem
  // (f_start, f_p2_start, f_end) czyszczą obie strony całkowicie (hostClearAll()),
  // nie pokazują żadnego zastępczego napisu.
  function renderFinal(row) {
    const step = row.step;
    if (step === "f_p1_entry") return renderFinalEntry(row, 1);
    if (step === "f_p2_entry") return renderFinalEntry(row, 2);
    if (step.startsWith("f_p1_map_q")) return renderFinalMapping(row, 1, Number(step.slice(-1)) - 1);
    if (step.startsWith("f_p2_map_q")) return renderFinalMapping(row, 2, Number(step.slice(-1)) - 1);
    setPane1("");
    setPane2("");
  }

  function render(row) {
    enabled = !row.detail?.settings?.noHostTablet;
    authoritativeCovered = enabled && !!row.detail?.host?.covered;
    peeked = false; // nowy stan resetuje podgląd
    stopTimerTick(); // nowy wiersz zastępuje ewentualny poprzedni tick jednorazowo w renderFinalEntry
    if (row.detail?.settings?.noHostTablet || row.step === "r_gameEnd" || row.detail?.locks?.gameEnded) { setPane1(""); setPane2(""); }
    else if (row.top_card === "rounds") renderRounds(row);
    else if (row.top_card === "final") renderFinal(row);
    else { setPane1(""); setPane2(""); }
    applyCover();
  }

  function setPeek(on) {
    peeked = enabled && !!on;
    applyCover();
  }

  function isCovered() { return authoritativeCovered && !peeked; }
  function isPeeked() { return peeked; }
  function isCoverableAtAll() { return authoritativeCovered; }

  return { render, setPeek, isCovered, isPeeked, isCoverableAtAll, updateSwipeHint };
}
