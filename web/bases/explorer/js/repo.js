// base-explorerjs/repo.js
// Repozytorium danych (Supabase) dla menadżera bazy pytań.

import { sb } from "../../../shared/js/core/supabase.js?v=v2026-11-05T23260";


/**
 * Pobiera metadane bazy.
 * Zwraca: { id, name, owner_id, created_at, updated_at }
 */
export async function getBaseMeta(baseId) {
  const { data, error } = await sb()
    .from("question_bases")
    .select("id,name,owner_id,created_at,updated_at")
    .eq("id", baseId)
    .single();

  if (error) throw error;
  return data;
}

/**
 * Ustala rolę użytkownika dla bazy:
 * - owner: jeśli owner_id === userId
 * - editor/viewer: z question_base_shares
 * Jeśli brak dostępu -> rzuca błąd (brak rekordu share i nie-owner).
 *
 * Zwraca: { role: "owner"|"editor"|"viewer" }
 */
export async function getBaseRole(baseId, userId, meta = null) {
  // meta: już pobrane metadane (wejście na stronę) — bez drugiego zapytania.
  const base = meta || await getBaseMeta(baseId);

  if (base?.owner_id === userId) {
    return { role: "owner" };
  }

  const { data, error } = await sb()
    .from("question_base_shares")
    .select("role")
    .eq("base_id", baseId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;

  const role = data?.role;
  if (role === "editor" || role === "viewer") {
    return { role };
  }

  // Brak dostępu (UI powinno wrócić do bases z komunikatem)
  const e = new Error("Brak dostępu do tej bazy.");
  e.code = "NO_ACCESS";
  throw e;
}

/**
 * Tagi w bazie.
 * Zwraca listę: [{ id, base_id, name, color, ord }]
 */
export async function listTags(baseId) {
  const { data, error } = await sb()
    .from("qb_tags")
    .select("id,base_id,name,color,ord")
    .eq("base_id", baseId)
    .order("ord", { ascending: true });

  if (error) throw error;
  return data || [];
}

/**
 * Jedno pytanie, świeżo z bazy (okno pytania).
 */
export async function getQuestion(id) {
  const { data, error } = await sb()
    .from("qb_questions")
    .select("id,base_id,category_id,ord,payload,updated_at")
    .eq("id", id)
    .single();

  if (error) throw error;
  return data;
}

/**
 * Cała baza do magazynu menedżera (data/store.js): foldery, tagi, pytania
 * z treścią i przypisania tagów — jedną funkcją SQL (migracja 430), jedno
 * zapytanie zamiast stron po 1000 wierszy (duża baza wczytywała się
 * kilkanaście sekund). RLS jak przy zwykłych odczytach.
 */
export async function loadBaseContent(baseId) {
  const { data, error } = await sb().rpc("qb_base_content", { p_base_id: baseId });
  if (error) throw error;
  return {
    categories: data?.categories || [],
    tags: data?.tags || [],
    questions: data?.questions || [],
    questionTags: data?.questionTags || [],
  };
}

// Przypisania tagów wskazanych pytań (okno tagów) — lista id w treści
// zapytania (migracja 430), bez limitów adresu i 1000 wierszy.
export async function listQuestionTagLinks(baseId, questionIds) {
  const ids = [...new Set((questionIds || []).filter(Boolean))];
  if (!ids.length) return [];
  const { data, error } = await sb().rpc("qb_question_tag_links", { p_base_id: baseId, p_question_ids: ids });
  if (error) throw error;
  return data || [];
}
