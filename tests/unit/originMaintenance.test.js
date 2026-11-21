import test from 'node:test';
import assert from 'node:assert/strict';
import {serveMaintenance,fetchWith404,fetchFromOrigin,pageIndexPath,fetchWithOrigin,bindStaticAssets} from '../../cloudflare/maintenance-worker/src/lib/origin/origin.js';
const BASE='https://www.familijna.app';

// Pliki strony z bindingu ASSETS (Workers Static Assets); handler zwraca odpowiedź i zapisuje adresy.
function withAssets(handler){
 const asked=[];
 bindStaticAssets({ASSETS:{fetch:async req=>{asked.push(req.url);return handler(req);}}});
 return asked;
}

test('maintenance fetches its actual index instead of a directory redirect',async()=>{
 const asked=withAssets(()=>new Response('<h1>Maintenance</h1>',{headers:{'Content-Type':'text/html'}}));
 try {
  const response=await serveMaintenance(new Request('https://www.familijna.app/'),BASE);
  assert.deepEqual(asked,['https://www.familijna.app/maintenance/index.html']);
  assert.equal(response.status,503);assert.match(await response.text(),/Maintenance/);
 } finally {bindStaticAssets({});}
});

test('HTML proxy preserves Location on redirects',async()=>{
 withAssets(()=>new Response('301 Moved Permanently',{status:301,headers:{'Content-Type':'text/html',Location:'https://www.familijna.app/games/'}}));
 try {
  const response=await fetchWith404(new Request('https://www.familijna.app/games'),BASE);
  assert.equal(response.status,301);assert.equal(response.headers.get('Location'),'https://www.familijna.app/games/');
 } finally {bindStaticAssets({});}
});

test('TV entry uses the simplified page through the same path used by bypass',async()=>{
 const asked=withAssets(()=>new Response('TV',{headers:{'Content-Type':'text/html'}}));
 try {
  const request=new Request('https://www.familijna.app/connect/?tv=1&lang=uk');
  await fetchFromOrigin(request,new URL(request.url),BASE);
  assert.deepEqual(asked,['https://www.familijna.app/connect/tv/index.html?tv=1&lang=uk']);
  assert.equal(pageIndexPath('/'),'/index.html');
 } finally {bindStaticAssets({});}
});

test('Worker serves the explicitly requested Polish page without a language redirect',async()=>{
 const {default:worker}=await import('../../cloudflare/maintenance-worker/src/index.js');
 const {setStateCache}=await import('../../cloudflare/maintenance-worker/src/lib/core/state.js');
 setStateCache({enabled:false,mode:'off'});
 let target;
 const ASSETS={fetch:async req=>{target=req.url;return new Response('Polski',{headers:{'Content-Type':'text/plain'}});}};
 try {
  const response=await worker.fetch(new Request('https://www.familijna.app/manual/?lang=pl'),{MAINT_KV:{get:async()=>null},ASSETS},{});
  assert.equal(response.status,200);
  assert.equal(new URL(target).searchParams.get('lang'),'pl');
  assert.equal(await response.text(),'Polski');
 } finally {bindStaticAssets({});}
});

test('site files come from Workers Static Assets, never from another origin',async()=>{
 const {default:worker}=await import('../../cloudflare/maintenance-worker/src/index.js');
 const {setStateCache}=await import('../../cloudflare/maintenance-worker/src/lib/core/state.js');
 setStateCache({enabled:false,mode:'off'});
 const original=globalThis.fetch;const asked=[];
 globalThis.fetch=async()=>{throw new Error('no external origin may be contacted');};
 const ASSETS={fetch:async req=>{asked.push(new URL(req.url).pathname);return new Response('<h1>Gry</h1>',{headers:{'Content-Type':'text/html'}});}};
 try {
  const response=await worker.fetch(new Request('https://www.familijna.app/games/',{headers:{Accept:'text/html'}}),{ASSETS},{waitUntil(){}});
  assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'no-store');
  assert.deepEqual(asked,['/games/index.html']);
  await fetchWithOrigin('https://www.familijna.app/nested/dir/',new Request('https://www.familijna.app/nested/dir/'));
  assert.equal(asked.at(-1),'/nested/dir/index.html');
 } finally {globalThis.fetch=original;bindStaticAssets({});}
});

test('without the ASSETS binding the Worker refuses instead of falling back',async()=>{
 bindStaticAssets({});
 await assert.rejects(fetchWithOrigin('https://www.familijna.app/',new Request('https://www.familijna.app/')),/ASSETS/);
});

test('missing page gets the 404 page even without Accept: text/html',async()=>{
 withAssets(req=>new URL(req.url).pathname==='/404.html'
  ? new Response('<script src="/404/js/404.js"></script>',{headers:{'Content-Type':'text/html'}})
  : new Response(null,{status:404}));
 try {
  const response=await fetchWith404(new Request('https://www.familijna.app/brak/sciezka',{headers:{Accept:'*/*'}}),BASE);
  assert.equal(response.status,404);assert.equal(response.headers.get('Cache-Control'),'no-store');
  assert.match(await response.text(),/404\.js/);
 } finally {bindStaticAssets({});}
});
