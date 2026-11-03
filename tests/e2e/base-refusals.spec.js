const { expectMailDocument } = require("./helpers/mail-document");
const { test, expect } = require("./helpers/e2e-test");
const { serveBranchCode } = require("./helpers/branch-code");
const { clearMailbox, waitForEmail, extractHttpLinks, resetMailProviderLimits, readMailDelivery, reservePairCooldown } = require("./helpers/mailbox");
const SITE = "https://www.familijna.app";
const branch = process.env.GITHUB_REF_NAME !== "main" && process.env.TEST_BRANCH_CODE !== "0";
test.use({ serviceWorkers: "block" });
// E25: konta wypożyczane na worker (tests/README.md „Test accounts”): właściciel
// accounts.standard[0], odbiorca accounts.standard[1]; testy czekają na
// prawdziwe maile do odbiorcy, więc plik wypożycza zasób poczty.
test.use({ needs: { standard: 2, resources: ["mail"] } });
test.beforeEach(async ({ context }) => { if (branch) await serveBranchCode(context, { pages: ["bases", "go"] }); });
async function rpc(page, name, args) {
  return page.evaluate(async ({ name, args }) => {
    const { data, error } = await window.__sbClient.rpc(name, args);
    if (error) throw new Error(`${name}: ${error.message}`);
    return data;
  }, { name, args });
}
async function ready(page) { await expect(page.locator('[data-skel-step]').first()).toHaveClass(/skel-step-ready/, { timeout: 30_000 }); }
async function createBase(page, name) {
  return page.evaluate(async name => {
    const user = (await window.__sbClient.auth.getUser()).data.user;
    const { data, error } = await window.__sbClient.from("question_bases")
      .insert({ name, owner_id: user.id }, { defaultToNull: false }).select("id").single();
    if (error) throw error; return data.id;
  }, name);
}
// Okno „Udostępnij bazę” (dolny pasek): adres + znajomi; po udanym wysłaniu zamyka się.
async function openShare(page, baseId) {
  await page.goto(`${SITE}/bases/`); await ready(page);
  await page.locator(`#mineGrid [data-base-id="${baseId}"]`).click();
  await page.locator("#btnShareSend").click();
  await expect(page.locator("#shareSendOverlay")).toBeVisible();
  await expect(page.locator("#baseShareFriends .shareRow, #baseShareFriends .shareEmpty").first()).toBeVisible();
}
// Okno „Udostępnienia” (górny pasek): lista udostępnionych, uprawnienie przy osobie.
async function openShares(page, baseId) {
  await page.goto(`${SITE}/bases/`); await ready(page);
  await page.locator(`#mineGrid [data-base-id="${baseId}"]`).click();
  await page.locator("#btnShare").click();
  await expect(page.locator("#shareOverlay")).toBeVisible();
  await expect(page.locator("#shareSectionsHost .shareRow, #shareSectionsHost .shareEmpty").first()).toBeVisible();
}
async function openShared(page) {
  await page.goto(`${SITE}/bases/?tab=shared`); await ready(page);
}

test("bazy337: rzeczywisty mail, odmowa i opuszczenie, undo, role oraz cofnięcie", async ({ page, context, browser, accounts, loginAs }) => {
  test.setTimeout(300_000);
  await loginAs(page, context, accounts.standard[0]);
  const recipientContext = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });
  if (branch) await serveBranchCode(recipientContext, { pages: ["bases", "go"] });
  const recipient = await recipientContext.newPage();
  let baseId = null, recipientId = null, recipientEmail = null;
  const name = `E2E-B337-${Date.now()}`;
  try {
    await loginAs(recipient, recipientContext, accounts.standard[1]);
    const identity = await recipient.evaluate(async () => (await window.__sbClient.auth.getUser()).data.user);
    recipientId = identity.id; recipientEmail = identity.email;
    await rpc(page, "e2e_friendships_cleanup", { p_other_user_id: recipientId });
    const friendship = await rpc(page, "friends_invite", { p_handle: recipientEmail });
    expect(friendship.ok).toBe(true);
    expect((await rpc(recipient, "friends_accept", { p_id: friendship.id })).ok).toBe(true);
    baseId = await createBase(page, name);
    await clearMailbox(recipientEmail); await resetMailProviderLimits(page);
    const after = new Date().toISOString();
    await openShare(page, baseId);
    const friend = page.locator(`#baseShareFriends [data-id="${recipientId}"]`);
    await friend.locator('input[type="checkbox"]').check();
    await page.locator('#shareRole label:has(input[value="viewer"])').click(); // editor -> viewer (przełącznik dwóch stanów w stopce okna)
    await page.locator("#btnShareAdd").click();
    await expect(page.locator("#shareSendOverlay")).toBeHidden();
    await openShares(page, baseId);
    const sharedRow = page.locator("#shareSectionsHost .shareRow");
    await expect(sharedRow).toHaveCount(1);
    await expect(sharedRow.locator('[data-act="resend"]')).toBeDisabled();
    await expect(sharedRow.locator(".baseShareRole")).toHaveAttribute("data-value", "viewer");
    const tasks = await rpc(page, "list_base_share_tasks_outgoing", { p_base_id: baseId });
    const taskId = tasks[0].task_id;
    const tokenInfo = await rpc(page, "base_share_panel", { p_base_id: baseId });
    expect(tokenInfo.outgoing[0].status).toBe("pending");
    // Duplicate po e-mailu/nazwie nie tworzy kolejnego zaproszenia ani maila.
    await openShare(page, baseId);
    await expect(page.locator(`#baseShareFriends [data-id="${recipientId}"]`)).toHaveCount(0);
    await page.locator("#shareEmail").fill(recipientEmail);
    await page.locator("#btnShareAdd").click();
    // Komunikaty udostępniania to wspólny dymek (toast), nie pole w oknie.
    await expect(page.locator(".app-toast-text")).toContainText(/oczekuje|pending/i);
    // Dymek błędu zostaje do zamknięcia (nie znika sam po kilku sekundach).
    expect((await rpc(page, "list_base_share_tasks_outgoing", { p_base_id: baseId })).length).toBe(1);
    const email = await waitForEmail({ recipient: recipientEmail, after, subject: /baz|base/i, timeout: 150_000 });
    const sentBy = await readMailDelivery({ recipient: recipientEmail, after });
    console.log("[e2e-diag] mail provider", JSON.stringify({
      queue: (sentBy.queue || []).map(row => ({ status: row.status, attempts: row.attempts, provider: row.provider_used, error: row.last_error })),
      events: (sentBy.events || []).filter(row => row.provider || row.error).map(row => ({ fn: row.function_name, event: row.event, provider: row.provider, error: row.error })),
    }));
    expectMailDocument(email, { accountFooter: true, text: ["przeglądający", "Dostęp otrzymasz po akceptacji zaproszenia."] });
    const link = extractHttpLinks(email).find(url => new URL(url).pathname === "/go/" && new URL(url).searchParams.has("b"));
    expect(link).toBeTruthy();
    await recipient.goto(link); await expect(recipient.locator("#message")).toContainText(/udostępnia.*bazę/);
    await recipient.locator("#actions button").click();
    await expect.poll(() => new URL(recipient.url()).pathname).toBe("/bases/");
    const proposed = recipient.locator(`#sharedGrid [data-base-id="${baseId}"][data-proposed="1"]`);
    await expect(proposed).toBeVisible(); await proposed.locator("[data-decline]").click();
    await expect(proposed).toHaveCount(0);
    const head = recipient.locator("#baseDeclinesHost .rowsSectionHead");
    await expect(head).toHaveAttribute("aria-expanded", "false");
    for (const width of [1400, 390]) {
      await recipient.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await openShared(recipient);
      await expect(head).toHaveAttribute("aria-expanded", "false"); await head.click();
      await expect(recipient.locator('#baseDeclinesHost [data-act="undo"]')).toBeVisible();
      expect(await recipient.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    await openShares(page, baseId);
    await expect(sharedRow).toContainText("Odrzucono");
    await expect(sharedRow.locator('[data-act="resend"]')).toHaveCount(0);
    expect(await rpc(recipient, "base_share_accept", { p_task_id: taskId })).toBe(false);
    await recipient.locator('#baseDeclinesHost [data-act="undo"]').click();
    await expect(proposed).toBeVisible(); // undo nie przyznaje dostępu
    await expect(proposed.locator("[data-accept]")).toBeVisible();
    await proposed.locator("[data-accept]").click();
    await expect(recipient.locator(`#sharedGrid [data-base-id="${baseId}"]:not([data-proposed])`)).toBeVisible();
    expect(await rpc(recipient, "leave_shared_base", { p_base_id: baseId })).toBe(true);
    expect(await rpc(recipient, "leave_shared_base", { p_base_id: baseId })).toBe(false);
    await openShared(recipient); await head.click();
    await expect(recipient.locator('#baseDeclinesHost [data-act="undo"]')).toBeVisible();
    await recipient.locator('#baseDeclinesHost [data-act="undo"]').click(); await expect(proposed).toBeVisible();
    await openShares(page, baseId);
    await sharedRow.locator('.baseShareRole label:has(input[value="editor"])').click();
    await expect(sharedRow.locator(".baseShareRole")).toHaveAttribute("data-value", "editor");
    await proposed.locator("[data-accept]").click();
    await expect(proposed).toHaveCount(0);
    await openShares(page, baseId);
    await expect(sharedRow).toContainText("Zaakceptowano");
    await sharedRow.locator('.baseShareRole label:has(input[value="viewer"])').click();
    await expect(sharedRow.locator(".baseShareRole")).toHaveAttribute("data-value", "viewer");
    const access = await rpc(page, "list_base_shares", { p_base_id: baseId });
    expect(access[0].role).toBe("viewer");
    // Accepted access belongs to the base and survives removal of its original friendship.
    expect((await rpc(page, "friends_remove", { p_id: friendship.id })).ok).toBe(true);
    expect((await rpc(page, "list_base_shares", { p_base_id: baseId }))[0].role).toBe("viewer");
    await sharedRow.locator('[data-act="remove"]').click(); await expect(sharedRow).toHaveCount(0);
    expect((await rpc(recipient, "base_share_undo_decline", { p_task_id: taskId })).ok).toBe(false);
    expect(await rpc(recipient, "base_share_accept", { p_task_id: taskId })).toBe(false);
    await recipient.goto(link); await expect(recipient.locator(".poll-go-card")).toContainText(/cofnięt|anulowan|wygas|nieaktyw|nieważn/i);
  } finally {
    if (baseId) await page.evaluate(async id => { const { error } = await window.__sbClient.from("question_bases").delete().eq("id", id); if (error) throw error; }, baseId);
    if (recipientId) await rpc(page, "e2e_friendships_cleanup", { p_other_user_id: recipientId });
    if (recipientEmail) await clearMailbox(recipientEmail);
    await recipientContext.close();
  }
});

test("bazy337: wspólne sekcje, wszystkie stany, osobne przewijanie i blob 390/1400", async ({ page, context, accounts, loginAs }) => {
  test.setTimeout(120_000);
  await loginAs(page, context, accounts.standard[0]);
  const baseId = await createBase(page, `E2E-B337-UI-${Date.now()}`);
  const future = days => new Date(Date.now() + days * 86400000).toISOString();
  const panel = {
    ok: true,
    friends: Array.from({ length: 20 }, (_, n) => ({ user_id: `f${n}`, label: `Znajomy ${n + 1}`, email: `friend${n}@example.net`, cooldown_until: n === 0 ? future(1) : null })),
    outgoing: [
      { task_id: "pending", recipient_user_id: "r1", label: "Alicja", email: "alicja@example.net", role: "viewer", status: "pending", is_friend: true, email_enabled: true, cooldown_until: future(.5) },
      { task_id: "muted", recipient_user_id: "r2", label: "Piotr", email: "piotr@example.net", role: "editor", status: "opened", is_friend: false, email_enabled: false },
      { task_id: "declined", recipient_user_id: "r3", label: "Tomasz", email: "tomasz@example.net", role: "viewer", status: "declined", is_friend: false, email_enabled: true, cooldown_until: future(29) },
    ],
    active: Array.from({ length: 20 }, (_, n) => ({ user_id: `a${n}`, label: `Odbiorca ${n + 1}`, email: `active${n}@example.net`, role: n % 2 ? "viewer" : "editor", status: "done", is_friend: n % 2 === 0 })),
  };
  const refusals = [{ id: "own-refusal", base_id: "refused", name: "Quiz sportowy", owner_label: "Maja", role: "editor", expires_at: future(29) }];
  await page.route("**/rest/v1/rpc/base_share_panel", route => route.fulfill({ json: panel }));
  await page.route("**/rest/v1/rpc/base_declines_list_mine", route => route.fulfill({ json: refusals }));
  await page.route("**/rest/v1/rpc/base_share_by_user", route => route.fulfill({ json: [{ ok: false, err: "already_pending" }] }));
  try {
    for (const width of [1400, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      // Okno „Udostępnienia”: stany wierszy, własne przewijanie listy.
      await openShares(page, baseId);
      await expect(page.locator('#shareOverlay .shareSection')).toHaveCount(1);
      await expect(page.locator('#shareSectionsHost [data-id="pending"] [data-act="resend"]')).toBeDisabled();
      await expect(page.locator('#shareSectionsHost [data-id="muted"] [data-act="resend"]')).toHaveCount(0);
      await expect(page.locator('#shareSectionsHost [data-id="declined"] [data-act="resend"]')).toHaveCount(0);
      await expect(page.locator('#shareSectionsHost [data-id="declined"] .shareCountdown')).toBeVisible();
      const geometry = await page.evaluate(() => {
        const right = document.querySelector('#shareSectionsHost');
        right.scrollTop = 120;
        const row = document.querySelector('#shareSectionsHost [data-id="pending"]');
        // Przycisk uprawnienia ma napis (decyzja 2026-10-20) — porównujemy pozostałe.
        const buttons = [...row.querySelectorAll('.shareRowActions button:not(.baseShareRole)')].map(button => ({ width: Math.round(button.getBoundingClientRect().width), height: Math.round(button.getBoundingClientRect().height) }));
        return { scroll: right.scrollTop, overflow: document.documentElement.scrollWidth > innerWidth, buttons };
      });
      expect(geometry.scroll).toBe(120); expect(geometry.overflow).toBe(false);
      // Szerokość zależy od treści (licznik czasu przy „Ponów”); porównujemy wysokość.
      expect(new Set(geometry.buttons.map(button => button.height)).size).toBe(1);
      await page.locator('#btnShareDone').click();
      await expect(page.locator('#shareOverlay')).toBeHidden();
      // Okno „Udostępnij bazę”: cooldown znajomego, zaznaczenie, własne przewijanie, błąd zostawia okno otwarte.
      await openShare(page, baseId);
      await expect(page.locator('#shareSendOverlay .shareSection')).toHaveCount(2);
      await expect(page.locator('#baseShareFriends [data-id="f0"] input')).toBeDisabled();
      await expect(page.locator('#baseShareFriends [data-id="f0"]')).toHaveClass(/is-cooling-down/);
      await expect(page.locator('#btnShareAdd')).toBeDisabled();
      await page.locator('#baseShareFriends [data-id="f1"] input').check();
      await expect(page.locator('#btnShareAdd')).toBeEnabled();
      const sendGeometry = await page.evaluate(() => {
        const left = document.querySelector('#baseShareFriends'); left.scrollTop = 70;
        return { scroll: left.scrollTop, overflow: document.documentElement.scrollWidth > innerWidth };
      });
      expect(sendGeometry.scroll).toBe(70); expect(sendGeometry.overflow).toBe(false);
      await page.locator('#baseShareFriends [data-id="f1"] input').uncheck();
      await page.locator('#shareEmail').fill('alicja@example.net'); await page.locator('#btnShareAdd').click();
      await expect(page.locator('.app-toast-text')).toBeVisible();
      await expect(page.locator('#shareSendOverlay')).toBeVisible();
      await page.locator('#btnShareSendCancel').click();
      await expect(page.locator('#shareSendOverlay')).toBeHidden();
      await page.locator('#tabBasesShared').click();
      const head = page.locator('#baseDeclinesHost .rowsSectionHead');
      await expect(head).toHaveAttribute('aria-expanded', 'false'); await head.click();
      await expect(page.locator('#baseDeclinesHost [data-act="undo"]')).toBeVisible();
      await page.screenshot({ path: test.info().outputPath(`base-refusals-${width}.png`), fullPage: true });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await head.click();
    }
  } finally {
    await page.unroute("**/rest/v1/rpc/base_share_panel");
    await page.unroute("**/rest/v1/rpc/base_declines_list_mine");
    await page.unroute("**/rest/v1/rpc/base_share_by_user");
    await page.evaluate(async id => { const { error } = await window.__sbClient.from("question_bases").delete().eq("id", id); if (error) throw error; }, baseId);
  }
});

test("bazy337: mail-off udostępnia mimo mailowego cooldownu, bez kolejki; odmowa nadal blokuje", async ({ page, context, browser, accounts, loginAs }) => {
  test.setTimeout(120_000);
  await loginAs(page, context, accounts.standard[0]);
  const recipientContext = await browser.newContext({ serviceWorkers: "block" });
  if (branch) await serveBranchCode(recipientContext, { pages: ["bases", "go"] });
  const recipient = await recipientContext.newPage();
  let baseId = null, recipientId = null, previousFlag = null;
  async function setFlag(enabled) {
    await recipient.evaluate(async ({ userId, enabled }) => {
      const { error } = await window.__sbClient.from("user_flags").upsert({ user_id: userId, email_notifications: enabled });
      if (error) throw error;
    }, { userId: recipientId, enabled });
  }
  try {
    await loginAs(recipient, recipientContext, accounts.standard[1]);
    const user = await recipient.evaluate(async () => (await window.__sbClient.auth.getUser()).data.user);
    recipientId = user.id;
    previousFlag = await recipient.evaluate(async userId => {
      const { data, error } = await window.__sbClient.from("user_flags").select("email_notifications").eq("user_id", userId).maybeSingle();
      if (error) throw error; return data?.email_notifications ?? true;
    }, recipientId);
    await setFlag(true);
    await rpc(page, "e2e_friendships_cleanup", { p_other_user_id: recipientId });
    const friendship = await rpc(page, "friends_invite", { p_handle: user.email });
    expect(friendship.ok).toBe(true); expect((await rpc(recipient, "friends_accept", { p_id: friendship.id })).ok).toBe(true);
    baseId = await createBase(page, `E2E-B339-MUTED-${Date.now()}`);
    const ownerId = await page.evaluate(async () => (await window.__sbClient.auth.getUser()).data.user.id);
    const key = `pair:${ownerId}:${recipientId}:base:${baseId}`;
    const clock = await reservePairCooldown(page, "base:share", key);
    const initialUntil = clock[0].next_allowed_at;
    await openShare(page, baseId);
    const checkbox = page.locator(`#baseShareFriends [data-id="${recipientId}"] input`);
    await expect(checkbox).toBeDisabled();
    await setFlag(false);
    await openShare(page, baseId);
    await expect(checkbox).toBeEnabled();
    const after = new Date().toISOString();
    await checkbox.check(); await page.locator("#btnShareAdd").click();
    await expect(page.locator("#shareSendOverlay")).toBeHidden();
    await openShares(page, baseId);
    const rows = page.locator("#shareSectionsHost .shareRow"); await expect(rows).toHaveCount(1);
    await expect(rows.locator('[data-act="resend"]')).toHaveCount(0);
    const panel = await rpc(page, "base_share_panel", { p_base_id: baseId });
    expect(panel.outgoing[0].email_enabled).toBe(false);
    expect(await rpc(page, "base_share_resend", { p_task_id: panel.outgoing[0].task_id })).toEqual({ ok: true, mail_allowed: false });
    const unchanged = await rpc(page, "mail_cooldown_check", { p_action_key: "base:share", p_target_key: key });
    expect(unchanged[0].next_allowed_at).toBe(initialUntil);
    const delivery = await readMailDelivery({ recipient: user.email, after });
    expect(delivery.queue || []).toEqual([]); expect(delivery.events || []).toEqual([]);
    await openShared(recipient);
    const proposed = recipient.locator(`#sharedGrid [data-base-id="${baseId}"][data-proposed="1"]`);
    await proposed.locator('[data-accept]').click(); await expect(proposed).toHaveCount(0);
    expect(await rpc(recipient, "leave_shared_base", { p_base_id: baseId })).toBe(true);
    await openShare(page, baseId);
    await expect(checkbox).toBeDisabled();
    const refused = await rpc(page, "base_share_panel", { p_base_id: baseId });
    expect(refused.friends[0].email_enabled).toBe(false);
    expect(Date.parse(refused.friends[0].cooldown_until)).toBeGreaterThan(Date.now() + 29 * 86400000);
    const duplicate = await rpc(page, "base_share_by_user", { p_base_id: baseId, p_recipient_user_id: recipientId, p_role: "editor" });
    expect(duplicate[0].err).toBe("declined");
  } finally {
    if (previousFlag !== null) await setFlag(previousFlag);
    if (baseId) await page.evaluate(async id => { const { error } = await window.__sbClient.from("question_bases").delete().eq("id", id); if (error) throw error; }, baseId);
    if (recipientId) await rpc(page, "e2e_friendships_cleanup", { p_other_user_id: recipientId });
    await recipientContext.close();
  }
});


test("bazy357: dwa rzeczywiste maile, cofnięcie znajomości zamyka tylko pochodne zaproszenie", async ({ page, context, browser, accounts, loginAs }) => {
  test.setTimeout(420_000);
  await loginAs(page, context, accounts.standard[0]);
  const otherContext = await browser.newContext({ serviceWorkers: "block" });
  if (branch) await serveBranchCode(otherContext, { pages: ["bases", "go"] });
  const recipient = await otherContext.newPage();
  const bases = [];
  let recipientId, recipientEmail;
  try {
    await loginAs(recipient, otherContext, accounts.standard[1]);
    const user = await recipient.evaluate(async () => (await window.__sbClient.auth.getUser()).data.user);
    recipientId = user.id; recipientEmail = user.email;
    await rpc(page, "e2e_friendships_cleanup", { p_other_user_id: recipientId });
    const friendship = await rpc(page, "friends_invite", { p_handle: recipientEmail });
    expect(friendship.ok).toBe(true);
    expect((await rpc(recipient, "friends_accept", { p_id: friendship.id })).ok).toBe(true);
    const invites = [];
    for (const source of ["friend", "manual"]) {
      const name = `E2E-B357-${source}-${Date.now()}`;
      const id = await createBase(page, name); bases.push(id);
      await clearMailbox(recipientEmail); await resetMailProviderLimits(page);
      const after = new Date().toISOString();
      await openShare(page, id);
      if (source === "friend") {
        await page.locator(`#baseShareFriends [data-id="${recipientId}"] input`).check();
        const response = page.waitForResponse(res => res.url().endsWith("/rpc/base_share_to_friend") && res.request().method() === "POST");
        await page.locator("#btnShareAdd").click();
        expect((await response).ok()).toBe(true);
      } else {
        await page.locator("#shareEmail").fill(recipientEmail); await page.locator("#btnShareAdd").click();
      }
      await expect(page.locator("#shareSendOverlay")).toBeHidden();
      await openShares(page, id);
      await expect(page.locator("#shareSectionsHost .shareRow")).toHaveCount(1);
      const tasks = await rpc(page, "list_base_share_tasks_outgoing", { p_base_id: id });
      expect(tasks).toHaveLength(1);
      // Source columns are private (RLS deny all); SQL contracts verify them.
      const email = await waitForEmail({ recipient: recipientEmail, after, subject: new RegExp(name), timeout: 150_000 });
      expectMailDocument(email, { accountFooter: true, text: [name] });
      const link = extractHttpLinks(email).find(url => new URL(url).pathname === "/go/" && new URL(url).searchParams.has("b"));
      expect(link).toBeTruthy();
      invites.push({ id, task: tasks[0].task_id, link });
      await page.locator("#btnShareDone").click();
    }
    // A previously selected checkbox must not fall back to a direct invitation.
    const staleBase = await createBase(page, `E2E-B357-stale-${Date.now()}`); bases.push(staleBase);
    await openShare(page, staleBase);
    await page.locator(`#baseShareFriends [data-id="${recipientId}"] input`).check();
    expect((await rpc(page, "friends_remove", { p_id: friendship.id })).ok).toBe(true);
    const rejectedResponse = page.waitForResponse(res => res.url().endsWith("/rpc/base_share_to_friend") && res.request().method() === "POST");
    await page.locator("#btnShareAdd").click();
    const rejected = await (await rejectedResponse).json();
    expect(rejected[0].ok).toBe(false); expect(rejected[0].err).toBe("not_friend");
    await expect(page.locator(".app-toast-text")).toContainText("Ta osoba nie jest już na liście znajomych.");
    expect(await rpc(page, "list_base_share_tasks_outgoing", { p_base_id: staleBase })).toHaveLength(0);

    expect(await rpc(recipient, "base_share_accept", { p_task_id: invites[0].task })).toBe(false);
    expect((await rpc(recipient, "base_share_undo_decline", { p_task_id: invites[0].task })).ok).toBe(false);
    await recipient.goto(invites[0].link);
    // Strona Go: przyczyna w tytule karty (#title), opis bywa pusty.
    await expect(recipient.locator(".poll-go-card")).toContainText(/wygas|cofnięt|anulowan|nieaktyw|nieważn/i);
    await recipient.goto(invites[1].link);
    await expect(recipient.locator("#message")).toContainText(/udostępnia.*bazę/);
    await recipient.locator("#actions button").click();
    const proposed = recipient.locator(`#sharedGrid [data-base-id="${invites[1].id}"][data-proposed="1"]`);
    await expect(proposed).toBeVisible(); await proposed.locator("[data-accept]").click();
    await expect(recipient.locator(`#sharedGrid [data-base-id="${invites[1].id}"]:not([data-proposed])`)).toBeVisible();
    expect((await rpc(page, "list_base_shares", { p_base_id: invites[1].id })).some(row => row.user_id === recipientId)).toBe(true);
  } finally {
    for (const id of bases) await page.evaluate(async id => {
      const { error } = await window.__sbClient.from("question_bases").delete().eq("id", id); if (error) throw error;
    }, id);
    if (recipientId) await rpc(page, "e2e_friendships_cleanup", { p_other_user_id: recipientId });
    if (recipientEmail) await clearMailbox(recipientEmail);
    await otherContext.close();
  }
});
