// Wspólne pomocnicze dla narzędzi czatu AI (E30).
import { sb } from "../../core/supabase.js";

export const uuid = { type: "string", description: "UUID" };
export const uuidList = { type: "array", items: { type: "string" }, description: "UUIDs" };
export const noArgs = { type: "object", properties: {} };

/** RPC; błąd PostgREST jako wyjątek z komunikatem. */
export async function rpc(fn, args) {
  const { data, error } = await sb().rpc(fn, args);
  if (error) throw new Error(error.message || "rpc_failed");
  return data;
}

/** Wynik zapytania (tablica) albo wyjątek. */
export async function rows(query) {
  const { data, error } = await query;
  if (error) throw new Error(error.message || "select_failed");
  return data || [];
}

export const answersSchema = {
  type: "array",
  description: "Answers in display order (max 6). Points matter only in 'prepared' games (each ≥ 4, sum ≤ 100); ignored otherwise. 'poll_text' games have no answers.",
  items: {
    type: "object",
    properties: { text: { type: "string", description: "Max 17 characters, letters the board can show." }, points: { type: "integer" } },
    required: ["text"],
  },
};

export const questionSchema = {
  type: "object",
  properties: { text: { type: "string", description: "Max 100 characters." }, answers: answersSchema },
  required: ["text"],
};
