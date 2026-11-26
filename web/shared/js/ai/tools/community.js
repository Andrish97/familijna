// Narzędzia czatu AI: Zadania (ankiety do wypełnienia od innych) i Rynek
// (Gry Społeczności): wyszukiwanie, szczegóły, biblioteka, ocena, wycofanie
// zgłoszenia. Te same RPC co strony Zadania i Rynek. Zgłoszenie gry na Rynek
// składa paczkę gry w przeglądarce — czat wskazuje je (show_on_page marketplace).
import { uuid, noArgs, rpc } from "./common.js";

const list = (data) => (Array.isArray(data) ? data : []);
const one = (data) => (Array.isArray(data) ? data[0] : data);

export default [
  {
    name: "list_tasks",
    description: "Polls other people asked the user to fill in (tasks): id, title, from whom, state, and the link to vote. The user votes on that page themselves.",
    inputSchema: noArgs,
    readOnly: true,
    async run(_args, ctx) {
      const base = ctx.site || "";
      const tasks = list(await rpc(ctx, "tasks_list", { p_kind: null })).filter((x) => x.kind === "poll");
      return {
        tasks: tasks.map((x) => ({
          id: x.id, title: x.title, from: x.owner_label, state: x.state, expires_at: x.expires_at,
          vote_link: x.token ? `${base}${x.poll_type === "poll_points" ? "/polls/vote/points/" : "/polls/vote/text/"}?t=${encodeURIComponent(x.token)}&lang=${ctx.lang}` : null,
        })),
      };
    },
  },
  {
    name: "decline_task",
    description: "Decline a poll someone asked the user to fill in (task id from list_tasks).",
    inputSchema: { type: "object", properties: { task_id: uuid }, required: ["task_id"] },
    confirm: () => "irreversible",
    async run({ task_id }, ctx) {
      const ok = await rpc(ctx, "polls_hub_task_decline", { p_task_id: task_id });
      if (ok) ctx.changed({ type: "tasks", id: task_id });
      return { ok: !!ok };
    },
  },
  {
    name: "search_market",
    description: "Search community games in the Market (title or description contains the words; optional language). Returns up to 20: market id, title, language, author, rating, how many added it.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" }, lang: { type: "string", enum: ["pl", "en", "uk"] },
        sort: { type: "string", enum: ["best_rated", "most_added", "newest", "title"], description: "Default: catalog order (recommended)." },
      },
    },
    readOnly: true,
    async run({ query = "", lang, sort }, ctx) {
      const words = String(query).toLowerCase().split(/\s+/).filter(Boolean);
      const rows = list(await rpc(ctx, "market_public_catalog", {}))
        .filter((g) => !lang || g.lang === lang)
        .filter((g) => words.every((w) => `${g.title} ${g.description || ""}`.toLowerCase().includes(w)));
      const by = {
        best_rated: (a, b) => (Number(b.avg_rating) || 0) - (Number(a.avg_rating) || 0),
        most_added: (a, b) => (b.library_count || 0) - (a.library_count || 0),
        newest: (a, b) => String(b.created_at).localeCompare(String(a.created_at)),
        title: (a, b) => String(a.title).localeCompare(String(b.title)),
      }[sort];
      if (by) rows.sort(by);
      return {
        total: rows.length,
        games: rows.slice(0, 20).map((g) => ({ market_id: g.id, title: g.title, lang: g.lang, author: g.author_username, rating: g.avg_rating, ratings: g.rating_count, added: g.library_count })),
      };
    },
  },
  {
    name: "get_market_game",
    description: "Details of a Market game (description, questions preview, rating) by market id.",
    inputSchema: { type: "object", properties: { market_id: uuid }, required: ["market_id"] },
    readOnly: true,
    async run({ market_id }, ctx) {
      return one(await rpc(ctx, "market_game_detail", { p_id: market_id })) || { error: "not_found" };
    },
  },
  {
    name: "market_library",
    description: "Games the user added from the Market (their library) and the user's own submissions to the Market with their status.",
    inputSchema: noArgs,
    readOnly: true,
    async run(_args, ctx) {
      const [library, submissions] = await Promise.all([rpc(ctx, "market_my_library", {}), rpc(ctx, "market_my_submissions", {})]);
      return {
        library: list(library).map((g) => ({ market_id: g.market_game_id, game_id: g.game_id, title: g.title, author: g.author_username, archived: g.archived })),
        submissions: list(submissions).map((g) => ({ market_id: g.id, game_id: g.source_game_id, title: g.title, status: g.status, note: g.moderation_note, added: g.library_count, rating: g.avg_rating })),
      };
    },
  },
  {
    name: "market_add",
    description: "Add a Market game to the user's games (tab Market on My games) or remove it from there.",
    inputSchema: { type: "object", properties: { market_id: uuid, remove: { type: "boolean" } }, required: ["market_id"] },
    async run({ market_id, remove = false }, ctx) {
      const res = one(await rpc(ctx, remove ? "market_remove_from_library" : "market_add_to_library", { p_market_game_id: market_id }));
      ctx.changed({ type: "game", id: market_id });
      return res ?? { ok: true };
    },
  },
  {
    name: "rate_market_game",
    description: "Rate a Market game in the user's library (1–5 stars).",
    inputSchema: { type: "object", properties: { market_id: uuid, stars: { type: "integer", description: "1–5" } }, required: ["market_id", "stars"] },
    async run({ market_id, stars }, ctx) {
      return one(await rpc(ctx, "market_rate_game", { p_market_game_id: market_id, p_stars: Math.max(1, Math.min(5, Math.round(Number(stars) || 0))) }));
    },
  },
  {
    name: "withdraw_market_game",
    description: "Withdraw the user's own game from the Market (market id from market_library submissions).",
    inputSchema: { type: "object", properties: { market_id: uuid }, required: ["market_id"] },
    confirm: () => "irreversible",
    async run({ market_id }, ctx) {
      return one(await rpc(ctx, "market_withdraw", { p_market_game_id: market_id }));
    },
  },
];
