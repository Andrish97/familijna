// tests/e2e/logo-editor.spec.js
//
// Testy logo: lista /logos/ i trzy strony edytorów /logos/editor/<tryb>/?id=
// (zmiany zapisują się same -- L.save czeka na autozapis). Strony są serwowane
// z BIEŻĄCEGO CHECKOUTU przez lokalny serwer w runnerze (helpers/local-site.js),
// a nie z www.familijna.app -- testują kod z gałęzi, na prawdziwym
// backendzie (baza, RPC, blokady, Storage), bez wdrażania na produkcję.
//
// Testy idą równolegle; każdy worker wypożycza WŁASNE konto (E25,
// helpers/e2e-test.js, czyszczone przy wypożyczeniu), więc blokady, lista
// i sprzątanie jednego testu nie wpływają na inne.
// Logowanie raz na workera (captureSession). Każdy test
// sprząta swoje logo i pliki (prefiks).
//
// Sprawdzamy WYNIK w bazie (payload, bity, które widzi wyświetlacz), nie
// tylko to, co widać na stronie. Odnośniki P0-x/P1-x -> familijna-server/docs/audyt-logo-editor.md.

const path = require("path");
const fs = require("fs");
const { test, expect } = require("./helpers/e2e-test");
const { startLocalSite, captureSession, useSession } = require("./helpers/local-site");
const L = require("./helpers/logo-editor");

const DEMO_IMAGE = path.resolve(__dirname, "../fixtures/demo-image.png");
const OTHER_IMAGE = path.resolve(__dirname, "../../web/assets/img/icon-512.png");

test.use({ viewport: { width: 1440, height: 900 }, serviceWorkers: "block" });
test.describe.configure({ mode: "parallel" });
test.use({ needs: { standard: 1 } });

let site;
let session;
test.beforeAll(async ({ browser, accounts }) => {
  site = await startLocalSite();
  session = await captureSession(browser, accounts.standard[0].email);
});
test.afterAll(async () => { await site?.close(); });
test.beforeEach(async ({ context }) => { await useSession(context, site.origin, session); });
test.afterEach(async ({ page }) => { await L.cleanup(page); });

const open = (page) => L.openList(page, site);
const edit = (page, id) => L.editLogo(page, site, id);

async function pickShape(page, shape) {
  await page.keyboard.press("s");
  await page.locator("#cShape .ui-select-btn").click();
  await page.locator(`#cShape .menu-item[data-value="${shape}"]`).click();
}

/* ======================= LISTA, NAZWY, IMPORT, EKSPORT ======================= */

test.describe("lista", () => {
  test("zakładki typów zapisują kartę w URL (bez wpisów historii), hint i skrajne wypustki", async ({ page }) => {
    await open(page);
    const historyBefore = await page.evaluate(() => history.length);
    await expect(page.locator("#tabLogoText")).toHaveClass(/active/);
    // Pasek mówi tylko o zmianie nazwy -- opis rodzaju jest na kaflu „Nowe logo…” (bez dublowania, 2026-10-23).
    await expect(page.locator("#hint")).toContainText(/Podwójne naciśnięcie kafla/i);
    // Narożniki aktywnej wypustki to ::before/::after przycisku karty (2026-10-21).
    const corner = (sel, pseudo) => page.locator(sel).evaluate((el, p) => getComputedStyle(el, p).display, pseudo);
    expect(await corner("#tabLogoText", "::before")).toBe("none");

    await page.locator("#tabLogoDraw").click();
    await expect(page).toHaveURL(/tab=draw/);
    await expect(page.locator("#hint")).toContainText(/Podwójne naciśnięcie kafla/i);
    await expect.poll(() => corner("#tabLogoDraw", "::before")).toBe("block");
    expect(await corner("#tabLogoDraw", "::after")).toBe("block");

    await page.locator("#tabLogoImage").click();
    await expect(page).toHaveURL(/tab=image/);
    await expect(page.locator("#hint")).toContainText(/Podwójne naciśnięcie kafla/i);
    await expect.poll(() => corner("#tabLogoImage", "::after")).toBe("none");

    // Karta przez replaceState: odświeżenie zostaje na karcie, a przeglądarkowe
    // „Wstecz” nie przełącza kart, tylko wychodzi ze strony.
    expect(await page.evaluate(() => history.length)).toBe(historyBefore);
    await page.reload();
    await expect(page.locator("#tabLogoImage")).toHaveClass(/active/);
  });

  test("logo z bazy widoczne na liście z miniaturą", async ({ page }) => {
    await open(page);
    const id = await L.insertLogo(page, { name: L.uniq("smoke"), type: "GLYPH_30x10", payload: L.textPayload() });
    await open(page);
    await expect(page.locator(`.logoTile[data-key="${id}"]`)).toBeVisible();
    await expect(page.locator(`.logoTile[data-key="${id}"] canvas`)).toBeVisible();
  });

  test("P1-11: pusta nazwa nie blokuje na stałe przycisku Zapisz w zmianie nazwy", async ({ page }) => {
    await open(page);
    const id = await L.insertLogo(page, { name: L.uniq("rename"), type: "GLYPH_30x10", payload: L.textPayload() });
    await open(page);
    await page.locator(`.logoTile[data-key="${id}"] .logoName`).dblclick();
    await page.fill(".uni-modal .uni-inp", "");
    await page.locator(".uni-modal .uni-foot .btn.gold").click();
    await expect(page.locator(".uni-modal .uni-foot .importMsg")).not.toBeEmpty();
    const newName = L.uniq("renamed");
    await page.fill(".uni-modal .uni-inp", newName);
    await page.locator(".uni-modal .uni-foot .btn.gold").click();
    await expect(page.locator(".uni-modal")).toBeHidden();
    expect((await L.readLogo(page, id)).name).toBe(newName);
  });

  test("zmiana nazwy na zajętą dopina numer (bez błędu bazy)", async ({ page }) => {
    await open(page);
    const taken = L.uniq("taken");
    await L.insertLogo(page, { name: taken, type: "GLYPH_30x10", payload: L.textPayload() });
    const id = await L.insertLogo(page, { name: L.uniq("other"), type: "GLYPH_30x10", payload: L.textPayload() });
    await open(page);
    await page.locator(`.logoTile[data-key="${id}"] .logoName`).dblclick();
    await page.fill(".uni-modal .uni-inp", taken);
    await page.locator(".uni-modal .uni-foot .btn.gold").click();
    await expect(page.locator(".uni-modal")).toBeHidden();
    expect((await L.readLogo(page, id)).name).toBe(`${taken} (2)`);
  });

  test("nowe logo o zajętej nazwie zapisuje się z numerem", async ({ page }) => {
    await open(page);
    const taken = L.uniq("dupname");
    await L.insertLogo(page, { name: taken, type: "GLYPH_30x10", payload: L.textPayload() });
    await open(page);
    await L.createNew(page, "Text", taken);
    await expect(page.locator("#logoName")).toHaveValue(`${taken} (2)`);
    await page.fill("#textValue", "AB");
    expect(await L.save(page)).toBe("saved");
    expect(await L.readLogoByName(page, `${taken} (2)`)).not.toBeNull();
  });

  test("usuwanie: wiersz znika z bazy i z listy", async ({ page }) => {
    await open(page);
    const name = L.uniq("del");
    const id = await L.insertLogo(page, { name, type: "GLYPH_30x10", payload: L.textPayload() });
    await open(page);
    await page.locator(`.logoTile[data-key="${id}"] .x`).click();
    await page.locator(".uni-modal .uni-foot .btn.gold").click();
    await expect(page.locator(`.logoTile[data-key="${id}"]`)).toHaveCount(0);
    expect(await L.readLogo(page, id)).toBeNull();
  });

  test("podgląd na pełnym ekranie otwiera się i zamyka", async ({ page }) => {
    await open(page);
    const id = await L.insertLogo(page, { name: L.uniq("prev"), type: "GLYPH_30x10", payload: L.textPayload() });
    await open(page);
    await page.locator(`.logoTile[data-key="${id}"]`).click();
    await page.locator("#btnPreview").click();
    await expect(page.locator("#previewOverlay")).toBeVisible();
    await page.locator("#btnPreviewClose").click();
    await expect(page.locator("#previewOverlay")).toBeHidden();
  });

  test("nowe logo powstaje w bazie od razu (id w adresie edytora); Wstecz wraca na listę z kartą", async ({ page }) => {
    await open(page);
    const name = L.uniq("new");
    const id = await L.createNew(page, "Draw", name);
    const row = await L.readLogoByName(page, name);
    expect(row.id).toBe(id);
    expect(row.payload.source.mode).toBe("DRAW");
    expect(new URL(page.url()).searchParams.get("ret")).toBe("/logos/?tab=draw");
    await expect(page.locator("#saveStatus")).toHaveAttribute("data-state", "idle");
    await L.close(page);
    await expect(page.locator("#tabLogoDraw")).toHaveClass(/active/);
    await expect(page.locator(`.logoTile[data-key="${id}"]`)).toBeVisible();
  });

  test("zmiany zapisują się same; po zamknięciu i ponownym wejściu na adres edytora praca jest na miejscu", async ({ page }) => {
    await open(page);
    const name = L.uniq("autosave");
    const id = await L.createNew(page, "Text", name);
    const editorUrl = page.url();
    await page.fill("#textValue", "AUTO");
    await expect(page.locator("#saveStatus")).toHaveAttribute("data-state", "saved", { timeout: 15000 });
    expect((await L.readLogo(page, id)).payload.source.text).toBe("AUTO");
    // Zmiana tuż przed wyjściem: „Wstecz” zapisuje od razu, bez pytania.
    await page.fill("#textValue", "AUTO2");
    await L.close(page);
    expect((await L.readLogo(page, id)).payload.source.text).toBe("AUTO2");
    await page.goto(editorUrl);
    await expect(page.locator("#logoName")).toBeEnabled({ timeout: 15000 });
    await expect(page.locator("#textValue")).toHaveValue("AUTO2");
  });

  test("edytor bez id albo z logo innego typu pokazuje blokadę z powrotem na listę", async ({ page }) => {
    await open(page);
    const id = await L.insertLogo(page, { name: L.uniq("wrongtype"), type: "GLYPH_30x10", payload: L.textPayload("AB") });
    await page.goto(`${site.origin}/logos/editor/draw/?id=${id}`);
    await expect(page.locator("#resourceLockGuard")).toBeVisible({ timeout: 15000 });
    await expect(page.locator("#logoName")).toBeDisabled();
    await page.goto(`${site.origin}/logos/editor/text/`);
    await expect(page.locator("#resourceLockGuard")).toBeVisible({ timeout: 15000 });
    await page.locator("#resourceLockGuardBack").click();
    await page.waitForURL(/\/logos\/(\?|$)/);
  });
});

test.describe("import / eksport", () => {
  async function exportFile(page, id) {
    const row = await L.readLogo(page, id);
    const sourceMode = String(row?.payload?.source?.mode || "").toUpperCase();
    const tab = row?.type === "GLYPH_30x10" ? "" : sourceMode === "IMAGE" ? "?tab=image" : "?tab=draw";
    await L.openList(page, site, `/logos/${tab}`);
    await page.locator(`.logoTile[data-key="${id}"]`).click();
    const [dl] = await Promise.all([page.waitForEvent("download"), page.locator("#btnExport").click()]);
    await expect(page.locator(".uni-modal:has(.uni-progress)")).toBeVisible();
    await expect(page.locator(".uni-modal:has(.uni-progress) .uni-foot .btn.gold")).toBeVisible();
    await expect(page.locator(".uni-progress-msg")).toContainText(/pobrany|downloaded|завантажено/i);
    await page.locator(".uni-modal:has(.uni-progress) .uni-foot .btn.gold").click();
    await expect(page.locator(".uni-modal:has(.uni-progress)")).toBeHidden();
    return { name: dl.suggestedFilename(), path: await dl.path() };
  }

  async function importFile(page, file) {
    await page.locator("#btnImport").click();
    await page.setInputFiles("#inpImportLogoFile", file);
    await expect(page.locator("#btnLogoImportConfirm")).toBeEnabled();
    await page.locator("#btnLogoImportConfirm").click();
    await expect(page.locator("#logoImportOverlay")).toBeVisible({ timeout: 15000 });
    await expect(page.locator("#btnLogoImportDone")).toBeVisible();
    await expect(page.locator("#logoImportErr")).toContainText(/Zaimportowano|Imported|Імпортовано/i);
    await page.locator("#btnLogoImportDone").click();
    await expect(page.locator("#logoImportOverlay")).toBeHidden();
  }

  test("P1-14: nazwa pliku eksportu zachowuje polskie litery", async ({ page }) => {
    await open(page);
    const name = `${L.PREFIX}Żółw łąka ${Date.now()}`;
    const id = await L.insertLogo(page, { name, type: "GLYPH_30x10", payload: L.textPayload() });
    const f = await exportFile(page, id);
    expect(f.name).toBe(`${name}.famlogo`);
    expect(JSON.parse(fs.readFileSync(f.path, "utf8")).kind).toBe("GLYPH");
  });

  test("E20: błąd eksportu Logo zostaje do ręcznego zamknięcia i ponowienia", async ({ page }) => {
    await open(page);
    const id = await L.insertLogo(page, { name: L.uniq("export-retry"), type: "GLYPH_30x10", payload: L.textPayload() });
    await open(page);
    await page.locator(`.logoTile[data-key="${id}"]`).click();
    await page.route("**/rest/v1/user_logos**", (route) => {
      const req = route.request();
      const url = new URL(req.url());
      if (req.method() === "GET" && url.searchParams.get("id") === `eq.${id}`) {
        return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ code: "E20_TEST", message: "E20 controlled export error" }) });
      }
      return route.continue();
    });
    await page.locator("#btnExport").click();
    await expect(page.locator(".uni-modal:has(.uni-progress)")).toBeVisible();
    await expect(page.locator(".uni-progress-msg")).toContainText("E20 controlled export error");
    await expect(page.locator(".uni-modal:has(.uni-progress) .uni-foot .btn.gold")).toBeVisible();
    await page.waitForTimeout(1200);
    await expect(page.locator(".uni-modal:has(.uni-progress)")).toBeVisible();
    await page.locator(".uni-modal:has(.uni-progress) .uni-foot .btn.gold").click();
    await expect(page.locator(".uni-modal:has(.uni-progress)")).toBeHidden();

    await page.unroute("**/rest/v1/user_logos**");
    const [download] = await Promise.all([page.waitForEvent("download"), page.locator("#btnExport").click()]);
    expect(download.suggestedFilename()).toContain("export-retry");
    await expect(page.locator(".uni-modal:has(.uni-progress) .uni-foot .btn.gold")).toBeVisible();
    await page.locator(".uni-modal:has(.uni-progress) .uni-foot .btn.gold").click();
  });

  test("eksport -> import rysunku: nowe logo z tymi samymi bitami i sceną", async ({ page }) => {
    await open(page);
    const fabricData = { version: "5.3.0", objects: [L.rect(100, 100, 300, 200)], background: "#000000" };
    const bits = Buffer.alloc(19 * 70, 0); bits[500] = 0xff;
    const name = L.uniq("rt-draw");
    const id = await L.insertLogo(page, { name, type: "PIX_150x70", payload: { ...L.emptyPix, bits_b64: bits.toString("base64"), source: { mode: "DRAW", fabricData, world: { w: 1040, h: 440 } } } });
    const f = await exportFile(page, id);
    await L.cleanup(page); // oryginał znika -- import ma odtworzyć go z pliku
    await open(page);
    await importFile(page, f.path);
    const back = await L.readLogoByName(page, name);
    expect(back.type).toBe("PIX_150x70");
    expect(back.payload.bits_b64).toBe(bits.toString("base64"));
    expect(back.payload.source.fabricData.objects[0].width).toBe(300);
  });

  test("eksport -> import obrazu: obraz osadzony w pliku, po imporcie da się go edytować", async ({ page }) => {
    await open(page);
    const name = L.uniq("rt-image");
    await L.createNew(page, "Image", name);
    await page.setInputFiles("#imgFile", DEMO_IMAGE);
    await expect(page.locator("#cropFrame")).toBeVisible();
    expect(await L.save(page)).toBe("saved");
    const orig = await L.readLogoByName(page, name);
    await L.close(page);

    const f = await exportFile(page, orig.id);
    const file = JSON.parse(fs.readFileSync(f.path, "utf8"));
    expect(file.payload.source.imageData).toMatch(/^data:image\//);
    await L.cleanup(page);

    await open(page);
    await importFile(page, f.path);
    const back = await L.readLogoByName(page, name);
    expect(back.payload.bits_b64).toBe(orig.payload.bits_b64);
    await edit(page, back.id);
    await expect(page.locator("#cropFrame")).toBeVisible({ timeout: 15000 });
    expect(await L.save(page)).toBe("saved");
  });

  test("import pliku, który nie jest logo, pokazuje błąd i nic nie zapisuje", async ({ page }) => {
    await open(page);
    await page.locator("#btnImport").click();
    await page.setInputFiles("#inpImportLogoFile", { name: "x.famlogo", mimeType: "application/json", buffer: Buffer.from('{"hello":1}') });
    await expect(page.locator("#logoImportErr")).toBeVisible();
    await expect(page.locator("#btnLogoImportConfirm")).toBeDisabled();
  });
});

/* ======================= TEKST ======================= */

test.describe("tryb Tekst", () => {
  test("zapis i ponowne otwarcie przywraca napis", async ({ page }) => {
    const errors = L.collectPageErrors(page);
    await open(page);
    const name = L.uniq("text");
    await L.createNew(page, "Text", name);
    await page.fill("#textValue", "FAMILIJNA");
    await expect(page.locator("#textMeasure")).toContainText("/30");
    expect(await L.save(page)).toBe("saved");
    const row = await L.readLogoByName(page, name);
    expect(row.payload.source.text).toBe("FAMILIJNA");
    expect(row.payload.layers[0].rows.join("").trim().length).toBeGreaterThan(0);
    await L.close(page);
    await edit(page, row.id);
    await expect(page.locator("#textValue")).toHaveValue("FAMILIJNA");
    expect(errors).toEqual([]);
  });

  test("niedozwolone znaki: ostrzeżenie widoczne, zapis odrzucony", async ({ page }) => {
    await open(page);
    const name = L.uniq("badchars");
    await L.createNew(page, "Text", name);
    await page.fill("#textValue", "AB~{}");
    await expect(page.locator("#textWarn")).toBeVisible();
    expect(await L.save(page)).not.toBe("saved");
    // Wiersz jest od „Nowe logo”; niedozwolony stan się nie zapisał.
    expect((await L.readLogoByName(page, name)).payload.source.text).toBe("");
  });

  test("za długi napis: zapis odrzucony", async ({ page }) => {
    await open(page);
    const name = L.uniq("toolong");
    await L.createNew(page, "Text", name);
    await page.fill("#textValue", "FAMILIJNA FAMILIJNA FAMILIJNA");
    await expect(page.locator("#textWarn")).toBeVisible();
    expect(await L.save(page)).not.toBe("saved");
    // Wiersz jest od „Nowe logo”; niedozwolony stan się nie zapisał.
    expect((await L.readLogoByName(page, name)).payload.source.text).toBe("");
  });

  test("P0-4: napis odtwarzany z wierszy, gdy logo nie ma zapisanego tekstu", async ({ page }) => {
    await open(page);
    // wiersze wygenerowane przez edytor dla "AB 12" -- zapisane bez source.text
    const name = L.uniq("rows");
    await L.createNew(page, "Text", name);
    await page.fill("#textValue", "AB  12");
    expect(await L.save(page)).toBe("saved");
    const saved = await L.readLogoByName(page, name);
    const id = await L.insertLogo(page, { name: L.uniq("rows-only"), type: "GLYPH_30x10", payload: { layers: [{ rows: saved.payload.layers[0].rows }], source: { mode: "TEXT" } } });
    await edit(page, id);
    await expect(page.locator("#textValue")).toHaveValue("AB  12");
    expect(await L.save(page)).toBe("saved");
    expect((await L.readLogo(page, id)).payload.layers[0].rows).toEqual(saved.payload.layers[0].rows);
  });

  test("P0-4: wiersze, których nie da się odczytać jako napis -> edycja zablokowana, logo nietknięte", async ({ page }) => {
    await open(page);
    const rows = Array.from({ length: 10 }, (_, i) => (i === 3 ? "  ~~~~~ ~".padEnd(30) : " ".repeat(30)));
    const id = await L.insertLogo(page, { name: L.uniq("oldtext"), type: "GLYPH_30x10", payload: { layers: [{ rows }], source: { mode: "TEXT" } } });
    await edit(page, id);
    await expect(page.locator(".uni-modal")).toBeVisible();
    await expect(page.locator("#editorShell")).toBeHidden();
    expect((await L.readLogo(page, id)).payload.layers[0].rows[3]).toContain("~~~~~");
  });
});

/* ======================= RYSUNEK ======================= */

test.describe("tryb Rysunek", () => {
  test("P0-3: zapis w stałym świecie bez editHistory; po otwarciu w innym oknie bity bez zmian", async ({ page }) => {
    const errors = L.collectPageErrors(page);
    await open(page);
    const name = L.uniq("brush");
    await L.createNew(page, "Draw", name);
    await page.keyboard.press("b");
    const b = await L.stage(page);
    await L.drag(page, b.x + b.width * 0.2, b.y + b.height * 0.43, b.x + b.width * 0.8, b.y + b.height * 0.43);
    expect(await L.isDirty(page)).toBe(true);
    expect(await L.save(page)).toBe("saved");
    const row = await L.readLogoByName(page, name);
    expect(row.payload.source.editHistory).toBeUndefined();
    expect(row.payload.source.world).toEqual({ w: 1040, h: 440 });
    expect(L.litCount(row.payload.bits_b64)).toBeGreaterThan(50);

    await L.close(page);
    await page.setViewportSize({ width: 1100, height: 800 });
    await edit(page, row.id);
    await expect(page.locator("#paneDraw")).toBeVisible();
    await page.waitForTimeout(800);
    expect(await L.isDirty(page)).toBe(false); // bez zmian -> zamknięte bez pytania
    await edit(page, row.id);
    await page.waitForTimeout(800);
    expect(await L.save(page)).toBe("saved");
    expect((await L.readLogo(page, row.id)).payload.bits_b64).toBe(row.payload.bits_b64);
    expect(errors).toEqual([]);
  });

  test("P0-3: stary rysunek (scena 700px) zachowuje swój świat -- kropki jak na wyświetlaczu", async ({ page }) => {
    await open(page);
    const fabricData = {
      version: "5.3.0",
      objects: [L.rect(350, 0, 350, 296)],
      background: "#000",
      clipPath: { type: "rect", version: "5.3.0", left: 0, top: 0, width: 700, height: 296, absolutePositioned: true },
    };
    const id = await L.insertLogo(page, { name: L.uniq("legacy"), type: "PIX_150x70", payload: { ...L.emptyPix, source: { mode: "DRAW", fabricData, bg: "BLACK", editHistory: { undoStack: [], redoStack: [] } } } });
    await edit(page, id);
    await page.waitForTimeout(800);
    expect(await L.save(page)).toBe("saved");
    const box = L.litBox((await L.readLogo(page, id)).payload.bits_b64);
    expect(box.x0).toBeGreaterThanOrEqual(70);
    expect(box.x0).toBeLessThanOrEqual(80);
    expect([box.x1, box.y0, box.y1]).toEqual([149, 0, 69]);
  });

  test("logo PIX bez sceny (demo/stare) otwiera się, a zapis bez zmian daje te same kropki", async ({ page }) => {
    await open(page);
    const bits = new Uint8Array(150 * 70);
    for (let y = 10; y < 60; y++) for (let x = 20; x < 130; x++) if ((x + y) % 3 === 0) bits[y * 150 + x] = 1;
    const b64 = L.pack(bits);
    const id = await L.insertLogo(page, { name: L.uniq("noscene"), type: "PIX_150x70", payload: { ...L.emptyPix, bits_b64: b64 } });
    await edit(page, id);
    await expect(page.locator("#paneDraw")).toBeVisible();
    await page.waitForTimeout(1000);
    expect(await L.save(page)).toBe("saved");
    expect(L.bitDiff((await L.readLogo(page, id)).payload.bits_b64, b64)).toBe(0);
  });

  test("P1-6: skróty klawiszowe nie wywalają edytora; R = prostokąt, F = wypełnienie", async ({ page }) => {
    const errors = L.collectPageErrors(page);
    await open(page);
    const name = L.uniq("keys");
    await L.createNew(page, "Draw", name);
    for (const k of ["r", "o", "l", "p", "u", "s", "t", "v", "h", "b", "e", "[", "]"]) await page.keyboard.press(k);
    await page.keyboard.press("r");
    await expect(page.locator("#tShapes")).toHaveAttribute("aria-pressed", "true");
    const b = await L.stage(page);
    await L.drag(page, b.x + 100, b.y + 100, b.x + 300, b.y + 250);
    await page.keyboard.press("f");
    await L.drag(page, b.x + 500, b.y + 100, b.x + 700, b.y + 250);
    expect(await L.save(page)).toBe("saved");
    const objs = (await L.readLogoByName(page, name)).payload.source.fabricData.objects;
    expect(objs.map((o) => o.type)).toEqual(["rect", "rect"]);
    expect(objs[1].fill).toBe("#ffffff");
    expect(errors).toEqual([]);
  });

  test("każdy z 14 kształtów rysuje się i trafia do zapisu", async ({ page }) => {
    const errors = L.collectPageErrors(page);
    await open(page);
    const name = L.uniq("shapes");
    await L.createNew(page, "Draw", name);
    const shapes = ["line", "rect", "roundRect", "ellipse", "triangle", "diamond", "pentagon", "hexagon", "star5", "arrow1", "arrow2", "arrow1Fill", "arrow2Fill", "heart"];
    const b = await L.stage(page);
    const cols = 5, cw = b.width / cols, ch = b.height / 3;
    for (const [i, s] of shapes.entries()) {
      await pickShape(page, s);
      const cx = b.x + (i % cols) * cw, cy = b.y + Math.floor(i / cols) * ch;
      await L.drag(page, cx + cw * 0.2, cy + ch * 0.2, cx + cw * 0.8, cy + ch * 0.8);
    }
    expect(await L.save(page)).toBe("saved");
    const row = await L.readLogoByName(page, name);
    expect(row.payload.source.fabricData.objects).toHaveLength(shapes.length);
    expect(L.litCount(row.payload.bits_b64)).toBeGreaterThan(300);
    expect(errors).toEqual([]);
  });

  test("strzałka: przeciągnięcie końca zmienia długość i kierunek, grot się nie rozciąga; Shift = poziomo", async ({ page }) => {
    const errors = L.collectPageErrors(page);
    await open(page);
    const name = L.uniq("arrow");
    await L.createNew(page, "Draw", name);
    const b = await L.stage(page);
    await pickShape(page, "arrow1");
    // 16: pozioma linia cieńsza może wpaść w przerwę między rzędami kafli i zniknąć z wyświetlacza
    await page.fill("#cStrokeW", "16");
    await page.locator("#cStrokeW").press("Enter");
    const y = b.y + b.height / 2;
    // Shift: lekko skośne przeciągnięcie daje idealnie poziomą strzałkę
    await page.mouse.move(b.x + b.width * 0.1, y);
    await page.mouse.down();
    await page.keyboard.down("Shift");
    await page.mouse.move(b.x + b.width * 0.4, y + 6, { steps: 8 });
    await page.keyboard.up("Shift");
    await page.mouse.up();
    const line0 = await page.evaluate(() => window.__drawFabric.getObjects()[0]._line);
    expect(line0.kind).toBe("arrow1");
    expect(Math.abs(line0.y2 - line0.y1)).toBeLessThan(0.01);
    expect(await L.save(page)).toBe("saved");
    const box0 = L.litBox((await L.readLogoByName(page, name)).payload.bits_b64);

    // zaznaczenie ramką i przeciągnięcie uchwytu końca (grot) dalej w prawo
    await page.keyboard.press("v");
    await L.drag(page, b.x + 4, b.y + 4, b.x + b.width * 0.6, b.y + b.height - 4);
    const h = await page.evaluate(() => {
      const o = window.__drawFabric.getActiveObject();
      return o && { ctrls: Object.keys(o.controls), p2: o.oCoords.p2 };
    });
    expect(h?.ctrls).toEqual(["p1", "p2"]);
    await L.drag(page, b.x + h.p2.x, b.y + h.p2.y, b.x + b.width * 0.9, b.y + h.p2.y);
    const o1 = await page.evaluate(() => { const o = window.__drawFabric.getObjects()[0]; return { line: o._line, sx: o.scaleX, sy: o.scaleY, n: window.__drawFabric.getObjects().length }; });
    expect(o1.n).toBe(1);
    expect([o1.sx, o1.sy]).toEqual([1, 1]);
    expect(o1.line.x1).toBeCloseTo(line0.x1, 3);
    expect(o1.line.x2).toBeGreaterThan(line0.x2 + 200);
    expect(await L.save(page)).toBe("saved");
    const row = await L.readLogoByName(page, name);
    expect(row.payload.source.fabricData.objects[0]._line.x2).toBeCloseTo(o1.line.x2, 3);
    const box1 = L.litBox(row.payload.bits_b64);
    expect(box1.x0).toBe(box0.x0);
    expect(box1.x1).toBeGreaterThan(box0.x1 + 20);
    // grot tej samej wielkości: wysokość zapalonego obszaru bez zmian
    // (±1 kropka: grot przesunięty w poziomie może inaczej trafić w siatkę kropek)
    expect(Math.abs((box1.y1 - box1.y0) - (box0.y1 - box0.y0))).toBeLessThanOrEqual(1);

    // jedno Cofnij = powrót do poprzedniej długości
    await page.keyboard.press("Control+z");
    await expect.poll(() => page.evaluate(() => window.__drawFabric.getObjects()[0]._line.x2)).toBeCloseTo(line0.x2, 3);
    expect(errors).toEqual([]);
  });

  test("wielokąt: kliknięcia + Enter; Backspace cofa punkt; Esc porzuca", async ({ page }) => {
    await open(page);
    const name = L.uniq("poly");
    await L.createNew(page, "Draw", name);
    await page.keyboard.press("p");
    const b = await L.stage(page);
    for (const [fx, fy] of [[0.1, 0.1], [0.4, 0.1], [0.9, 0.9]]) await page.mouse.click(b.x + b.width * fx, b.y + b.height * fy);
    await page.keyboard.press("Backspace"); // cofa (0.9, 0.9)
    await page.mouse.click(b.x + b.width * 0.3, b.y + b.height * 0.7);
    await page.keyboard.press("Enter");
    await page.mouse.click(b.x + b.width * 0.6, b.y + b.height * 0.2);
    await page.keyboard.press("Escape"); // porzucony szkic
    expect(await L.save(page)).toBe("saved");
    const objs = (await L.readLogoByName(page, name)).payload.source.fabricData.objects;
    expect(objs).toHaveLength(1);
    expect(objs[0].type).toBe("polygon");
    expect(objs[0].points).toHaveLength(3);
  });

  test("gumka usuwa dotknięte obiekty, jedno Cofnij je przywraca", async ({ page }) => {
    await open(page);
    const name = L.uniq("eraser");
    await L.createNew(page, "Draw", name);
    await page.keyboard.press("r");
    const b = await L.stage(page);
    await L.drag(page, b.x + 100, b.y + 100, b.x + 200, b.y + 200);
    await L.drag(page, b.x + 400, b.y + 100, b.x + 500, b.y + 200);
    await L.drag(page, b.x + 700, b.y + 100, b.x + 800, b.y + 200);
    await page.keyboard.press("e");
    await L.drag(page, b.x + 90, b.y + 150, b.x + 520, b.y + 150, 30); // przez dwa pierwsze
    expect(await L.save(page)).toBe("saved");
    expect((await L.readLogoByName(page, name)).payload.source.fabricData.objects).toHaveLength(1);
    await page.keyboard.press("Control+z");
    await page.waitForTimeout(300);
    expect(await L.save(page)).toBe("saved");
    expect((await L.readLogoByName(page, name)).payload.source.fabricData.objects).toHaveLength(3);
  });

  test("zoom i przesuwanie widoku nie zmieniają zapisanych kropek", async ({ page }) => {
    await open(page);
    const name = L.uniq("zoom");
    await L.createNew(page, "Draw", name);
    await page.keyboard.press("r");
    const b = await L.stage(page);
    await L.drag(page, b.x + 200, b.y + 100, b.x + 600, b.y + 300);
    expect(await L.save(page)).toBe("saved");
    const before = (await L.readLogoByName(page, name)).payload.bits_b64;
    for (let i = 0; i < 4; i++) await page.locator("#tZoomIn").click();
    await page.keyboard.press("h");
    await L.drag(page, b.x + 500, b.y + 200, b.x + 300, b.y + 100);
    await page.keyboard.press("v");
    await page.mouse.click(b.x + 5, b.y + 5); // odznacz
    expect(await L.save(page)).toBe("saved");
    expect((await L.readLogoByName(page, name)).payload.bits_b64).toBe(before);
  });

  test("P1-7/P1-9: po Cofnij obiekty dają się zaznaczyć; Wyczyść cofa się jednym krokiem; Ponów działa", async ({ page }) => {
    await open(page);
    const name = L.uniq("undo");
    await L.createNew(page, "Draw", name);
    await page.keyboard.press("r");
    const b = await L.stage(page);
    await L.drag(page, b.x + 100, b.y + 100, b.x + 300, b.y + 250);
    await L.drag(page, b.x + 500, b.y + 100, b.x + 700, b.y + 250);
    await page.keyboard.press("v");
    await page.keyboard.press("Control+z");
    // Zaznaczenie ramką wokół pierwszego prostokąta, nie kliknięciem w jego
    // krawędź — krawędź przyciąga się do siatki pikseli logo, więc przy innej
    // skali sceny (wysokość strony) klik w x=100 trafiał obok kreski.
    await L.drag(page, b.x + 60, b.y + 60, b.x + 340, b.y + 290);
    await expect(page.locator("#cObjStroke")).toBeVisible();
    await page.keyboard.press("Control+y"); // drugi prostokąt wraca

    await page.keyboard.press("r");
    await L.drag(page, b.x + 500, b.y + 300, b.x + 700, b.y + 400);
    await page.locator("#tClear").click();
    await page.locator(".uni-modal .uni-foot .btn.gold").click();
    await page.keyboard.press("Control+z");
    await page.waitForTimeout(300);
    expect(await L.save(page)).toBe("saved");
    expect((await L.readLogoByName(page, name)).payload.source.fabricData.objects).toHaveLength(3);
  });

  test("P0-5: zmiana koloru zaznaczonego obiektu = niezapisana zmiana", async ({ page }) => {
    await open(page);
    await L.createNew(page, "Draw", L.uniq("dirty"));
    await page.keyboard.press("r");
    const b = await L.stage(page);
    await L.drag(page, b.x + 100, b.y + 100, b.x + 300, b.y + 250);
    expect(await L.save(page)).toBe("saved");
    await page.keyboard.press("v");
    await L.drag(page, b.x + 60, b.y + 60, b.x + 340, b.y + 290); // ramka (krawędź przyciąga się do siatki)
    await page.locator("#cObjStrokeColor").click();
    expect(await L.isDirty(page)).toBe(true);
  });

  test("zakresy: grubość poniżej widocznej (5) i nieczytelnie mała czcionka (50) są podnoszone", async ({ page }) => {
    await open(page);
    await L.createNew(page, "Draw", L.uniq("ranges"));
    await page.keyboard.press("b");
    await page.fill("#cStrokeW", "2");
    await page.locator("#cStrokeW").press("Enter");
    await expect(page.locator("#cStrokeW")).toHaveValue("5");
    await expect(page.locator("#cStrokeW")).toHaveAttribute("max", "100");
    await page.keyboard.press("t");
    await page.fill("#cSz", "20");
    await page.locator("#cSz").press("Enter");
    await expect(page.locator("#cSz")).toHaveValue("50");
    await expect(page.locator("#cSz")).toHaveAttribute("max", "600");
  });

  test("P1-8: zmiana rozmiaru tekstu cofa się jednym Cofnij", async ({ page }) => {
    await open(page);
    const name = L.uniq("textundo");
    await L.createNew(page, "Draw", name);
    await page.keyboard.press("t");
    const b = await L.stage(page);
    await page.mouse.click(b.x + 200, b.y + 150);
    await page.keyboard.type("AB");
    await page.mouse.click(b.x + b.width - 30, b.y + b.height - 30); // koniec edycji
    // zaznacz tekst (narzędzie Tekst); wyśrodkowany napis Fabric 7 przy pisaniu trzyma środek, nie lewą krawędź
    const mid = await page.evaluate(() => {
      const f = window.__drawFabric;
      const c = f.upperCanvasEl.getBoundingClientRect();
      const p = f.getObjects()[0].getCenterPoint();
      const v = f.viewportTransform;
      return { x: c.left + v[4] + p.x * v[0], y: c.top + v[5] + p.y * v[3] };
    });
    await page.mouse.click(mid.x, mid.y);
    await page.fill("#cSz", "120");
    await page.locator("#cSz").press("Enter");
    await page.mouse.click(b.x + b.width - 30, b.y + b.height - 30);
    await page.keyboard.press("v");
    expect(await L.save(page)).toBe("saved");
    expect((await L.readLogoByName(page, name)).payload.source.fabricData.objects[0].fontSize).toBe(120);
    await page.keyboard.press("Control+z");
    await page.waitForTimeout(300);
    expect(await L.save(page)).toBe("saved");
    expect((await L.readLogoByName(page, name)).payload.source.fabricData.objects[0].fontSize).toBe(80);
  });

  test("tło białe zapala resztę kropek; Cofnij przywraca czarne", async ({ page }) => {
    await open(page);
    const name = L.uniq("bg");
    await L.createNew(page, "Draw", name);
    await page.locator("#tBg").click();
    expect(await L.save(page)).toBe("saved");
    let row = await L.readLogoByName(page, name);
    expect(row.payload.source.bg).toBe("WHITE");
    expect(L.litCount(row.payload.bits_b64)).toBe(150 * 70);
    await page.keyboard.press("Control+z");
    await page.waitForTimeout(300);
    expect(await L.save(page)).toBe("saved");
    row = await L.readLogoByName(page, name);
    expect(row.payload.source.bg).toBe("BLACK");
    expect(L.litCount(row.payload.bits_b64)).toBe(0);
  });

  test("strzałki przesuwają zaznaczenie (1 / Shift = 10), Delete usuwa", async ({ page }) => {
    await open(page);
    const name = L.uniq("arrows");
    await L.createNew(page, "Draw", name);
    await page.keyboard.press("r");
    const b = await L.stage(page);
    await L.drag(page, b.x + 200, b.y + 100, b.x + 400, b.y + 250);
    await L.drag(page, b.x + 600, b.y + 100, b.x + 700, b.y + 250);
    expect(await L.save(page)).toBe("saved");
    const left0 = (await L.readLogoByName(page, name)).payload.source.fabricData.objects[0].left;
    await page.keyboard.press("v");
    // klik w środek lewego obrysu pierwszego prostokąta (pusty środek nie
    // zaznacza; krawędź obrysu zależy od skali płótna)
    const hit = await page.evaluate(() => {
      const f = window.__drawFabric;
      const c = f.upperCanvasEl.getBoundingClientRect();
      const o = f.getObjects()[0];
      const r = o.getBoundingRect(); // Fabric 7: współrzędne sceny -> ekran przez viewportTransform
      const v = f.viewportTransform;
      return { x: c.left + v[4] + (r.left + o.strokeWidth / 2) * v[0], y: c.top + v[5] + (r.top + r.height / 2) * v[3] };
    });
    await page.mouse.click(hit.x, hit.y);
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Shift+ArrowRight");
    expect(await L.save(page)).toBe("saved");
    expect(Math.round((await L.readLogoByName(page, name)).payload.source.fabricData.objects[0].left - left0)).toBe(11);
    await page.keyboard.press("Delete");
    expect(await L.save(page)).toBe("saved");
    expect((await L.readLogoByName(page, name)).payload.source.fabricData.objects).toHaveLength(1);
  });

  test("P1-10: duplikat kilku obiektów ląduje obok oryginałów (+10), nie w rogu", async ({ page }) => {
    await open(page);
    const name = L.uniq("dup");
    await L.createNew(page, "Draw", name);
    await page.keyboard.press("r");
    const b = await L.stage(page);
    await L.drag(page, b.x + 100, b.y + 100, b.x + 200, b.y + 200);
    await L.drag(page, b.x + 400, b.y + 100, b.x + 500, b.y + 200);
    await page.keyboard.press("v");
    await L.drag(page, b.x + 50, b.y + 50, b.x + 600, b.y + 300);
    await page.keyboard.press("Control+d");
    await page.mouse.click(b.x + b.width - 20, b.y + b.height - 20);
    expect(await L.save(page)).toBe("saved");
    const [a, c, a2, c2] = (await L.readLogoByName(page, name)).payload.source.fabricData.objects;
    expect(Math.round(a2.left - a.left)).toBe(10);
    expect(Math.round(c2.left - c.left)).toBe(10);
    expect(Math.round(a2.top - a.top)).toBe(10);
  });

  test("tekst na scenie zapisuje się z treścią", async ({ page }) => {
    await open(page);
    const name = L.uniq("drawtext");
    await L.createNew(page, "Draw", name);
    await page.keyboard.press("t");
    const b = await L.stage(page);
    await page.mouse.click(b.x + 200, b.y + 150);
    await page.keyboard.type("ABC");
    await page.mouse.click(b.x + b.width - 30, b.y + b.height - 30);
    expect(await L.save(page)).toBe("saved");
    const row = await L.readLogoByName(page, name);
    expect(row.payload.source.fabricData.objects.filter((o) => o.type === "i-text").map((o) => o.text)).toContain("ABC");
    expect(L.litCount(row.payload.bits_b64)).toBeGreaterThan(20);
  });

  test.describe("ekran Retina (deviceScaleFactor 2)", () => {
    test.use({ deviceScaleFactor: 2 });

    test("P0-5b: raster rysunku nie zależy od gęstości ekranu", async ({ page }) => {
      await open(page);
      const fabricData = { version: "5.3.0", objects: [L.rect(780, 330, 260, 110)], background: "#000" };
      const id = await L.insertLogo(page, { name: L.uniq("retina"), type: "PIX_150x70", payload: { ...L.emptyPix, source: { mode: "DRAW", fabricData, world: { w: 1040, h: 440 } } } });
      await edit(page, id);
      await page.waitForTimeout(800);
      expect(await L.save(page)).toBe("saved");
      expect(L.litBox((await L.readLogo(page, id)).payload.bits_b64)).toEqual({ x0: 112, y0: 52, x1: 149, y1: 69 });
    });
  });
});

/* ======================= OBRAZ ======================= */

test.describe("tryb Obraz", () => {
  test("P0-1/P1-15: kolejne zapisy trzymają URL ze Storage, obraz wczytuje się ponownie, podmieniony plik jest sprzątany", async ({ page }) => {
    const errors = L.collectPageErrors(page);
    await open(page);
    const name = L.uniq("image");
    await L.createNew(page, "Image", name);
    expect(await L.save(page)).not.toBe("saved");
    // Wiersz powstaje od razu przy „Nowe logo”, ale bez obrazu nic się nie zapisało.
    expect((await L.readLogoByName(page, name)).payload.source.imageUrl).toBeFalsy();

    await page.setInputFiles("#imgFile", DEMO_IMAGE);
    await expect(page.locator("#cropFrame")).toBeVisible();
    expect(await L.save(page)).toBe("saved");
    const first = await L.readLogoByName(page, name);
    const url1 = first.payload.source.imageUrl;
    expect(url1).toMatch(/^https:\/\/.+\/user-logos\//);

    await page.locator('.imgSetBtn[data-panel="bright"]').click();
    await page.locator("#rngImgBright").fill("40");
    await page.locator("#rngImgBright").dispatchEvent("input");
    expect(await L.save(page)).toBe("saved");
    const second = await L.readLogo(page, first.id);
    expect(second.payload.source.imageUrl).toBe(url1);
    expect(second.payload.source.bright).toBe(40);

    await L.close(page);
    await edit(page, first.id);
    await expect(page.locator("#cropFrame")).toBeVisible({ timeout: 15000 });

    await page.setInputFiles("#imgFile", OTHER_IMAGE);
    await expect(page.locator("#cropFrame")).toBeVisible();
    expect(await L.save(page)).toBe("saved");
    const third = await L.readLogo(page, first.id);
    expect(third.payload.source.imageUrl).not.toBe(url1);
    const oldStatus = await page.evaluate((u) => fetch(`${u}?t=${Date.now()}`, { cache: "no-store" }).then((r) => r.status), url1);
    expect(oldStatus).toBeGreaterThanOrEqual(400);
    expect(errors).toEqual([]);
  });

  test("P0-2: obraz, którego nie da się wczytać, blokuje zapis (logo nie zostaje wyzerowane)", async ({ page }) => {
    await open(page);
    const full = Buffer.alloc(19 * 70, 255).toString("base64");
    const id = await L.insertLogo(page, {
      name: L.uniq("broken"),
      type: "PIX_150x70",
      payload: { ...L.emptyPix, bits_b64: full, source: { mode: "IMAGE", imageUrl: "https://api.familijna.app/storage/v1/object/public/user-logos/nope/missing.png" } },
    });
    await edit(page, id);
    await expect(page.locator(".uni-modal")).toBeVisible({ timeout: 15000 });
    await page.locator(".uni-modal .uni-foot .btn.gold").click();
    expect(await L.save(page)).not.toBe("saved");
    expect((await L.readLogo(page, id)).payload.bits_b64).toBe(full);
  });

  test("suwaki, odwrócenie i Przywróć zmieniają wynik; kadr przeciągnięty zostaje po ponownym otwarciu", async ({ page }) => {
    await open(page);
    const name = L.uniq("sliders");
    await L.createNew(page, "Image", name);
    await page.setInputFiles("#imgFile", DEMO_IMAGE);
    await expect(page.locator("#cropFrame")).toBeVisible();
    expect(await L.save(page)).toBe("saved");
    const base = (await L.readLogoByName(page, name)).payload;

    await page.locator("#chkImgInvert").click();
    expect(await L.save(page)).toBe("saved");
    const inv = (await L.readLogoByName(page, name)).payload;
    expect(inv.source.invert).toBe(false);
    expect(L.bitDiff(base.bits_b64, inv.bits_b64)).toBeGreaterThan(5000);

    await page.locator("#btnImgResetDefault").click();
    await page.waitForTimeout(300);
    expect(await L.save(page)).toBe("saved");
    expect((await L.readLogoByName(page, name)).payload.source.invert).toBe(true);

    // przesunięcie kadru
    const f = await page.locator("#cropFrame").boundingBox();
    await L.drag(page, f.x + f.width / 2, f.y + f.height / 2, f.x + f.width / 2 + 40, f.y + f.height / 2 + 20);
    expect(await L.save(page)).toBe("saved");
    const moved = (await L.readLogoByName(page, name)).payload;
    expect(moved.source.crop.v).toBe(2);
    expect(L.bitDiff(base.bits_b64, moved.bits_b64)).toBeGreaterThan(50);

    const id = (await L.readLogoByName(page, name)).id;
    await L.close(page);
    await edit(page, id);
    await expect(page.locator("#cropFrame")).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(500);
    expect(await L.save(page)).toBe("saved");
    expect(L.bitDiff((await L.readLogoByName(page, name)).payload.bits_b64, moved.bits_b64)).toBeLessThanOrEqual(30);
  });

  test("obrót 90° i prostowanie: ramka zostaje na obrazie, zapis i ponowne otwarcie dają te same kropki", async ({ page }) => {
    const errors = L.collectPageErrors(page);
    await open(page);
    const name = L.uniq("rotate");
    await L.createNew(page, "Image", name);
    await page.setInputFiles("#imgFile", DEMO_IMAGE);
    await expect(page.locator("#cropFrame")).toBeVisible({ timeout: 10000 });

    // Najmniejszy zapas (px) między rogami ramki a krawędzią obrazu obróconego
    // o `deg` (demo-image.png ma 1536x1024); ujemny = ramka wystaje na puste rogi.
    const margin = (deg) => page.evaluate((deg) => {
      const img = document.getElementById("imgPreview").getBoundingClientRect();
      const cr = document.getElementById("cropFrame").getBoundingClientRect();
      const a = deg * Math.PI / 180, c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a));
      const f = img.width / (1536 * c + 1024 * s);
      const hw = 1536 * f / 2, hh = 1024 * f / 2, cx = img.left + img.width / 2, cy = img.top + img.height / 2;
      let worst = Infinity;
      for (const [x, y] of [[cr.left, cr.top], [cr.right, cr.top], [cr.left, cr.bottom], [cr.right, cr.bottom]]) {
        const dx = x - cx, dy = y - cy;
        const qx = dx * Math.cos(-a) - dy * Math.sin(-a), qy = dx * Math.sin(-a) + dy * Math.cos(-a);
        worst = Math.min(worst, hw - Math.abs(qx), hh - Math.abs(qy));
      }
      return worst;
    }, deg);
    const dragFrame = async (dx, dy, corner = false) => {
      const f = await page.locator("#cropFrame").boundingBox();
      const x = corner ? f.x + f.width - 2 : f.x + f.width / 2, y = corner ? f.y + f.height - 2 : f.y + f.height / 2;
      await L.drag(page, x, y, x + dx, y + dy);
    };
    // koniec przebudowy obrazu po obrocie (w trakcie ramka jest ukryta)
    const settled = async () => {
      await expect(page.locator("#imgStage")).not.toHaveAttribute("data-rotating", "1", { timeout: 10000 });
      await expect(page.locator("#cropFrame")).toBeVisible();
    };
    const straighten = async (v) => {
      await page.locator('.imgSetBtn[data-panel="straighten"]').click();
      await page.locator("#rngImgStraighten").fill(String(v));
      await expect(page.locator('.imgSetBtn[data-panel="straighten"] .imgSetBtnVal')).toHaveText(`${v > 0 ? "+" : ""}${v}°`);
      await page.waitForTimeout(200); // opóźnienie suwaka
      await settled();
    };

    await dragFrame(-600, -600); // ramka w rogu obrazu
    await page.locator("#btnImgRotR").click();
    await settled();
    expect(await margin(90)).toBeGreaterThanOrEqual(-0.5);
    await straighten(20);
    expect(await margin(110)).toBeGreaterThanOrEqual(-0.5);
    await dragFrame(900, 900);          // próba wyciągnięcia poza obraz
    expect(await margin(110)).toBeGreaterThanOrEqual(-0.5);
    await dragFrame(800, 800, true);    // próba powiększenia ponad obraz
    expect(await margin(110)).toBeGreaterThanOrEqual(-0.5);

    expect(await L.save(page)).toBe("saved");
    const row = await L.readLogoByName(page, name);
    expect(row.payload.source).toMatchObject({ rotate: 90, straighten: 20 });
    expect(L.litCount(row.payload.bits_b64)).toBeGreaterThan(100);

    await L.editLogo(page, site, row.id);
    await expect(page.locator("#cropFrame")).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(800);
    await settled();
    await expect(page.locator("#rngImgStraighten")).toHaveValue("20");
    expect(await margin(110)).toBeGreaterThanOrEqual(-0.5);
    // zapis bez zmian po ponownym otwarciu: dokładnie te same kropki
    await page.locator("#chkImgInvert").click();
    await page.locator("#chkImgInvert").click();
    expect(await L.save(page)).toBe("saved");
    const again = await L.readLogo(page, row.id);
    expect(again.payload.source).toMatchObject({ rotate: 90, straighten: 20 });
    expect(L.bitDiff(row.payload.bits_b64, again.payload.bits_b64)).toBe(0);

    // obrót w lewo i z powrotem: ramka 26:11 na pionowym obrazie musi się
    // zmniejszyć/przesunąć, więc to nie jest tożsamość -- ważne, że zostaje na obrazie
    await page.locator("#btnImgRotL").click();
    await settled();
    expect(await margin(20)).toBeGreaterThanOrEqual(-0.5);
    await page.locator("#btnImgRotR").click();
    await settled();
    expect(await margin(110)).toBeGreaterThanOrEqual(-0.5);
    expect(await L.save(page)).toBe("saved");
    expect((await L.readLogo(page, row.id)).payload.source.rotate).toBe(90);
    expect(errors).toEqual([]);
  });

  test("walidacja pliku: zły typ i za duży plik odrzucone przed wysłaniem", async ({ page }) => {
    await open(page);
    await L.createNew(page, "Image", L.uniq("badfile"));
    await page.setInputFiles("#imgFile", { name: "a.bmp", mimeType: "image/bmp", buffer: Buffer.from("BM....") });
    await expect(page.locator(".uni-modal")).toContainText(/JPG, PNG, GIF/);
    await page.locator(".uni-modal .uni-foot .btn.gold").click();
    await page.setInputFiles("#imgFile", { name: "big.png", mimeType: "image/png", buffer: Buffer.alloc(6 * 1024 * 1024) });
    await expect(page.locator(".uni-modal")).toContainText(/5 MB/);
    await page.locator(".uni-modal .uni-foot .btn.gold").click();
    await expect(page.locator("#cropFrame")).toBeHidden();
  });
});

/* ======================= BLOKADY ======================= */

test.describe("blokady", () => {
  test("edytowane logo ma blokadę, druga karta go nie otworzy, zamknięcie ją zwalnia", async ({ page, context }) => {
    await open(page);
    const id = await L.insertLogo(page, { name: L.uniq("lock"), type: "GLYPH_30x10", payload: L.textPayload() });
    await edit(page, id);
    await expect(page.locator("#paneText")).toBeVisible();

    const tabB = await context.newPage();
    try {
      await L.openList(tabB, site);
      await tabB.locator(`.logoTile[data-key="${id}"]`).click();
      await tabB.locator("#btnEdit").click();
      await tabB.waitForURL(/\/logos\/editor\/text\/\?id=/);
      await expect(tabB.locator("#resourceLockGuard")).toBeVisible({ timeout: 10000 });
      await expect(tabB.locator("#logoName")).toBeDisabled();
    } finally {
      await tabB.close();
    }

    await L.close(page);
    await expect.poll(() => page.evaluate(async (id) => {
      const { data } = await window.__sbClient.from("edit_locks").select("resource_id").eq("resource_type", "logo").eq("resource_id", id);
      return (data || []).length;
    }, id), { timeout: 10000 }).toBe(0);
  });

  // Pula logo to zasób `logos` (id = użytkownik), trzymany współdzielenie przez
  // Control i ustawienia gry (familijna-server/docs/blokady-zasobow.md, sekcja 6). Testy symulują
  // to obcą kartą, która bierze `logos` kontekstem „settings”.
  const poolLock = (page, tab) => (fn) => page.evaluate(async ({ fn, tab }) => {
    const sb = window.__sbClient;
    const { data: u } = await sb.auth.getUser();
    if (fn === "acquire_edit_lock_mode") {
      return sb.rpc(fn, { p_resource_type: "logos", p_resource_id: u.user.id, p_tab_id: tab, p_context: "settings", p_mode: "shared" });
    }
    return sb.rpc(fn, { p_resource_type: "logos", p_resource_id: u.user.id, p_tab_id: tab });
  }, { fn, tab });

  test("otwarte ustawienia gry (logos) blokują edycję logo (cała pula)", async ({ page }) => {
    await open(page);
    const id = await L.insertLogo(page, { name: L.uniq("pool"), type: "GLYPH_30x10", payload: L.textPayload("AB") });
    const lock = poolLock(page, `e2e-le2-${Date.now()}`);
    const got = await lock("acquire_edit_lock_mode");
    expect(got.data?.ok, "logos współdzielone powinno się zająć").toBe(true);
    try {
      await edit(page, id);
      await expect(page.locator("#resourceLockGuardMsg")).toContainText(/ustawienia gry/i, { timeout: 10000 });
      await expect(page.locator("#logoName")).toBeDisabled();
    } finally {
      await lock("release_edit_lock");
    }
  });

  test("pula zajęta po utracie blokady logo w trakcie edycji: zapis odrzucony, logo nietknięte", async ({ page }) => {
    await open(page);
    const id = await L.insertLogo(page, { name: L.uniq("pool-mid"), type: "GLYPH_30x10", payload: L.textPayload("AB") });
    await edit(page, id);
    // Edytor trzyma logo:L wyłącznie, więc `logos` nie da się zająć, dopóki trzyma. Symulacja
    // uśpionej karty: zwolnij blokadę edytora jego własnym tab_id i od razu zajmij pulę obcą
    // kartą. Edytor co kilka sekund odnawia blokadę (resource-lock.js renewAll) i może ją
    // odzyskać między tymi krokami -- wtedy obie czynności powtarzamy.
    const poolTab = `e2e-le2-mid-${Date.now()}`;
    const got = await page.evaluate(async ({ logoId, poolTab }) => {
      const sb = window.__sbClient;
      const tabId = sessionStorage.getItem("familijna:tabId");
      const { data: u } = await sb.auth.getUser();
      // Blokady innych logo tego konta zostawione przez wcześniejsze testy w tym samym
      // wątku (zamknięta strona nie zawsze zdąży je zwolnić; wygasają po 120 s) też
      // zajmują pulę -- zwalniamy je jak zamknięte karty.
      const { data: stale } = await sb.from("edit_locks").select("resource_type,resource_id,holder_tab_id")
        .eq("holder_user_id", u.user.id).in("resource_type", ["logo", "logos"]);
      for (const row of stale || []) {
        if (row.resource_type === "logo" && row.resource_id === logoId) continue;
        await sb.rpc("release_edit_lock", { p_resource_type: row.resource_type, p_resource_id: row.resource_id, p_tab_id: row.holder_tab_id });
      }
      let res = null;
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await sb.rpc("release_edit_lock", { p_resource_type: "logo", p_resource_id: logoId, p_tab_id: tabId });
        res = await sb.rpc("acquire_edit_lock_mode", { p_resource_type: "logos", p_resource_id: u.user.id, p_tab_id: poolTab, p_context: "settings", p_mode: "shared" });
        if (res.data?.ok) break;
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
      return res;
    }, { logoId: id, poolTab });
    expect(got.data?.ok, `logos współdzielone po zwolnieniu logo:L: ${JSON.stringify(got.data || got.error)}`).toBe(true);
    const lock = poolLock(page, poolTab);
    try {
      await page.fill("#textValue", "CD");
      // Zapis (RPC update_logo_checked) albo odnowienie blokady (locked) kończy edycję pełnym komunikatem.
      await expect(page.locator("#resourceLockGuardMsg")).toContainText(/ustawienia|blokad|rozgrywk/i, { timeout: 15000 });
      expect((await L.readLogo(page, id)).payload.source.text).toBe("AB");
    } finally {
      await lock("release_edit_lock");
    }
  });
});

/* ======================= ZGODNOŚĆ ZE STARYMI DANYMI =======================
   Przed wdrożeniem (przebiegi #185–#190) testy tworzyły logo STARYM edytorem
   i porównywały zapis w nowym: 0 różnic dla tekstu, rysunku i obrazu, a dla
   demo 0 różnic względem starego edytora (familijna-server/docs/audyt-logo-editor.md). Po
   wdrożeniu starego edytora już nie ma -- zostają testy na starych danych
   (P0-3 świat 700px, P0-4 napis z wierszy, PIX bez sceny) i poniższy test
   na kopiach logo demo z konta testowego (oryginały nietknięte). */

test.describe("zgodność ze starymi danymi", () => {
  test("logo demo: każde się otwiera, zapis zachowuje źródło, a kolejny zapis bez zmian daje te same kropki", async ({ page }) => {
    await L.openList(page, site);
    const demos = await page.evaluate(async () => {
      const { data, error } = await window.__sbClient.from("user_logos").select("name,type,payload").eq("is_demo", true);
      if (error) throw new Error(error.message);
      return data;
    });
    console.log(`[demo] logo demo na koncie: ${demos.length}`);
    test.skip(!demos.length, "konto testowe nie ma logo demo");

    const openAndSave = async (id) => {
      await L.editLogo(page, site, id);
      const modal = page.locator(".uni-modal");
      const blocked = await modal.waitFor({ state: "visible", timeout: 2500 }).then(() => true).catch(() => false);
      if (blocked) console.log(`[demo] ZABLOKOWANE -- ${await modal.locator(".mSub").textContent()}`);
      expect(blocked, "logo demo powinno dać się edytować").toBe(false);
      await expect(page.locator("#editorShell")).toBeVisible();
      await page.waitForTimeout(1500);
      expect(await L.save(page)).toBe("saved");
      const row = await L.readLogo(page, id);
      await L.close(page);
      return row;
    };

    for (const d of demos) {
      const id = await L.insertLogo(page, { name: L.uniq(`demo-${d.type}`), type: d.type, payload: d.payload });
      const first = await openAndSave(id);
      const src = d.payload.source || {};
      if (d.type === "GLYPH_30x10") {
        expect(first.payload.layers[0].rows).toEqual(d.payload.layers[0].rows.map((r) => String(r).padEnd(30).slice(0, 30)));
        continue;
      }
      if (src.fabricData) {
        // rysunek zostaje na scenie, na której go narysowano (nie przeskalowany)
        expect(first.payload.source.world).toBeTruthy();
        expect(first.payload.source.fabricData.objects).toHaveLength(src.fabricData.objects.length);
      }
      if (src.mode === "IMAGE") {
        // Edycja kopii nie rusza pliku wzorca (bucket demo-assets, migracje 523–524).
        expect(first.payload.source.imageUrl, "adres obrazu demo bez zmian").toBe(src.imageUrl);
        expect(first.payload.source.crop).toMatchObject({ v: 2 });
      }
      const second = await openAndSave(id);
      const diff = L.bitDiff(first.payload.bits_b64, second.payload.bits_b64);
      console.log(`[demo] ${d.name}: vs seed ${L.bitDiff(d.payload.bits_b64, first.payload.bits_b64)}, drugi zapis vs pierwszy ${diff}`);
      expect(diff).toBe(0);
    }
  });
});

/* ======================= JĘZYKI, TELEFON ======================= */

for (const lang of ["en", "uk"]) {
  test(`język ${lang}: żadnego surowego klucza tłumaczenia na liście i w trzech trybach`, async ({ page, context }) => {
    await context.addInitScript((l) => { try { localStorage.setItem("uiLang", l); } catch {} }, lang);
    await open(page);
    const rawKeys = () => page.evaluate(() => {
      const txt = document.body.innerText + [...document.querySelectorAll("[title],[aria-label],[placeholder],[data-tip],[data-tooltip]")]
        .map((e) => `${e.title} ${e.getAttribute("aria-label")} ${e.placeholder || ""} ${e.dataset.tip || ""} ${e.dataset.tooltip || ""}`).join(" ");
      return (txt.match(/logoEditor\.[\w.]+/g) || []).slice(0, 5);
    });
    expect(await rawKeys()).toEqual([]);
    for (const mode of ["Text", "Draw", "Image"]) {
      await L.createNew(page, mode, L.uniq(`lang-${mode}`));
      expect(await rawKeys()).toEqual([]);
      await L.close(page);
    }
  });
}

/* Tablet: prawdziwe zdarzenia dotyku (CDP Input.dispatchTouchEvent), bo
   page.mouse daje zdarzenia myszy, a Fabric i kadr obrazu mają osobne ścieżki
   dla palców (pinch, pierwszy palec pinchu nie może zostawić kreski). */
test.describe("tablet (dotyk)", () => {
  test.use({ viewport: { width: 1180, height: 820 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

  async function touchApi(page) {
    const cdp = await page.context().newCDPSession(page);
    const T = (type, pts) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) });
    const drag = async (x0, y0, x1, y1, steps = 10) => {
      await T("touchStart", [[x0, y0]]);
      for (let i = 1; i <= steps; i++) await T("touchMove", [[x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps]]);
      await T("touchEnd", []);
      await page.waitForTimeout(150);
    };
    /** Dwa palce od środka (cx, cy): odległość d0 -> d1 w poziomie. */
    const pinch = async (cx, cy, d0, d1, steps = 10) => {
      await T("touchStart", [[cx - d0 / 2, cy]]);
      await T("touchStart", [[cx - d0 / 2, cy], [cx + d0 / 2, cy]]);
      for (let i = 1; i <= steps; i++) {
        const d = d0 + (d1 - d0) * i / steps;
        await T("touchMove", [[cx - d / 2, cy], [cx + d / 2, cy]]);
      }
      await T("touchEnd", []);
      await page.waitForTimeout(300);
    };
    return { drag, pinch };
  }
  const objects = (page) => page.evaluate(() => window.__drawFabric.getObjects().map((o) => o.type + (o._line ? `:${o._line.kind}` : "")));

  test("Rysunek palcem: pędzel, strzałka, koniec strzałki, pinch bez kreski", async ({ page }) => {
    const errors = L.collectPageErrors(page);
    await open(page);
    const name = L.uniq("touch-draw");
    await L.createNew(page, "Draw", name);
    const t = await touchApi(page);
    const b = await L.stage(page);

    await page.locator("#tBrush").tap();
    await t.drag(b.x + 50, b.y + 50, b.x + 250, b.y + 120);
    expect(await objects(page)).toEqual(["path"]);

    await page.locator("#tShapes").tap();
    await page.locator("#cShape .ui-select-btn").tap();
    await page.locator('#cShape .menu-item[data-value="arrow1"]').tap();
    const y = b.y + b.height * 0.6;
    await t.drag(b.x + b.width * 0.2, y, b.x + b.width * 0.5, y);
    expect(await objects(page)).toEqual(["path", "path:arrow1"]);

    await page.locator("#tSelect").tap();
    await page.touchscreen.tap(b.x + b.width * 0.35, y);
    const p2 = await page.evaluate(() => window.__drawFabric.getActiveObject()?.oCoords?.p2 || null);
    expect(p2, "stuknięcie zaznacza strzałkę").not.toBeNull();
    const x2 = () => page.evaluate(() => window.__drawFabric.getObjects()[1]._line.x2);
    const before = await x2();
    await t.drag(b.x + p2.x, b.y + p2.y, b.x + b.width * 0.85, b.y + p2.y);
    expect(await x2()).toBeGreaterThan(before + 100);

    // pinch przy aktywnym pędzlu: powiększa, nie rysuje
    await page.locator("#tBrush").tap();
    await t.pinch(b.x + b.width / 2, b.y + b.height / 2, 80, 320);
    expect(await page.evaluate(() => window.__drawFabric.getZoom())).toBeGreaterThan(1.2);
    expect(await objects(page)).toHaveLength(2);

    expect(await L.save(page)).toBe("saved");
    const row = await L.readLogoByName(page, name);
    expect(row.payload.source.fabricData.objects).toHaveLength(2);
    expect(errors).toEqual([]);
  });

  test("Obraz palcem: kadr przesuwa się jednym palcem i zmniejsza pinchem", async ({ page }) => {
    const errors = L.collectPageErrors(page);
    await open(page);
    await L.createNew(page, "Image", L.uniq("touch-img"));
    await page.setInputFiles("#imgFile", DEMO_IMAGE);
    await expect(page.locator("#cropFrame")).toBeVisible({ timeout: 10000 });
    const t = await touchApi(page);
    const frame = () => page.locator("#cropFrame").boundingBox();
    const f0 = await frame();
    await t.drag(f0.x + f0.width / 2, f0.y + f0.height / 2, f0.x + f0.width / 2 - 40, f0.y + f0.height / 2 - 30);
    const f1 = await frame();
    expect(f1.x).toBeLessThan(f0.x - 20);
    expect(Math.round(f1.width)).toBe(Math.round(f0.width));
    await t.pinch(f1.x + f1.width / 2, f1.y + f1.height / 2, 60, 20);
    const f2 = await frame();
    expect(f2.width).toBeLessThan(f1.width * 0.6);
    expect(f2.width / f2.height).toBeCloseTo(26 / 11, 1);
    expect(errors).toEqual([]);
  });
});

/* Tablet w pionie: edycja dostępna od początku, a obrót ekranu w trakcie
   (pion -> poziom -> pion) nie gubi rysunku. Telefon rozpoznajemy po krótszym
   boku EKRANU, więc obrót niczego nie przełącza. */
test.describe("tablet w pionie i obrót ekranu", () => {
  const PORTRAIT = { width: 820, height: 1180 };
  test.use({ viewport: PORTRAIT, screen: PORTRAIT, isMobile: true, hasTouch: true });

  test("edycja zaczęta w pionie, obrót w trakcie: pasek ustawień bez ucięć, oba obiekty w zapisie", async ({ page }) => {
    const errors = L.collectPageErrors(page);
    await open(page);
    await expect(page.locator("#grid .addCard")).toBeVisible();
    const name = L.uniq("portrait");
    await L.createNew(page, "Draw", name);
    const drawRect = async () => {
      const b = await L.stage(page);
      await page.keyboard.press("r");
      await L.drag(page, b.x + 40, b.y + 30, b.x + b.width / 2, b.y + b.height / 2);
    };
    await drawRect();
    // pasek ustawień zawija się zamiast ucinać ostatnie pola
    const bar = await page.evaluate(() => {
      const c = document.getElementById("toolCtxSettings").getBoundingClientRect();
      const right = Math.max(...[...document.querySelectorAll("#toolCtxSettings > *")].map((k) => k.getBoundingClientRect().right));
      return { container: c.right, content: right };
    });
    expect(bar.content).toBeLessThanOrEqual(bar.container + 1);

    await page.setViewportSize({ width: PORTRAIT.height, height: PORTRAIT.width }); // obrót do poziomu
    await page.waitForTimeout(500);
    await drawRect();
    await page.setViewportSize(PORTRAIT);                                            // i z powrotem
    await page.waitForTimeout(500);
    await expect(page.locator("#editorShell")).toHaveAttribute("data-mode", "DRAW");
    expect(await L.save(page)).toBe("saved");
    const row = await L.readLogoByName(page, name);
    expect(row.payload.source.fabricData.objects).toHaveLength(2);
    expect(row.payload.source.world).toEqual({ w: 1040, h: 440 }); // świat nie zależy od orientacji
    expect(errors).toEqual([]);
  });
});

test.describe("telefon", () => {
  test.use({ viewport: { width: 390, height: 800 }, screen: { width: 390, height: 800 }, isMobile: true, hasTouch: true });

  test("lista i podgląd działają; tworzenie i edycja są ukryte", async ({ page }) => {
    await open(page);
    const id = await L.insertLogo(page, { name: L.uniq("mobile"), type: "GLYPH_30x10", payload: L.textPayload("AB") });
    await open(page);
    await expect(page.locator("#grid .addCard")).toBeHidden();
    await expect(page.locator("#btnEdit")).toBeHidden();
    await page.locator(`.logoTile[data-key="${id}"]`).tap();
    await page.locator("#btnPreview").tap();
    await expect(page.locator("#previewOverlay")).toBeVisible();
  });

  test("edytor na telefonie jest niedostępny w pionie i w poziomie (bez prośby o obrót)", async ({ page }, testInfo) => {
    await open(page);
    const id = await L.insertLogo(page, { name: L.uniq("mobile-edit"), type: "GLYPH_30x10", payload: L.textPayload("AB") });
    await page.goto(`${site.origin}/logos/editor/text/?id=${id}`);
    // Wspólna nakładka urządzenia (page-overlay.js), nie blokada zasobu.
    // Edytory logo: tylko tablet i komputer (nav-map deviceGuard.formFactors).
    await expect(page.locator("#pageGuard")).toBeVisible({ timeout: 15000 });
    await expect(page.locator("#pageGuard")).toHaveAttribute("data-kind", "device");
    await expect(page.locator("#pageGuard")).toHaveAttribute("data-state", "unsupported");
    await expect(page.locator("#pageGuardMsg")).toContainText(/niedostępna na telefonie/);
    await expect(page.locator("#logoName")).toBeDisabled();
    await page.screenshot({ path: testInfo.outputPath("shot-e20-logo-editor-phone-portrait-guard.png"), fullPage: true });
    await page.setViewportSize({ width: 800, height: 390 });
    await expect(page.locator("#pageGuard")).toHaveAttribute("data-state", "unsupported");
    await expect(page.locator("#pageGuard")).toBeVisible();
    await expect(page.locator("#logoName")).toBeDisabled();
    expect((await L.readLogo(page, id)).payload.source.text).toBe("AB");
    await page.screenshot({ path: testInfo.outputPath("shot-e20-logo-editor-phone-landscape-guard.png"), fullPage: true });
  });
});

test.describe("telefon w poziomie", () => {
  const LAND = { width: 844, height: 390 };
  test.use({ viewport: LAND, screen: LAND, isMobile: true, hasTouch: true });

  test("telefon w poziomie: lista prosi o obrót do pionu, po obrocie tylko przeglądanie", async ({ page }) => {
    // Krok 5 tabeli E20: telefon w poziomie domyślnie blokowany (wyjątki: Host, Buzzer, wąż).
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page);
    const id = await L.insertLogo(page, { name: L.uniq("landscape-view"), type: "GLYPH_30x10", payload: L.textPayload("AB") });
    await open(page);
    await page.setViewportSize(LAND);
    await expect(page.locator("#pageGuard")).toBeVisible({ timeout: 15000 });
    await expect(page.locator("#pageGuard")).toHaveAttribute("data-kind", "device");
    await expect(page.locator("#pageGuard")).toHaveAttribute("data-state", "rotate");
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator("#pageGuard")).toBeHidden();
    await expect(page.locator(`.logoTile[data-key="${id}"]`)).toBeVisible({ timeout: 15000 });
    await expect(page.locator("#grid .addCard")).toBeHidden();
    await page.locator(`.logoTile[data-key="${id}"]`).tap();
    await expect(page.locator("#btnEdit")).toBeHidden();
    await page.locator("#btnPreview").tap();
    await expect(page.locator("#previewOverlay")).toBeVisible();
  });
});
