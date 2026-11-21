// Opcjonalna regresja przeglądarkowa: npm ci w tests i w Workerze,
// potem node cloudflare/maintenance-worker/test/public-browser.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Miniflare, Response } from 'miniflare';
// Pliki strony przychodzą z bindingu ASSETS (Workers Static Assets), pozostałe
// żądania (Supabase) przez fetch — ten sam podstawiony serwer obsługuje oba.
const assetsOrigin = (handler) => ({ outboundService: handler, serviceBindings: { ASSETS: handler } });
const root = fileURLToPath(new URL('../../../', import.meta.url));
const { chromium } = createRequire(import.meta.url)(path.join(root, 'tests/node_modules/@playwright/test'));
const mime = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json', '.webp':'image/webp', '.svg':'image/svg+xml', '.png':'image/png' };
const bundle = await build({ entryPoints:[path.join(root,'cloudflare/maintenance-worker/src/index.js')], bundle:true, write:false, format:'esm', platform:'browser', target:'es2022' });
const mf = new Miniflare({ modules:true, script:bundle.outputFiles[0].text, compatibilityDate:'2024-01-01', kvNamespaces:['MAINT_KV'], ...assetsOrigin(async(request) => {
  const file = path.resolve(root, 'web', `.${new URL(request.url).pathname}`);
  if (!file.startsWith(path.join(root,'web')+path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return new Response('Not found',{status:404});
  return new Response(fs.readFileSync(file),{headers:{'Content-Type':mime[path.extname(file)]||'application/octet-stream'}});
})});
const browser = await chromium.launch({headless:true});
try {
  for (const width of [390,1400]) for (const earlyClick of [false,true]) {
    const context = await browser.newContext({viewport:{width,height:900},serviceWorkers:'block'});
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    let release, started;
    const gate = new Promise(resolve => {release=resolve;});
    const pending = new Promise(resolve => {started=resolve;});
    await context.route('**/*',async route => {
      const req=route.request(), url=new URL(req.url());
      if (url.hostname!=='www.familijna.app') return route.abort();
      if (url.pathname==='/manual/content/pl.js') {started(); await gate;}
      const response=await mf.dispatchFetch(req.url(),{method:req.method(),headers:req.headers(),redirect:'manual'});
      const headers=Object.fromEntries(response.headers); delete headers['content-length']; delete headers['content-encoding'];
      await route.fulfill({status:response.status,headers,body:Buffer.from(await response.arrayBuffer())}).catch(()=>{});
    });
    try {
      await page.goto('https://www.familijna.app/manual/?ch=6&lang=pl&from=9',{waitUntil:'domcontentloaded'});
      await pending;
      const image=await page.locator('.m-shot-zoom img').first().elementHandle();
      assert.ok(image);
      assert.equal(await page.locator('#manualArticle').getAttribute('data-manual-chapter'),'6');
      if (earlyClick) {
        await page.locator('.m-pager-link.next').click();
        assert.equal(new URL(page.url()).searchParams.get('ch'),'7');
        assert.equal(await page.locator('link[rel=canonical]').getAttribute('href'),'https://www.familijna.app/manual/?ch=7');
      }
      release();
      await page.waitForFunction(()=>document.documentElement.dataset.manualReady==='true');
      if (!earlyClick) {
        assert.equal(await image.evaluate(node=>node.isConnected),true);
        await page.locator('.m-shot-zoom').first().click();
        await page.locator('#imgvOverlay.is-open .imgv-img').waitFor({state:'visible'});
      }
      assert.deepEqual(errors,[]);
      console.log(`OK ${width}px: ${earlyClick?'link before JS ready':'SSR image stays attached and zoom works'}`);
    } finally {release(); await context.close();}
  }
} finally {await browser.close(); await mf.dispose();}
