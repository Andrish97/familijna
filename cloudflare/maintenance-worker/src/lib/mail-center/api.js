import { supabaseRpc } from '../core/supabase.js';
import { buildMailCenterConfirmation } from './confirmation-email.js';
import { normalizeLang } from '../core/utils.js';
import { clientIp } from '../core/rate-limit.js';
import { verifyTurnstile } from '../auth/turnstile.js';

const SESSION = '__Host-familijna-mail';
const CSRF = '__Host-familijna-mail-csrf';
const HEX = /^[a-f0-9]{64}$/;
function cookie(request, name) {
  const pair = (request.headers.get('Cookie') || '').split(';').map(value => value.trim()).find(value => value.startsWith(name + '='));
  const value = pair?.slice(name.length + 1) || '';
  return HEX.test(value) ? value : '';
}
function randomSecret() { return [...crypto.getRandomValues(new Uint8Array(32))].map(n => n.toString(16).padStart(2,'0')).join(''); }
function setCookie(name, value, seconds) { return `${name}=${value}; Path=/; Max-Age=${seconds}; HttpOnly; Secure; SameSite=Strict`; }
async function ipHash(request, env) {
  const value = `${env.SUPABASE_SERVICE_ROLE_KEY}:${clientIp(request)}`;
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(n=>n.toString(16).padStart(2,'0')).join('');
}
function response(data, status=200, cookies=[]) {
  const headers=new Headers({ 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store', 'Referrer-Policy':'no-referrer', 'X-Content-Type-Options':'nosniff' });
  for (const value of cookies) headers.append('Set-Cookie',value);
  return new Response(JSON.stringify(data),{status,headers});
}
async function rpc(env, name, args) {
  const result=await supabaseRpc(env,name,args);
  if (!result.ok) throw new Error('mail_center_backend_failed');
  const value=Array.isArray(result.data)?result.data[0]:result.data;
  if (!value || typeof value !== 'object') throw new Error('invalid_mail_center_response');
  return value;
}
function publicResult(result) {
  // Exact protocol, never spread a service response containing capabilities.
  const allowed=['ok','error','cooldown_seconds','email','notifications_enabled','subscriptions','items','purpose'];
  return Object.fromEntries(allowed.filter(key=>Object.hasOwn(result,key)).map(key=>[key,result[key]]));
}
export async function handleMailCenterApi(request,env) {
  const url=new URL(request.url);
  if (!['www.familijna.app','familijna.app'].includes(url.hostname)) return response({ok:false,error:'invalid_origin'},403);
  const endpoint=url.pathname.slice('/_api/mail/'.length);
  const session=cookie(request,SESSION), existingCsrf=cookie(request,CSRF);
  const csrf=existingCsrf || randomSecret();
  const bootstrapCookie=existingCsrf?[]:[setCookie(CSRF,csrf,86400)];
  if (request.method==='GET' && endpoint==='session') {
    try {
      const result=session?await rpc(env,'mail_center_list',{p_secret:session}):{ok:false,error:'no_session'};
      return response({...publicResult(result),csrf},200,bootstrapCookie);
    } catch { return response({ok:false,error:'temporarily_unavailable'},503); }
  }
  if (request.method!=='POST') return response({ok:false,error:'method_not_allowed'},405);
  // Origin and a same-origin bootstrap nonce are required for every mutation,
  // including exchanging a link. GET and link previews never consume a proof.
  if (request.headers.get('Origin')!==url.origin || !existingCsrf || request.headers.get('X-Mail-CSRF')!==existingCsrf) return response({ok:false,error:'invalid_origin'},403);
  let body;
  try {
    const raw=await request.text(); if (raw.length>4096) return response({ok:false,error:'invalid_request'},413);
    body=JSON.parse(raw); if (!body || typeof body!=='object' || Array.isArray(body)) return response({ok:false,error:'invalid_request'},400);
  } catch { return response({ok:false,error:'invalid_request'},400); }
  try {
    if (endpoint==='request') {
      // Turnstile jak przy stanie adresu w rejestracji (B8, E24 R7).
      const check=await verifyTurnstile(request,env,body.captcha_token);
      if (!check.ok) return response({ok:false,error:check.error},check.error==='captcha_unavailable'?503:400);
      const lang=normalizeLang(body.lang), template=buildMailCenterConfirmation(lang);
      const result=await rpc(env,'mail_center_request_link',{p_email:String(body.email||'').trim(),p_ip_hash:await ipHash(request,env),p_subject:template.subject,p_html:template.html,p_lang:lang});
      return response(publicResult(result),result.error==='cooldown'?429:200);
    }
    if (endpoint==='peek') {
      if (!HEX.test(String(body.token||''))) return response({ok:false,error:'invalid_token'},400);
      return response(publicResult(await rpc(env,'mail_center_peek_link',{p_token:body.token})));
    }
    if (endpoint==='exchange') {
      if (!HEX.test(String(body.token||''))) return response({ok:false,error:'invalid_token'},400);
      const result=await rpc(env,'mail_center_exchange_link',{p_token:body.token});
      if (!result.ok) return response(publicResult(result));
      if (!HEX.test(String(result.session_secret||''))) throw new Error('invalid_session_secret');
      // Session proof is only in HttpOnly cookie; no JSON/localStorage copy.
      const data=await rpc(env,'mail_center_list',{p_secret:result.session_secret});
      return response({...publicResult(data),csrf},200,[setCookie(SESSION,result.session_secret,86400)]);
    }
    if (!session) return response({ok:false,error:'invalid_session'},401);
    if (endpoint==='notifications') {
      if (typeof body.enabled!=='boolean') return response({ok:false,error:'invalid_request'},400);
      return response(publicResult(await rpc(env,'mail_center_set_notifications',{p_secret:session,p_enabled:body.enabled})));
    }
    if (endpoint==='action') {
      if (!['subscription','poll'].includes(body.kind) || !['accept','decline'].includes(body.action) || (body.kind==='poll' && body.action==='accept') || typeof body.id!=='string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(body.id)) return response({ok:false,error:'invalid_request'},400);
      return response(publicResult(await rpc(env,'mail_center_action',{p_secret:session,p_kind:body.kind,p_id:body.id,p_action:body.action})));
    }
    return response({ok:false,error:'not_found'},404);
  } catch { return response({ok:false,error:'temporarily_unavailable'},503); }
}
