// E30: historia rozmów czatu AI na koncie (migracja 535). Historia jest
// w formacie dostawcy; zmiana dostawcy zaczyna nową rozmowę.
import { sb } from "../core/supabase.js";

async function call(fn, args) {
  const { data, error } = await sb().rpc(fn, args);
  if (error) throw error;
  if (data?.ok === false) throw Object.assign(new Error(data.error || "chat_error"), { code: data.error });
  return data;
}

export const listChats = async () => (await call("ai_chat_list", { p_limit: 50 })).chats || [];
export const getChat = (id) => call("ai_chat_get", { p_id: id });
export const deleteChat = (id) => call("ai_chat_delete", { p_id: id });

/** Zapis rozmowy; zwraca jej id (nowa rozmowa: id === null). */
export async function saveChat({ id = null, title, provider, model, history }) {
  return (await call("ai_chat_save", { p_id: id, p_title: title, p_provider: provider, p_model: model, p_history: history })).id;
}

/** Tytuł rozmowy z pierwszej wiadomości użytkownika. */
export function chatTitle(text) {
  const s = String(text || "").replace(/\s+/g, " ").trim();
  return s.length > 60 ? `${s.slice(0, 59)}…` : s;
}
