import { registerPageLayout } from "./page-layout.js?v=v2026-11-08T21320";
// Nagłówek list Gier/Baz/Logo: pozwól tytułowi i podpowiedzi zawinąć się
// przed przeniesieniem akcji. Akcje schodzą niżej, gdy nie mieszczą się nawet
// obok minimalnej szerokości nagłówka.
import { setWidth } from "./geometry.js?v=v2026-11-08T21320";
export function initListHeaderLayout(selector = ".bar") {
  const bars = [...document.querySelectorAll(selector)].filter((bar) => bar.querySelector(":scope > .actions"));
  for (const bar of bars) {
    let queued = false;
    const update = () => {
      queued = false;
      const actions = bar.querySelector(":scope > .actions");
      const heading = [...bar.children].find((child) => child !== actions);
      if (!actions || !heading) return;
      const hint = heading.querySelector(".hint");
      if (hint) {
        const hintText = hint.textContent.trim().replace(/\s+/g, " ");
        if (hint.dataset.listHintWrapSource !== hintText) {
          hint.dataset.listHintWrapSource = hintText;
          const phrases = hintText.split(/(?<=[,.])\s+/u).filter(Boolean);
          hint.replaceChildren(...phrases.flatMap((phrase, index) => {
            const nodes = [];
            if (index) nodes.push(document.createTextNode(" "));
            const part = document.createElement("span");
            part.className = "list-hint-phrase";
            part.textContent = phrase;
            nodes.push(part);
            return nodes;
          }));
        }
      }
      bar.classList.remove("has-actions-below");
      const available = bar.clientWidth;
      const barStyle = getComputedStyle(bar);
      const barGap = parseFloat(barStyle.columnGap) || parseFloat(barStyle.gap) || 0;
      const actionStyle = getComputedStyle(actions);
      const actionGap = parseFloat(actionStyle.columnGap) || parseFloat(actionStyle.gap) || 0;
      const visibleActions = [...actions.children].filter((child) => child.getClientRects().length);
      const actionWidth = visibleActions.reduce((width, child) => width + Math.max(child.getBoundingClientRect().width, child.scrollWidth), 0)
        + Math.max(0, visibleActions.length - 1) * actionGap;
      const title = heading.querySelector(".title, h1, [data-list-title]");
      const titleStyle = title ? getComputedStyle(title) : null;
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      if (context && titleStyle) context.font = titleStyle.font;
      let titleText = title?.textContent?.trim() || "";
      if (titleStyle?.textTransform === "uppercase") titleText = titleText.toLocaleUpperCase();
      if (titleStyle?.textTransform === "lowercase") titleText = titleText.toLocaleLowerCase();
      const spacingValue = titleStyle ? Number.parseFloat(titleStyle.letterSpacing) || 0 : 0;
      const letterSpacing = titleStyle?.letterSpacing.endsWith("em")
        ? spacingValue * (Number.parseFloat(titleStyle.fontSize) || 16)
        : spacingValue;
      const words = titleText.split(/\s+/).filter(Boolean);
      const titleMinimumWidth = title ? Math.ceil(Math.max(0, ...words.map((word) =>
        (context?.measureText(word).width || 0) + Math.max(0, word.length - 1) * letterSpacing,
      ))) : 0;
      // Podpowiedź nie uczestniczy w decyzji o przeniesieniu przycisków.
      // Ma zawijać się tekstem (text-wrap: pretty), pozostając przy akcjach,
      // dopóki sam tytuł i cała grupa przycisków mieszczą się w jednym rzędzie.
      if (titleMinimumWidth + actionWidth + barGap > available || actionWidth > available) {
        bar.classList.add("has-actions-below");
      }
    };
    const schedule = () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(update);
    };
    new ResizeObserver(schedule).observe(bar);
    new MutationObserver(schedule).observe(bar, { childList: true, subtree: true, characterData: true });
    window.addEventListener("i18n:lang", schedule);
    registerPageLayout(update);
    schedule();
  }

  initListBottomToolbarLayout();
}

// Dolny pasek list: najpierw sprawdza naturalną szerokość wszystkich kontrolek.
// Najpierw zwęża się pole wyszukiwania (do min-width); gdy napisy nadal się nie
// mieszczą, przyciski przechodzą na same ikony. Gdy nie
// mieszczą się nawet ikony, pasek zostaje jednym rzędem i przewija się w bok;
// na starcie w pełni widać grupę z mniejszą liczbą przycisków, a wystaje ta
// z większą (decyzja użytkownika 2026-10-21, zamiast zawijania w rzędy).
// Separator grup: 1 px kreski + 8 px odstępu (CSS .has-group-sep). Pojawia
// się (także na komputerze), gdy odstęp między grupami spadłby poniżej
// TOOLBAR_SEPARATOR_ROOM -- decyzja użytkownika 2026-10-23.
const TOOLBAR_SEPARATOR_WIDTH = 9;
const TOOLBAR_SEPARATOR_ROOM = 40;

function initListBottomToolbarLayout() {
  for (const bar of document.querySelectorAll(".list-toolbar")) {
    let queued = false;
    let lastLayout = "";
    let lastAvailableWidth = null;
    let lastTextMeasures = null;
    const measureBox = document.createElement("div");
    // Daj klonom tę samą bazową kaskadę .list-toolbar co prawdziwemu paskowi;
    // bez tego mobilne .only-desktop i reguły kompaktowe nie są mierzone tak,
    // jak potem renderują się na stronie.
    // Wygląd pudełka i klonów pomiarowych: .toolbar-measure-* w silniku (components.css).
    measureBox.className = "list-toolbar toolbar-measure-box";
    bar.append(measureBox);
    const measureGroup = (group, mode = "text") => {
      if (!group) return { width: 0, items: [] };
      if (mode === "text") {
        const items = [...group.children]
          .filter((item) => item.getClientRects().length)
          .map((item) => Math.max(item.getBoundingClientRect().width, item.scrollWidth));
        const style = getComputedStyle(group);
        const gap = parseFloat(style.columnGap) || parseFloat(style.gap) || 0;
        return {
          width: items.reduce((total, itemWidth) => total + itemWidth, 0)
            + Math.max(0, items.length - 1) * gap,
          items,
        };
      }
      measureBox.classList.toggle("is-compact-icons", mode === "icons");
      const clone = group.cloneNode(true);
      // Klon w jednym rzędzie, w wariancie z napisami albo samymi ikonami
      // (.is-icons odtwarza wymiary kompaktowe: przyciski i listy 36 px).
      clone.classList.add("toolbar-measure-clone");
      clone.classList.toggle("is-icons", mode === "icons");
      measureBox.replaceChildren(clone);
      const items = [...clone.children].map((item) => item.getBoundingClientRect().width);
      const cloneStyle = getComputedStyle(clone);
      const gap = parseFloat(cloneStyle.columnGap) || parseFloat(cloneStyle.gap) || 0;
      // Szerokość samego flexa może być zaniżona przez zawijanie lub zawyżona
      // przez wewnętrzną szerokość kontrolki (np. menu selecta). Pasek ma
      // podejmować decyzję na podstawie faktycznych kontrolek i ich odstępów.
      const width = items.reduce((total, itemWidth) => total + itemWidth, 0)
        + Math.max(0, items.length - 1) * gap;
      measureBox.replaceChildren();
      return { width, items };
    };
    const updateEdges = () => {
      const max = bar.scrollWidth - bar.clientWidth;
      const scrolling = bar.classList.contains("is-scroll") && max > 1;
      bar.classList.toggle("has-more-start", scrolling && bar.scrollLeft > 1);
      bar.classList.toggle("has-more-end", scrolling && bar.scrollLeft < max - 1);
    };
    bar.addEventListener("scroll", updateEdges, { passive: true });
    const update = () => {
      queued = false;
      const left = bar.querySelector(":scope > .list-toolbar-left");
      const right = bar.querySelector(":scope > .list-toolbar-right");
      if (!left || !right) return;
      const available = bar.clientWidth;
      if (lastAvailableWidth !== null && Math.abs(lastAvailableWidth - available) > 1) {
        bar.classList.remove("is-compact-icons");
      }
      lastAvailableWidth = available;
      const compact = bar.classList.contains("is-compact-icons") && lastTextMeasures;
      const textLeft = compact ? lastTextMeasures.left : measureGroup(left, "text");
      const textRight = compact ? lastTextMeasures.right : measureGroup(right, "text");
      // Pole wyszukiwania zwęża się (CSS: max-width 240 → min-width 140 px), zanim
      // przyciski stracą napisy -- do decyzji liczy się jego najmniejsza szerokość.
      // Tylko rozwinięte pole (na telefonie CSS zwija je do lupy).
      const search = [...left.querySelectorAll(":scope > .list-search")]
        .find((el) => el.querySelector(".searchBox")?.getClientRects().length) || null;
      const searchStyle = search && !compact ? getComputedStyle(search) : null;
      const searchBox = searchStyle ? {
        current: search.getBoundingClientRect().width,
        min: parseFloat(searchStyle.minWidth) || 0,
        max: parseFloat(searchStyle.maxWidth) || search.getBoundingClientRect().width,
      } : (compact ? lastTextMeasures.searchBox : null);
      const searchSlack = searchBox && !compact ? Math.max(0, searchBox.current - searchBox.min) : (compact ? lastTextMeasures.searchSlack : 0);
      if (!compact) lastTextMeasures = { left: textLeft, right: textRight, searchSlack, searchBox };
      const barStyle = getComputedStyle(bar);
      const groupGap = parseFloat(barStyle.columnGap) || parseFloat(barStyle.gap) || 0;
      const hasTextLabels = [...bar.querySelectorAll(".list-toolbar-right .only-desktop")]
        .some((label) => label.textContent.trim());
      const textNeeded = textLeft.width + textRight.width + groupGap - searchSlack;
      const useIcons = hasTextLabels && textNeeded > available + 1;
      bar.classList.toggle("is-compact-icons", useIcons);
      let needed = textNeeded;
      // Z napisami: pole dostaje to, co zostaje (najwyżej max-width). W układzie
      // jednego rzędu grupy mają stałą szerokość, więc ustawiamy ją wprost.
      if (search) {
        // Zwężone pole dochodzi do drugiej grupy -- zostawia miejsce na separator.
        const room = available - textNeeded - TOOLBAR_SEPARATOR_WIDTH;
        const width = !useIcons && searchBox
          ? `${Math.floor(Math.min(searchBox.max, searchBox.min + Math.max(0, room)))}px` : "";
        if (search.style.getPropertyValue("--geo-w") !== width) setWidth(search, width || null);
        if (width) needed = textNeeded + parseFloat(width) - searchBox.min;
      }
      if (useIcons) {
        needed = measureGroup(left, "icons").width + measureGroup(right, "icons").width + groupGap;
      }
      // Gdy grupy niemal się stykają, rozdziela je mały separator (jego
      // miejsce wlicza się do szerokości); przewijanie dopiero, gdy i z nim
      // się nie mieszczą.
      const separated = needed + TOOLBAR_SEPARATOR_ROOM > available + 1;
      if (separated) needed += TOOLBAR_SEPARATOR_WIDTH;
      const scroll = needed > available + 1;
      const leftCount = [...left.children].filter((item) => item.getClientRects().length).length;
      const rightCount = [...right.children].filter((item) => item.getClientRects().length).length;
      const startAtEnd = scroll && leftCount > rightCount;
      const layoutKey = `${scroll}:${separated}:${useIcons}:${startAtEnd}:${available}`;
      if (layoutKey !== lastLayout) {
        lastLayout = layoutKey;
        bar.classList.add("is-single-row");
        bar.classList.toggle("is-scroll", scroll);
        bar.classList.toggle("has-group-sep", separated);
        if (scroll) bar.scrollLeft = startAtEnd ? bar.scrollWidth : 0;
      }
      updateEdges();
    };
    const schedule = () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(update);
    };
    const resize = new ResizeObserver(schedule);
    resize.observe(bar);
    const mutation = new MutationObserver((records) => {
      if (records.some((record) => !record.target.closest?.(".toolbar-measure-box"))) schedule();
    });
    mutation.observe(bar, { childList: true, subtree: true, characterData: true, attributes: true });
    window.addEventListener("resize", schedule, { passive: true });
    window.addEventListener("i18n:lang", () => {
      bar.classList.remove("is-compact-icons");
      schedule();
    });
    registerPageLayout(update);
    schedule();
  }
}
