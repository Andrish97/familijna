import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import {fixtureOrigin,row,detail,gameId} from './market-fixture.mjs';
let mf,bundle;
const state={},requests=[];
before(async()=>{
 bundle=(await build({entryPoints:[new URL('../src/index.js',import.meta.url).pathname],bundle:true,write:false,format:'esm',platform:'browser',target:'es2022'})).outputFiles[0].text;
 mf=new Miniflare({modules:true,script:bundle,compatibilityDate:'2024-01-01',kvNamespaces:['MAINT_KV'],bindings:{SUPABASE_URL:'https://api.test',SUPABASE_ANON_KEY:'anon-only'},outboundService:fixtureOrigin(state,requests)});
});
after(async()=>mf?.dispose());
test('catalogue uses existing UI, full crawlable links and equal HTML for people/bots in every locale',async()=>{
 for(const lang of ['pl','en','uk']){
  const suffix=lang==='pl'?'':`?lang=${lang}`;
  const response=await mf.dispatchFetch('https://www.familijna.app/marketplace'+suffix,{headers:{Authorization:'Bearer PRIVATE_SESSION',Cookie:'PRIVATE_COOKIE=1'}});
  const html=await response.text();
  assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'no-store');
  assert.equal(response.headers.get('Content-Language'),lang);
  assert.ok(html.includes(`href="https://www.familijna.app/marketplace${suffix}"`));
  assert.match(html,/<a class="mkt-card[^>]+href="\/marketplace\/game\/dzieci-i-rodzice/);
  assert.match(html,/<h2 class="mkt-card-title">Dzieci i rodzice/);
  assert.equal((html.match(/rel="canonical"/g)||[]).length,1);
  assert.doesNotMatch(html,/page-loading|noindex|FAQPage/);
  const bot=await mf.dispatchFetch('https://www.familijna.app/marketplace'+suffix,{headers:{'User-Agent':'Googlebot'}});
  assert.equal(await bot.text(),html);
 }
 for(const req of requests.filter(r=>r.path.startsWith('/rest/'))){assert.equal(req.authorization,'Bearer anon-only');assert.equal(req.cookie,null);}
});
test('game is an open existing modal with questions, its own metadata, safe bootstrap and Game schema',async()=>{
 for(const lang of ['pl','en','uk']){
  const url=`https://www.familijna.app/marketplace/game/${row.slug}?lang=${lang}&q=ignored&ret=%2Fgames%2F`;
  const response=await mf.dispatchFetch(url),html=await response.text();
  assert.equal(response.status,200);
  assert.match(html,/<title>Dzieci i rodzice — Familijna<\/title>/);
  assert.ok(html.includes(`rel="canonical" href="https://www.familijna.app/marketplace/game/${row.slug}"`));
  const modal=html.match(/<div[^>]*id="gameDetailOverlay"[^>]*>/)?.[0];
  assert.ok(modal&&!/\bhidden\b/.test(modal));
  assert.match(html,/<h1 class="mTitle" id="detailTitle">Dzieci i rodzice/);
  assert.match(html,/Pytanie &lt;script&gt;/);
  assert.doesNotMatch(html,/<script>bad|PRIVATE_EMAIL|PRIVATE_NOTE|PRIVATE_PAYLOAD|user_stars|in_library|FAQPage/);
  const boot=JSON.parse(html.match(/id="marketBootstrap">([\s\S]*?)<\/script>/)[1]);
  assert.equal(boot.game.status,'published');assert.equal(boot.game.payload.questions.length,1);
  const schema=JSON.parse(html.match(/data-market-schema>([\s\S]*?)<\/script>/)[1]);
  assert.equal(schema['@type'],'Game');assert.equal(schema.inLanguage,'pl');
  const bot=await mf.dispatchFetch(url,{headers:{'User-Agent':'Googlebot'}});assert.equal(await bot.text(),html);
 }
});
test('HEAD agrees, public UUID redirects, unknown and withdrawn games are 404 for both UAs',async()=>{
 const head=await mf.dispatchFetch(`https://www.familijna.app/marketplace/game/${row.slug}?lang=en`,{method:'HEAD'});
 assert.equal(head.status,200);assert.equal(head.headers.get('Content-Language'),'en');assert.equal(await head.text(),'');
 const redirect=await mf.dispatchFetch(`https://www.familijna.app/marketplace/game/${gameId}`,{redirect:'manual'});
 assert.equal(redirect.status,301);assert.ok(redirect.headers.get('Location').endsWith('/'+row.slug));
 for(const ua of ['Mozilla/5.0','Googlebot']){
  const missing=await mf.dispatchFetch('https://www.familijna.app/marketplace/game/unknown-game',{headers:{'User-Agent':ua}});assert.equal(missing.status,404);await missing.text();
 }
 state.withdrawn=true;
 const gone=await mf.dispatchFetch(`https://www.familijna.app/marketplace/game/${row.slug}`);assert.equal(gone.status,404);await gone.text();
 state.withdrawn=false;state.game={...detail,status:'pending'};
 const hidden=await mf.dispatchFetch(`https://www.familijna.app/marketplace/game/${row.slug}`);assert.equal(hidden.status,404);await hidden.text();
 delete state.game;
});
test('API or template failure is 503, never an empty 200 or a false 404',async()=>{
 // Świeża instancja: bez katalogu w pamięci Workera (60 s), jak pierwsze wejście po błędzie bazy.
 for(const flag of ['fail','originFail']){
  const local={[flag]:true};
  const fresh=new Miniflare({modules:true,script:bundle,compatibilityDate:'2024-01-01',kvNamespaces:['MAINT_KV'],bindings:{SUPABASE_URL:'https://api.test',SUPABASE_ANON_KEY:'anon-only'},outboundService:fixtureOrigin(local,[])});
  try {
   for(const path of ['/marketplace','/marketplace/game/'+row.slug]){
    const response=await fresh.dispatchFetch('https://www.familijna.app'+path);
    assert.equal(response.status,503);assert.equal(response.headers.get('Retry-After'),'60');await response.text();
   }
  } finally { await fresh.dispose(); }
 }
});
test('catalogue page keeps the public catalogue in Worker memory; detail is always fresh',async()=>{
 const calls=[];
 const fresh=new Miniflare({modules:true,script:bundle,compatibilityDate:'2024-01-01',kvNamespaces:['MAINT_KV'],bindings:{SUPABASE_URL:'https://api.test',SUPABASE_ANON_KEY:'anon-only'},outboundService:fixtureOrigin({},calls)});
 try {
  for(const path of ['/marketplace','/marketplace?lang=en','/marketplace/game/'+row.slug,'/marketplace/game/'+row.slug]){
   const response=await fresh.dispatchFetch('https://www.familijna.app'+path);assert.equal(response.status,200);await response.text();
  }
  const rpc=name=>calls.filter(c=>c.path.endsWith('/rpc/'+name)).length;
  assert.equal(rpc('market_public_catalog'),1);
  assert.equal(rpc('market_game_by_slug'),2);
 } finally { await fresh.dispose(); }
});
test('private preview URL has noindex and never contains non-public payload or account state',async()=>{
 const response=await mf.dispatchFetch('https://www.familijna.app/marketplace/?game='+gameId);
 assert.equal(response.status,200);assert.equal(response.headers.get('X-Robots-Tag'),'noindex, nofollow');
 const html=await response.text();assert.doesNotMatch(html,/Pytanie &lt;script|PRIVATE_|user_stars|in_library/);
 assert.equal(JSON.parse(html.match(/id="marketBootstrap">([\s\S]*?)<\/script>/)[1]).game,null);
});
test('sitemap is fresh and public; 105 games are not truncated and counter updates do not invent lastmod',async()=>{
 state.rows=Array.from({length:105},(_,i)=>({...row,id:`00000000-0000-4000-8000-${String(i).padStart(12,'0')}`,slug:'public-game-'+i,updated_at:'2099-01-01'}));
 // Świeża instancja: katalog Społeczności z poprzednich testów siedzi w pamięci Workera (60 s).
 const fresh=new Miniflare({modules:true,script:bundle,compatibilityDate:'2024-01-01',kvNamespaces:['MAINT_KV'],bindings:{SUPABASE_URL:'https://api.test',SUPABASE_ANON_KEY:'anon-only'},outboundService:fixtureOrigin(state,[])});
 let response=await fresh.dispatchFetch('https://www.familijna.app/marketplace');
 assert.equal(((await response.text()).match(/<a class="mkt-card/g)||[]).length,105);await fresh.dispose();
 response=await mf.dispatchFetch('https://www.familijna.app/sitemap.xml');let xml=await response.text();
 assert.equal(response.headers.get('Cache-Control'),'no-store');assert.equal((xml.match(/<loc>[^<]+\/marketplace\/game\//g)||[]).length,105);assert.doesNotMatch(xml,/2099/);
 state.rows=[];
 response=await mf.dispatchFetch('https://www.familijna.app/sitemap.xml');xml=await response.text();assert.doesNotMatch(xml,/public-game-/);assert.match(xml,/\/manual\//);
 delete state.rows;
 state.fail=true;response=await mf.dispatchFetch('https://www.familijna.app/sitemap.xml');assert.equal(response.status,503);await response.text();delete state.fail;
});
test('maintenance gate applies equally and does not query public API',async()=>{
 const calls=[];
 const other=new Miniflare({modules:true,script:bundle,compatibilityDate:'2024-01-01',kvNamespaces:['MAINT_KV'],bindings:{SUPABASE_URL:'https://api.test',SUPABASE_ANON_KEY:'anon-only'},outboundService:fixtureOrigin({},calls)});
 try{
  await (await other.getKVNamespace('MAINT_KV')).put('state',JSON.stringify({enabled:true,mode:'message'}));
  for(const ua of ['Mozilla/5.0','Googlebot']){
   const response=await other.dispatchFetch('https://www.familijna.app/marketplace/game/'+row.slug,{headers:{'User-Agent':ua}});assert.equal(response.status,503);assert.equal(response.headers.get('Retry-After'),'300');await response.text();
  }
  assert.ok(calls.every(c=>!c.path.startsWith('/rest/')));
 }finally{await other.dispose();}
});
