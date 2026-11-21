// Prawdziwy Worker + frontend; atrapa jedynie danych API. Wymaga Playwrighta z tests.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import {fixtureOrigin,row,detail} from './market-fixture.mjs';
// Pliki strony przychodzą z bindingu ASSETS (Workers Static Assets), pozostałe
// żądania (Supabase) przez fetch — ten sam podstawiony serwer obsługuje oba.
const assetsOrigin = (handler) => ({ outboundService: handler, serviceBindings: { ASSETS: handler } });
const root=fileURLToPath(new URL('../../../',import.meta.url));
const {chromium}=createRequire(import.meta.url)(path.join(root,'tests/node_modules/@playwright/test'));
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.webp':'image/webp','.png':'image/png','.woff2':'font/woff2'};
const bundle=(await build({entryPoints:[path.join(root,'cloudflare/maintenance-worker/src/index.js')],bundle:true,write:false,format:'esm',platform:'browser',target:'es2022'})).outputFiles[0].text;
const state={},api=fixtureOrigin(state);
const mf=new Miniflare({modules:true,script:bundle,compatibilityDate:'2024-01-01',kvNamespaces:['MAINT_KV'],bindings:{SUPABASE_URL:'https://api.test',SUPABASE_ANON_KEY:'anon-only'},...assetsOrigin(async req=>{
 const u=new URL(req.url);if(u.pathname.startsWith('/rest/'))return api(req);
 const file=path.resolve(root,'web','.'+u.pathname);
 return file.startsWith(path.join(root,'web')+path.sep)&&fs.existsSync(file)&&fs.statSync(file).isFile()?new Response(fs.readFileSync(file),{headers:{'Content-Type':mime[path.extname(file)]||'application/octet-stream'}}):new Response('missing',{status:404});
})});
const browser=await chromium.launch({headless:true});
const out=process.env.MARKET_SCREEN_DIR;
if(out)fs.mkdirSync(out,{recursive:true});
let checks=0;
try{
 for(const lang of ['pl','en','uk','browser-en'])for(const width of [390,1400])for(const js of [false,true]){
  const context=await browser.newContext({viewport:{width,height:900},isMobile:width===390,hasTouch:width===390,javaScriptEnabled:js,serviceWorkers:'block'});
  context.setDefaultTimeout(12000);context.setDefaultNavigationTimeout(20000);
  const errors=[];let publicCalls=0,blocked=true;
  await context.route('**/*',async route=>{
   const req=route.request(),u=new URL(req.url());
   if(u.hostname==='api.familijna.app'){
    if(blocked)return route.abort();
    const headers={'Content-Type':'application/json','Access-Control-Allow-Origin':'https://www.familijna.app','Access-Control-Allow-Headers':'apikey,authorization,content-type,x-client-info,prefer,accept,accept-profile,content-profile,range,x-supabase-api-version','Access-Control-Allow-Methods':'POST,GET,OPTIONS'};
    if(req.method()==='OPTIONS')return route.fulfill({status:200,headers,body:''});
    const fn=u.pathname.split('/').pop();let data;
    if(fn==='market_public_catalog'){publicCalls++;data=[row];}
    else if(fn==='market_game_detail'||fn==='market_game_by_slug'){data={...detail,in_library:false,user_stars:null};if(!req.headers().accept?.includes('vnd.pgrst.object'))data=[data];}
    else if(fn==='market_my_library')data=[];
    else throw new Error('Unexpected browser RPC '+fn);
    return route.fulfill({status:200,headers,body:JSON.stringify(data)});
   }
   if(u.hostname!=='www.familijna.app')return route.abort();
   const response=await mf.dispatchFetch(req.url(),{method:req.method(),headers:req.headers(),redirect:'manual'});
   const headers=Object.fromEntries(response.headers);delete headers['content-length'];delete headers['content-encoding'];
   await route.fulfill({status:response.status,headers,body:Buffer.from(await response.arrayBuffer())});
  });
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  try{
   console.log(`START ${lang}/${width}/${js}`);
   const uiLang=lang==='browser-en'?'en':lang;
   if(lang==='browser-en')await context.addInitScript(()=>localStorage.setItem('uiLang','en'));
   await page.goto(`https://www.familijna.app/marketplace/game/${row.slug}${lang==='browser-en'?'':`?lang=${lang}`}`,{waitUntil:'domcontentloaded'});
   const question=await page.locator('#detailQuestions .q-preview-text').first().elementHandle();assert.ok(question);
   await page.locator('#gameDetailOverlay').waitFor({state:'visible'});
   assert.equal(await page.locator('link[rel=canonical]').getAttribute('href'),'https://www.familijna.app/marketplace/game/'+row.slug);
   if(js){
    await page.waitForFunction(()=>document.documentElement.dataset.marketReady==='true');
    assert.equal(await question.evaluate(el=>el.isConnected),true);
    assert.equal(publicCalls,0,'hydration should not refetch public list');
    if(width===390)await page.locator('#gameDetailOverlay .sheet-handle').click();else await page.locator('#btnDetailClose').click();
    await page.locator('#gameDetailOverlay').waitFor({state:'hidden'});
    assert.equal(new URL(page.url()).pathname,'/marketplace/');
    assert.equal(await page.locator('link[rel=canonical]').getAttribute('href'),'https://www.familijna.app/marketplace'+(uiLang==='pl'?'':'?lang='+uiLang));
    blocked=false;
    await page.locator('#browseGrid a.mkt-card').first().click();
    await page.locator('#gameDetailOverlay[data-detail-state=ready]').waitFor({state:'visible'});
    assert.ok(new URL(page.url()).pathname.endsWith(row.slug));
    assert.equal(await page.locator('link[rel=canonical]').getAttribute('href'),'https://www.familijna.app/marketplace/game/'+row.slug);
   }else{
    if(out)await page.screenshot({path:path.join(out,`game-${lang}-${width}-nojs.png`)});
    await page.locator('#marketNoJsBack').click();
    assert.equal(new URL(page.url()).pathname,'/marketplace');
    await page.locator('#browseGrid a.mkt-card').first().click();
    await page.locator('#gameDetailOverlay').waitFor({state:'visible'});
   }
   const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);assert.equal(overflow,false);
   assert.deepEqual(errors,[]);checks++;
   console.log(`OK ${lang}/${width}/${js?'JS':'no JS'}: content, modal, links and canonical`);
  }catch(error){
    console.log(JSON.stringify(await page.evaluate(()=>({url:location.href,animations:document.getAnimations().map(a=>({time:a.currentTime,state:a.playState})),elements:['#gameDetailOverlay','.mkt-modal-detail','#marketNoJsBack','.mkt-games-card'].map(s=>{const e=document.querySelector(s),c=getComputedStyle(e),b=e.getBoundingClientRect();return {s,rect:{x:b.x,y:b.y,w:b.width,h:b.height},position:c.position,z:c.zIndex,opacity:c.opacity,animation:c.animation,hidden:e.hidden};})}))));
    throw error;
  }finally{await context.close();}
 }
 console.log(JSON.stringify({checks,result:'passed'}));
}finally{await browser.close();await mf.dispose();}
