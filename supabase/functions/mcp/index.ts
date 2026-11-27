// E30 (decyzja 19): serwer MCP Familijnej — łącznik dla Claude, ChatGPT
// i innych klientów MCP. Adres publiczny: https://api.familijna.app/mcp
// (Worker przekazuje /mcp i /.well-known/oauth-* tutaj). Logika: ../_shared/mcp-core.js.
// Token fam_mcp_… → użytkownik (mcp_token_user, klucz serwisowy) → krótkotrwały
// JWT użytkownika (sekret JWT serwera, jak device-realtime-token) → narzędzia
// wołają te same endpointy i RLS co strona.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleHttp } from "../_shared/mcp-core.js";
import { serverToolEnv } from "../_shared/mcp-env.js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const JWT_SECRET = Deno.env.get("SUPABASE_JWT_SECRET") || Deno.env.get("JWT_SECRET") || "";
const PUBLIC_ORIGIN = Deno.env.get("MCP_PUBLIC_ORIGIN") || "https://api.familijna.app";
const SITE = Deno.env.get("SITE_URL") || "https://www.familijna.app";

const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
const service = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
async function signJwt(claims: Record<string, unknown>): Promise<string> {
  const enc = new TextEncoder();
  const head = b64url(enc.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const body = b64url(enc.encode(JSON.stringify(claims)));
  const key = await crypto.subtle.importKey("raw", enc.encode(JWT_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(`${head}.${body}`)));
  return `${head}.${body}.${b64url(sig)}`;
}

// deno-lint-ignore no-explicit-any
async function rpc(client: any, fn: string, args: Record<string, unknown>): Promise<any> {
  const { data, error } = await client.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data;
}

Deno.serve((request: Request) => handleHttp(request, {
  pub: PUBLIC_ORIGIN,
  site: SITE,
  anonRpc: (fn: string, args: Record<string, unknown>) => rpc(anon, fn, args),
  async tokenUser(token: string) {
    const res = await rpc(service, "mcp_token_user", { p_token: token });
    return res?.ok ? res : null;
  },
  async recordCall({ tokenId, tool, ok }: { tokenId: string; tool: string; ok: boolean }) {
    await rpc(service, "mcp_usage_record", { p_token_id: tokenId, p_tool: tool, p_ok: ok });
  },
  async userCtx({ userId, tokenId }: { userId: string; tokenId: string }) {
    const now = Math.floor(Date.now() / 1000);
    const jwt = await signJwt({ sub: userId, role: "authenticated", aud: "authenticated", iat: now, exp: now + 600 });
    const db = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
    const { data } = await service.auth.admin.getUserById(userId);
    const asked = String(data?.user?.user_metadata?.language || "");
    const lang = ["pl", "en", "uk"].includes(asked) ? asked : "pl";
    return serverToolEnv({ db, jwt, userId, tokenId, lang, site: SITE, supabaseUrl: SUPABASE_URL });
  },
}));
