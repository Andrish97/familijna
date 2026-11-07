// Seria zrzutów obszaru „logos-market”: biblioteka logo, edytory logo (tekst,
// rysunek, obraz), Społeczność (/marketplace/)
// Prawdziwy kod stron; dane tylko w atrapie (db: …). Sceny, które już są
// w scenes.cjs (logos, logos-draw, logos-image, logo-text, logo-draw,
// logo-image, logo-text-space, logos-name-create, marketplace,
// marketplace-my-sent), nie są tu powtarzane.
const { id, IDS } = require("../data/demo.cjs");

const CAT = "logos-market";

// Gry Producenta: lista gier producenta z danych sceny, pozostałe akcje { ok: true }.

const LIST = ["web/logos/index.html", "web/logos/js/list.js", "web/logos/css/", "web/logos/js/db.js", "web/logos/js/transfer.js"];
const TEXT_ED = ["web/logos/editor/text/", "web/logos/js/text.js", "web/logos/js/editor-text.js", "web/logos/js/editor-page.js"];
const DRAW_ED = ["web/logos/editor/draw/", "web/logos/js/draw", "web/logos/js/editor-draw.js", "web/logos/js/editor-page.js"];
const IMAGE_ED = ["web/logos/editor/image/", "web/logos/js/image.js", "web/logos/js/editor-image.js", "web/logos/js/editor-page.js"];
const MARKET = ["web/marketplace/"];

const EDITOR_DEVICES = ["desktop", "tablet"];

const wait = (ms) => async (view) => { await view.waitForTimeout(ms); };
const click = (selector, ms = 400) => async (view) => { await view.locator(selector).first().click(); await view.waitForTimeout(ms); };
const openModal = (selector, modal = ".overlay:visible") => async (view) => {
  await view.locator(selector).first().click();
  await view.locator(modal).first().waitFor({ state: "visible", timeout: 5000 });
  await view.waitForTimeout(300);
};
// Po kliknięciu narzędzia kursor zostaje nad przyciskiem (podpowiedź title) -- odsuwamy go.
const mouseAway = async (view) => { await view.mouse.move(4, 600); await view.waitForTimeout(300); };
const selectLogo = (n = 0) => async (view) => {
  await view.locator("#grid .logoTile").nth(n).click();
  await view.waitForTimeout(300);
};

// Nowe, puste logo danego typu (jak tworzy je lista: wiersz od razu, edytor z id w adresie).
const EMPTY_TEXT = id("8300", 90);
const EMPTY_DRAW = id("8300", 91);
const EMPTY_IMAGE = id("8300", 92);
const emptyRows = () => Array.from({ length: 10 }, () => " ".repeat(30));
const ZERO_BITS = Buffer.alloc(Math.ceil((150 * 70) / 8)).toString("base64");
const EMPTY_NAMES = { pl: ["Nowe logo", "Nowy rysunek", "Nowy obraz"], en: ["New logo", "New drawing", "New image"], uk: ["Нове лого", "Новий малюнок", "Нове зображення"] };
function addEmptyLogos(db, lang = "pl") {
  const [nText, nDraw, nImage] = EMPTY_NAMES[lang] || EMPTY_NAMES.pl;
  const row = (logoId, name, type, payload) => ({ id: logoId, user_id: db.user.id, name, type, payload, created_at: "2026-10-20T10:00:00Z", updated_at: "2026-10-20T10:00:00Z", is_demo: false, received_from_label: null, received_from_identity: null });
  db.tables.user_logos.push(
    row(EMPTY_TEXT, nText, "GLYPH_30x10", { layers: [{ color: "main", rows: emptyRows() }], source: { mode: "TEXT", text: "" } }),
    row(EMPTY_DRAW, nDraw, "PIX_150x70", { w: 150, h: 70, format: "BITPACK_MSB_FIRST_ROW_MAJOR", bits_b64: ZERO_BITS, source: { mode: "DRAW" } }),
    row(EMPTY_IMAGE, nImage, "PIX_150x70", { w: 150, h: 70, format: "BITPACK_MSB_FIRST_ROW_MAJOR", bits_b64: ZERO_BITS, source: { mode: "IMAGE" } }),
  );
}

// Plik .famlogo do okna importu: logo tekstowe z danych wypalonych prawdziwym edytorem.
const baked = require("../data/logos.baked.json");
function famlogo(lang) {
  const item = baked.find((x) => x.type === "GLYPH_30x10") || baked[0];
  return JSON.stringify({ type: item.type, name: item.names[lang] || item.names.pl, payload: item.payloads?.[lang] || item.payload });
}
const chooseImportFile = (content, name) => async (view, { lang }) => {
  await view.locator("#btnImport").click();
  await view.locator("#logoImportOverlay").waitFor({ state: "visible" });
  const body = typeof content === "function" ? content(lang) : content;
  await view.locator("#inpImportLogoFile").setInputFiles({ name, mimeType: "application/json", buffer: Buffer.from(body) });
  await view.waitForTimeout(600);
};

// ---------- Społeczność ----------
const SUBMIT_DESC = { pl: "Dziesięć pytań na rodzinne spotkanie — od jedzenia po wakacje.", en: "Ten questions for a family get-together — from food to holidays.", uk: "Десять питань для родинної зустрічі — від їжі до відпустки." };
 // pierwsza gra PL z market_public_catalog (demo.cjs)
function marketDetail(db, extra = {}) {
  const qs = db.tables.questions.filter((q) => q.game_id === IDS.game).sort((a, b) => a.ord - b.ord).slice(0, 6)
    .map((q) => ({ text: q.text, answers: db.tables.answers.filter((a) => a.question_id === q.id).sort((a, b) => a.ord - b.ord).map((a) => ({ text: a.text, fixed_points: a.fixed_points })) }));
  db.rpc.market_detail_extra = extra;
  db.rpc.market_detail_questions = qs;
  db.rpc.market_game_detail = `fn:(args, db) => {
    const all = [...db.rpc.market_public_catalog, ...(db.rpc.market_my_submissions || [])];
    const g = all.find((x) => x.id === args.p_id);
    if (!g) return null;
    return { status: "published", origin: "community", author_username: "", description: "", avg_rating: 0, rating_count: 0, library_count: 0, ...g,
      slug: "gra-" + String(g.id).slice(-3), payload: { questions: db.rpc.market_detail_questions }, ...db.rpc.market_detail_extra };
  }`;
  db.rpc.market_game_raters = [];
  db.rpc.market_game_by_slug = null;
}

module.exports = [
{ id: "logos-market-logos-empty", category: CAT, title: "Biblioteka logo — pusta lista (tekst)", path: "/logos/", sources: LIST, ready: ".logoShell.skel-step-ready",
    db: (db) => { db.tables.user_logos = []; } },
{ id: "logos-market-logos-empty-draw", category: CAT, title: "Biblioteka logo — pusta lista (rysunek)", path: "/logos/", sources: LIST, ready: ".logoShell.skel-step-ready",
    db: (db) => { db.tables.user_logos = []; }, steps: [click("#tabLogoDraw")] },
{ id: "logos-market-logos-selected", category: CAT, title: "Biblioteka logo — zaznaczone logo (aktywne przyciski)", path: "/logos/", sources: LIST, ready: ".logoTile", steps: [selectLogo(1)] },
{ id: "logos-market-logos-received", category: CAT, title: "Biblioteka logo — otrzymane kopie jako kafle propozycji zaraz po kaflu tworzenia (podgląd, ✓/✕ w rogu), liczniki w linii na wypustkach", path: "/logos/", sources: [...LIST, "web/shared/js/core/resource-copy-inbox.js", "web/shared/js/core/proposed-tile.js"], ready: '.logoTile[data-proposed] .logoPrev canvas',
    db: (db, lang) => {
      const from = require("../data/panel.cjs")[lang].friends.accepted;
      const text = db.tables.user_logos.filter((l) => l.type === "GLYPH_30x10");
      const rows = [
        { ...text[0], id: id("8f41", 1), name: { pl: "Turniej klasowy", en: "Class tournament", uk: "Класний турнір" }[lang], received_from_label: from[0][0], created_at: "2026-10-21T08:00:00Z", updated_at: "2026-10-21T08:00:00Z" },
        { ...text[1 % text.length], id: id("8f41", 2), name: { pl: "Gala 2026", en: "Gala 2026", uk: "Гала 2026" }[lang], received_from_label: from[1][0], created_at: "2026-10-20T08:00:00Z", updated_at: "2026-10-20T08:00:00Z" },
      ];
      db.tables.user_logos.push(...rows);
      db.rpc.resource_copy_inbox = { ok: true, items: rows.map((l, i) => ({ id: id("8f30", i + 1), name: l.name, sender_label: l.received_from_label, variant: "GLYPH_30x10", logo_mode: "TEXT", resource_kind: "logo", logo_id: l.id, created_at: l.created_at })) };
      db.rpc.resource_copy_badges = { ok: true, items: [{ kind: "logo", variant: "GLYPH_30x10", mode: "TEXT", count: 2 }, { kind: "logo", variant: "PIX_150x70", mode: "DRAW", count: 1 }, { kind: "game", variant: "prepared", count: 3 }] };
    } },
{ id: "logos-market-logos-import", category: CAT, title: "Biblioteka logo — okno importu (bez pliku)", path: "/logos/", sources: LIST, ready: ".logoTile", steps: [openModal("#btnImport", "#logoImportOverlay")] },
{ id: "logos-market-logos-import-file", category: CAT, title: "Biblioteka logo — okno importu z podglądem wybranego pliku", path: "/logos/", sources: LIST, ready: ".logoTile",
    steps: [chooseImportFile(famlogo, "turniej.famlogo"), async (view) => { await view.locator("#logoImportPreviewWrap").waitFor({ state: "visible" }); }] },
{ id: "logos-market-logos-import-error", category: CAT, title: "Biblioteka logo — okno importu, błędny plik", path: "/logos/", sources: LIST, ready: ".logoTile",
    steps: [chooseImportFile("{ to nie jest logo", "zepsute.famlogo"), async (view) => { await view.locator("#logoImportErr").waitFor({ state: "visible" }); }] },
{ id: "logos-market-logos-import-done", category: CAT, title: "Biblioteka logo — import zakończony", path: "/logos/", sources: LIST, ready: ".logoTile",
    steps: [chooseImportFile(famlogo, "turniej.famlogo"), async (view) => { await view.locator("#btnLogoImportConfirm").click(); await view.locator("#btnLogoImportDone").waitFor({ state: "visible" }); await view.waitForTimeout(300); }] },
{ id: "logos-market-logos-preview", category: CAT, title: "Biblioteka logo — podgląd logo na wyświetlaczu", path: "/logos/", sources: [...LIST, "web/logos/js/render.js"], ready: ".logoTile",
    steps: [selectLogo(0), openModal("#btnPreview", "#previewOverlay"), wait(400)] },
{ id: "logos-market-logos-preview-draw", category: CAT, title: "Biblioteka logo — podgląd logo rysunkowego", path: "/logos/", sources: [...LIST, "web/logos/js/render.js"], ready: ".logoTile",
    steps: [click("#tabLogoDraw"), selectLogo(0), openModal("#btnPreview", "#previewOverlay"), wait(400)] },
{ id: "logos-market-logos-rename", category: CAT, title: "Biblioteka logo — zmiana nazwy (dwuklik)", path: "/logos/", sources: [...LIST, "web/shared/js/core/rename-gesture.js", "web/shared/js/core/modal.js"], ready: ".logoTile",
    steps: [async (view, { device }) => {
      const tile = view.locator("#grid .logoTile").first();
      if (device === "phone") { await tile.tap(); await tile.tap(); } else await tile.dblclick();
      await view.locator(".uni-modal").first().waitFor({ state: "visible" });
      await view.waitForTimeout(300);
    }] },
{ id: "logos-market-logos-delete", category: CAT, title: "Biblioteka logo — potwierdzenie usunięcia", path: "/logos/", sources: [...LIST, "web/shared/js/core/modal.js"], ready: ".logoTile",
    steps: [openModal("#grid .logoTile .x", ".uni-modal")] },
{ id: "logos-market-logos-send", category: CAT, title: "Biblioteka logo — wysyłanie kopii znajomemu (wybrany znajomy, wcześniejsze wysyłki)", path: "/logos/", sources: [...LIST, "web/shared/js/core/resource-send.js", "web/shared/js/core/share-sections.js"], ready: ".logoTile",
    db: (db) => { const f = db.rpc.friends_list; db.rpc.resource_copy_history = { ok: true, items: [{ recipient_label: f[0].label, sent_at: "2026-10-18T17:40:00Z" }, { recipient_label: f[2].label, sent_at: "2026-10-12T09:15:00Z" }] }; },
    steps: [selectLogo(0), async (view) => {
      await view.locator("#btnSendCopy").click();
      await view.locator("#resourceSendOverlay").waitFor({ state: "visible" });
      await view.locator("#resourceSendOverlay .resource-send-friends input[type=checkbox]").nth(1).check({ force: true });
      await view.waitForTimeout(500);
    }] },
{ id: "logos-market-logos-export", category: CAT, title: "Biblioteka logo — eksport do pliku (okno postępu)", path: "/logos/", sources: [...LIST, "web/shared/js/core/modal.js"], ready: ".logoTile",
    steps: [selectLogo(0), openModal("#btnExport", ".uni-modal"), wait(500)] },
{ id: "logos-market-text-empty", category: CAT, title: "Edytor logo — tekst, nowe puste logo", path: `/logos/editor/text/?id=${EMPTY_TEXT}`, sources: TEXT_ED, ready: "#logoName:not([disabled])", devices: EDITOR_DEVICES, db: addEmptyLogos },
{ id: "logos-market-text-too-wide", category: CAT, title: "Edytor logo — tekst za szeroki (błąd szerokości)", path: `/logos/editor/text/?id=${IDS.logoText}`, sources: TEXT_ED, ready: "#logoName:not([disabled])", devices: EDITOR_DEVICES,
    steps: [async (view) => { await view.locator("#textValue").fill("WIELKI FINAŁ FAMILIJNEJ 2026"); await view.locator("#textWarn").waitFor({ state: "visible" }); await view.waitForTimeout(300); }] },
{ id: "logos-market-text-invalid", category: CAT, title: "Edytor logo — tekst z niedozwolonymi znakami (ostrzeżenie)", path: `/logos/editor/text/?id=${IDS.logoText}`, sources: TEXT_ED, ready: "#logoName:not([disabled])", devices: EDITOR_DEVICES,
    steps: [async (view) => { await view.locator("#textValue").fill("LATO @ 26 #&"); await view.locator("#textWarn").waitFor({ state: "visible" }); await view.waitForTimeout(400); }] },
{ id: "logos-market-text-invalid-wide", category: CAT, title: "Edytor logo — tekst za szeroki i z niedozwolonymi znakami (dwa ostrzeżenia)", path: `/logos/editor/text/?id=${IDS.logoText}`, sources: TEXT_ED, ready: "#logoName:not([disabled])", devices: EDITOR_DEVICES,
    steps: [async (view) => { await view.locator("#textValue").fill("WIELKI FINAŁ FAMILIJNEJ 2026 @#&"); await view.locator("#textWarn").waitFor({ state: "visible" }); await view.waitForTimeout(400); }] },
{ id: "logos-market-text-chars", category: CAT, title: "Edytor logo — tekst, wstawianie znaków z listy (LATO + spacja, 2, 6)", path: `/logos/editor/text/?id=${IDS.logoText}`, sources: TEXT_ED, ready: "#logoName:not([disabled])", devices: EDITOR_DEVICES,
    steps: [async (view) => { await view.locator("#textValue").fill("LATO"); }, click(".charKey.is-space", 150), click('.charKey[data-char="2"]', 150), click('.charKey[data-char="6"]', 400)] },
{ id: "logos-market-text-preview", category: CAT, title: "Edytor logo — tekst, podgląd na pełnym ekranie", path: `/logos/editor/text/?id=${IDS.logoText}`, sources: TEXT_ED, ready: "#logoName:not([disabled])", devices: EDITOR_DEVICES,
    steps: [openModal("#bigPreview", "#previewOverlay"), wait(400)] },
{ id: "logos-market-text-preview-zoom", category: CAT, title: "Edytor logo — podgląd na pełnym ekranie, przybliżony (ostre kropki po przybliżeniu)", path: `/logos/editor/text/?id=${IDS.logoText}`, sources: [...TEXT_ED, "web/shared/js/core/pinch-zoom.js"], ready: "#logoName:not([disabled])", devices: ["desktop"],
    steps: [openModal("#bigPreview", "#previewOverlay"), wait(400), async (view) => {
      const box = await view.locator("#bigPreviewFull").boundingBox();
      await view.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.45);
      for (let i = 0; i < 8; i++) { await view.mouse.wheel(0, -120); await view.waitForTimeout(40); }
      await view.waitForTimeout(600);
    }] },
{ id: "logos-market-editor-phone", category: CAT, title: "Edytor logo na telefonie — blokada urządzenia", path: `/logos/editor/text/?id=${IDS.logoText}`, sources: [...TEXT_ED, "web/shared/js/core/device-guard.js"], ready: () => true, devices: ["phone"], settle: 1500 },
{ id: "logos-market-editor-busy", category: CAT, title: "Edytor logo — logo edytowane w innej karcie (blokada)", path: `/logos/editor/text/?id=${IDS.logoText}`, sources: [...TEXT_ED, "web/shared/js/core/resource-lock.js"], ready: () => true, devices: EDITOR_DEVICES, settle: 1500,
    db: (db) => { db.rpc.acquire_edit_locks = { ok: false, error: "locked", blocker_type: "logo", blocker_context: "logo-editor", resource: { type: "logo", id: IDS.logoText } }; } },
{ id: "logos-market-draw-empty", category: CAT, title: "Edytor rysunku — nowe puste logo", path: `/logos/editor/draw/?id=${EMPTY_DRAW}`, sources: DRAW_ED, ready: () => !!window.__drawFabric, devices: EDITOR_DEVICES, settle: 1000, db: addEmptyLogos },
{ id: "logos-market-draw-selected", category: CAT, title: "Edytor rysunku — zaznaczony obiekt (ustawienia obiektu)", path: `/logos/editor/draw/?id=${IDS.logoDraw}`, sources: DRAW_ED, ready: () => window.__drawFabric?.getObjects().length > 0, devices: EDITOR_DEVICES, settle: 800,
    steps: [async (view) => { await view.evaluate(() => { const c = window.__drawFabric; const o = c.getObjects().find((x) => x.selectable !== false && x.type !== "image") || c.getObjects()[0]; c.setActiveObject(o); c.requestRenderAll(); c.fire("selection:created", { selected: [o] }); }); await view.waitForTimeout(500); }] },
{ id: "logos-market-draw-brush", category: CAT, title: "Edytor rysunku — pędzel (ustawienia narzędzia)", path: `/logos/editor/draw/?id=${IDS.logoDraw}`, sources: DRAW_ED, ready: () => window.__drawFabric?.getObjects().length > 0, devices: EDITOR_DEVICES, settle: 800,
    steps: [click("#tBrush", 500), mouseAway] },
{ id: "logos-market-draw-shapes", category: CAT, title: "Edytor rysunku — kształty (lista kształtów)", path: `/logos/editor/draw/?id=${IDS.logoDraw}`, sources: DRAW_ED, ready: () => window.__drawFabric?.getObjects().length > 0, devices: EDITOR_DEVICES, settle: 800,
    steps: [click("#tShapes", 500), click("#cShape .ui-select-btn", 400), async (view) => { await view.locator("#cShape.open .ui-select-menu").waitFor({ timeout: 3000 }).catch(() => {}); }, mouseAway] },
{ id: "logos-market-draw-text", category: CAT, title: "Edytor rysunku — narzędzie tekstu (wybór czcionki)", path: `/logos/editor/draw/?id=${IDS.logoDraw}`, sources: DRAW_ED, ready: () => window.__drawFabric?.getObjects().length > 0, devices: EDITOR_DEVICES, settle: 800,
    steps: [click("#tText", 500), click("#toolCtxSettings button", 400), async (view) => { await view.locator("#drawFontPickPop:not([hidden])").waitFor({ timeout: 3000 }); await view.locator("#drawFontPickPop").hover(); await view.waitForTimeout(800); }] },
{ id: "logos-market-draw-bg", category: CAT, title: "Edytor rysunku — tło sceny przełączone na białe", path: `/logos/editor/draw/?id=${IDS.logoDraw}`, sources: DRAW_ED, ready: () => window.__drawFabric?.getObjects().length > 0, devices: EDITOR_DEVICES, settle: 800,
    steps: [click("#tBg", 500), mouseAway] },
{ id: "logos-market-draw-preview", category: CAT, title: "Edytor rysunku — podgląd na wyświetlaczu", path: `/logos/editor/draw/?id=${IDS.logoDraw}`, sources: DRAW_ED, ready: () => window.__drawFabric?.getObjects().length > 0, devices: EDITOR_DEVICES, settle: 800,
    steps: [openModal("#tEye", "#previewOverlay"), wait(400)] },
{ id: "logos-market-image-empty", category: CAT, title: "Edytor obrazu — nowe logo bez obrazu", path: `/logos/editor/image/?id=${EMPTY_IMAGE}`, sources: IMAGE_ED, ready: "#logoName:not([disabled])", devices: EDITOR_DEVICES, settle: 800, db: addEmptyLogos },
{ id: "logos-market-image-preview", category: CAT, title: "Edytor obrazu — podgląd na pełnym ekranie", path: `/logos/editor/image/?id=${id("8300", 47)}`, sources: IMAGE_ED, ready: "#logoName:not([disabled])", devices: EDITOR_DEVICES, settle: 1500,
    steps: [wait(1000), openModal("#imgBigPreview", "#previewOverlay"), wait(400)] },
// Obrót o 90°: obraz staje się wysoki, układ dobiera się do nowych proporcji
{ id: "logos-market-image-rotated", category: CAT, title: "Edytor obrazu — obraz obrócony o 90° (układ z nowych proporcji)", path: `/logos/editor/image/?id=${id("8300", 47)}`, sources: IMAGE_ED, ready: "#logoName:not([disabled])", devices: [...EDITOR_DEVICES, "tablet-landscape"], settle: 1500,
    steps: [wait(800), click("#btnImgRotR", 1200)] },
// Prostowanie o dowolny kąt (suwak): układ dobrany po puszczeniu suwaka
{ id: "logos-market-image-straightened", category: CAT, title: "Edytor obrazu — prostowanie o 25° (układ z obrysu obróconego obrazu)", path: `/logos/editor/image/?id=${id("8300", 47)}`, sources: IMAGE_ED, ready: "#logoName:not([disabled])", devices: [...EDITOR_DEVICES, "tablet-landscape"], settle: 1500,
    steps: [wait(800), async (view) => {
      await view.evaluate(() => {
        const r = document.getElementById("rngImgStraighten");
        r.value = "25";
        r.dispatchEvent(new Event("input", { bubbles: true }));
        r.dispatchEvent(new Event("change", { bubbles: true }));
      });
      await view.waitForTimeout(1500);
    }] },
// Wysoki obraz (np. zdjęcie z telefonu) — układ pola obrazu i podglądu dobiera
// image.js z kształtu okna i proporcji obrazu. Plik rysowany w przeglądarce
// i podany przez #imgFile jak wybrany z dysku.
{ id: "logos-market-image-tall", category: CAT, title: "Edytor obrazu — wysoki obraz (układ z proporcji obrazu i okna)", path: `/logos/editor/image/?id=${id("8300", 47)}`, sources: IMAGE_ED, ready: "#logoName:not([disabled])", devices: [...EDITOR_DEVICES, "tablet-landscape"], settle: 1500,
    steps: [wait(800), async (view) => {
      await view.evaluate(async () => {
        const c = document.createElement("canvas"); c.width = 600; c.height = 1200;
        const g = c.getContext("2d");
        g.fillStyle = "#fff"; g.fillRect(0, 0, 600, 1200);
        g.fillStyle = "#000"; g.font = "bold 220px sans-serif"; g.textAlign = "center";
        g.fillText("TOP", 300, 300); g.beginPath(); g.arc(300, 640, 170, 0, Math.PI * 2); g.fill();
        g.fillText("10", 300, 1080);
        const blob = await new Promise((r) => c.toBlob(r, "image/png"));
        const dt = new DataTransfer(); dt.items.add(new File([blob], "wysoki.png", { type: "image/png" }));
        const inp = document.getElementById("imgFile"); inp.files = dt.files; inp.dispatchEvent(new Event("change", { bubbles: true }));
      });
      await view.waitForTimeout(1500);
    }] },
{ id: "logos-market-market-search-empty", category: CAT, title: "Społeczność — wyszukiwanie bez wyników", path: "/marketplace/", sources: MARKET, ready: ".mkt-card",
    steps: [async (view, { device }) => {
      const input = view.locator("#searchInput");
      if (await input.isVisible()) await input.fill("zzzz");
      else {
        // telefon: pole w oknie wyszukiwania (list-search), zatwierdzenie OK
        await view.locator("#btnSearchFocus").click();
        await view.locator(".uni-modal .uni-inp").fill("zzzz");
        await view.locator(".uni-modal .uni-inp").press("Enter");
      }
      await view.locator(".mkt-empty").waitFor({ state: "visible" });
      await view.waitForTimeout(300);
    }] },
{ id: "logos-market-market-filter", category: CAT, title: "Społeczność — filtr języka (lista otwarta)", path: "/marketplace/", sources: MARKET, ready: ".mkt-card",
    steps: [click("#langFilter .ui-select-btn, #langFilter", 900)] },
{ id: "logos-market-market-detail", category: CAT, title: "Społeczność — szczegóły gry z oceną", path: "/marketplace/", sources: MARKET, ready: ".mkt-card",
    db: (db) => marketDetail(db, { user_stars: 4 }),
    steps: [async (view) => { await view.locator(".mkt-card").first().click(); await view.locator("#gameDetailOverlay[data-detail-state=ready]").waitFor(); await view.waitForTimeout(400); }] },
{ id: "logos-market-market-detail-own", category: CAT, title: "Społeczność — podgląd własnej gry (lista oceniających)", path: "/marketplace/", sources: MARKET, ready: ".mkt-card",
    db: (db, lang) => { marketDetail(db, { author_username: db.user.user_metadata.username, description: SUBMIT_DESC[lang] || SUBMIT_DESC.pl, in_library: true }); db.rpc.market_game_raters = [["ania.k", 5], ["Wujek_Staszek", 4], ["quizmaster", 5], ["ola", 3]].map(([username, stars]) => ({ username, stars })); },
    steps: [openModal("#btnMySent", "#mySentOverlay"), wait(600), async (view) => { await view.locator("#mySentList [data-preview]").first().click(); await view.locator("#gameDetailOverlay[data-detail-state=ready]").waitFor(); await view.locator("#detailRaters:not([hidden])").waitFor(); await view.waitForTimeout(400); }] },
{ id: "logos-market-market-my-sent-all", category: CAT, title: "Społeczność — Moje wysłane: wszystkie statusy zgłoszeń", path: "/marketplace/", sources: MARKET, ready: ".mkt-card",
    db: (db) => { db.rpc.market_my_submissions = [...db.rpc.market_my_submissions, { id: id("8b80", 4), title: "Sylwester 2025", lang: "pl", status: "withdrawn", library_count: 17, avg_rating: 4.1, rating_count: 6 }]; },
    steps: [openModal("#btnMySent", "#mySentOverlay")] },
{ id: "logos-market-market-my-sent-empty", category: CAT, title: "Społeczność — Moje wysłane: brak zgłoszeń", path: "/marketplace/", sources: MARKET, ready: ".mkt-card",
    db: (db) => { db.rpc.market_my_submissions = []; }, steps: [openModal("#btnMySent", "#mySentOverlay")] },
{ id: "logos-market-market-withdraw", category: CAT, title: "Społeczność — potwierdzenie wycofania gry", path: "/marketplace/", sources: MARKET, ready: ".mkt-card",
    steps: [openModal("#btnMySent", "#mySentOverlay"), wait(600), openModal("#mySentList [data-withdraw]", ".uni-modal")] },
{ id: "logos-market-market-submit", category: CAT, title: "Społeczność — zgłoszenie nowej gry (formularz)", path: "/marketplace/", sources: MARKET, ready: ".mkt-card",
    steps: [openModal("#btnMySent", "#mySentOverlay"), wait(600), openModal("#btnSubmitNew", "#submitOverlay"), async (view, { lang }) => {
      await view.locator("#submitGameSelect .ui-select-btn, #submitGameSelect").first().click();
      await view.waitForTimeout(300);
      await view.locator("#submitGameSelect [role=option], #submitGameSelect .ui-select-option").first().click().catch(() => {});
      await view.locator("#submitTitle").fill(require("../data/panel.cjs")[lang].game);
      await view.locator("#submitDesc").fill(SUBMIT_DESC[lang] || SUBMIT_DESC.pl);
      await view.locator("#submitConfirm").check().catch(() => {});
      await view.waitForTimeout(300);
    }] },
{ id: "logos-market-market-submit-duplicate", category: CAT, title: "Społeczność — komunikat o kopii zestawu", path: "/marketplace/", sources: MARKET, ready: ".mkt-card",
    db: db => { db.rpc.market_submit_game = [{ ok: false, err: "duplicate_content", market_id: null }]; },
    steps: [openModal("#btnMySent", "#mySentOverlay"), wait(600), openModal("#btnSubmitNew", "#submitOverlay"), async (view, { lang }) => {
      await view.locator("#submitGameSelect .ui-select-btn").click();
      await view.locator("#submitGameSelect [role=option]").first().click();
      await view.locator("#submitTitle").fill(require("../data/panel.cjs")[lang].game);
      await view.locator("#submitDesc").fill(SUBMIT_DESC[lang] || SUBMIT_DESC.pl);
      await view.locator("#submitConfirm").check();
      await view.locator("#btnSubmitConfirm").click();
      await view.locator("#submitError:not([hidden])").waitFor();
    }] },
{ id: "logos-market-market-submit-none", category: CAT, title: "Społeczność — zgłoszenie: brak gier gotowych do wysłania", path: "/marketplace/", sources: MARKET, ready: ".mkt-card",
    db: (db) => { db.tables.games = []; },
    steps: [openModal("#btnMySent", "#mySentOverlay"), wait(600), openModal("#btnSubmitNew", "#submitOverlay")] },
{ id: "logos-market-market-guest", guest: true, category: CAT, title: "Społeczność — odwiedzający bez konta", path: "/marketplace/", sources: MARKET, ready: ".mkt-card",
    db: (db) => { db.rpc.market_public_catalog = db.rpc.market_public_catalog.map((g) => ({ ...g, in_library: false })); } },
{ id: "logos-market-market-guest-detail", guest: true, category: CAT, title: "Społeczność — szczegóły gry bez konta (bez oceniania)", path: "/marketplace/", sources: MARKET, ready: ".mkt-card",
    db: (db) => { db.rpc.market_public_catalog = db.rpc.market_public_catalog.map((g) => ({ ...g, in_library: false })); marketDetail(db); },
    steps: [async (view) => { await view.locator(".mkt-card").nth(1).click(); await view.locator("#gameDetailOverlay[data-detail-state=ready]").waitFor(); await view.waitForTimeout(500); }] }
];
