const { test, expect } = require('./helpers/e2e-test');
const { serveBranchCode } = require('./helpers/branch-code');
test.use({ serviceWorkers: 'block', needs: { standard: 1 } });
test.beforeEach(async ({ context }) => {
  if (process.env.TEST_BRANCH_CODE === '1') await serveBranchCode(context, { pages: ['games', 'games/settings'] });
});

test('ikony stanu: oko zmienia części i typ hasła bez wymiany SVG lub zmiany rozmiaru', async ({ page }) => {
  for (const width of [390, 360, 1400]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/login/?lang=pl', { waitUntil: 'domcontentloaded' });
    const button = page.locator('.pass-toggle').first();
    await expect(button).toHaveAttribute('aria-label', 'Pokaż hasło');
    await expect(button).toBeVisible();
    await expect(page.locator('html')).not.toHaveAttribute('data-layout-pending', '');
    const box = await button.boundingBox();
    const original = await button.locator('svg').elementHandle();
    await button.click();
    await expect(page.locator('#pass')).toHaveAttribute('type', 'text');
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    await expect(button.locator('[data-icon-part="slash"]')).toHaveCSS('opacity', '1');
    expect(await button.locator('svg').evaluate((el, before) => el === before, original)).toBe(true);
    expect(await button.boundingBox()).toEqual(box);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await button.click();
    await expect(page.locator('#pass')).toHaveAttribute('type', 'password');
    await expect(button.locator('[data-icon-part="iris"]')).toHaveCSS('opacity', '1');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
  }
});

test('ikony stanu: strzałki listy i konta odzwierciedlają otwarcie oraz Escape', async ({ page, context, accounts, loginAs }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await loginAs(page, context, accounts.standard[0]);
  await page.goto('/games/?lang=pl');
  const select = page.locator('.list-filter .ui-select-btn').first();
  await expect(select).toBeVisible();
  await expect(page.locator('html')).not.toHaveAttribute('data-layout-pending', '');
  const box = await select.boundingBox();
  await select.click();
  await expect(select).toHaveAttribute('aria-expanded', 'true');
  await expect(select.locator('[data-icon-part="chevron"]')).toHaveCSS('transform', 'matrix(-1, 0, 0, -1, 0, 0)');
  expect(await select.boundingBox()).toEqual(box);
  await page.keyboard.press('Escape');
  await expect(select).toHaveAttribute('aria-expanded', 'false');
  const who = page.locator('.account-btn').first();
  await who.focus(); await page.keyboard.press('Enter');
  await expect(who).toHaveAttribute('aria-expanded', 'true');
  await expect(who.locator('[data-icon-part="chevron"]')).toHaveCSS('transform', 'matrix(-1, 0, 0, -1, 0, 0)');
  await page.keyboard.press('Escape');
  await expect(who).toHaveAttribute('aria-expanded', 'false');
  await expect(who).toBeFocused();
});

test('ikony stanu: zapis potwierdza wynik bazy, a Powiel rusza kartkami tylko podczas żądania', async ({ page, context, accounts, loginAs }) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width: 1400, height: 900 });
  await loginAs(page, context, accounts.standard[0]);
  const ids = [];
  let releaseSave, releaseCopy;
  try {
    const id = await page.evaluate(async () => {
      const db = window.__sbClient;
      const { data: auth } = await db.auth.getUser();
      const { data: game, error } = await db.from('games').insert({ owner_id: auth.user.id, name: 'E2E-ICON-' + Date.now(), type: 'prepared', status: 'draft' }).select('id,name').single();
      if (error) throw new Error('create icon fixture failed');
      const questions = Array.from({ length: 10 }, (_, i) => ({ text: 'Pytanie testowe ' + (i + 1), answers: [{ text: 'A', fixed_points: 40 }, { text: 'B', fixed_points: 30 }, { text: 'C', fixed_points: 20 }] }));
      const { error: content } = await db.rpc('game_import_content', { p_game_id: game.id, p_name: game.name, p_questions: questions });
      if (content) { await db.from('games').delete().eq('id', game.id); throw new Error('create icon content failed'); }
      return game.id;
    });
    ids.push(id);
    const saveGate = new Promise(resolve => releaseSave = resolve);
    await page.route('**/rest/v1/rpc/game_settings_save', async route => {
      if (route.request().method() === 'POST') await saveGate;
      return route.continue();
    });
    await page.goto('/games/settings/?id=' + id + '&lang=pl&ret=' + encodeURIComponent('/games/?lang=pl'));
    await page.locator('#gsTeamA').fill('E2E A');
    const save = page.locator('#btnSaveAll');
    const saveBox = await save.boundingBox();
    await save.click();
    await expect(save).toHaveAttribute('aria-busy', 'true');
    await expect(save.locator('[data-icon-part="check"]')).toHaveCSS('opacity', '0');
    await expect(save.locator('[data-icon-part="slot"]')).toHaveCSS('opacity', '0.4');
    releaseSave();
    await expect(save).toHaveAttribute('data-icon-state', 'saved');
    await expect(save.locator('[data-icon-part="check"]')).toHaveCSS('opacity', '1');
    expect(await save.boundingBox()).toEqual(saveBox);
    await page.locator('#btnBack').click();
    await page.waitForURL(url => url.pathname === '/games/');
    await page.locator(`#grid .card[data-game-id="${id}"]`).click();
    const copyGate = new Promise(resolve => releaseCopy = resolve);
    await page.route('**/_api/resource-duplicate', async route => { await copyGate; return route.continue(); });
    const button = page.locator('#btnDuplicate');
    const box = await button.boundingBox();
    await button.click();
    await expect(button).toHaveAttribute('aria-busy', 'true');
    await expect(button.locator('[data-icon-part="front"]')).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 1, 1)');
    expect(await button.boundingBox()).toEqual(box);
    const response = page.waitForResponse(res => res.url().includes('/_api/resource-duplicate') && res.request().method() === 'POST');
    releaseCopy();
    const result = await (await response).json();
    expect(result.ok).toBe(true);
    ids.push(result.id);
    await expect(button).not.toHaveAttribute('aria-busy', 'true');
    await expect(button.locator('[data-icon-part="front"]')).toHaveCSS('transform', 'none');
  } finally {
    releaseSave?.(); releaseCopy?.();
    if (ids.length && !page.isClosed()) await page.evaluate(async ids => {
      const { error } = await window.__sbClient.from('games').delete().in('id', ids);
      if (error) throw new Error('cleanup icon fixtures failed');
    }, ids);
  }
});
