// src/lib/admin-marketing-api.js -- /_admin_api/marketing/* (bulk send, kontakty,
// logi wyszukiwania, kolejność AI). Tabele marketingu są tylko dla klucza
// serwisowego (audyt E24) -- panel czyta i zmienia je wyłącznie tędy.
import { json } from "../core/http.js";
import { readJson } from "./admin-auth.js";
import { supabaseRequest, supabaseRpc, summarizeSupabaseError } from "../core/supabase.js";
import { htmlToPlainTextPreview } from "../email/html-to-text.js";

const MC_PAGE_SIZE = 50;
const MC_SORT_COLS = new Set(["title", "email", "url", "added_at", "last_sent_at", "reaction", "sent_count"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function cleanIds(ids) {
  return Array.isArray(ids) ? [...new Set(ids.map(String).filter((id) => UUID_RE.test(id)))].slice(0, 500) : [];
}

// Filtry widoku tabeli (Lead Finder 3): kategoria (uuid | none), stan wysyłki,
// wyszukiwanie. Wspólne dla listy i adresów do wysyłki.
export function contactFilters(searchParams) {
  const q = new URLSearchParams();
  const category = String(searchParams.get("category") || "");
  if (UUID_RE.test(category)) q.set("category_id", `eq.${category.toLowerCase()}`);
  else if (category === "none") q.set("category_id", "is.null");
  const sent = searchParams.get("sent");
  if (sent === "unsent") q.set("sent_count", "eq.0");
  else if (sent === "waiting") { q.set("sent_count", "gt.0"); q.set("reaction", "is.null"); }
  else if (sent === "replied") q.set("reaction", "eq.replied");
  else if (sent === "blocked") q.set("reaction", "in.(declined,bounced)");
  const search = String(searchParams.get("search") || "").trim().slice(0, 200);
  if (search) {
    // Wzorzec LIKE (\\ % _ dosłownie, * to % w PostgREST), potem wartość w cudzysłowie PostgREST.
    const like = search.replace(/\*/g, "").replace(/[\\%_]/g, "\\$&");
    const v = `"*${like.replace(/[\\"]/g, "\\$&")}*"`;
    q.set("or", `(title.ilike.${v},email.ilike.${v},url.ilike.${v})`);
  }
  return q;
}

async function categoriesList(env) {
  const res = await supabaseRpc(env, "marketing_categories_list", {});
  return res.ok && Array.isArray(res.data) ? res.data : null;
}

export async function handleAdminMarketingApi(request, env, url) {
  // GET /_admin_api/marketing/contacts?page=&category=&sent=&search=&sort=&dir=
  if (url.pathname === "/_admin_api/marketing/contacts" && request.method === "GET") {
    const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10) || 1);
    const sort = MC_SORT_COLS.has(url.searchParams.get("sort")) ? url.searchParams.get("sort") : "added_at";
    const dir = url.searchParams.get("dir") === "asc" ? "asc" : "desc";
    const q = contactFilters(url.searchParams);
    q.set("select", "*");
    q.set("order", `${sort}.${dir}.nullslast`);
    const from = (page - 1) * MC_PAGE_SIZE;
    const res = await supabaseRequest(env, `/rest/v1/marketing_verified_contacts?${q}`, {
      headers: { Prefer: "count=exact", Range: `${from}-${from + MC_PAGE_SIZE - 1}` },
    });
    if (!res.ok) return json({ ok: false, error: "contacts_failed", details: summarizeSupabaseError(res) }, res.status || 500);
    const total = parseInt(String(res.contentRange || "").split("/")[1] || "0", 10) || 0;
    return json({ ok: true, rows: Array.isArray(res.data) ? res.data : [], total });
  }

  // GET /_admin_api/marketing/contacts/emails?category=&sent=&search= -- adresy
  // całego widoku do wysyłki (bez odmów i odbitych), najwyżej 500 (limit wysyłki).
  if (url.pathname === "/_admin_api/marketing/contacts/emails" && request.method === "GET") {
    const q = contactFilters(url.searchParams);
    if (url.searchParams.get("sent") === "blocked") return json({ ok: true, emails: [], total: 0 });
    // Bez odmów i odbitych (NULL = brak reakcji też przechodzi).
    const sendable = "reaction.is.null,reaction.not.in.(declined,bounced)";
    if (q.has("or")) { const search = q.get("or"); q.delete("or"); q.set("and", `(or${search},or(${sendable}))`); }
    else q.set("or", `(${sendable})`);
    q.set("select", "email");
    q.set("order", "added_at.asc");
    const res = await supabaseRequest(env, `/rest/v1/marketing_verified_contacts?${q}`, {
      headers: { Prefer: "count=exact", Range: "0-499" },
    });
    if (!res.ok) return json({ ok: false, error: "contacts_failed", details: summarizeSupabaseError(res) }, res.status || 500);
    const total = parseInt(String(res.contentRange || "").split("/")[1] || "0", 10) || 0;
    const emails = [...new Set((Array.isArray(res.data) ? res.data : []).map((r) => String(r.email || "").trim().toLowerCase()).filter(Boolean))];
    return json({ ok: true, emails, total });
  }

  // GET /_admin_api/marketing/categories -- z liczbą kontaktów
  if (url.pathname === "/_admin_api/marketing/categories" && request.method === "GET") {
    const rows = await categoriesList(env);
    if (!rows) return json({ ok: false, error: "categories_failed" }, 500);
    return json({ ok: true, rows });
  }

  // POST /_admin_api/marketing/categories { name }
  if (url.pathname === "/_admin_api/marketing/categories" && request.method === "POST") {
    const body = await readJson(request);
    const name = String(body?.name || "").replace(/\s+/g, " ").trim().slice(0, 80);
    if (!name) return json({ ok: false, error: "missing_name" }, 400);
    const res = await supabaseRequest(env, "/rest/v1/marketing_categories", {
      method: "POST", headers: { Prefer: "return=representation" }, body: { name },
    });
    if (res.status === 409) return json({ ok: false, error: "Taka kategoria już istnieje" }, 409);
    if (!res.ok) return json({ ok: false, error: "category_create_failed", details: summarizeSupabaseError(res) }, res.status || 500);
    return json({ ok: true, row: Array.isArray(res.data) ? res.data[0] : res.data });
  }

  // POST /_admin_api/marketing/categories/update { id, is_active }
  if (url.pathname === "/_admin_api/marketing/categories/update" && request.method === "POST") {
    const body = await readJson(request);
    const id = String(body?.id || "");
    if (!UUID_RE.test(id) || typeof body?.is_active !== "boolean") return json({ ok: false, error: "bad_request" }, 400);
    const res = await supabaseRequest(env, `/rest/v1/marketing_categories?id=eq.${id}`, { method: "PATCH", body: { is_active: body.is_active } });
    if (!res.ok) return json({ ok: false, error: "category_update_failed", details: summarizeSupabaseError(res) }, res.status || 500);
    return json({ ok: true });
  }

  // POST /_admin_api/marketing/categories/delete { id } -- kontakty zostają (bez kategorii)
  if (url.pathname === "/_admin_api/marketing/categories/delete" && request.method === "POST") {
    const body = await readJson(request);
    const id = String(body?.id || "");
    if (!UUID_RE.test(id)) return json({ ok: false, error: "bad_request" }, 400);
    const res = await supabaseRequest(env, `/rest/v1/marketing_categories?id=eq.${id}`, { method: "DELETE" });
    if (!res.ok) return json({ ok: false, error: "category_delete_failed", details: summarizeSupabaseError(res) }, res.status || 500);
    return json({ ok: true });
  }

  // POST /_admin_api/marketing/contacts/delete { ids }
  if (url.pathname === "/_admin_api/marketing/contacts/delete" && request.method === "POST") {
    const body = await readJson(request);
    const ids = cleanIds(body?.ids);
    if (!ids.length) return json({ ok: false, error: "missing_ids" }, 400);
    const res = await supabaseRequest(env, `/rest/v1/marketing_verified_contacts?id=in.(${ids.join(",")})`, { method: "DELETE" });
    if (!res.ok) return json({ ok: false, error: "contacts_delete_failed", details: summarizeSupabaseError(res) }, res.status || 500);
    return json({ ok: true });
  }

  // GET /_admin_api/marketing/logs -- 200 najnowszych wpisów
  if (url.pathname === "/_admin_api/marketing/logs" && request.method === "GET") {
    const res = await supabaseRequest(env, "/rest/v1/marketing_search_logs?select=*&order=created_at.desc&limit=200");
    if (!res.ok) return json({ ok: false, error: "logs_failed", details: summarizeSupabaseError(res) }, res.status || 500);
    return json({ ok: true, rows: Array.isArray(res.data) ? res.data : [] });
  }

  // POST /_admin_api/marketing/send { emails, subject, template_id, custom_body }
  if (url.pathname === "/_admin_api/marketing/send" && request.method === "POST") {
    const body = await readJson(request);
    const { emails, subject: mktSubject, template_id, custom_body } = body || {};
    if (!Array.isArray(emails) || !emails.length) return json({ ok: false, error: "missing_emails" }, 400);
    if (!mktSubject) return json({ ok: false, error: "missing_subject" }, 400);
    if (typeof custom_body !== "string" || !custom_body.trim()) return json({ ok: false, error: "missing_body" }, 400);

    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const requested = [...new Set(emails.map(e => String(e).trim().toLowerCase()).filter(e => emailRe.test(e)))];
    if (!requested.length) return json({ ok: false, error: "no_valid_emails" }, 400);
    if (requested.length > 500) return json({ ok: false, error: "too_many_emails", max: 500 }, 400);
    // Kontakty, które odmówiły albo których adres odbił -- bez kolejnych wysyłek.
    const bRes = await supabaseRpc(env, "marketing_send_blocked", { p_emails: requested });
    if (!bRes.ok) return json({ ok: false, error: "blocked_check_failed", details: summarizeSupabaseError(bRes) }, bRes.status || 500);
    const blockedSet = new Set((Array.isArray(bRes.data) ? bRes.data : []).map((r) => String(typeof r === "string" ? r : Object.values(r || {})[0] || "")));
    const validEmails = requested.filter((e) => !blockedSet.has(e));
    const blocked = requested.length - validEmails.length;
    if (!validEmails.length) return json({ ok: true, queued: 0, skipped: 0, blocked, total: requested.length });

    // custom_body is already full HTML from client (templates in JS)
    const emailHtml = custom_body || "";

    const emailText = htmlToPlainTextPreview(emailHtml);

    // Insert into mail_queue (batch insert for all recipients) --
    // cooldown_action_key/cooldown_target_key wymagane przez trigger
    // (ujednolicenie cooldownów, migracja 289); "admin:marketing" ma
    // enforce=false (celowo powtarzalna wysyłka kampanii do tych samych
    // adresów, nigdy nie ma być throttlowana).
    const queueRows = validEmails.map(email => ({
      to_email: email,
      subject: String(mktSubject),
      html: emailHtml,
      text: emailText,
      from_email: "kontakt@familiada.online",
      meta: { type: "marketing", template_id: template_id || "custom" },
      cooldown_action_key: "admin:marketing",
      cooldown_target_key: `email:${email}`,
    }));

    const qRes = await supabaseRequest(env, "/rest/v1/mail_queue?select=to_email", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: queueRows,
    });

    if (!qRes.ok) {
      return json({ ok: false, error: "queue_insert_failed", details: summarizeSupabaseError(qRes) }, qRes.status || 500);
    }

    // The flag guard can omit recipients. Only actual queue rows are sent history.
    const queuedEmails = (Array.isArray(qRes.data) ? qRes.data : []).map(row => row.to_email);
    const queued = queuedEmails.length;
    const skipped = validEmails.length - queued;
    if (!queued) return json({ ok: true, queued, skipped, blocked, total: requested.length });
    const sRes = await supabaseRpc(env, "marketing_mark_sent", { p_emails: queuedEmails });
    if (!sRes.ok) console.error("[marketing/send] mark_sent failed", summarizeSupabaseError(sRes));
    const messageRows = queuedEmails.map(email => ({
      to_email: email,
      subject: String(mktSubject),
      body: emailText,
      body_html: emailHtml,
      is_marketing: true,
      direction: 'outbound',
      source: 'email'
    }));

    // Batch insert into messages table
    const mRes = await supabaseRequest(env, "/rest/v1/messages", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: messageRows,
    });

    if (!mRes.ok) {
      console.error("[marketing/send] Failed to save message history records", summarizeSupabaseError(mRes));
    }

    return json({ ok: true, queued, skipped, blocked, total: requested.length });
  }

  return new Response("Not Found", { status: 404 });
}
