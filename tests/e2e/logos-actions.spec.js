// tests/e2e/logos-actions.spec.js
//
// Czynności z podręcznika, rozdział 8 (Logo), których nie sprawdzał
// logo-editor.spec.js: klawisze dozwolonych znaków i licznik szerokości, skróty
// narzędzi rysunku (V H B E S T, spacja, Ctrl), [ i ], powiększenie z klawiatury,
// Shift przy kształtach, [Wyczyść] z Anuluj, Ctrl+Shift+Z, [Podgląd] rysunku
// i usuwanie logo z Anuluj — wraz z wariantem „źle”: skróty w czasie pisania,
// odmowa potwierdzenia, granice zakresów.
//
// Strony z kodu brancha (serveBranchCode), baza i konto produkcyjne.
// Lokalnie: scripts/agent-tools/local-e2e/run.sh e2e/logos-actions.spec.js
// (bez Storage — testy nie wgrywają obrazów).
const { test, expect } = require("./helpers/e2e-test");
const { serveBranchCode } = require("./helpers/branch-code");
const L = require("./helpers/logo-editor");

const ORIGIN = "https://www.familijna.app";
const SITE = { origin: ORIGIN };

test.use({ serviceWorkers: "block", viewport: { width: 1400, height: 900 }, needs: { standard: 1 } });

test.beforeEach(async ({ page, context, accounts, loginAs }) => {
  if (process.env.TEST_BRANCH_CODE !== "0") await serveBranchCode(context, { pages: ["logos"] });
  await loginAs(page, context, accounts.standard[0]);
  await L.openList(page, SITE);
});
test.afterEach(async ({ page }) => { await L.cleanup(page); });

const pressed = (page, id) => page.locator(`#${id}`).getAttribute("aria-pressed");
const liveObjects = (page) => page.evaluate(() => window.__drawFabric.getObjects().map((o) => ({
  type: o.type, width: o.width, height: o.height, rx: o.rx, ry: o.ry, line: o._line || null, text: o.text ?? null,
})));
const zoom = (page) => page.evaluate(() => window.__drawFabric.getZoom());

/* ======================= TEKST ======================= */

test("Tekst: klawisze dozwolonych znaków zawsze widoczne i wstawiają znak w miejscu kursora, licznik „Szerokość: …/30” rośnie, za szeroki napis — ostrzeżenie", async ({ page }) => {
  await L.createNew(page, "Text", L.uniq("chars"));
  const list = page.locator("#charsList");
  await expect(list).toBeVisible();
  await expect(list.locator(".charKey.is-space")).toHaveText("Spacja");
  await expect(list.locator('.charKey[data-char="A"]')).toBeVisible();
  await expect(page.locator("#btnCharsToggle")).toHaveCount(0);
  // klawisze w kolumnie obok podglądu mieszczą się bez przewijania
  expect(await list.evaluate((el) => el.scrollHeight <= el.clientHeight + 1)).toBe(true);
  // wstawianie w miejscu kursora: „AC” + kursor po A + klawisz B → „ABC”, kursor zostaje w polu
  await page.fill("#textValue", "AC");
  await page.locator("#textValue").evaluate((el) => el.setSelectionRange(1, 1));
  await list.locator('.charKey[data-char="B"]').click();
  await expect(page.locator("#textValue")).toHaveValue("ABC");
  await expect(page.locator("#textValue")).toBeFocused();
  await list.locator(".charKey.is-space").click();
  await expect(page.locator("#textValue")).toHaveValue("AB C");

  await page.fill("#textValue", "");
  const width = async () => Number((await page.locator("#textMeasure").textContent()).match(/(\d+)\/30/)[1]);
  await expect(page.locator("#textMeasure")).toHaveText("Szerokość: 0/30.");
  await page.fill("#textValue", "AB");
  const w2 = await width();
  expect(w2).toBeGreaterThan(0);
  await page.fill("#textValue", "ABCD");
  expect(await width()).toBeGreaterThan(w2);
  await expect(page.locator("#textWarn")).toBeHidden();
  await page.fill("#textValue", "FAMILIJNA FAMILIJNA FAMILIJNA");
  expect(await width()).toBeGreaterThan(30);
  await expect(page.locator("#textWarn")).toContainText("Napis się nie mieści — skróć go.");
});

/* ======================= RYSUNEK ======================= */

test("Rysunek: V H B E S T włączają narzędzie; przytrzymana spacja — Rączka, przytrzymany Ctrl — Wskaźnik", async ({ page }) => {
  await L.createNew(page, "Draw", L.uniq("tools"));
  const tools = { v: "tSelect", h: "tPan", b: "tBrush", e: "tEraser", s: "tShapes", t: "tText" };
  for (const [key, id] of Object.entries(tools)) {
    await page.keyboard.press(key);
    for (const other of Object.values(tools)) expect(await pressed(page, other), `${key} → ${other}`).toBe(other === id ? "true" : "false");
  }
  await page.keyboard.press("b");
  await page.keyboard.down(" ");
  await expect.poll(() => pressed(page, "tPan")).toBe("true");
  await page.keyboard.up(" ");
  await expect.poll(() => pressed(page, "tBrush")).toBe("true");
  await page.keyboard.down("Control");
  await expect.poll(() => pressed(page, "tSelect")).toBe("true");
  await page.keyboard.up("Control");
  await expect.poll(() => pressed(page, "tBrush")).toBe("true");
});

test("Rysunek: skróty nie działają podczas wpisywania — w polu nazwy ani w tekście na scenie", async ({ page }) => {
  await L.createNew(page, "Draw", L.uniq("typing"));
  await page.keyboard.press("r");
  const b = await L.stage(page);
  await L.drag(page, b.x + 100, b.y + 100, b.x + 300, b.y + 250);
  expect(await liveObjects(page)).toHaveLength(1);

  // pole nazwy: litery-skróty i Ctrl+Z należą do pola
  await page.locator("#logoName").click();
  await page.keyboard.press("End");
  await page.keyboard.type("vb");
  await page.keyboard.press("Control+z");
  await page.keyboard.press("Delete");
  expect(await pressed(page, "tShapes")).toBe("true");
  expect(await liveObjects(page)).toHaveLength(1);
  await page.locator("#logoName").blur();

  // tekst na scenie: litery trafiają do napisu, narzędzie się nie zmienia
  await page.locator("#tText").click();
  await page.mouse.click(b.x + b.width * 0.5, b.y + b.height * 0.7);
  await page.keyboard.type("vhb");
  expect(await pressed(page, "tText")).toBe("true");
  await page.keyboard.press("Escape");
  const objs = await liveObjects(page);
  expect(objs).toHaveLength(2);
  expect(objs[1].text).toContain("vhb");
});

test("Rysunek: [ i ] zmieniają grubość linii i gumki tylko w zakresie pola (5–100)", async ({ page }) => {
  await L.createNew(page, "Draw", L.uniq("brackets"));
  await page.keyboard.press("b");
  await expect(page.locator("#cStrokeW")).toHaveValue("6");
  await page.keyboard.press("]");
  await expect(page.locator("#cStrokeW")).toHaveValue("7");
  for (let i = 0; i < 10; i++) await page.keyboard.press("[");
  await expect(page.locator("#cStrokeW"), "poniżej 5 kreska znika z Wyświetlacza").toHaveValue("5");
  for (let i = 0; i < 120; i++) await page.keyboard.press("]");
  await expect(page.locator("#cStrokeW")).toHaveValue("100");
  // pędzel naprawdę rysuje tą grubością
  const b = await L.stage(page);
  await L.drag(page, b.x + 100, b.y + 150, b.x + 400, b.y + 160);
  expect(await page.evaluate(() => window.__drawFabric.getObjects()[0].strokeWidth)).toBe(100);

  await page.keyboard.press("e");
  await expect(page.locator("#cEraser")).toHaveValue("10");
  for (let i = 0; i < 10; i++) await page.keyboard.press("[");
  await expect(page.locator("#cEraser")).toHaveValue("5");
});

test("Rysunek: Ctrl+plus i Ctrl+minus powiększają i pomniejszają, Ctrl+0 wraca do 100%; poniżej 100% się nie da", async ({ page }) => {
  await L.createNew(page, "Draw", L.uniq("zoomkeys"));
  const z0 = await zoom(page);
  await expect(page.locator("#tZoomOut")).toBeDisabled();
  await page.keyboard.press("Control+-");
  expect(await zoom(page)).toBeCloseTo(z0, 5);
  await page.keyboard.press("Control+=");
  await page.keyboard.press("Control+=");
  const z2 = await zoom(page);
  expect(z2).toBeGreaterThan(z0 * 1.2);
  await expect(page.locator("#tZoomOut")).toBeEnabled();
  await page.keyboard.press("Control+-");
  const z1 = await zoom(page);
  expect(z1).toBeLessThan(z2);
  expect(z1).toBeGreaterThan(z0);
  await page.keyboard.press("Control+0");
  expect(await zoom(page)).toBeCloseTo(z0, 5);
  await expect(page.locator("#tZoomOut")).toBeDisabled();
});

test("Rysunek: L, O, P i U wybierają kształt; z Shift prostokąt jest kwadratem, elipsa kołem, a linia idzie co 15°", async ({ page }) => {
  await L.createNew(page, "Draw", L.uniq("shift"));
  const shapeLabel = () => page.locator("#cShape .ui-select-label").textContent();
  await page.keyboard.press("l");
  const lineLabel = await shapeLabel();
  await page.keyboard.press("u");
  const nextLabel = await shapeLabel();
  expect(nextLabel).not.toBe(lineLabel);
  await page.keyboard.press("p");
  expect(await shapeLabel()).not.toBe(nextLabel);

  const b = await L.stage(page);
  await page.keyboard.press("r");
  await page.keyboard.down("Shift");
  await L.drag(page, b.x + 60, b.y + 60, b.x + 260, b.y + 140);
  await page.keyboard.up("Shift");
  await page.keyboard.press("o");
  await page.keyboard.down("Shift");
  await L.drag(page, b.x + 400, b.y + 60, b.x + 640, b.y + 120);
  await page.keyboard.up("Shift");
  await page.keyboard.press("l");
  await page.keyboard.down("Shift");
  await L.drag(page, b.x + 100, b.y + 300, b.x + 400, b.y + 370);
  await page.keyboard.up("Shift");

  const [rect, ellipse, line] = await liveObjects(page);
  expect(rect.type).toBe("rect");
  expect(rect.width).toBeCloseTo(rect.height, 0);
  expect(ellipse.type).toBe("ellipse");
  expect(ellipse.rx).toBeCloseTo(ellipse.ry, 0);
  const deg = Math.atan2(line.line.y2 - line.line.y1, line.line.x2 - line.line.x1) * 180 / Math.PI;
  expect(Math.abs(deg % 15) < 0.5 || Math.abs(deg % 15) > 14.5, `kąt ${deg}`).toBe(true);
  expect(Math.abs(deg)).toBeGreaterThan(1); // ukośna, nie spłaszczona do poziomu

  // bez Shift: prostokąt zostaje prostokątem
  await page.keyboard.press("r");
  await L.drag(page, b.x + 700, b.y + 60, b.x + 900, b.y + 120);
  const free = (await liveObjects(page))[3];
  expect(Math.abs(free.width - free.height)).toBeGreaterThan(20);
});

test("Rysunek: [Wyczyść] — Anuluj zostawia rysunek, potwierdzenie usuwa wszystko; Ctrl+Shift+Z ponawia jak Ctrl+Y", async ({ page }) => {
  const name = L.uniq("clear");
  await L.createNew(page, "Draw", name);
  await page.keyboard.press("r");
  const b = await L.stage(page);
  await L.drag(page, b.x + 100, b.y + 100, b.x + 300, b.y + 250);
  await L.drag(page, b.x + 500, b.y + 100, b.x + 700, b.y + 250);

  await page.locator("#tClear").click();
  await expect(page.locator(".uni-modal")).toContainText("Usunąć wszystko ze sceny?");
  await page.locator(".uni-modal .uni-foot .btn:not(.gold)").click();
  await expect(page.locator(".uni-modal")).toHaveCount(0);
  expect(await liveObjects(page)).toHaveLength(2);
  expect(await L.save(page)).toBe("saved");
  expect((await L.readLogoByName(page, name)).payload.source.fabricData.objects).toHaveLength(2);

  await page.locator("#tClear").click();
  await page.locator(".uni-modal .uni-foot .btn.gold").click();
  expect(await liveObjects(page)).toHaveLength(0);
  expect(await L.save(page)).toBe("saved");
  expect((await L.readLogoByName(page, name)).payload.source.fabricData.objects).toHaveLength(0);

  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await liveObjects(page)).length).toBe(2);
  await page.keyboard.press("Control+Shift+z");
  await expect.poll(async () => (await liveObjects(page)).length).toBe(0);
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await liveObjects(page)).length).toBe(2);
  expect(await L.save(page)).toBe("saved");
  expect((await L.readLogoByName(page, name)).payload.source.fabricData.objects).toHaveLength(2);
});

test("Rysunek: [Podgląd] pokazuje rysunek tak, jak na Wyświetlaczu, i się zamyka", async ({ page }) => {
  await L.createNew(page, "Draw", L.uniq("preview"));
  await page.keyboard.press("r");
  await page.keyboard.press("f");
  const b = await L.stage(page);
  await L.drag(page, b.x + 100, b.y + 100, b.x + 400, b.y + 300);
  await page.locator("#tEye").click();
  await expect(page.locator("#previewOverlay")).toBeVisible();
  // podgląd to kropki: na płótnie podglądu są jasne piksele (rysowane
  // asynchronicznie po otwarciu okna -- czekamy, aż się pojawią)
  const countLit = () => page.locator("#bigPreviewFull").evaluate((el) => {
    const c = el.tagName === "CANVAS" ? el : el.querySelector("canvas");
    if (!c) return -1;
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] > 150) n++;
    return n;
  });
  await expect.poll(countLit, { timeout: 10_000 }).toBeGreaterThan(0);
  await page.locator("#btnPreviewClose").click();
  await expect(page.locator("#previewOverlay")).toBeHidden();
});

/* ======================= LISTA ======================= */

test("Lista: usuwanie logo — Anuluj zostawia logo w bazie i na liście", async ({ page }) => {
  const name = L.uniq("keep");
  const id = await L.insertLogo(page, { name, type: "GLYPH_30x10", payload: L.textPayload() });
  await L.openList(page, SITE);
  await page.locator(`.logoTile[data-key="${id}"] .x`).click();
  await expect(page.locator(".uni-modal")).toContainText(name);
  await page.locator(".uni-modal .uni-foot .btn:not(.gold)").click();
  await expect(page.locator(".uni-modal")).toHaveCount(0);
  await expect(page.locator(`.logoTile[data-key="${id}"]`)).toBeVisible();
  expect(await L.readLogo(page, id)).not.toBeNull();
});

test("Lista: nazwa logo do 80 znaków — dłuższa ucięta w oknie, a zapis z pominięciem strony odrzucony", async ({ page }) => {
  const id = await L.insertLogo(page, { name: L.uniq("long"), type: "GLYPH_30x10", payload: L.textPayload() });
  await L.openList(page, SITE);
  await page.locator(`.logoTile[data-key="${id}"] .logoName`).dblclick();
  const long = `${L.PREFIX}${"x".repeat(120)}`;
  await page.fill(".uni-modal .uni-inp", long);
  await expect(page.locator(".uni-modal .uni-inp")).toHaveValue(long.slice(0, 80));
  await page.locator(".uni-modal .uni-foot .btn.gold").click();
  await expect(page.locator(".uni-modal")).toHaveCount(0);
  expect((await L.readLogo(page, id)).name).toBe(long.slice(0, 80));

  const err = await page.evaluate(async ({ id, name }) => {
    const { error } = await window.__sbClient.from("user_logos").update({ name }).eq("id", id);
    return error?.message || null;
  }, { id, name: `${L.PREFIX}${"y".repeat(500)}` });
  expect(err, "serwer odrzuca nazwę dłuższą niż 80 znaków").toContain("name_too_long");
  expect((await L.readLogo(page, id)).name).toBe(long.slice(0, 80));
});
