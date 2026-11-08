const { test, expect } = require('./helpers/e2e-test');
const { serveBranchCode } = require('./helpers/branch-code');
const { resetMailProviderLimits, waitForEmail, extractHttpLinks } = require('./helpers/mailbox');
const { expectMailDocument } = require('./helpers/mail-document');
const { generateE2EToken } = require('./helpers/e2e-token');
const URL = 'https://www.familijna.app/mails/';
test.use({ serviceWorkers: 'block' });
// E25: właściciel i skrzynka bez konta wypożyczane na worker (tests/README.md
// „Test accounts”). Preferencję adresu (email_unsub_tokens) i linki centrum
// maili (mail_center_links) czyści wypożyczenie (migracja 460) -- bez fikstur
// e2e_subscriber_mail_flag i /_e2e_api/mail-center-* (usunięte w 463/464).
test.use({ needs: { standard: 1, noaccount: 1, resources: ['mail'] } });
// Adres bez konta tego workera -- ustawiany z fixture na początku testu.
let EMAIL = null;
async function branch(context) {
  if (process.env.GITHUB_REF_NAME !== 'main' && process.env.TEST_BRANCH_CODE !== '0') await serveBranchCode(context, { pages: ['mails', 'go', 'subscribers'] });
  await context.addInitScript(() => { localStorage.setItem('uiLang', 'pl'); localStorage.setItem('fam:app_rating_suppressed', 'true'); });
  // Prośba o link wymaga Turnstile (E24 R7): atrapa widżetu, a Worker przy
  // podpisanym X-E2E-Token weryfikuje token testowym kluczem Cloudflare.
  await context.addInitScript(() => { window.turnstile = { render(_el, opts) { setTimeout(() => opts.callback('e2e-fake-token'), 0); return 1; }, remove() {} }; });
  await context.route('**/_api/mail/request', route => route.continue({ headers: { ...route.request().headers(), 'X-E2E-Token': generateE2EToken(process.env.E2E_BYPASS_SECRET) } }));
}
async function cleanup(page) {
  return page.evaluate(async email => {
    const { data, error } = await window.__sbClient.rpc('e2e_subscriber_email_cleanup', { p_email: email });
    if (error || !data?.ok) throw error || new Error('Subscriber cleanup failed');
  }, EMAIL);
}
async function state(page) { return page.evaluate(async () => (await fetch('/_api/mail/session', { cache: 'no-store' })).json()); }
function proofLink(email) { return extractHttpLinks(email).find(link => /^[a-f0-9]{64}$/.test(new globalThis.URL(link).searchParams.get('m') || '')); }

test('mail360: rzeczywista stopka, listy, globalna rezygnacja i potwierdzenie przy mail-off', async ({ page, context, browser, accounts, loginAs, mailbox }, testInfo) => {
  test.setTimeout(420000);
  const [outsider] = accounts.noaccount;
  EMAIL = outsider.email;
  await branch(context);
  await loginAs(page, context, accounts.standard[0]);
  const anonymous = await browser.newContext({ viewport: { width: 1400, height: 1000 }, serviceWorkers: 'block' });
  const second = await browser.newContext({ serviceWorkers: 'block' });
  await branch(anonymous); await branch(second);
  const center = await anonymous.newPage();
  const entry = await second.newPage();
  let games = [], deviceToken;
  try {
    await cleanup(page);
    await mailbox.clear(outsider); await resetMailProviderLimits(page);
    const after = new Date(Date.now() - 2000).toISOString();
    await page.goto('https://www.familijna.app/subscribers/');
    await expect(page.locator('[data-skel-step]')).toHaveClass(/skel-step-ready/);
    await expect(page.locator('#inviteForm')).toBeVisible();
    await page.locator('#inviteInput').fill(EMAIL);
    const sendResponse = page.waitForResponse(response => response.url().includes('/functions/v1/send-mail') && response.request().method() === 'POST', { timeout: 15000 });
    await page.locator('#inviteForm button[type=submit]').click();
    const sent = await sendResponse; expect(sent.ok()).toBe(true);
    expect(await sent.json()).toMatchObject({ ok: true, queued: 1 });
    await expect(page.locator('.rowsSection--pending .shareRow').filter({ hasText: EMAIL })).toHaveCount(1);
    const email = await waitForEmail({ recipient: EMAIL, after, subject: /subskrypc|subscript|підпис/i, timeout: 180000 });
    expectMailDocument(email, { globalUnsub: true });
    const footer = proofLink(email); expect(footer).toBeTruthy();
    await center.goto(footer);
    await expect(center.locator('#mailTitle')).toHaveText('Moje powiadomienia');
    await expect(center.locator('#mailAddress')).toHaveText(EMAIL);
    await expect(center.locator('#subscriptionBadge')).toHaveText('1');
    await center.locator('#subscriptionList').getByRole('button', { name: 'Akceptuj', exact: true }).click();
    // Przy 1400 px pasek zakładek (z plakietką) jest ukryty w CSS, więc samo
    // toBeHidden nie czeka na akceptację -- czekamy na wiersz i stan sesji.
    await expect(center.locator('#subscriptionList .mail-row--subscription')).toHaveAttribute('data-state', 'active');
    await expect(center.locator('#subscriptionBadge')).toBeHidden();
    await expect.poll(async () => (await state(center)).subscriptions[0]?.status).toBe('active');
    const session = (await anonymous.cookies()).find(cookie => cookie.name === '__Host-familijna-mail');
    expect(session).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Strict', path: '/' });
    expect(new globalThis.URL(center.url()).searchParams.has('m')).toBe(false);
    expect(await center.evaluate(() => Object.values(localStorage).some(value => /^[a-f0-9]{64}$/.test(value)))).toBe(false);
    // Build current sources through the real sharing RPCs, not direct task inserts.
    const resources = await page.evaluate(async email => {
      const sb = window.__sbClient, owner = (await sb.auth.getUser()).data.user.id;
      window.__mail360Games = [];
      const create = async (type, name) => {
        const { data, error } = await sb.from('games').insert({ owner_id: owner, type, status: 'draft', name }).select('id,share_key_poll').single();
        if (error) throw error; window.__mail360Games.push(data.id); return data;
      };
      const poll = await create('poll_text', 'Wieczór rodzinny');
      const control = await create('prepared', 'Finał turnieju');
      const questions = await sb.from('questions').insert(Array.from({ length: 10 }, (_, i) => ({ game_id: poll.id, ord: i + 1, text: `Pytanie ${i + 1}` })));
      if (questions.error) throw questions.error;
      const opened = await sb.rpc('poll_open', { p_game_id: poll.id, p_key: poll.share_key_poll }); if (opened.error) throw opened.error;
      const subscribers = await sb.rpc('subscribers_list'); if (subscribers.error) throw subscribers.error;
      const subscriber = subscribers.data.find(item => item.email === email && item.status === 'active');
      const shared = await sb.rpc('poll_share_send', { p_game_id: poll.id, p_friend_ids: [], p_subscriber_ids: [subscriber.id] });
      if (shared.error || !shared.data?.ok || shared.data.created !== 1) throw shared.error || new Error('Poll share fixture failed');
      const runtime = await sb.rpc('control_runtime_session_touch', { p_game_id: control.id }); if (runtime.error || !runtime.data?.ok) throw runtime.error || new Error('Control session fixture failed');
      const device = await sb.rpc('control_device_share_create', { p_game_id: control.id, p_device_type: 'host', p_recipient_email: email });
      if (device.error || !device.data?.ok) throw device.error || new Error('Device share fixture failed');
      return { games: [poll.id, control.id], token: device.data.token };
    }, EMAIL);
    games = resources.games; deviceToken = resources.token;
    await center.reload();
    await expect(center.locator('#subscriptionPanel')).toBeVisible();
    await expect(center.locator('#itemsPanel')).toBeVisible();
    await expect(center.locator('#itemsBadge')).toHaveText('2');
    await expect(center.locator('#itemsList .mail-row--poll')).toHaveCount(1);
    await expect(center.locator('#itemsList .mail-row--device')).toHaveCount(1);
    const devices = (await state(center)).items.filter(item => item.kind === 'device');
    expect(devices[0].link).toMatch(/^\/go\/\?d=host&id=[a-f0-9-]+&key=[a-f0-9-]+$/);
    // Ekran prowadzącego wymaga dotyku — link otwieramy jak na telefonie.
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
    const device = await phone.newPage();
    try {
      await device.goto(new globalThis.URL(devices[0].link, URL).href);
      await expect(device).toHaveURL(/\/control\/host\//);
      await expect(device.locator('#paper')).toBeVisible({ timeout: 15000 });
    } finally { await phone.close(); }
    await center.screenshot({ path: testInfo.outputPath('shot-mail360-active-1400.png'), fullPage: true });
    await center.setViewportSize({ width: 390, height: 844 });
    await center.screenshot({ path: testInfo.outputPath('shot-mail360-active-390.png'), fullPage: true });
    await center.locator('[data-split-tab=items]').click();
    await expect(center.locator('#itemsPanel')).toBeVisible();
    await expect(center.locator('#subscriptionPanel')).toBeHidden();
    expect(new globalThis.URL(center.url()).searchParams.get('tab')).toBe('items');
    await center.locator('[data-split-tab=subscriptions]').click();
    expect(new globalThis.URL(center.url()).searchParams.has('tab')).toBe(false);
    expect(await center.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const denied = await center.evaluate(async () => (await fetch('/_api/mail/notifications', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: false }) })).status);
    expect(denied).toBe(403); expect((await state(center)).notifications_enabled).toBe(true);
    await center.locator('#mailPreferenceButton').click(); await center.locator('.uni-foot .btn.gold').click();
    await expect(center.locator('#mailPreferenceTitle')).toHaveText('Powiadomienia są wyłączone');
    await expect(center.locator('#mailLists')).toBeHidden();
    const off = await state(center); expect(off.items).toEqual([]); expect(off.subscriptions).toEqual([]);
    expect(await page.evaluate(async token => (await window.__sbClient.rpc('control_device_share_resolve', { p_token: token })).data.ok, deviceToken)).toBe(false);
    await center.screenshot({ path: testInfo.outputPath('shot-mail360-disabled-390.png'), fullPage: true });
    // A new proof is still sent while ordinary notifications are globally off.
    await mailbox.clear(outsider); const confirmationAfter = new Date(Date.now() - 2000).toISOString();
    await entry.goto(URL); await entry.locator('#mailInput').fill(EMAIL); await entry.locator('#mailForm button').click();
    await expect(entry.locator('#mailTitle')).toHaveText('Sprawdź swoją skrzynkę');
    const verification = await waitForEmail({ recipient: EMAIL, after: confirmationAfter, timeout: 180000 });
    const tokenLink = proofLink(verification); expect(tokenLink).toBeTruthy();
    expect((await second.request.head(tokenLink, { maxRedirects: 0 })).status()).toBe(302);
    expect((await second.request.get(tokenLink, { maxRedirects: 0 })).status()).toBe(302);
    await entry.goto(tokenLink); await expect(entry.locator('#mailTitle')).toHaveText('Otwórz centrum maili');
    await entry.screenshot({ path: testInfo.outputPath('shot-mail360-confirmation.png'), fullPage: true });
    await entry.goto(tokenLink); await expect(entry.locator('#mailTitle')).toHaveText('Otwórz centrum maili');
    await entry.getByRole('button', { name: 'Otwórz moje powiadomienia', exact: true }).click();
    await expect(entry.locator('#mailPreferenceTitle')).toHaveText('Powiadomienia są wyłączone');
    await entry.locator('#mailPreferenceButton').click();
    await expect(entry.locator('#mailPreferenceTitle')).toHaveText('Powiadomienia są włączone');
    const restored = await state(entry); expect(restored.items).toEqual([]); expect(restored.subscriptions).toEqual([]);
    await entry.screenshot({ path: testInfo.outputPath('shot-mail360-restored-empty.png'), fullPage: true });
    // No preview consumes a proof; explicit use consumes it exactly once.
    await center.goto(tokenLink); await expect(center.locator('#mailTitle')).toHaveText('Ten link już nie działa');
  } finally {
    // Every independent cleanup runs even if an earlier cleanup failed.
    const jobs = [
      async () => {
        const ids = games.length ? games : await page.evaluate(() => window.__mail360Games || []);
        if (ids.length) await page.evaluate(async ids => { const { error } = await window.__sbClient.from('games').delete().in('id', ids); if (error) throw error; }, ids);
      },
      () => cleanup(page),
      () => mailbox.clear(outsider),
      () => anonymous.close(), () => second.close(),
    ];
    const errors = [];
    for (const job of jobs) { try { await job(); } catch (error) { errors.push(error); } }
    if (errors.length) throw new AggregateError(errors, 'Mail center cleanup failed');
  }
});

test('mail360: brak dostepu, nieaktualny link i adres konta prowadzi do logowania', async ({ page, context, accounts }, testInfo) => {
  await branch(context);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(URL);
  await expect(page.locator('#mailForm')).toBeVisible(); await expect(page.locator('#mailLists')).toBeHidden();
  await page.screenshot({ path: testInfo.outputPath('shot-mail360-entry-390.png'), fullPage: true });
  const publicSession = await state(page); expect(publicSession.ok).toBe(false); expect(publicSession.subscriptions).toBeUndefined(); expect(publicSession.items).toBeUndefined();
  await page.goto(URL + '?m=' + 'a'.repeat(64));
  await expect(page.locator('#mailTitle')).toHaveText('Ten link już nie działa');
  await page.screenshot({ path: testInfo.outputPath('shot-mail360-expired-390.png'), fullPage: true });
  await page.locator('#mailInput').fill(accounts.standard[0].email); await page.locator('#mailForm button').click();
  await expect(page.locator('#mailTitle')).toHaveText('Masz konto w Familijnej');
  await expect(page.locator('#mailActions a')).toHaveAttribute('href', '/login/?next=account');
  await expect(page.locator('#mailLists')).toBeHidden();
  await page.setViewportSize({ width: 844, height: 390 });
  await page.screenshot({ path: testInfo.outputPath('shot-mail360-registered-landscape.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
