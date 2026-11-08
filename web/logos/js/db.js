// familiada/logos/js/db.js
// Dostęp do tabeli user_logos i plików logo w Storage.

import { sb } from "../../shared/js/core/supabase.js?v=v2026-11-08T21312";
import { getTabId } from "../../shared/js/core/resource-lock.js?v=v2026-11-08T21312";
import { storagePathFromUrl } from "./image.js?v=v2026-11-08T21312";
import { decodeImportedLogoImage } from "../../shared/js/core/logo-image-data.js?v=v2026-11-08T21312";


/** Błąd „zasób zajęty” z RPC *_checked -- reason: logo (inna karta edytuje to logo)
 *  | control | settings (pula logo trzymana przez grę) | locked. */
function busyError(result) {
  const e = new Error("logo in use");
  e.code = "RESOURCE_IN_USE";
  e.reason = result?.blocker_type === "logo" ? "logo" : (result?.blocker_context || result?.reason);
  return e;
}

export function isUniqueViolation(e) {
  return e?.code === "23505" || /duplicate key value/i.test(String(e?.message || ""));
}

/**
 * Lista do kafelków -- BEZ ciężkiej części payloadu (fabricData, obraz
 * base64, stara historia undo). Miniatura potrzebuje tylko bitów/wierszy.
 */
export async function listLogos() {
  const { data, error } = await sb()
    .from("user_logos")
    .select("id,name,type,updated_at,received_from_label,received_from_identity,bits_b64:payload->>bits_b64,w:payload->w,h:payload->h,layers:payload->layers,source_mode:payload->source->>mode")
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data || []).map((r) => ({
    id: r.id,
    name: r.name,
    type: r.type,
    updated_at: r.updated_at,
    received_from_label: r.received_from_label,
    received_from_identity: r.received_from_identity,
    payload: { bits_b64: r.bits_b64, w: r.w, h: r.h, layers: r.layers, source: r.source_mode ? { mode: r.source_mode } : null },
  }));
}

/** Pełny rekord (do edycji i eksportu). */
export async function fetchLogo(id) {
  const { data, error } = await sb().from("user_logos").select("id,name,type,updated_at,payload").eq("id", id).single();
  if (error) throw error;
  return data;
}

export async function createLogo(row) {
  const { data, error } = await sb().from("user_logos").insert(row).select("id").single();
  if (error) throw error;
  return data.id;
}

/** Upload a self-contained IMAGE source from an imported .famlogo to Storage. */
export async function uploadImportedLogoImage(dataUrl, userId) {
  if (!userId) throw new Error("You must be signed in to upload a logo image");
  const { bytes, mime, ext } = decodeImportedLogoImage(dataUrl);
  const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const storage = sb().storage.from("user-logos");
  const { error } = await storage.upload(path, new Blob([bytes], { type: mime }), {
    cacheControl: "3600", upsert: false, contentType: mime,
  });
  if (error) throw error;
  return storage.getPublicUrl(path).data.publicUrl;
}

/** Upload the flattened, color-neutral DRAW result used by the Host. */
export async function removeLogoImageUrl(imageUrl, userId) {
  const path = storagePathFromUrl(imageUrl, userId);
  if (!path) return;
  const { error } = await sb().storage.from("user-logos").remove([path]);
  if (error) console.warn("[logo/db] could not remove imported image:", error);
}

// Przez RPC, nie goły update(): sprawdza atomowo, czy to logo (inna karta) albo
// pula logo właściciela (rozgrywka / otwarte ustawienia gry) nie są trzymane
// przez kogoś innego -- familijna-server/docs/blokady-zasobow.md, „Zgodność zasobów”. Własna
// karta (p_tab_id) nie przeszkadza sama sobie.
export async function updateLogo(id, patch) {
  const { data, error } = await sb().rpc("update_logo_checked", { p_logo_id: id, p_patch: patch, p_tab_id: getTabId() });
  if (error) throw error;
  if (!data?.ok) throw busyError(data);
}

// Plik obrazu w Storage usuwa baza razem z wierszem (migracja 313).
export async function deleteLogo(id) {
  const { data: result, error } = await sb().rpc("delete_resource_checked", { p_resource_type: "logo", p_resource_id: id, p_tab_id: getTabId() });
  if (error) throw error;
  if (!result?.ok) throw busyError(result);
}
