// E30 (decyzje 25–30): wbudowany czat Familijnej — Gemini 2.5 Flash-Lite na
// płatnym kluczu serwera (GEMINI_API_KEY w functions.env), z limitami na
// użytkownika (ai_quota_take, migracja 538). Logika: ../_shared/ai-chat-core.js.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleChat } from "../_shared/ai-chat-core.js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const API_KEY = Deno.env.get("GEMINI_API_KEY") || "";

const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
const service = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

Deno.serve((request: Request) => handleChat(request, {
  apiKey: API_KEY,
  fetchImpl: fetch,
  sleep: (ms: number) => new Promise((r) => setTimeout(r, ms)),
  async userOf(token: string) {
    const { data, error } = await anon.auth.getUser(token);
    return error ? null : data?.user?.id || null;
  },
  async quotaTake(userId: string, newMessage: boolean) {
    const { data, error } = await service.rpc("ai_quota_take", { p_user: userId, p_new_message: newMessage });
    if (error) return { ok: false, error: "disabled" };
    return data;
  },
}));
