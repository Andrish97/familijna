import test from 'node:test';
import assert from 'node:assert/strict';
import {serveMaintenance,fetchWith404} from '../../cloudflare/maintenance-worker/src/lib/origin/origin.js';
test('maintenance fetches its actual index instead of a directory redirect',async()=>{
 const original=globalThis.fetch;let target;
 globalThis.fetch=async url=>{target=url;return new Response('<h1>Maintenance</h1>',{headers:{'Content-Type':'text/html'}});};
 try {
  const response=await serveMaintenance(new Request('https://www.familijna.app/'),'https://familijna.app','familijna.app','andrish97.github.io');
  assert.equal(target,'https://familijna.app/maintenance/index.html');
  assert.equal(response.status,503);assert.match(await response.text(),/Maintenance/);
 } finally {globalThis.fetch=original;}
});
test('HTML proxy preserves Location on origin redirects',async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=async()=>new Response('301 Moved Permanently',{status:301,headers:{'Content-Type':'text/html',Location:'https://www.familijna.app/games/'}});
 try {
  const response=await fetchWith404(new Request('https://www.familijna.app/games'), 'https://familijna.app','familijna.app','andrish97.github.io');
  assert.equal(response.status,301);assert.equal(response.headers.get('Location'),'https://www.familijna.app/games/');
 } finally {globalThis.fetch=original;}
});

test('TV entry uses the simplified page through the same proxy used by bypass',async()=>{
 const {fetchFromOrigin,pageIndexPath}=await import('../../cloudflare/maintenance-worker/src/lib/origin/origin.js');
 const original=globalThis.fetch;let target;
 globalThis.fetch=async url=>{target=url;return new Response('TV',{headers:{'Content-Type':'text/html'}});};
 try {
  const request=new Request('https://www.familijna.app/connect/?tv=1&lang=uk');
  await fetchFromOrigin(request,new URL(request.url),'https://familijna.app','familijna.app','andrish97.github.io');
  assert.equal(target,'https://familijna.app/connect/tv/index.html?tv=1&lang=uk');
  assert.equal(pageIndexPath('/'),'/index.html');
 } finally {globalThis.fetch=original;}
});

test('Worker serves the explicitly requested Polish page without a language redirect',async()=>{
 const {default:worker}=await import('../../cloudflare/maintenance-worker/src/index.js');
 const {setStateCache}=await import('../../cloudflare/maintenance-worker/src/lib/core/state.js');
 setStateCache({enabled:false,mode:'off'});
 const original=globalThis.fetch;let target;
 globalThis.fetch=async url=>{target=url;return new Response('Polski',{headers:{'Content-Type':'text/plain'}});};
 try {
  const response=await worker.fetch(new Request('https://www.familijna.app/manual/?lang=pl'),{MAINT_KV:{get:async()=>null}},{});
  assert.equal(response.status,200);
  assert.equal(new URL(target).searchParams.get('lang'),'pl');
  assert.equal(await response.text(),'Polski');
 } finally {globalThis.fetch=original;}
});

test('with the ASSETS binding site files come from Workers Static Assets, not GitHub Pages',async()=>{
 const {default:worker}=await import('../../cloudflare/maintenance-worker/src/index.js');
 const {bindStaticAssets,fetchWithOrigin}=await import('../../cloudflare/maintenance-worker/src/lib/origin/origin.js');
 const {setStateCache}=await import('../../cloudflare/maintenance-worker/src/lib/core/state.js');
 setStateCache({enabled:false,mode:'off'});
 const original=globalThis.fetch;const asked=[];
 globalThis.fetch=async()=>{throw new Error('GitHub Pages must not be contacted');};
 const ASSETS={fetch:async req=>{asked.push(new URL(req.url).pathname);return new Response('<h1>Gry</h1>',{headers:{'Content-Type':'text/html'}});}};
 try {
  const response=await worker.fetch(new Request('https://www.familijna.app/games/',{headers:{Accept:'text/html'}}),{ASSETS},{waitUntil(){}});
  assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'no-store');
  assert.deepEqual(asked,['/games/index.html']);
  await fetchWithOrigin('https://familijna.app/nested/dir/',new Request('https://www.familijna.app/nested/dir/'),'familijna.app','andrish97.github.io');
  assert.equal(asked.at(-1),'/nested/dir/index.html');
 } finally {globalThis.fetch=original;bindStaticAssets({});}
});
