// displays.js
// Moduł renderujący 6 wyświetlacze w SVG na podstawie pozycji z motywu + geometrii

import { DOT_BIG, GAP, Wgrid, Hgrid } from "./display-geometry.js?v=v2026-11-08T21595";

export function createDisplays({ svgGroup, theme }) {
  const NS = "http://www.w3.org/2000/svg";
  const el = (name, attrs = {}) => {
    const n = document.createElementNS(NS, name);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    return n;
  };

  const displaysPos = theme.displays;
  const multiplier = theme.multiplier ?? 1.0;
  const gapCells = 2 * DOT_BIG;

  // Config każdego typu wyświetlacza z GEOMETRY
  const tileConfigs = {
    big:       { tilesX: 30, tilesY: 10, dotSize: DOT_BIG, gap: GAP },
    leftPanel: { tilesX: 3,  tilesY: 1,  dotSize: 3 * DOT_BIG, gap: GAP },
    rightPanel:{ tilesX: 3,  tilesY: 1,  dotSize: 3 * DOT_BIG, gap: GAP },
    topPanel:  { tilesX: 3,  tilesY: 1,  dotSize: 3 * DOT_BIG, gap: GAP },
    long1:     { X: 95, Y: 7, dotSize: 1.5 * DOT_BIG, gap: GAP },
    long2:     { X: 95, Y: 7, dotSize: 1.5 * DOT_BIG, gap: GAP },
  };

  function buildTiledDisplay(pos, cfg) {
    const { cx, cy } = pos;
    const { tilesX, tilesY, dotSize, gap } = cfg;
    const wSmall = Wgrid(5, dotSize, gap);
    const hSmall = Hgrid(7, dotSize, gap);

    const w = (tilesX * wSmall + (tilesX - 1) * gapCells + 2 * gap) * multiplier;
    const h = (tilesY * hSmall + (tilesY - 1) * gapCells + 2 * gap) * multiplier;
    const x = cx - w / 2;
    const y = cy - h / 2;

    const g = el("g");
    g.appendChild(el("rect", { x, y, width: w, height: h, fill: "#000000" }));

    const tiles = Array.from({ length: tilesY }, () =>
      Array.from({ length: tilesX }, () => null)
    );

    const r = (dotSize * multiplier) / 2;
    const stepX = (wSmall + gapCells) * multiplier;
    const stepY = (hSmall + gapCells) * multiplier;
    const pad = gap * multiplier;

    for (let ty = 0; ty < tilesY; ty++) {
      for (let tx = 0; tx < tilesX; tx++) {
        const tileG = el("g");
        const cellX = x + pad + tx * stepX;
        const cellY = y + pad + ty * stepY;

        tileG.appendChild(
          el("rect", { x: cellX, y: cellY, width: wSmall * multiplier, height: hSmall * multiplier, fill: "#000000" })
        );

        const dots = [];
        for (let row = 0; row < 7; row++) {
          const dotsRow = [];
          for (let col = 0; col < 5; col++) {
            const circle = el("circle", {
              cx: cellX + pad + r + col * (dotSize * multiplier + pad),
              cy: cellY + pad + r + row * (dotSize * multiplier + pad),
              r: r, fill: "#2e2e32",
            });
            tileG.appendChild(circle);
            dotsRow.push(circle);
          }
          dots.push(dotsRow);
        }

        g.appendChild(tileG);
        tiles[ty][tx] = { dots };
      }
    }

    svgGroup.appendChild(g);

    return {
      tiles, tilesX, tilesY,
      setDotColor(tx, ty, row, col, color) {
        const t = tiles[ty]?.[tx];
        const c = t?.dots[row]?.[col];
        if (c) c.setAttribute("fill", color);
      },
      clear() {
        for (let ty = 0; ty < tilesY; ty++)
          for (let tx = 0; tx < tilesX; tx++)
            for (let row = 0; row < 7; row++)
              for (let col = 0; col < 5; col++)
                this.setDotColor(tx, ty, row, col, "#2e2e32");
      },
      snapshot() {
        const snap = [];
        for (let ty = 0; ty < tilesY; ty++) {
          const rowSnap = [];
          for (let tx = 0; tx < tilesX; tx++) {
            const t = tiles[ty][tx];
            if (!t) { rowSnap.push(null); continue; }
            rowSnap.push(t.dots.map(r => r.map(c => c.getAttribute("fill"))));
          }
          snap.push(rowSnap);
        }
        return snap;
      },
      restore(snap) {
        if (!snap) return;
        for (let ty = 0; ty < Math.min(snap.length, tilesY); ty++) {
          for (let tx = 0; tx < Math.min(snap[ty].length, tilesX); tx++) {
            const tileData = snap[ty][tx];
            if (!tileData) continue;
            const t = tiles[ty][tx];
            if (!t) continue;
            for (let row = 0; row < 7; row++) {
              for (let col = 0; col < 5; col++) {
                const fill = tileData[row]?.[col];
                if (fill != null) t.dots[row][col].setAttribute("fill", fill);
              }
            }
          }
        }
      },
    };
  }

  function buildDotPanel(pos, cfg) {
    const { cx, cy } = pos;
    const { X, Y, dotSize, gap } = cfg;

    const wInner = Wgrid(X, dotSize, gap) * multiplier;
    const hInner = Hgrid(Y, dotSize, gap) * multiplier;
    const w = wInner + 2 * gap * multiplier;
    const h = hInner + 2 * gap * multiplier;
    const x = cx - w / 2;
    const y = cy - h / 2;

    const g = el("g");
    const dots = Array.from({ length: Y }, () => Array.from({ length: X }, () => null));

    g.appendChild(el("rect", { x, y, width: w, height: h, fill: "#000000" }));
    g.appendChild(
      el("rect", { x: x + gap * multiplier, y: y + gap * multiplier, width: wInner, height: hInner, fill: "#000000" })
    );

    const r = (dotSize * multiplier) / 2;
    const step = dotSize * multiplier + gap * multiplier;
    const pad = gap * multiplier;

    for (let row = 0; row < Y; row++) {
      for (let col = 0; col < X; col++) {
        const circle = el("circle", {
          cx: x + 2 * pad + r + col * step,
          cy: y + 2 * pad + r + row * step,
          r: r, fill: "#2e2e32",
        });
        g.appendChild(circle);
        dots[row][col] = circle;
      }
    }

    svgGroup.appendChild(g);

    return {
      dots, X, Y,
      setDotColor(row, col, color) {
        const c = dots[row]?.[col];
        if (c) c.setAttribute("fill", color);
      },
      clear() {
        for (let row = 0; row < Y; row++)
          for (let col = 0; col < X; col++)
            this.setDotColor(row, col, "#2e2e32");
      },
      snapshot() {
        return dots.map(row => row.map(c => c.getAttribute("fill")));
      },
      restore(snap) {
        if (!snap) return;
        for (let row = 0; row < Math.min(snap.length, Y); row++) {
          for (let col = 0; col < Math.min(snap[row].length, X); col++) {
            const fill = snap[row][col];
            if (fill != null) dots[row][col].setAttribute("fill", fill);
          }
        }
      },
    };
  }

  const big       = buildTiledDisplay(displaysPos.big,       tileConfigs.big);
  const leftPanel = buildTiledDisplay(displaysPos.leftPanel, tileConfigs.leftPanel);
  const rightPanel= buildTiledDisplay(displaysPos.rightPanel, tileConfigs.rightPanel);
  const topPanel  = buildTiledDisplay(displaysPos.topPanel,  tileConfigs.topPanel);
  const long1     = buildDotPanel(displaysPos.long1,         tileConfigs.long1);
  const long2     = buildDotPanel(displaysPos.long2,         tileConfigs.long2);

  const leftTriple  = [leftPanel.tiles[0][0],  leftPanel.tiles[0][1],  leftPanel.tiles[0][2]];
  const rightTriple = [rightPanel.tiles[0][0], rightPanel.tiles[0][1], rightPanel.tiles[0][2]];
  const topTriple   = [topPanel.tiles[0][0],   topPanel.tiles[0][1],   topPanel.tiles[0][2]];

  return { big, left: leftPanel, right: rightPanel, top: topPanel, long1, long2, leftTriple, rightTriple, topTriple };
}
