const { test, expect } = require('./helpers/e2e-test');
const { serveBranchCode, serveBranchLoginHtml } = require('./helpers/branch-code');

test.use({ needs: { standard: 1 }, serviceWorkers: 'block' });

test('niewidoczne przekierowania: sesja rozstrzyga trasę przed pierwszą klatką', async ({ page, context, accounts, loginAs }) => {
  if (process.env.TEST_BRANCH_CODE === '1') {
    await serveBranchCode(context, { pages: ['index', 'games', 'friends', 'go'] });
    await context.route('https://www.familijna.app/login/**', async route => {
      if (route.request().isNavigationRequest() && new URL(route.request().url()).pathname === '/login/') return serveBranchLoginHtml(route);
      return route.fallback();
    });
  }
  await loginAs(page, context, accounts.standard[0]);
  let source = '', target = '', visibleFrames = 0;
  let diagLogged = false;
  await page.exposeBinding('__routeFrame', (_, path, state) => {
    if (path !== source) return;
    visibleFrames++;
    // [e2e-diag]: stan strony przy pierwszej widocznej klatce źródła przekierowania.
    if (!diagLogged) { diagLogged = true; console.log(`[e2e-diag] atomic ${source}→${target}: ${state}`); }
  });
  await page.addInitScript(() => {
    const frame = () => {
      if (document.body) {
        const css = getComputedStyle(document.body);
        if (css.visibility !== 'hidden' && Number(css.opacity) > 0) {
          const root = document.documentElement;
          const attrs = (el) => [...el.attributes].map((a) => a.name === 'class' ? `.${a.value.trim().split(/\s+/).join('.')}` : a.name).join(' ');
          void window.__routeFrame(location.pathname, `html[${attrs(root)}] body[${attrs(document.body)}] opacity=${css.opacity} ready=${document.readyState}`);
        }
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
  await page.route('**/*', async route => {
    if (route.request().isNavigationRequest() && new URL(route.request().url()).pathname === target) {
      // Docelowy HTML jeszcze nie dotarł: źródło nie może mignąć w tym czasie.
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    return route.fallback();
  });
  for (const width of [390, 360, 1400]) {
    await page.setViewportSize({ width, height: width === 1400 ? 900 : 844 });
    for (const [path, destination] of [['/', '/games/'], ['/login/', '/games/'], ['/login/?next=friends', '/friends/']]) {
      source = new URL(path, 'https://www.familijna.app').pathname;
      target = destination;
      visibleFrames = 0;
      diagLogged = false;
      await page.goto(path, { waitUntil: 'domcontentloaded' });
      await page.waitForURL(url => url.pathname === destination, { waitUntil: 'domcontentloaded' });
      await expect(page.locator('html')).not.toHaveAttribute('data-layout-pending', '', { timeout: 15000 });
      expect(visibleFrames, `${source} → ${destination}, ${width}px: widoczne klatki źródła`).toBe(0);
    }
    const toggle = page.locator('.topbar-menu-toggle');
    const menu = page.locator('#topbarAccountMenu');
    for (let attempt = 0; attempt < 2; attempt++) {
      if (width < 600) await toggle.click();
      else await page.locator('#who, #whoStatic').click();
      await expect(menu.getByRole('button', { name: 'Ustawienia konta', exact: true })).toBeVisible();
      await expect(menu.getByRole('button', { name: 'Wyloguj', exact: true })).toBeVisible();
      if (width < 600) await page.locator('.topbar-menu-toggle').click();
      else await page.locator('main').click({ position: { x: 2, y: 2 } });
    }
  }
  source = ''; target = '';
  await page.goto('/login/?force_auth=1', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#btnPrimary')).toBeVisible({ timeout: 15000 });
  expect(new URL(page.url()).pathname).toBe('/login/');
  await page.goto('/go/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('main[data-skel-step]')).toHaveClass(/skel-step-ready/);
  await expect(page.locator('body')).toHaveCSS('opacity', '1');
});
