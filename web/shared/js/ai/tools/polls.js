// Narzędzia czatu AI: ankiety (stan i wyniki, uruchomienie, zatrzymanie,
// wznowienie, przerwanie, zaproszenia, podliczenie). Stany gry:
// draft → poll_open ⇄ poll_stopped → ready (migracja 315).
import { sb } from "../../core/supabase.js";
import { sendPollInviteMails } from "../../core/poll-mail.js";
import { uuid, uuidList, rpc, rows } from "./common.js";

const gameArg = { type: "object", properties: { game_id: uuid }, required: ["game_id"] };

async function pollGame(gameId) {
  const [g] = await rows(sb().from("games").select("id,name,type,status,share_key_poll").eq("id", gameId));
  return g || null;
}

export default [
  {
    name: "get_poll",
    description: "Poll of a game (type poll_text or poll_points): status, who can be invited (friends by user_id, subscribers by id), sent invitations, and current results (votes per answer; for text polls the raw typed answers).",
    inputSchema: gameArg,
    readOnly: true,
    async run({ game_id }) {
      const g = await pollGame(game_id);
      if (!g) return { error: "not_found" };
      const panel = await rpc("poll_share_panel", { p_game_id: game_id });
      const results = g.status === "draft" ? null : await rpc("poll_tally_source", { p_game_id: game_id });
      return {
        game: { id: g.id, name: g.name, type: g.type, status: g.status },
        can_invite: panel?.ok !== false ? { friends: panel.friends, subscribers: panel.subscribers } : panel,
        invitations: panel?.tasks?.filter((t) => !t.hidden).map((t) => ({ id: t.id, to: t.label, status: t.status })),
        results,
      };
    },
  },
  {
    name: "open_poll",
    description: "Start collecting votes in a poll (draft → poll_open). The game must meet the poll rules (see get_game can_open_poll).",
    inputSchema: gameArg,
    async run({ game_id }, ctx) {
      const g = await pollGame(game_id);
      if (!g) return { error: "not_found" };
      await rpc("poll_open", { p_game_id: game_id, p_key: g.share_key_poll });
      ctx.changed({ type: "game", id: game_id });
      return { ok: true, status: "poll_open" };
    },
  },
  {
    name: "stop_poll",
    description: "Pause voting (poll_open → poll_stopped). Votes are kept; the poll can be resumed or tallied.",
    inputSchema: gameArg,
    async run({ game_id }, ctx) {
      await rpc("poll_stop", { p_game_id: game_id });
      ctx.changed({ type: "game", id: game_id });
      return { ok: true, status: "poll_stopped" };
    },
  },
  {
    name: "resume_poll",
    description: "Resume voting (poll_stopped → poll_open).",
    inputSchema: gameArg,
    async run({ game_id }, ctx) {
      await rpc("poll_resume", { p_game_id: game_id });
      ctx.changed({ type: "game", id: game_id });
      return { ok: true, status: "poll_open" };
    },
  },
  {
    name: "abort_poll",
    description: "Abort the poll: delete all votes and invitations, back to draft (old links stop working).",
    inputSchema: gameArg,
    confirm: () => "irreversible",
    async run({ game_id }, ctx) {
      const res = await rpc("poll_abort", { p_game_id: game_id });
      ctx.changed({ type: "game", id: game_id });
      return res;
    },
  },
  {
    name: "send_poll_invites",
    description: "Invite friends (user_id from get_poll) and subscribers (id from get_poll) to vote; they get a task and, when allowed, an e-mail.",
    inputSchema: {
      type: "object",
      properties: { game_id: uuid, friend_user_ids: uuidList, subscriber_ids: uuidList },
      required: ["game_id"],
    },
    confirm: () => "send",
    async run({ game_id, friend_user_ids = [], subscriber_ids = [] }, ctx) {
      const data = await rpc("poll_share_send", { p_game_id: game_id, p_friend_ids: friend_user_ids, p_subscriber_ids: subscriber_ids });
      if (data?.ok === false) return data;
      const mail = await sendPollInviteMails({ mailItems: data?.mail });
      ctx.changed({ type: "game", id: game_id });
      return { ok: true, created: data?.created, blocked: data?.blocked, mail };
    },
  },
  {
    name: "tally_poll",
    description: "Close the poll and turn votes into points (the game becomes ready to play). poll_points: no extra input. poll_text: give for every question the final answers — merge synonyms of the typed answers (sum their counts), fix spelling, 3–6 answers per question, answer text max 17 characters; points are computed from counts. Read get_poll results first.",
    inputSchema: {
      type: "object",
      properties: {
        game_id: uuid,
        text_answers: {
          type: "array",
          description: "poll_text only: one item per question.",
          items: {
            type: "object",
            properties: {
              question_id: uuid,
              answers: { type: "array", items: { type: "object", properties: { text: { type: "string" }, count: { type: "integer" } }, required: ["text", "count"] } },
            },
            required: ["question_id", "answers"],
          },
        },
      },
      required: ["game_id"],
    },
    confirm: () => "irreversible",
    async run({ game_id, text_answers }, ctx) {
      const g = await pollGame(game_id);
      if (!g) return { error: "not_found" };
      if (g.type === "poll_points") await rpc("poll_points_tally", { p_game_id: game_id });
      else {
        const items = (Array.isArray(text_answers) ? text_answers : []).map((q) => ({ question_id: q.question_id, answers: q.answers, selected: null }));
        await rpc("poll_text_tally_apply", { p_game_id: game_id, p_payload: { items } });
      }
      ctx.changed({ type: "game", id: game_id });
      return { ok: true, status: "ready" };
    },
  },
];
