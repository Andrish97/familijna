import test from 'node:test';
import assert from 'node:assert/strict';
import { handleMailCenterApi } from '../../cloudflare/maintenance-worker/src/lib/mail-center/api.js';
import { buildMailCenterConfirmation } from '../../cloudflare/maintenance-worker/src/lib/mail-center/confirmation-email.js';
const env={SUPABASE_URL:'https://supabase.test',SUPABASE_SERVICE_ROLE_KEY:'private-fixture-key'};
const csrf='a'.repeat(64),secret='b'.repeat(64),link='c'.repeat(64);
function req(path,body,extra={}) {
 return new Request('https://www.familijna.app/_api/mail/'+path,{method:body===undefined?'GET':'POST',headers:{Origin:'https://www.familijna.app',Cookie:`__Host-familijna-mail-csrf=${csrf}; __Host-familijna-mail=${secret}`,'X-Mail-CSRF':csrf,...extra},...(body===undefined?{}:{body:JSON.stringify(body)})});
}
function stub(t,fn) {const old=globalThis.fetch;globalThis.fetch=fn;t.after(()=>{globalThis.fetch=old;});}
test('mail center bootstrap creates secure nonce without consuming a link',async()=>{
 const response=await handleMailCenterApi(new Request('https://www.familijna.app/_api/mail/session'),env);
 const data=await response.json();assert.equal(data.error,'no_session');assert.match(data.csrf,/^[a-f0-9]{64}$/);
 assert.match(response.headers.get('set-cookie'),/HttpOnly; Secure; SameSite=Strict/);
 assert.equal(response.headers.get('cache-control'),'no-store');
 assert.equal(response.headers.get('access-control-allow-origin'),null);
});
test('mail center mutations require exact origin and bootstrap nonce before RPC',async(t)=>{
 stub(t,()=>assert.fail('unauthorized RPC'));
 for(const headers of [{Origin:'https://attacker.example'},{Origin:'https://admin.familijna.app'},{Origin:''},{'X-Mail-CSRF':''},{Cookie:''}]) {
  const response=await handleMailCenterApi(req('notifications',{enabled:false},headers),env);assert.equal(response.status,403);
 }
 const get=await handleMailCenterApi(new Request('https://www.familijna.app/_api/mail/exchange?token='+link),env);assert.equal(get.status,405);
});
test('mail center exchange exposes only HttpOnly session cookie, no JSON secret',async(t)=>{
 const calls=[];stub(t,async(url,options)=>{calls.push({url:String(url),body:JSON.parse(options.body)});return Response.json(String(url).endsWith('/mail_center_exchange_link')?{ok:true,session_secret:secret}:{ok:true,email:'fixture@example.net',notifications_enabled:false,subscriptions:[],items:[],session_secret:secret,token:link});});
 const response=await handleMailCenterApi(req('exchange',{token:link}),env);const data=await response.json();
 assert.equal(data.notifications_enabled,false);assert.equal(data.session_secret,undefined);assert.equal(data.token,undefined);
 assert.match(response.headers.get('set-cookie'),/__Host-familijna-mail=/);assert.match(response.headers.get('set-cookie'),/HttpOnly; Secure; SameSite=Strict/);
 assert.deepEqual(calls[1].body,{p_secret:secret});assert.equal(calls.length,2);
});
test('mail center ignores client-supplied recipient and uses cookie scope',async(t)=>{
 let body;stub(t,async(url,options)=>{body=JSON.parse(options.body);return Response.json({ok:true});});
 const response=await handleMailCenterApi(req('notifications',{enabled:false,email:'foreign@example.com',secret:link}),env);
 assert.equal(response.status,200);assert.deepEqual(body,{p_secret:secret,p_enabled:false});
});
test('mail center peek returns only purpose and cannot redeem a proof',async(t)=>{
 let calls=0;stub(t,async(url,options)=>{calls++;assert.ok(String(url).endsWith('/mail_center_peek_link'));assert.deepEqual(JSON.parse(options.body),{p_token:link});return Response.json({ok:true,purpose:'verification',token:link,session_secret:secret});});
 const response=await handleMailCenterApi(req('peek',{token:link}),env);
 assert.deepEqual(await response.json(),{ok:true,purpose:'verification'});assert.equal(response.headers.get('set-cookie'),null);assert.equal(calls,1);
});
test('mail confirmation is requested with private source, IP hash and no returned token',async(t)=>{
 let args;stub(t,async(url,options)=>{
  if(String(url).includes('siteverify')) return Response.json({success:true,hostname:'www.familijna.app'});
  assert.ok(String(url).endsWith('/mail_center_request_link'));args=JSON.parse(options.body);return Response.json({ok:true,cooldown_seconds:60,token:link,session_secret:secret});});
 const response=await handleMailCenterApi(req('request',{email:'fixture@example.net',lang:'uk',captcha_token:'tok'},{'CF-Connecting-IP':'192.0.2.1'}),{...env,TURNSTILE_SECRET_KEY:'ts-fixture'});
 assert.deepEqual(await response.json(),{ok:true,cooldown_seconds:60});assert.match(args.p_ip_hash,/^[a-f0-9]{64}$/);assert.equal(args.p_lang,'uk');assert.match(args.p_html,/MAIL_CENTER_ACCESS_TOKEN/);assert.ok(!args.p_ip_hash.includes('192.0.2.1'));
});
// E24 R7: bez Turnstile nie ma pytania o adres (enumeracja kont) ani maila.
test('mail request without valid Turnstile never reaches the database',async(t)=>{
 const calls=[];stub(t,async(url)=>{calls.push(String(url));return Response.json({success:false});});
 const e={...env,TURNSTILE_SECRET_KEY:'ts-fixture'};
 assert.equal((await handleMailCenterApi(req('request',{email:'fixture@example.net',lang:'pl'}),e)).status,400);
 assert.equal((await handleMailCenterApi(req('request',{email:'fixture@example.net',lang:'pl',captcha_token:'bad'}),e)).status,400);
 assert.equal((await handleMailCenterApi(req('request',{email:'fixture@example.net',lang:'pl',captcha_token:'x'}),env)).status,503);
 assert.ok(calls.every(u=>u.includes('siteverify')));
});
test('mail center rejects invalid protocol and fails closed on service failure',async(t)=>{
 stub(t,async()=>Response.json({error:'failure'},{status:500}));
 assert.equal((await handleMailCenterApi(req('notifications',{enabled:'false'}),env)).status,400);
 assert.equal((await handleMailCenterApi(req('action',{kind:'device',id:'bad',action:'accept'}),env)).status,400);
 assert.equal((await handleMailCenterApi(req('action',{kind:'poll',id:'a'.repeat(36),action:'decline'}),env)).status,400);
 assert.equal((await handleMailCenterApi(req('action',{kind:'poll',id:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',action:'accept'}),env)).status,400);
 assert.equal((await handleMailCenterApi(req('exchange',{token:'old-u'}),env)).status,400);
 assert.equal((await handleMailCenterApi(req('notifications',{enabled:false}),env)).status,503);
});
test('confirmation documents in all languages have CTA and global footer with same single-use proof',()=>{
 for(const lang of ['pl','en','uk']) {
  const result=buildMailCenterConfirmation(lang);assert.match(result.html,new RegExp(`<html lang="${lang}">`));
  assert.equal((result.html.match(/go\/\?m=MAIL_CENTER_ACCESS_TOKEN/g)||[]).length,3);assert.ok(result.subject);
 }
});

test('Go forwards center capability without redeeming or toggling preference',async(t)=>{
 const {default:worker}=await import('../../cloudflare/maintenance-worker/src/index.js');
 stub(t,()=>assert.fail('Go should not call any backend'));
 const result=await worker.fetch(new Request('https://www.familijna.app/go/?m='+link+'&lang=uk'),env,{});
 assert.equal(result.status,302);const target=new URL(result.headers.get('location'));assert.equal(target.pathname,'/mails/');assert.equal(target.searchParams.get('m'),link);assert.equal(target.searchParams.get('lang'),'uk');
});

test('Worker retains invalid and mixed center links on Go with the shared parser',async(t)=>{
 const {default:worker}=await import('../../cloudflare/maintenance-worker/src/index.js');
 const targetEnv={...env,MAINT_KV:{get:async()=>null}};
 const requested=[];stub(t,async(url)=>{requested.push(String(url));return new Response('<html><body>Go</body></html>',{headers:{'Content-Type':'text/html'}});});
 for(const query of ['m='+link+'&b=aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','m='+link+'&m='+link,'m='+link+'&p=anon','m=','m=bad','m='+link+'&lang=pl&lang=uk','m='+link+'&extra=1'])for(const method of ['GET','HEAD']){
  const response=await worker.fetch(new Request('https://www.familijna.app/go/?'+query,{method}),targetEnv,{});
  assert.equal(response.status,200,query);assert.equal(response.headers.get('location'),null);
  assert.ok(new URL(requested.at(-1)).pathname.endsWith('/go/index.html'));
  assert.equal(new URL(requested.at(-1)).search,'?'+query);
 }
});
