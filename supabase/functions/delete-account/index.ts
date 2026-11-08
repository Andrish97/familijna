import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const sb = createClient(supabaseUrl, supabaseAnonKey);
const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ ok: false, error: "Method not allowed" }, 405);
  }

  try {
    if (!serviceRoleKey) {
      return json({ ok: false, error: "Missing SUPABASE_SERVICE_ROLE_KEY" }, 500);
    }
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token) return json({ ok: false, error: "Missing Bearer token" }, 401);

    const { data: userData, error: authError } = await sb.auth.getUser(token);
    if (authError || !userData?.user) {
      return json({ ok: false, error: "Invalid JWT" }, 401);
    }

    const userId = userData.user.id;

    // Najpierw baza (jedno źródło prawdy kasowania, używane też przez gości).
    // Funkcja usuwa rekordy powiązane z user_id i e-mailem, a finalnie auth.users/profiles.
    // Błąd bazy = nic nie ginie (pliki zostają razem z kontem).
    const { error: deleteError } = await admin.rpc("delete_user_everything", { p_user_id: userId });
    if (deleteError) throw deleteError;

    // Profile DELETE atomowo dodaje pliki obu bucketów do storage_cleanup_queue.
    // Usuwa je wspólny worker Storage, także po retry; ten endpoint nie kasuje
    // plików bezpośrednio po usunięciu konta.

    return json({ ok: true });
  } catch (e) {
    // E24 R22: szczegóły tylko w logu funkcji, klient dostaje ogólny kod.
    console.error("[delete-account] failed:", e instanceof Error ? e.message : String(e));
    return json({ ok: false, error: "delete_failed" }, 500);
  }
});

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
