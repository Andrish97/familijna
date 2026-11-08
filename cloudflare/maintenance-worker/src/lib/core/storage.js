// src/lib/storage.js -- Supabase Storage (message-attachments bucket) helpers.
import { getSupabaseConfig } from "./supabase.js";

// Nazwa pliku z obcego maila/formularza jako jeden bezpieczny człon ścieżki.
export function safeStorageName(name) {
  const base = String(name || "").split(/[\\/]/).pop();
  const clean = base.replace(/[^\w.\-]/g, "_").replace(/^\.+/, "_").slice(0, 100);
  return clean || "file";
}

export function isSafeAttachmentPath(p) {
  const parts = String(p || "").split("/");
  return parts.length === 2 && parts[0] === "message-attachments"
    && /^[\w.\-]{1,200}$/.test(parts[1]) && parts[1] !== "." && parts[1] !== "..";
}

export async function uploadToStorage(env, bucketPath, data_b64, mimeType, { upsert = false } = {}) {
  // E24 (2026-11): klucz serwisowy pisze tylko do message-attachments, bez
  // członów "." / ".." (fetch rozwija je w adresie) i bez ? # % \.
  if (!isSafeAttachmentPath(bucketPath)) throw new Error("storage_upload_failed:bad_path");
  const cfg = getSupabaseConfig(env);
  if (!cfg) throw new Error("storage_upload_failed:missing_supabase_config");
  // bucketPath format: "message-attachments/{path}" or just "{bucket}/{path}"
  const url = `${cfg.baseUrl}/storage/v1/object/${bucketPath}`;
  const binaryStr = atob(data_b64);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${cfg.serviceRoleKey}`,
      "Content-Type": mimeType,
      ...(upsert ? { "x-upsert": "true" } : {}),
    },
    body: bytes,
  });
  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`storage_upload_failed:${res.status}:${err.slice(0, 200)}`);
  }
  return bucketPath;
}

export async function downloadFromStorage(env, bucketPath) {
  const cfg = getSupabaseConfig(env);
  if (!cfg) throw new Error("storage_download_failed:missing_supabase_config");
  const url = `${cfg.baseUrl}/storage/v1/object/${bucketPath}`;
  const res = await fetch(url, {
    headers: { "Authorization": `Bearer ${cfg.serviceRoleKey}` },
  });
  return res; // return raw Response to proxy
}
