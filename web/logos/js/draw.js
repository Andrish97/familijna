// familiada/logos/js/draw.js
// Tryb DRAW: rysunek wektorowy (Fabric.js 7 w trybie zgodnym z zapisami z Fabric 5,
// shared/js/core/fabric-compat.js; globalne window.fabric) -> PIX 150x70.
//
// Świat sceny ma rozmiar ZAPISANY RAZEM Z LOGO (source.world) -- niezależny
// od ekranu: obiekty są we współrzędnych świata, a dopasowanie do okna robi
// wyłącznie viewportTransform (skala bazowa). Nowe logo: WORLD_W x WORLD_H
// (draw/raster.js). Stare zapisy (sprzed source.world) zachowują rozmiar
// sceny, na której je narysowano (zdradza go zapisany clipPath) -- dzięki
// temu raster wychodzi bit w bit taki sam jak w starym edytorze. Zoom
// użytkownika to mnożnik skali bazowej: 1 = cała scena, max 12; przesuwanie
// widoku tylko przy zoomie > 1 i nigdy poza scenę.
//
// Historia (Cofnij/Ponów): stos snapshotów JSON, wierzchołek = stan bieżący.
// Każda zakończona zmiana woła commit() -- jedno miejsce, które zapisuje
// snapshot, oznacza „niezapisane zmiany” i odświeża podgląd.

import { confirmModal } from "../../shared/js/core/modal.js?v=v2026-11-04T19500";
import { initUiSelect } from "../../shared/js/core/ui-select.js?v=v2026-11-04T19500";
import { placeDropdown } from "../../shared/js/core/popover.js?v=v2026-11-04T19500";
import { t } from "../../shared/translation/translation.js?v=v2026-11-04T19500";
import { v as cacheBust } from "../../shared/js/core/cache-bust.js?v=v2026-11-04T19500";
import { icon, iconText } from "../../shared/js/core/icons.js?v=v2026-11-04T19500";
import { DOT_W, DOT_H, TYPE_PIX, PIX_FORMAT, packBits, unpackBits } from "./render.js?v=v2026-11-04T19500";
import { WORLD_W, WORLD_H, sceneToBits } from "./draw/raster.js?v=v2026-11-04T19500";
import { SHAPES, shapeById, buildShapePath, buildArrowPath } from "./draw/shapes.js?v=v2026-11-04T19500";
import { legacySceneTypes, prepareFabric } from "../../shared/js/core/fabric-compat.js?v=v2026-11-04T19500";
import { setVars } from "../../shared/js/core/ui-metrics.js?v=v2026-11-04T19500";


const TOOL = { SELECT: "SELECT", PAN: "PAN", TEXT: "TEXT", BRUSH: "BRUSH", ERASER: "ERASER", SHAPES: "SHAPES" };
const MAX_ZOOM = 12;
const HISTORY_LIMIT = 200;

// Właściwości zapisywane w snapshotach i w payloadzie (oprócz standardowych Fabrica).
const EXTRA_PROPS = [
  "strokeUniform", "strokeDashArray", "strokeLineCap", "strokeLineJoin",
  "fontFamily", "fontSize", "fontWeight", "fontStyle", "underline", "textAlign", "lineHeight", "charSpacing",
  "_canHaveFill", "imageSmoothing", "_line",
];

const LINE_STYLES = [
  { id: "solid", dash: null },
  { id: "dashed", dash: (w) => [w * 2, w] },
  { id: "dotted", dash: (w) => [Math.max(w * 0.5, 1), w * 1.5] },
  { id: "dashDot", dash: (w) => [w * 3, w, Math.max(w * 0.5, 1), w] },
];

const DEFAULT_TOOL_SETTINGS = {
  BRUSH: { stroke: 6, fg: "WHITE", lineStyle: "solid" },
  SHAPES: { stroke: 6, fg: "WHITE", lineStyle: "solid", fill: false, fillColor: "WHITE" },
  TEXT: { fg: "WHITE", font: "", size: 80, lineHeight: 1, spacing: 0, bold: false, italic: false, underline: false, align: "center" },
  ERASER: { size: 10 },
};

// Zakresy pól liczbowych, dobrane pomiarem na wyświetlaczu (świat 1040
// jednostek szerokości, kropka ~5 jednostek): linia cieńsza niż 4 w ogóle
// nie zapala kropek, 4–5 zapala je zależnie od położenia; napis mniejszy niż
// ~50 ma 1–5 kropek wysokości (nieczytelny), a 600 to prawie cała wysokość.
const RANGE = {
  stroke: [5, 100],
  eraser: [5, 100],
  outline: [0, 100], // obrys zaznaczonego kształtu: 0 = bez obrysu (samo wypełnienie)
  fontSize: [50, 600],
};

const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const hex = (bw) => (bw === "BLACK" ? "#000000" : "#ffffff");
const isTextObj = (o) => !!o && (o.type === "i-text" || o.type === "textbox" || o.type === "text");

/** Kolor Fabrica -> BLACK/WHITE (scena jest dwukolorowa). */
function toBW(color) {
  const c = String(color || "").toLowerCase().replace(/\s+/g, "");
  return ["#000", "#000000", "rgb(0,0,0)", "black"].includes(c) ? "BLACK" : "WHITE";
}

function dashFor(lineStyle, width) {
  return LINE_STYLES.find((s) => s.id === lineStyle)?.dash?.(width || 6) || null;
}

function mergeSettings(saved) {
  const out = {};
  for (const [k, def] of Object.entries(DEFAULT_TOOL_SETTINGS)) out[k] = { ...def, ...(saved?.[k] || {}) };
  // ustawienia zapisane przed zmianą zakresów (np. grubość 2) -- do nowego zakresu
  const fit = (v, [a, b], d) => clamp(Number(v) || d, a, b);
  out.BRUSH.stroke = fit(out.BRUSH.stroke, RANGE.stroke, DEFAULT_TOOL_SETTINGS.BRUSH.stroke);
  out.SHAPES.stroke = fit(out.SHAPES.stroke, RANGE.stroke, DEFAULT_TOOL_SETTINGS.SHAPES.stroke);
  out.ERASER.size = fit(out.ERASER.size, RANGE.eraser, DEFAULT_TOOL_SETTINGS.ERASER.size);
  out.TEXT.size = fit(out.TEXT.size, RANGE.fontSize, DEFAULT_TOOL_SETTINGS.TEXT.size);
  return out;
}

export function initDrawEditor(ctx) {
  const $ = (id) => document.getElementById(id);
  const paneDraw = $("paneDraw");
  const canvasEl = $("drawStage");
  const stageHost = $("drawStageHost");
  const toolCtx = $("toolCtxSettings");
  const btn = {
    select: $("tSelect"), pan: $("tPan"), zoomIn: $("tZoomIn"), zoomOut: $("tZoomOut"), bg: $("tBg"),
    brush: $("tBrush"), eraser: $("tEraser"), shapes: $("tShapes"), text: $("tText"),
    undo: $("tUndo"), redo: $("tRedo"), duplicate: $("tDuplicate"), clear: $("tClear"), eye: $("tEye"),
  };
  const fontPop = $("drawFontPickPop");
  const fontSearch = $("drawFontSearchInp");
  const fontList = $("drawFontList");
  const fontEmpty = $("drawFontEmpty");

  // =========================================================
  // Stan
  // =========================================================
  let canvas = null;           // fabric.Canvas (tworzony przy pierwszym open())
  let worldW = WORLD_W;        // rozmiar świata otwartego logo (patrz nagłówek)
  let worldH = WORLD_H;
  let baseTool = TOOL.SELECT;  // wybrane narzędzie
  let tool = TOOL.SELECT;      // bieżące (Spacja = chwilowo Ręka, Ctrl/Cmd = chwilowo Wskaźnik)
  let holdSpace = false;
  let holdCtrl = false;
  let currentShape = "rect";
  let settings = mergeSettings(null);
  let bg = "BLACK";

  let history = [];
  let redoStack = [];
  let restoring = false;       // w trakcie loadFromJSON -- zdarzenia Fabrica nie są zmianami użytkownika

  let drawing = null;          // { obj, start } -- kształt w trakcie przeciągania
  let polyPoints = [];
  let polyPreview = null;
  let erasedSomething = false;
  let pointerDown = false;
  let pan = null;              // { x, y, vpt } -- przesuwanie widoku Ręką
  let discardNextPath = false; // kreska rozpoczęta pierwszym palcem pinchu

  let bits = new Uint8Array(DOT_W * DOT_H);
  let previewTimer = null;
  let previewSeq = 0;

  const fabric = () => {
    if (!window.fabric) throw new Error(t("logoEditor.draw.errors.missingFabric"));
    return prepareFabric(window.fabric);
  };

  // =========================================================
  // Widok: skala bazowa (świat -> ekran) i zoom użytkownika
  // =========================================================
  const baseScale = () => canvas.getWidth() / worldW;
  const userZoom = () => canvas.getZoom() / baseScale();

  function stageSize() {
    const rect = stageHost?.getBoundingClientRect?.() || { width: 800, height: 400 };
    let w = Math.max(320, Math.floor(rect.width));
    let h = Math.floor((w * worldH) / worldW);
    if (rect.height > 0 && h > rect.height) {
      h = Math.max(180, Math.floor(rect.height));
      w = Math.floor((h * worldW) / worldH);
    }
    return { w, h };
  }

  function clampViewport() {
    const z = canvas.getZoom();
    const v = canvas.viewportTransform.slice();
    v[4] = clamp(v[4], canvas.getWidth() - worldW * z, 0);
    v[5] = clamp(v[5], canvas.getHeight() - worldH * z, 0);
    canvas.setViewportTransform(v);
  }

  function resetView() {
    const s = baseScale();
    canvas.setViewportTransform([s, 0, 0, s, 0, 0]);
  }

  /** z = zoom użytkownika (1..MAX_ZOOM), point = punkt ekranu, który ma zostać w miejscu. */
  function setZoom(z, point = null) {
    const f = fabric();
    const zz = clamp(z, 1, MAX_ZOOM);
    if (zz <= 1 + 1e-6) {
      resetView();
    } else {
      canvas.zoomToPoint(point || new f.Point(canvas.getWidth() / 2, canvas.getHeight() / 2), zz * baseScale());
      clampViewport();
    }
    canvas.requestRenderAll();
    if (btn.zoomOut) btn.zoomOut.disabled = zz <= 1 + 1e-6;
    updateCursor();
  }

  function resizeStage() {
    if (!canvas) return;
    const { w, h } = stageSize();
    canvas.setDimensions({ width: w, height: h });
    canvas.calcOffset();
    setZoom(1);
  }

  function screenToWorld(ev) {
    const f = fabric();
    const p = ev?.touches?.[0] || ev?.changedTouches?.[0] || ev;
    const rect = canvas.upperCanvasEl.getBoundingClientRect();
    const wp = f.util.transformPoint(new f.Point(p.clientX - rect.left, p.clientY - rect.top), f.util.invertTransform(canvas.viewportTransform));
    return { x: clamp(wp.x, 0, worldW), y: clamp(wp.y, 0, worldH) };
  }

  /** Nie pozwala wyjechać obiektem poza scenę. */
  function keepInWorld(obj) {
    obj.setCoords();
    const r = obj.getBoundingRect(); // we współrzędnych świata
    let dx = 0, dy = 0;
    if (r.left < 0) dx = -r.left;
    else if (r.left + r.width > worldW) dx = worldW - (r.left + r.width);
    if (r.top < 0) dy = -r.top;
    else if (r.top + r.height > worldH) dy = worldH - (r.top + r.height);
    if (dx || dy) {
      obj.left += dx;
      obj.top += dy;
      obj.setCoords();
    }
  }

  // =========================================================
  // Historia + podgląd
  // =========================================================
  // toObject, nie toJSON: w Fabric 7 toJSON pomija własne pola (_line, _canHaveFill).
  function snapshot() {
    return legacySceneTypes(canvas.toObject(EXTRA_PROPS));
  }

  function updateHistoryButtons() {
    if (btn.undo) btn.undo.disabled = history.length < 2;
    if (btn.redo) btn.redo.disabled = redoStack.length < 1;
  }

  function resetHistory() {
    history = [snapshot()];
    redoStack = [];
    updateHistoryButtons();
  }

  /** Zakończona zmiana użytkownika: snapshot + „niezapisane” + podgląd. */
  function commit() {
    if (!canvas || restoring) return;
    const snap = snapshot();
    if (JSON.stringify(snap) !== JSON.stringify(history[history.length - 1])) {
      history.push(snap);
      if (history.length > HISTORY_LIMIT) history.shift();
      redoStack = [];
      updateHistoryButtons();
    }
    ctx.markDirty?.();
    schedulePreview();
  }

  /** Zmiana w toku (np. przeciąganie suwaka) -- bez wpisu w historii. */
  function touch() {
    canvas.requestRenderAll();
    ctx.markDirty?.();
    schedulePreview();
  }

  async function loadScene(json) {
    restoring = true;
    try {
      await canvas.loadFromJSON(json);
    } finally {
      restoring = false;
    }
    bg = toBW(canvas.backgroundColor);
    canvas.backgroundColor = hex(bg);
    updateClipPath();
    applyToolBehavior();
    syncBgIcon();
    canvas.requestRenderAll();
  }

  async function undo() {
    if (history.length < 2) return;
    redoStack.push(history.pop());
    await loadScene(history[history.length - 1]);
    afterHistoryMove();
  }

  async function redo() {
    if (!redoStack.length) return;
    history.push(redoStack.pop());
    await loadScene(history[history.length - 1]);
    afterHistoryMove();
  }

  function afterHistoryMove() {
    updateHistoryButtons();
    renderSettings();
    ctx.markDirty?.();
    schedulePreview();
  }

  function schedulePreview(ms = 80) {
    clearTimeout(previewTimer);
    const seq = ++previewSeq;
    previewTimer = setTimeout(async () => {
      const b = await sceneToBits(fabric(), snapshot(), worldW, worldH);
      if (seq !== previewSeq) return;
      bits = b;
      ctx.onPreview?.({ kind: "PIX", bits });
    }, ms);
  }

  // =========================================================
  // Tło sceny
  // =========================================================
  const ICON_BG = {
    WHITE: `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect class="fill" x="4" y="5" width="16" height="14" rx="2"></rect></svg>`,
    BLACK: `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="4.5" y="5.5" width="15" height="13" rx="2" stroke-width="1"></rect></svg>`,
  };

  function syncBgIcon() {
    if (!btn.bg) return;
    btn.bg.innerHTML = ICON_BG[bg];
    const color = t(bg === "BLACK" ? "logoEditor.draw.colors.black" : "logoEditor.draw.colors.white");
    btn.bg.setAttribute("aria-label", t("logoEditor.draw.aria.backgroundColor", { color }));
  }

  function updateClipPath() {
    canvas.clipPath = new (fabric().Rect)({ left: 0, top: 0, width: worldW, height: worldH, absolutePositioned: true });
  }

  // =========================================================
  // Narzędzia
  // =========================================================
  function applyToolBehavior() {
    if (!canvas) return;
    const selecting = tool === TOOL.SELECT || tool === TOOL.TEXT;
    canvas.isDrawingMode = tool === TOOL.BRUSH;
    canvas.selection = selecting;
    // Obiekty zawsze „evented” (gumka i kursor muszą je trafiać), zaznaczalne tylko we Wskaźniku/Tekście.
    canvas.forEachObject((o) => {
      if (o === polyPreview) return;
      o.selectable = selecting;
      o.evented = true;
    });
    const precise = tool === TOOL.SELECT || tool === TOOL.ERASER;
    canvas.perPixelTargetFind = precise;
    canvas.setTargetFindTolerance(precise ? 10 : 0); // Fabric 7: przypisanie nie zmienia bufora trafień
    if (!selecting) canvas.discardActiveObject();
    if (tool !== TOOL.SHAPES || currentShape !== "polygon") clearPolyDraft();
    if (tool === TOOL.BRUSH) applyBrushStyle();

    for (const [key, t2] of [["select", TOOL.SELECT], ["pan", TOOL.PAN], ["brush", TOOL.BRUSH], ["eraser", TOOL.ERASER], ["shapes", TOOL.SHAPES], ["text", TOOL.TEXT]]) {
      btn[key]?.setAttribute("aria-pressed", tool === t2 ? "true" : "false");
    }
    updateCursor();
    canvas.requestRenderAll();
  }

  function setTool(next) {
    baseTool = next;
    if (!holdSpace && !holdCtrl) tool = next;
    applyToolBehavior();
    renderSettings();
  }

  function setShape(id) {
    currentShape = id;
    setTool(TOOL.SHAPES);
  }

  function recomputeTempTool() {
    const next = holdSpace ? TOOL.PAN : holdCtrl ? TOOL.SELECT : baseTool;
    if (next === tool) return;
    tool = next;
    applyToolBehavior();
    renderSettings();
  }

  function applyBrushStyle() {
    const f = fabric();
    canvas.freeDrawingBrush ||= new f.PencilBrush(canvas);
    const s = settings.BRUSH;
    canvas.freeDrawingBrush.width = s.stroke;
    canvas.freeDrawingBrush.color = hex(s.fg);
    canvas.freeDrawingBrush.decimate = 0;
    canvas.freeDrawingBrush.strokeDashArray = dashFor(s.lineStyle, s.stroke);
  }

  // =========================================================
  // Kursor: pędzel = kółko, gumka = kwadrat (nakładka w rozmiarze narzędzia)
  // =========================================================
  let cursorDot = null;
  let lastPointer = { x: -9999, y: -9999 };

  function ensureCursorOverlay() {
    if (cursorDot || !stageHost) return;
    const layer = document.createElement("div");
    layer.className = "draw-cursor-layer";
    cursorDot = document.createElement("div");
    cursorDot.className = "draw-cursor-dot";
    layer.appendChild(cursorDot);
    stageHost.classList.add("has-cursor-layer");
    stageHost.appendChild(layer);
  }

  const hideCursorDot = () => setVars(cursorDot, { "--x": null, "--y": null });

  function placeCursorDot(x, y) {
    if (!cursorDot || !canvas || (tool !== TOOL.BRUSH && tool !== TOOL.ERASER)) return hideCursorDot();
    const rect = canvas.upperCanvasEl.getBoundingClientRect();
    const px = x - rect.left, py = y - rect.top;
    if (px < 0 || py < 0 || px > rect.width || py > rect.height) return hideCursorDot();
    setVars(cursorDot, { "--x": `${px - cursorDot.offsetWidth / 2}px`, "--y": `${py - cursorDot.offsetHeight / 2}px` });
  }

  function updateCursor() {
    if (!canvas) return;
    ensureCursorOverlay();
    stageHost?.classList.remove("cur-select", "cur-pan", "cur-cross", "cur-none", "down");
    const set = (def, hover) => {
      canvas.defaultCursor = def;
      canvas.hoverCursor = hover;
      canvas.moveCursor = hover;
      canvas.freeDrawingCursor = def; // pędzel/gumka: bez kursora (kropka), jak klasa cur-none
      canvas.upperCanvasEl.style.removeProperty("cursor"); // fabric wpisuje kursor sam
    };

    if (tool === TOOL.BRUSH || tool === TOOL.ERASER) {
      stageHost?.classList.add("cur-none");
      set("none", "none");
      const size = tool === TOOL.BRUSH ? settings.BRUSH.stroke : settings.ERASER.size;
      const d = Math.max(6, Math.round(size * canvas.getZoom()));
      setVars(cursorDot, { "--d": `${d}px` });
      cursorDot.classList.toggle("is-round", tool === TOOL.BRUSH);
      placeCursorDot(lastPointer.x, lastPointer.y);
      return;
    }
    hideCursorDot();
    if (tool === TOOL.SELECT) { stageHost?.classList.add("cur-select"); set("default", "move"); }
    else if (tool === TOOL.PAN) { stageHost?.classList.add("cur-pan"); if (pan) stageHost?.classList.add("down"); set(pan ? "grabbing" : "grab", pan ? "grabbing" : "grab"); }
    else if (tool === TOOL.TEXT) { set("crosshair", "text"); }
    else { stageHost?.classList.add("cur-cross"); set("crosshair", "crosshair"); }
  }

  // =========================================================
  // Rysowanie kształtów
  // =========================================================
  function shapeStyle() {
    const s = settings.SHAPES;
    const shape = shapeById(currentShape);
    return {
      stroke: hex(s.fg),
      strokeWidth: s.stroke,
      strokeUniform: true,
      strokeLineCap: "round",
      strokeLineJoin: "round",
      strokeDashArray: dashFor(s.lineStyle, s.stroke),
      fill: shape.hasFill && s.fill ? hex(s.fillColor) : "transparent",
      _canHaveFill: !!shape.hasFill,
      objectCaching: false,
    };
  }

  /** Obiekt kształtu w prostokącie świata (x,y,w,h); linie/strzałki: od (x1,y1) do (x2,y2). */
  function makeShape(start, end, shift) {
    const f = fabric();
    const linear = currentShape === "line" || currentShape.startsWith("arrow");
    if (linear && shift) end = snapEnd(start, end);
    let w = end.x - start.x;
    let h = end.y - start.y;
    if (shift && !linear) {
      const m = Math.max(Math.abs(w), Math.abs(h));
      w = Math.sign(w || 1) * m;
      h = Math.sign(h || 1) * m;
    }
    const left = Math.min(start.x, start.x + w);
    const top = Math.min(start.y, start.y + h);
    const aw = Math.max(1, Math.abs(w));
    const ah = Math.max(1, Math.abs(h));
    const style = shapeStyle();
    const common = { ...style, selectable: false, evented: true, excludeFromExport: true };

    if (currentShape === "rect" || currentShape === "roundRect") {
      const r = currentShape === "roundRect" ? Math.min(20, aw / 2, ah / 2) : 0;
      return new f.Rect({ left, top, width: aw, height: ah, rx: r, ry: r, ...common });
    }
    if (currentShape === "ellipse") {
      return new f.Ellipse({ left, top, rx: aw / 2, ry: ah / 2, ...common });
    }
    if (linear) {
      // kierunek ma znaczenie: rysujemy od punktu startu do końca
      const p2 = { x: start.x + w, y: start.y + h };
      const _line = { kind: currentShape, x1: start.x, y1: start.y, x2: p2.x, y2: p2.y };
      return new f.Path(linePath(currentShape, start, p2, settings.SHAPES.stroke), { ...common, _line });
    }
    return new f.Path(buildShapePath(currentShape, left, top, left + aw, top + ah, settings.SHAPES.stroke), common);
  }

  // =========================================================
  // Linie i strzałki: końce do przeciągania
  // =========================================================
  // Linia/strzałka pamięta swoje końce (_line: {kind, x1, y1, x2, y2} we
  // współrzędnych jej ścieżki). Zaznaczona pojedynczo ma zamiast ramki
  // skalowania dwa uchwyty na końcach: przeciągnięcie końca buduje ścieżkę od
  // nowa, więc zmienia się długość i kierunek, a grot zostaje grotem (przy
  // skalowaniu ramką rozciągał się razem z całością). Shift = kąt co 15°.
  // Linie ze starego edytora nie mają _line -- zostają zwykłymi ścieżkami.
  const isLineObj = (o) => o?.type === "path" && !!o._line;

  function linePath(kind, p1, p2, sw) {
    if (kind === "line") return `M ${p1.x} ${p1.y} L ${p2.x} ${p2.y}`;
    return buildArrowPath(p1.x, p1.y, p2.x, p2.y, kind.startsWith("arrow2") ? 2 : 1, sw, kind.endsWith("Fill"), worldW / 30);
  }

  function snapEnd(anchor, p) {
    const dx = p.x - anchor.x, dy = p.y - anchor.y;
    const step = Math.PI / 12;
    const a = Math.round(Math.atan2(dy, dx) / step) * step;
    const len = Math.hypot(dx, dy);
    return { x: clamp(anchor.x + Math.cos(a) * len, 0, worldW), y: clamp(anchor.y + Math.sin(a) * len, 0, worldH) };
  }

  /** Końce linii we współrzędnych świata (po przesunięciu, obrocie, skali grupy…). */
  function lineEnds(o) {
    const f = fabric();
    const m = o.calcTransformMatrix();
    const pt = (x, y) => f.util.transformPoint(new f.Point(x - o.pathOffset.x, y - o.pathOffset.y), m);
    return [pt(o._line.x1, o._line.y1), pt(o._line.x2, o._line.y2)];
  }

  /** Buduje ścieżkę linii od nowa między p1 i p2 (świat), z bieżącą grubością. */
  function rebuildLine(o, p1, p2) {
    const f = fabric();
    const tmp = new f.Path(linePath(o._line.kind, p1, p2, o.strokeWidth), { strokeWidth: o.strokeWidth, strokeUniform: o.strokeUniform });
    o.set({
      path: tmp.path, width: tmp.width, height: tmp.height, pathOffset: tmp.pathOffset,
      angle: 0, scaleX: 1, scaleY: 1, flipX: false, flipY: false, skewX: 0, skewY: 0,
      // zawsze nowy obiekt: snapshoty historii trzymają referencję do starego
      _line: { kind: o._line.kind, x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y },
      dirty: true,
    });
    o.setPositionByOrigin(tmp.getCenterPoint(), "center", "center");
    o.setCoords();
  }

  function lineEndControl(which) {
    const f = fabric();
    return new f.Control({
      actionName: "lineEnd",
      cursorStyle: "crosshair",
      sizeX: 16,
      sizeY: 16,
      touchSizeX: 32,
      touchSizeY: 32,
      render: f.controlsUtils.renderCircleControl,
      positionHandler: (dim, finalMatrix, o) => {
        const p = lineEnds(o)[which];
        return f.util.transformPoint(p, o.canvas?.viewportTransform || [1, 0, 0, 1, 0, 0]);
      },
      // x, y: wskaźnik we współrzędnych sceny
      actionHandler: (e, transform, x, y) => {
        const o = transform.target;
        const ends = lineEnds(o);
        const anchor = ends[1 - which];
        let p = { x: clamp(x, 0, worldW), y: clamp(y, 0, worldH) };
        if (e.shiftKey) p = snapEnd(anchor, p);
        if (Math.hypot(p.x - anchor.x, p.y - anchor.y) < 1) return false;
        ends[which] = p;
        rebuildLine(o, ends[0], ends[1]);
        touch();
        return true;
      },
    });
  }

  function decorateLine(o) {
    if (!isLineObj(o)) return;
    o.controls = { p1: lineEndControl(0), p2: lineEndControl(1) };
    o.hasBorders = false;
    // pełne kółka -- przezroczyste giną na białej linii
    o.transparentCorners = false;
    o.cornerColor = "#ffffff";
    o.cornerStrokeColor = "#2f6bff";
    // Fabric 7 szuka uchwytów po kluczach oCoords: przeliczyć po podmianie controls
    o.setCoords();
  }

  function startShape(ev) {
    const start = screenToWorld(ev);
    drawing = { start, obj: makeShape(start, { x: start.x + 1, y: start.y + 1 }, false) };
    canvas.add(drawing.obj);
  }

  function updateShape(ev) {
    const obj = makeShape(drawing.start, screenToWorld(ev), ev.shiftKey);
    restoring = true; // wymiana obiektu w trakcie przeciągania to nie zmiana do historii
    canvas.remove(drawing.obj);
    canvas.add(obj);
    restoring = false;
    drawing.obj = obj;
    canvas.requestRenderAll();
  }

  function finishShape() {
    const obj = drawing.obj;
    drawing = null;
    obj.set({ excludeFromExport: false });
    obj.setCoords();
    commit();
  }

  function cancelShape() {
    if (!drawing) return;
    canvas.remove(drawing.obj);
    drawing = null;
    canvas.requestRenderAll();
  }

  // Wielokąt: klik = punkt, dwuklik / Enter / „Zamknij” = koniec, Backspace = cofnij punkt, Esc = porzuć.
  function addPolyPoint(p) {
    polyPoints.push(p);
    if (!polyPreview) {
      polyPreview = new (fabric().Polyline)(polyPoints, {
        ...shapeStyle(), fill: "transparent", selectable: false, evented: false, excludeFromExport: true,
      });
      canvas.add(polyPreview);
    } else {
      polyPreview.set({ points: polyPoints });
    }
    canvas.requestRenderAll();
    renderSettings();
  }

  function popPolyPoint() {
    polyPoints.pop();
    if (!polyPoints.length) clearPolyDraft();
    else { polyPreview.set({ points: polyPoints }); canvas.requestRenderAll(); }
    renderSettings();
  }

  function clearPolyDraft() {
    polyPoints = [];
    if (polyPreview && canvas) {
      canvas.remove(polyPreview);
      canvas.requestRenderAll();
    }
    polyPreview = null;
  }

  function finalizePolygon() {
    if (polyPoints.length < 3) return;
    const points = polyPoints.slice();
    clearPolyDraft();
    canvas.add(new (fabric().Polygon)(points, { ...shapeStyle(), selectable: false, evented: true }));
    commit();
    renderSettings();
  }

  // =========================================================
  // Tekst
  // =========================================================
  function addText(point) {
    const s = settings.TEXT;
    const obj = new (fabric().IText)(t("logoEditor.draw.ui.defaultText"), {
      left: point.x,
      top: point.y,
      fontSize: s.size,
      lineHeight: s.lineHeight,
      charSpacing: s.spacing * 50,
      fontWeight: s.bold ? "bold" : "normal",
      fontStyle: s.italic ? "italic" : "normal",
      underline: s.underline,
      textAlign: s.align,
      fill: hex(s.fg),
      ...(s.font ? { fontFamily: s.font } : {}),
    });
    canvas.add(obj);
    keepInWorld(obj);
    canvas.setActiveObject(obj);
    obj.enterEditing();
    obj.selectAll();
    commit();
  }

  /** Kończy edycję tekstu; pusty tekst usuwa. */
  function finishTextEditing() {
    const active = canvas?.getActiveObject();
    if (!isTextObj(active)) return;
    if (active.isEditing) active.exitEditing();
    canvas.discardActiveObject();
    if (!active.text?.trim()) {
      canvas.remove(active);
      commit();
    }
    canvas.requestRenderAll();
  }

  // =========================================================
  // Operacje na zaznaczeniu
  // =========================================================
  function removeObjects(list) {
    if (!list.length) return;
    canvas.discardActiveObject();
    list.forEach((o) => canvas.remove(o));
    canvas.requestRenderAll();
    commit();
  }

  const selectedObjects = () => (canvas ? canvas.getActiveObjects().filter(Boolean) : []);

  async function duplicateSelection() {
    const active = canvas?.getActiveObject();
    if (!active) return;
    const clone = await active.clone(EXTRA_PROPS);
    canvas.discardActiveObject();
    clone.set({ left: clone.left + 10, top: clone.top + 10, evented: true });
    if (clone instanceof fabric().ActiveSelection) {
      // obiekty grupy mają współrzędne względem jej środka -- grupa musi
      // zostać zaznaczona, żeby Fabric przeliczył je po odznaczeniu
      clone.canvas = canvas;
      clone.forEachObject((o) => canvas.add(o));
      clone.setCoords();
    } else {
      canvas.add(clone);
    }
    keepInWorld(clone);
    if (tool !== TOOL.SELECT) setTool(TOOL.SELECT);
    canvas.setActiveObject(clone);
    canvas.requestRenderAll();
    commit();
  }

  function moveSelection(dx, dy) {
    const active = canvas?.getActiveObject();
    if (!active) return;
    active.set({ left: active.left + dx, top: active.top + dy });
    keepInWorld(active);
    canvas.requestRenderAll();
    commit();
  }

  // =========================================================
  // Pasek ustawień (drugi rząd toolbaru): narzędzie albo zaznaczone obiekty
  // =========================================================
  const T = (k, p) => t(`logoEditor.draw.ui.${k}`, p);
  let lineStyleSel = null;
  let shapeSel = null;

  function colorBtn(value, attr = "") {
    const black = value === "BLACK";
    return `<button class="ctxColorBtn ${black ? "black" : "white"}" type="button" ${attr} title="${T(black ? "colorBlack" : "colorWhite")}"></button>`;
  }
  const group = (inner) => `<div class="ctxGroup">${inner}</div>`;
  const label = (text) => `<span class="ctxLabel">${text}</span>`;
  const numInput = (id, min, max, step, value) =>
    `<input id="${id}" class="inp sm ctxInput" type="number" min="${min}" max="${max}" step="${step}" value="${value}"/>`;
  const toggleBtn = (id, on, content, title = "") =>
    `<button class="btn xs" id="${id}" type="button" aria-pressed="${on ? "true" : "false"}" ${title ? `title="${title}" aria-label="${title}"` : ""}>${content}</button>`;
  const selectHtml = (id) =>
    `<div class="ui-select ctxSelect" id="${id}"><button class="btn sm ui-select-btn" type="button" aria-haspopup="listbox" aria-expanded="false"><span class="ui-select-label">—</span><span class="ui-select-caret" aria-hidden="true">${icon("caret-down")}</span></button><div class="ui-select-menu" role="listbox"></div></div>`;
  const alignButtons = (align) => group(
    toggleBtn("cAlignL", align === "left", icon("align-left"), T("alignLeft")) +
    toggleBtn("cAlignC", align === "center", icon("align-center"), T("alignCenter")) +
    toggleBtn("cAlignR", align === "right", icon("align-right"), T("alignRight")),
  );

  function mountLineStyle(id, value, onChange) {
    lineStyleSel?.destroy();
    lineStyleSel = initUiSelect($(id), {
      options: LINE_STYLES.map((ls) => ({ value: ls.id, label: T(`lineStyles.${ls.id}`) })),
      value,
      onChange,
    });
  }

  const on = (id, event, fn) => $(id)?.addEventListener(event, fn);

  /**
   * Liczbowe pole ustawień: `input` = podgląd na żywo (bez historii),
   * `change` (enter / utrata fokusu / strzałki) = jeden wpis w historii.
   */
  function bindNumber(id, min, max, fallback, apply) {
    const read = (e) => clamp(Number(e.target.value) || fallback, min, max);
    on(id, "input", (e) => apply(read(e), false));
    on(id, "change", (e) => { const v = read(e); e.target.value = v; apply(v, true); });
    // Enter zatwierdza i oddaje klawiaturę skrótom sceny (Ctrl+Z, V, B…)
    on(id, "keydown", (e) => { if (e.key === "Enter") e.target.blur(); });
  }

  function renderSettings() {
    renderSettingsContent();
    if (!toolCtx || !selectedObjects().length || (tool !== TOOL.SELECT && tool !== TOOL.TEXT)) return;
    toolCtx.insertAdjacentHTML("beforeend", group(toggleBtn("cDelete", false, icon("close"), T("deleteSelection"))));
    $("cDelete").setAttribute("aria-keyshortcuts", "Delete Backspace");
    on("cDelete", "click", () => removeObjects(selectedObjects()));
  }

  function renderSettingsContent() {
    lineStyleSel?.destroy();
    lineStyleSel = null;
    shapeSel?.destroy();
    shapeSel = null;
    if (!toolCtx) return;
    toolCtx.dataset.empty = T("ctxEmpty"); // podpowiedź w pustym wierszu ustawień (CSS :empty)
    const active = canvas?.getActiveObject();

    if (tool === TOOL.SELECT && active && !isTextObj(active)) return renderShapeObjectSettings();
    if (tool === TOOL.TEXT && isTextObj(active)) return renderTextObjectSettings(active);
    if (tool === TOOL.BRUSH) return renderBrushSettings();
    if (tool === TOOL.ERASER) return renderEraserSettings();
    if (tool === TOOL.SHAPES) return renderShapeToolSettings();
    if (tool === TOOL.TEXT) return renderTextToolSettings();
    toolCtx.innerHTML = "";
  }

  function renderBrushSettings() {
    const s = settings.BRUSH;
    toolCtx.innerHTML =
      group(label(T("strokeLabel")) + numInput("cStrokeW", ...RANGE.stroke, 1, s.stroke)) +
      group(label(T("styleLabel")) + selectHtml("cLineStyle")) +
      group(label(T("colorLabel")) + colorBtn(s.fg, 'id="cFg"'));
    bindNumber("cStrokeW", ...RANGE.stroke, 6, (v) => { s.stroke = v; applyBrushStyle(); updateCursor(); });
    mountLineStyle("cLineStyle", s.lineStyle, (v) => { s.lineStyle = v; applyBrushStyle(); });
    on("cFg", "click", () => { s.fg = s.fg === "BLACK" ? "WHITE" : "BLACK"; applyBrushStyle(); renderSettings(); });
  }

  function renderEraserSettings() {
    const s = settings.ERASER;
    toolCtx.innerHTML = group(label(T("sizeLabel")) + numInput("cEraser", ...RANGE.eraser, 1, s.size));
    bindNumber("cEraser", ...RANGE.eraser, 10, (v) => { s.size = v; updateCursor(); });
  }

  function renderShapeToolSettings() {
    const s = settings.SHAPES;
    const shape = shapeById(currentShape);
    let html =
      `<div class="ctxGroup">${selectHtml("cShape")}</div>` +
      group(label(T("strokeLabel")) + numInput("cStrokeW", ...RANGE.stroke, 1, s.stroke)) +
      group(label(T("styleLabel")) + selectHtml("cLineStyle")) +
      group(label(T("colorLabel")) + colorBtn(s.fg, 'id="cFg"'));
    if (shape.hasFill) {
      html += group(`<label class="ctxChk"><input type="checkbox" id="cFill" ${s.fill ? "checked" : ""}/> ${T("fillCheckbox")}</label>` + colorBtn(s.fillColor, 'id="cFillColor"'));
    }
    if (shape.isPoly && polyPoints.length) {
      html += group(`<button class="btn xs gold" id="cPolyDone" type="button">${iconText("check", T("polygonDone"))}</button>`);
    }
    toolCtx.innerHTML = html;

    // Wybór kształtu: wspólna lista ui-select (ikona + nazwa), jak „Styl”.
    shapeSel = initUiSelect($("cShape"), {
      options: SHAPES.map((sh) => ({ value: sh.id, label: t(sh.label), icon: sh.icon })),
      value: shape.id,
      onChange: (v) => setShape(v),
    });
    bindNumber("cStrokeW", ...RANGE.stroke, 6, (v) => { s.stroke = v; });
    mountLineStyle("cLineStyle", s.lineStyle, (v) => { s.lineStyle = v; });
    on("cFg", "click", () => { s.fg = s.fg === "BLACK" ? "WHITE" : "BLACK"; renderSettings(); });
    on("cFill", "change", (e) => { s.fill = e.target.checked; });
    on("cFillColor", "click", () => { s.fillColor = s.fillColor === "BLACK" ? "WHITE" : "BLACK"; renderSettings(); });
    on("cPolyDone", "click", finalizePolygon);
  }

  function renderTextToolSettings() {
    const s = settings.TEXT;
    toolCtx.innerHTML = textSettingsHtml({
      font: s.font, size: s.size, lineHeight: s.lineHeight, spacing: s.spacing,
      bold: s.bold, italic: s.italic, underline: s.underline, align: s.align, color: s.fg,
    });
    on("cFont", "click", () => openFontPicker(s.font, (v) => { s.font = v; renderSettings(); }));
    bindNumber("cSz", ...RANGE.fontSize, 80, (v) => { s.size = v; });
    bindNumber("cLH", 0.6, 3, 1, (v) => { s.lineHeight = v; });
    bindNumber("cSp", 0, 20, 0, (v) => { s.spacing = v; });
    for (const [id, key] of [["cB", "bold"], ["cI", "italic"], ["cU", "underline"]]) {
      on(id, "click", () => { s[key] = !s[key]; renderSettings(); });
    }
    for (const [id, align] of [["cAlignL", "left"], ["cAlignC", "center"], ["cAlignR", "right"]]) {
      on(id, "click", () => { s.align = align; renderSettings(); });
    }
    on("cFg", "click", () => { s.fg = s.fg === "BLACK" ? "WHITE" : "BLACK"; renderSettings(); });
  }

  function textSettingsHtml(v) {
    const fontLabel = DRAW_FONTS.find((f) => f.value === v.font)?.label || T("fontFallback");
    return (
      group(`<button class="btn xs ctxSelectBtn" id="cFont" type="button" title="${fontLabel}"><span class="ctxSelectLabel">${fontLabel}</span><span class="ctxSelectCaret">${icon("caret-down")}</span></button>`) +
      group(label(T("sizeLabel")) + numInput("cSz", ...RANGE.fontSize, 1, v.size)) +
      group(label(T("lineHeightLabel")) + numInput("cLH", 0.6, 3, 0.05, v.lineHeight)) +
      group(label(T("letterSpacingLabel")) + numInput("cSp", 0, 20, 0.5, v.spacing)) +
      group(toggleBtn("cB", v.bold, T("bold")) + toggleBtn("cI", v.italic, T("italic")) + toggleBtn("cU", v.underline, T("underline"))) +
      alignButtons(v.align) +
      group(label(T("colorLabel")) + colorBtn(v.color, 'id="cFg"'))
    );
  }

  /** Zaznaczony tekst (narzędzie Tekst): zmiany dotyczą obiektu. */
  function renderTextObjectSettings(obj) {
    const bold = obj.fontWeight === "bold" || Number(obj.fontWeight) >= 700;
    toolCtx.innerHTML = textSettingsHtml({
      font: obj.fontFamily || "",
      size: Math.round(obj.fontSize || 40),
      lineHeight: obj.lineHeight || 1,
      spacing: Math.round((obj.charSpacing || 0) / 50),
      bold,
      italic: obj.fontStyle === "italic",
      underline: !!obj.underline,
      align: obj.textAlign || "left",
      color: toBW(obj.fill),
    });
    const setObj = (props, final = true) => {
      obj.set(props);
      obj.setCoords();
      if (final) { keepInWorld(obj); commit(); canvas.requestRenderAll(); } else touch();
    };
    on("cFont", "click", () => openFontPicker(obj.fontFamily, (v) => { setObj({ fontFamily: v }); renderSettings(); }));
    bindNumber("cSz", ...RANGE.fontSize, 80, (v, final) => setObj({ fontSize: v }, final));
    bindNumber("cLH", 0.6, 3, 1, (v, final) => setObj({ lineHeight: v }, final));
    bindNumber("cSp", 0, 20, 0, (v, final) => setObj({ charSpacing: v * 50 }, final));
    on("cB", "click", () => { setObj({ fontWeight: bold ? "normal" : "bold" }); renderSettings(); });
    on("cI", "click", () => { setObj({ fontStyle: obj.fontStyle === "italic" ? "normal" : "italic" }); renderSettings(); });
    on("cU", "click", () => { setObj({ underline: !obj.underline }); renderSettings(); });
    for (const [id, align] of [["cAlignL", "left"], ["cAlignC", "center"], ["cAlignR", "right"]]) {
      on(id, "click", () => { setObj({ textAlign: align }); renderSettings(); });
    }
    on("cFg", "click", () => { setObj({ fill: hex(toBW(obj.fill) === "BLACK" ? "WHITE" : "BLACK") }); renderSettings(); });
  }

  /** Zaznaczone kształty (Wskaźnik): tylko wspólne właściwości; tekst w zaznaczeniu -> brak ustawień. */
  function renderShapeObjectSettings() {
    const shapes = selectedObjects();
    if (!shapes.length || shapes.some(isTextObj)) { toolCtx.innerHTML = ""; return; }
    const canFill = shapes.every((o) => o.type === "rect" || o.type === "ellipse" || !!o._canHaveFill);
    const widths = new Set(shapes.map((o) => Math.round(o.strokeWidth || 0)));
    const strokeColors = new Set(shapes.map((o) => toBW(o.stroke)));
    const filled = shapes.every((o) => o.fill && o.fill !== "transparent" && o.fill !== "rgba(0,0,0,0)");
    const firstFill = shapes.find((o) => o.fill && o.fill !== "transparent")?.fill;

    let html =
      group(label(T("outlineLabel")) + `<input id="cObjStroke" class="inp sm ctxInput" type="number" min="${RANGE.outline[0]}" max="${RANGE.outline[1]}" step="1" value="${widths.size === 1 ? [...widths][0] : ""}" placeholder="—"/>`) +
      group(label(T("styleLabel")) + selectHtml("cObjLineStyle")) +
      group(colorBtn(strokeColors.size === 1 ? [...strokeColors][0] : "WHITE", 'id="cObjStrokeColor"'));
    if (canFill) {
      html += group(`<label class="ctxChk"><input type="checkbox" id="cObjFill" ${filled ? "checked" : ""}/> ${T("fillCheckbox")}</label>` + colorBtn(toBW(firstFill || "#fff"), 'id="cObjFillColor"'));
    }
    toolCtx.innerHTML = html;

    const apply = (fn, final = true) => {
      shapes.forEach(fn);
      if (final) { commit(); canvas.requestRenderAll(); } else touch();
    };
    const styleOf = (o) => LINE_STYLES.find((ls) => JSON.stringify(ls.dash?.(o.strokeWidth) || null) === JSON.stringify(o.strokeDashArray || null))?.id || "solid";
    bindNumber("cObjStroke", ...RANGE.outline, 0, (v, final) => apply((o) => {
      // strzałka: grot zależy od grubości -- przebudowa między tymi samymi końcami
      const ends = isLineObj(o) && !o.group ? lineEnds(o) : null;
      o.set({ strokeDashArray: dashFor(styleOf(o), v), strokeWidth: v });
      if (ends) rebuildLine(o, ends[0], ends[1]);
    }, final));
    const styles = new Set(shapes.map(styleOf));
    mountLineStyle("cObjLineStyle", styles.size === 1 ? [...styles][0] : "solid", (v) => apply((o) => o.set({ strokeDashArray: dashFor(v, o.strokeWidth) })));
    on("cObjStrokeColor", "click", () => {
      const next = hex(toBW(shapes[0].stroke) === "BLACK" ? "WHITE" : "BLACK");
      apply((o) => o.set({ stroke: next }));
      renderSettings();
    });
    on("cObjFill", "change", (e) => {
      const color = e.target.checked ? hex(toBW(firstFill || "#fff")) : "transparent";
      apply((o) => o.set({ fill: color }));
      renderSettings();
    });
    on("cObjFillColor", "click", () => {
      const next = hex(toBW(firstFill || "#fff") === "BLACK" ? "WHITE" : "BLACK");
      apply((o) => { if (o.fill && o.fill !== "transparent") o.set({ fill: next }); });
      renderSettings();
    });
  }

  // =========================================================
  // Wybór fontu (popover z wyszukiwarką)
  // =========================================================
  let DRAW_FONTS = [];
  let fontOnSelect = null;
  let fontCurrent = "";

  async function loadFonts() {
    if (DRAW_FONTS.length) return;
    try {
      const res = await fetch(await cacheBust(new URL("../data/fonts.json", import.meta.url).href), { cache: "no-store" });
      const data = res.ok ? await res.json() : [];
      DRAW_FONTS = Array.isArray(data) ? data.filter((f) => f?.value && f?.label) : [];
    } catch {
      DRAW_FONTS = [];
    }
  }

  async function loadSceneFonts() {
    const textObjects = canvas?.getObjects?.().filter(isTextObj) || [];
    const families = new Set(textObjects.map(obj => {
      const style = [obj.fontStyle, obj.fontWeight].filter(value => value && value !== "normal").join(" ");
      return `${style ? `${style} ` : ""}${Math.max(1, Number(obj.fontSize) || 16)}px ${obj.fontFamily || "sans-serif"}`;
    }));
    await Promise.all([...families].map(font => document.fonts?.load(font, "Familijna").catch(() => [])));
    await document.fonts?.ready;
  }

  function renderFontList() {
    const norm = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    const q = norm(fontSearch?.value || "");
    const list = q ? DRAW_FONTS.filter((f) => norm(f.label).includes(q) || norm(f.value).includes(q)) : DRAW_FONTS;
    fontEmpty.hidden = list.length > 0;
    fontList.innerHTML = "";
    for (const f of list) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "menu-item fontPickItem";
      item.setAttribute("aria-selected", String(f.value === fontCurrent));
      const name = document.createElement("span");
      name.className = "fontPickName";
      name.textContent = f.label;
      const sample = document.createElement("span");
      sample.className = "fontPickSwatch";
      setVars(sample, { "--font": f.value });
      sample.textContent = T("sampleText");
      item.append(name, sample);
      item.addEventListener("click", () => {
        fontOnSelect?.(f.value);
        closeFontPicker();
      });
      fontList.appendChild(item);
    }
  }

  function openFontPicker(current, onSelect) {
    if (!fontPop || !DRAW_FONTS.length) return;
    fontCurrent = current || "";
    fontOnSelect = onSelect;
    placeDropdown($("toolsDraw"), fontPop, { align: "start" });
    fontPop.hidden = false;
    fontSearch.value = "";
    renderFontList();
    fontSearch.focus();
  }

  function closeFontPicker() {
    if (fontPop) fontPop.hidden = true;
    fontOnSelect = null;
  }

  fontSearch?.addEventListener("input", renderFontList);
  $("drawFontSearchClear")?.addEventListener("click", () => { fontSearch.value = ""; renderFontList(); fontSearch.focus(); });
  document.addEventListener("pointerdown", (e) => {
    if (fontPop && !fontPop.hidden && !fontPop.contains(e.target)) closeFontPicker();
  }, true);

  // =========================================================
  // Podpowiedzi przycisków (nad przyciskiem, z JS -- CSS-owe ucinał pasek)
  // =========================================================
  const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform) || /Mac OS X/.test(navigator.userAgent);
  const MOD = isMac ? "⌘" : "Ctrl";
  const withKey = (text, key) => `${text}\n${T("shortcutPrefix")}${key}`;

  function updateTooltips() {
    const TT = (k) => t(`logoEditor.draw.tooltips.${k}`);
    const hold = (key) => T("holdKey", { key });
    const tips = {
      select: withKey(TT("select"), `V · ${hold(MOD)}`),
      pan: withKey(TT("pan"), `H · ${hold(T("spaceKey"))}`),
      zoomIn: withKey(TT("zoomIn"), `${MOD} +`),
      zoomOut: withKey(TT("zoomOut"), `${MOD} −`),
      bg: TT("background"),
      brush: withKey(TT("brush"), "B"),
      eraser: withKey(TT("eraser"), "E"),
      shapes: withKey(`${TT("shapes")}\n${TT("shapesLines")}`, "S · U"),
      text: withKey(TT("text"), "T"),
      undo: withKey(TT("undo"), `${MOD}+Z`),
      redo: withKey(TT("redo"), isMac ? "⌘⇧Z" : "Ctrl+Y"),
      duplicate: withKey(TT("duplicate"), `${MOD}+D`),
      clear: TT("clear"),
      eye: TT("preview"),
    };
    for (const [k, text] of Object.entries(tips)) btn[k]?.setAttribute("data-tip", text);
  }

  const ICONS = {
    select: "cursor", pan: "hand", zoomIn: "zoom-in", zoomOut: "zoom-out", text: "text", brush: "brush",
    eraser: "eraser", shapes: "shapes", undo: "undo", redo: "redo", clear: "trash", duplicate: "duplicate", eye: "eye",
  };
  for (const [k, name] of Object.entries(ICONS)) {
    if (!btn[k]) continue;
    btn[k].innerHTML = icon(name);
    btn[k].setAttribute("aria-label", t(`logoEditor.draw.tooltips.${k === "eye" ? "preview" : k}`).split("\n")[0]);
  }
  updateTooltips();
  window.addEventListener("i18n:lang", () => { updateTooltips(); syncBgIcon(); renderSettings(); });

  // =========================================================
  // Klawiatura (skróty jak w programach graficznych)
  // =========================================================
  const isTyping = (target) => {
    const tag = (target?.tagName || "").toLowerCase();
    return tag === "input" || tag === "textarea" || tag === "select" || !!target?.isContentEditable;
  };
  const SHAPE_CYCLE = ["line", "rect", "ellipse", "polygon"];

  function onKeyDown(ev) {
    if (ctx.getMode?.() !== "DRAW" || !canvas || isTyping(ev.target)) return;
    if (canvas.getActiveObject()?.isEditing) return; // pisanie w tekście na scenie
    const key = ev.key;
    const k = key.length === 1 ? key.toLowerCase() : key;
    const mod = ev.ctrlKey || ev.metaKey;

    if (key === " ") {
      ev.preventDefault();
      if (!holdSpace) { holdSpace = true; recomputeTempTool(); }
      return;
    }
    if (key === "Control" || key === "Meta") {
      if (!holdCtrl) { holdCtrl = true; recomputeTempTool(); }
      return;
    }

    if (mod) {
      const actions = {
        z: () => (ev.shiftKey ? redo() : undo()),
        y: redo,
        d: duplicateSelection,
        0: () => setZoom(1),
        1: () => setZoom(1),
        "+": () => setZoom(userZoom() * 1.15),
        "=": () => setZoom(userZoom() * 1.15),
        "-": () => setZoom(userZoom() / 1.15),
      };
      if (actions[k]) { ev.preventDefault(); void actions[k](); }
      return;
    }
    if (ev.altKey) return;

    const toolKeys = { v: TOOL.SELECT, h: TOOL.PAN, b: TOOL.BRUSH, e: TOOL.ERASER, s: TOOL.SHAPES, t: TOOL.TEXT };
    const shapeKeys = { l: "line", r: "rect", o: "ellipse", p: "polygon" };
    if (toolKeys[k]) { ev.preventDefault(); setTool(toolKeys[k]); return; }
    if (shapeKeys[k]) { ev.preventDefault(); setShape(shapeKeys[k]); return; }
    if (k === "u") {
      ev.preventDefault();
      const i = SHAPE_CYCLE.indexOf(currentShape);
      setShape(SHAPE_CYCLE[(i + 1) % SHAPE_CYCLE.length]);
      return;
    }
    if (k === "f" && baseTool === TOOL.SHAPES && shapeById(currentShape).hasFill) {
      ev.preventDefault();
      settings.SHAPES.fill = !settings.SHAPES.fill;
      renderSettings();
      return;
    }
    if (k === "[" || k === "]") {
      const s = baseTool === TOOL.ERASER ? settings.ERASER : settings[baseTool];
      const prop = baseTool === TOOL.ERASER ? "size" : "stroke";
      if (s?.[prop] == null) return;
      ev.preventDefault();
      // ten sam zakres co pole grubości / gumki (poniżej 5 kropki znikają)
      const [lo, hi] = baseTool === TOOL.ERASER ? RANGE.eraser : RANGE.stroke;
      s[prop] = clamp(s[prop] + (k === "]" ? 1 : -1), lo, hi);
      if (baseTool === TOOL.BRUSH) applyBrushStyle();
      updateCursor();
      renderSettings();
      return;
    }

    const drawingPoly = baseTool === TOOL.SHAPES && currentShape === "polygon" && polyPoints.length > 0;
    if (drawingPoly) {
      if (key === "Enter") { ev.preventDefault(); finalizePolygon(); return; }
      if (key === "Escape") { ev.preventDefault(); clearPolyDraft(); renderSettings(); return; }
      if (key === "Backspace" || key === "Delete") { ev.preventDefault(); popPolyPoint(); return; }
    }

    if ((tool === TOOL.SELECT || tool === TOOL.TEXT) && (key === "Backspace" || key === "Delete")) {
      if (selectedObjects().length) { ev.preventDefault(); removeObjects(selectedObjects()); }
      return;
    }
    const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (tool === TOOL.SELECT && arrows[key] && canvas.getActiveObject()) {
      ev.preventDefault();
      const step = ev.shiftKey ? 10 : 1;
      moveSelection(arrows[key][0] * step, arrows[key][1] * step);
    }
  }

  function onKeyUp(ev) {
    if (ev.key === " " && holdSpace) { holdSpace = false; recomputeTempTool(); }
    if ((ev.key === "Control" || ev.key === "Meta") && holdCtrl) { holdCtrl = false; recomputeTempTool(); }
  }

  // Puszczony klawisz poza oknem nie przychodzi -- bez tego Spacja/Ctrl „zostawały wciśnięte”.
  function releaseTempKeys() {
    if (!holdSpace && !holdCtrl) return;
    holdSpace = holdCtrl = false;
    recomputeTempTool();
  }

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", releaseTempKeys);

  // =========================================================
  // Przyciski paska narzędzi
  // =========================================================
  btn.select?.addEventListener("click", () => setTool(TOOL.SELECT));
  btn.pan?.addEventListener("click", () => setTool(TOOL.PAN));
  btn.brush?.addEventListener("click", () => setTool(TOOL.BRUSH));
  btn.eraser?.addEventListener("click", () => setTool(TOOL.ERASER));
  btn.shapes?.addEventListener("click", () => setTool(TOOL.SHAPES));
  btn.text?.addEventListener("click", () => setTool(TOOL.TEXT));
  btn.zoomIn?.addEventListener("click", () => setZoom(userZoom() * 1.15));
  btn.zoomOut?.addEventListener("click", () => setZoom(userZoom() / 1.15));
  btn.undo?.addEventListener("click", () => void undo());
  btn.redo?.addEventListener("click", () => void redo());
  btn.duplicate?.addEventListener("click", duplicateSelection);
  btn.eye?.addEventListener("click", async () => {
    // Podgląd zaraz po rysowaniu: odświeżenie miniatury (schedulePreview)
    // mogło jeszcze nie zdążyć -- liczymy kropki z aktualnej sceny, jak zapis.
    if (canvas) {
      clearTimeout(previewTimer);
      const seq = ++previewSeq;
      const b = await sceneToBits(fabric(), snapshot(), worldW, worldH);
      if (seq === previewSeq) { bits = b; ctx.onPreview?.({ kind: "PIX", bits }); }
    }
    window.dispatchEvent(new CustomEvent("logoeditor:openPreview", { detail: { kind: "PIX", bits } }));
  });
  btn.bg?.addEventListener("click", () => {
    if (!canvas) return;
    bg = bg === "BLACK" ? "WHITE" : "BLACK";
    canvas.backgroundColor = hex(bg);
    syncBgIcon();
    canvas.requestRenderAll();
    commit();
  });
  btn.clear?.addEventListener("click", async () => {
    if (ctx.getMode?.() !== "DRAW" || !canvas) return;
    if (!(await confirmModal({ text: t("logoEditor.draw.confirmClear") }))) return;
    clearPolyDraft();
    removeObjects(canvas.getObjects().slice());
  });

  // =========================================================
  // Fabric: tworzenie sceny i zdarzenia (raz)
  // =========================================================
  function installCanvas() {
    const f = fabric();
    canvas = new f.Canvas(canvasEl, {
      backgroundColor: hex(bg),
      selection: true,
      preserveObjectStacking: true,
      stopContextMenu: true,
      fireRightClick: true,
    });
    updateClipPath();
    ensureCursorOverlay();
    window.__drawFabric = canvas; // podgląd sceny w testach e2e (jak w starym edytorze)

    const upper = canvas.upperCanvasEl;
    // Fabric blokuje domyślną obsługę kliknięcia, więc fokus zostawał w polu
    // ustawień i skróty (Ctrl+Z, V, …) trafiały do niego zamiast do sceny.
    upper.addEventListener("pointerdown", () => {
      const el = document.activeElement;
      if (el && el !== document.body && toolCtx?.contains(el)) el.blur();
    }, { passive: true });
    upper.addEventListener("pointermove", (ev) => {
      lastPointer = { x: ev.clientX, y: ev.clientY };
      placeCursorDot(ev.clientX, ev.clientY);
    }, { passive: true });
    upper.addEventListener("pointerleave", hideCursorDot, { passive: true });

    canvas.on("path:created", (e) => {
      if (!e?.path) return;
      if (discardNextPath) {
        // kreska z gestu, który okazał się pinchem dwoma palcami
        discardNextPath = false;
        canvas.remove(e.path);
        canvas.requestRenderAll();
        return;
      }
      e.path.set({ strokeUniform: true, selectable: false, evented: true });
      commit();
    });
    // Linie/strzałki (też z historii, duplikatu, wczytanego logo) dostają uchwyty końców.
    canvas.on("object:added", (e) => decorateLine(e?.target));
    canvas.on("object:modified", (e) => {
      if (e?.target) keepInWorld(e.target);
      commit();
      renderSettings();
    });
    // Tekst na scenie: podgląd na żywo w trakcie pisania (wpis w historii przy wyjściu z edycji).
    canvas.on("text:changed", () => touch());
    canvas.on("text:editing:exited", (e) => {
      if (e?.target && !e.target.text?.trim()) {
        canvas.remove(e.target);
      }
      commit();
    });
    for (const ev of ["object:moving", "object:scaling", "object:rotating"]) {
      canvas.on(ev, (e) => { if (e?.target) keepInWorld(e.target); });
    }
    for (const ev of ["selection:created", "selection:updated", "selection:cleared"]) {
      canvas.on(ev, () => renderSettings());
    }

    // Fabric zdejmuje zaznaczenie przy kliknięciu w puste pole ZANIM wywoła
    // "mouse:down" -- stąd zapamiętanie, co było aktywne przed kliknięciem.
    let activeBeforeDown = null;
    canvas.on("mouse:down:before", () => { activeBeforeDown = canvas.getActiveObject(); });

    canvas.on("mouse:down", (opt) => {
      pointerDown = true;
      const e = opt.e?.touches?.[0] || opt.e;
      lastPointer = { x: e.clientX, y: e.clientY };

      if (tool === TOOL.PAN) {
        if (userZoom() > 1 + 1e-6) {
          pan = { x: e.clientX, y: e.clientY, vpt: canvas.viewportTransform.slice() };
          updateCursor();
        }
        return;
      }
      if (tool === TOOL.ERASER) { eraseAt(opt); return; }
      if (tool === TOOL.SHAPES) {
        if (currentShape === "polygon") addPolyPoint(screenToWorld(opt.e));
        else startShape(opt.e);
        return;
      }
      if (tool === TOOL.TEXT) {
        const target = opt.target;
        if (isTextObj(target)) {
          canvas.setActiveObject(target);
          if (!target.isEditing) { target.enterEditing(); target.selectAll(); }
          renderSettings();
          return;
        }
        // klik w puste pole przy zaznaczonym/edytowanym tekście = tylko zakończ
        // edycję (Fabric już go odznaczył); nowy napis dopiero następnym klikiem
        if (isTextObj(activeBeforeDown)) {
          if (activeBeforeDown.isEditing) activeBeforeDown.exitEditing();
          canvas.discardActiveObject();
          if (!activeBeforeDown.text?.trim()) canvas.remove(activeBeforeDown);
          commit();
          renderSettings();
          return;
        }
        addText(screenToWorld(opt.e));
        renderSettings();
      }
    });

    canvas.on("mouse:move", (opt) => {
      const e = opt.e?.touches?.[0] || opt.e;
      lastPointer = { x: e.clientX, y: e.clientY };
      if (pan) {
        const v = pan.vpt.slice();
        v[4] += e.clientX - pan.x;
        v[5] += e.clientY - pan.y;
        canvas.setViewportTransform(v);
        clampViewport();
        canvas.requestRenderAll();
        return;
      }
      if (tool === TOOL.ERASER && pointerDown) { eraseAt(opt); return; }
      if (drawing) updateShape(opt.e);
    });

    canvas.on("mouse:up", () => {
      pointerDown = false;
      if (pan) { pan = null; updateCursor(); }
      if (drawing) finishShape();
      if (erasedSomething) { erasedSomething = false; commit(); }
    });

    canvasEl.addEventListener("dblclick", (ev) => {
      if (ctx.getMode?.() !== "DRAW") return;
      if (tool === TOOL.SHAPES && currentShape === "polygon") {
        ev.preventDefault();
        finalizePolygon();
        return;
      }
      // Dwuklik w tekst Wskaźnikiem = przejście do edycji tekstu
      const target = canvas.findTarget(ev)?.target;
      if (tool === TOOL.SELECT && isTextObj(target)) {
        ev.preventDefault();
        setTool(TOOL.TEXT);
        canvas.setActiveObject(target);
        target.enterEditing();
        target.selectAll();
        renderSettings();
      }
    });

    // Klik poza sceną (nie w pasek narzędzi) kończy edycję tekstu.
    document.addEventListener("mousedown", (ev) => {
      if (ctx.getMode?.() !== "DRAW" || !canvas) return;
      if (ev.target.closest?.("#toolsDraw, #toolCtxSettings, #drawFontPickPop, .ui-select-menu")) return;
      if (canvas.upperCanvasEl.contains(ev.target)) return;
      if (isTextObj(canvas.getActiveObject())) finishTextEditing();
    });

    canvasEl.parentElement?.addEventListener("wheel", (ev) => {
      if (ctx.getMode?.() !== "DRAW" || (tool !== TOOL.PAN && tool !== TOOL.SELECT)) return;
      ev.preventDefault();
      const rect = canvas.upperCanvasEl.getBoundingClientRect();
      setZoom(userZoom() * (ev.deltaY < 0 ? 1.1 : 1 / 1.1), new f.Point(ev.clientX - rect.left, ev.clientY - rect.top));
    }, { passive: false });

    installPinchZoom();

    new ResizeObserver(() => {
      if (ctx.getMode?.() === "DRAW") requestAnimationFrame(resizeStage);
    }).observe(stageHost || paneDraw);
  }

  function eraseAt(opt) {
    const size = settings.ERASER.size;
    const prevTol = canvas.targetFindTolerance;
    canvas.setTargetFindTolerance(Math.max(10, size * 2));
    // findTarget w trakcie zdarzenia zwraca wynik zapamiętany przy starej tolerancji
    const target = opt.target || canvas.searchPossibleTargets(canvas.getObjects(), canvas.getScenePoint(opt.e)).target;
    canvas.setTargetFindTolerance(prevTol);
    if (!target || target === polyPreview) return;
    canvas.remove(target);
    canvas.requestRenderAll();
    erasedSomething = true;
    ctx.markDirty?.();
    schedulePreview();
  }

  // Pinch dwoma palcami = zoom + przesuwanie, przy każdym narzędziu. Dotyk
  // dwoma palcami jest zatrzymywany w fazie capture (nie dochodzi do pędzla
  // ani kształtów), a to, co zdążył zacząć pierwszy palec, jest anulowane.
  function installPinchZoom() {
    const f = fabric();
    const wrap = canvas.wrapperEl || canvasEl.parentElement;
    let pz = null;
    let active = false;
    const pt = (tch) => ({ x: tch.clientX, y: tch.clientY });
    const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) || 1;
    const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

    const begin = (e) => {
      const a = pt(e.touches[0]), b = pt(e.touches[1]);
      const rect = canvas.upperCanvasEl.getBoundingClientRect();
      const m = mid(a, b);
      pz = {
        dist: dist(a, b),
        zoom: userZoom(),
        world: f.util.transformPoint(new f.Point(m.x - rect.left, m.y - rect.top), f.util.invertTransform(canvas.viewportTransform)),
      };
    };

    wrap.addEventListener("touchstart", (e) => {
      if (e.touches.length < 2) return;
      e.preventDefault();
      e.stopPropagation();
      if (!active) {
        active = true;
        cancelShape();
        if (canvas.isDrawingMode) discardNextPath = true;
        pointerDown = false;
      }
      begin(e);
    }, { capture: true, passive: false });

    wrap.addEventListener("touchmove", (e) => {
      if (!active) return;
      e.preventDefault();
      e.stopPropagation();
      if (!pz || e.touches.length < 2) return;
      const a = pt(e.touches[0]), b = pt(e.touches[1]);
      const rect = canvas.upperCanvasEl.getBoundingClientRect();
      const m = mid(a, b);
      const z = clamp(pz.zoom * (dist(a, b) / pz.dist), 1, MAX_ZOOM) * baseScale();
      // ten sam punkt sceny zostaje pod środkiem palców
      canvas.setViewportTransform([z, 0, 0, z, m.x - rect.left - pz.world.x * z, m.y - rect.top - pz.world.y * z]);
      if (userZoom() <= 1 + 1e-6) resetView(); else clampViewport();
      canvas.requestRenderAll();
      if (btn.zoomOut) btn.zoomOut.disabled = userZoom() <= 1 + 1e-6;
      updateCursor();
    }, { capture: true, passive: false });

    const end = (e) => {
      if (!active) return;
      if (e.touches.length >= 2) { begin(e); e.stopPropagation(); return; }
      pz = null;
      if (e.touches.length === 0) active = false; // ostatnie touchend dochodzi do Fabrica
      else e.stopPropagation();                   // został jeden palec -- nic nie rysuje
    };
    wrap.addEventListener("touchend", end, { capture: true });
    wrap.addEventListener("touchcancel", end, { capture: true });
  }

  // =========================================================
  // Wczytywanie zapisu (z migracją starego formatu)
  // =========================================================
  /** Rozmiar świata zapisu: source.world, a w starych zapisach -- zapisany clipPath sceny. */
  function savedWorld(source) {
    const w = Number(source?.world?.w ?? source?.fabricData?.clipPath?.width);
    const h = Number(source?.world?.h ?? source?.fabricData?.clipPath?.height);
    return w > 1 && h > 1 ? { w, h } : { w: WORLD_W, h: WORLD_H };
  }

  /**
   * Logo bez sceny wektorowej (demo „Rysunek”, stare zapisy, importy) --
   * zapisane kropki jako obraz na scenie. Każda kropka to blok 5x5 w świecie
   * dokładnie w miejscu, z którego raster (draw/raster.js) ją odczyta, więc
   * zapis bez zmian daje te same kropki, a na obrazie można dalej rysować.
   */
  function bitsLayer(b64) {
    const bitsIn = unpackBits(b64);
    if (!bitsIn.some(Boolean)) return null;
    const el = document.createElement("canvas");
    el.width = worldW;
    el.height = worldH;
    const g = el.getContext("2d");
    g.fillStyle = "#ffffff";
    const cell = worldW / 208; // jeden „piksel” rastra 208x88 (5 w nowym świecie)
    for (let y = 0; y < DOT_H; y++) {
      for (let x = 0; x < DOT_W; x++) {
        if (!bitsIn[y * DOT_W + x]) continue;
        const rx = Math.floor(x / 5) * 7 + (x % 5);
        const ry = Math.floor(y / 7) * 9 + (y % 7);
        g.fillRect(rx * cell, ry * cell, cell, cell);
      }
    }
    return new (fabric().Image)(el, { left: 0, top: 0, imageSmoothing: false, objectCaching: false });
  }

  async function loadSource(payload) {
    const source = payload?.source || {};
    ({ w: worldW, h: worldH } = source.fabricData ? savedWorld(source) : { w: WORLD_W, h: WORLD_H });
    resizeStage();
    if (!source.fabricData) {
      canvas.clear();
      canvas.backgroundColor = hex(bg);
      updateClipPath();
      const layer = bitsLayer(payload?.bits_b64);
      if (layer) canvas.add(layer);
      return;
    }
    await loadScene(source.fabricData);
  }

  // =========================================================
  // API
  // =========================================================
  return {
    async open(payload = null) {
      paneDraw.hidden = false;
      await loadFonts();
      if (!canvas) installCanvas();

      const source = payload?.source || {};
      bg = source.bg === "WHITE" || source.bg === "BLACK" ? source.bg : source.fabricData?.background ? toBW(source.fabricData.background) : "BLACK";
      settings = mergeSettings(source.toolSettings);
      holdSpace = holdCtrl = false;
      baseTool = tool = TOOL.SELECT;
      drawing = null;
      clearPolyDraft();
      closeFontPicker();

      resizeStage();
      await loadSource(payload);
      await loadSceneFonts();
      canvas.backgroundColor = hex(bg);
      syncBgIcon();
      applyToolBehavior();
      renderSettings();
      resetHistory();
      canvas.requestRenderAll();
      requestAnimationFrame(() => canvas?.calcOffset());

      ctx.clearDirty?.();
      schedulePreview(10);
    },

    close() {
      paneDraw.hidden = true;
      if (canvas && isTextObj(canvas.getActiveObject())) canvas.getActiveObject().exitEditing?.();
      closeFontPicker();
      hideCursorDot();
      if (toolCtx) toolCtx.innerHTML = "";
    },

    /** Czynność w toku (pisanie napisu, przeciągany kształt, wielokąt) --
     *  autozapis czeka, bo getCreatePayload() by ją przerwał. */
    isInteracting() {
      const active = canvas?.getActiveObject();
      return !!(drawing || polyPoints.length || (isTextObj(active) && active.isEditing));
    },

    async getCreatePayload() {
      // Zakończ rozpoczęte czynności, żeby nie zapisać ich w połowie.
      if (isTextObj(canvas.getActiveObject()) && canvas.getActiveObject().isEditing) canvas.getActiveObject().exitEditing();
      cancelShape();
      clearPolyDraft();

      const fabricData = snapshot();
      bits = await sceneToBits(fabric(), fabricData, worldW, worldH);
      ctx.onPreview?.({ kind: "PIX", bits });
      return {
        ok: true,
        type: TYPE_PIX,
        payload: {
          w: DOT_W,
          h: DOT_H,
          format: PIX_FORMAT,
          bits_b64: packBits(bits),
          source: { mode: "DRAW", fabricData, world: { w: worldW, h: worldH }, bg, toolSettings: settings },
        },
      };
    },
  };
}
