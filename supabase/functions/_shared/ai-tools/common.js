// Wygenerowane przez scripts/sync-ai-tools.mjs z web/shared/js/ai/tools — nie edytować.
// Wspólne pomocnicze dla narzędzi czatu AI (E30).

export const uuid = { type: "string", description: "UUID" };
export const uuidList = { type: "array", items: { type: "string" }, description: "UUIDs" };
export const noArgs = { type: "object", properties: {} };

/** RPC przez połączenie z ctx.db (przeglądarka albo serwer MCP); błąd jako wyjątek. */
export async function rpc(ctx, fn, args) {
  const { data, error } = await ctx.db.rpc(fn, args);
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
