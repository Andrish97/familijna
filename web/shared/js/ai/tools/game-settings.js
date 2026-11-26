// Narzędzia czatu AI: ustawienia gry (drużyny, kolory, finał, ekran końca,
// nagrody, logo). Zapis przez endpoint game_settings_save (właściciel, reguły
// edycji, blokady, kontrola równoczesnego zapisu). Tylko pola z limitami
// strony Ustawień gry — wybór pytań i dźwięki zostają na stronie.
import { uuid, rpc, rows } from "./common.js";

// Te same granice co web/games/settings/js/advanced-limits.js (zgodność
// pilnuje unit/aiChat.test.js) i pola drużyny (LONG_MAX_INPUT).
export const SETTINGS_LIMITS = {
  teamName: 48,
  finalMinPoints: { min: 0, max: 9999 },
  finalTarget: { min: 1, max: 480 },
  mainPrizeAmount: { min: 1, max: 99999 },
  finalPrizeMultiplier: { min: 1, max: 10 },
  roundMultiplier: { min: 1, max: 99 },
};
const END_SCREENS = ["logo", "points", "money"];
const COLOR_KEYS = { team_a: "A", team_b: "B", background: "BACKGROUND", dots: "DOT" };

const hex = (v) => {
  let s = String(v ?? "").trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(s)) s = s.replace(/./g, (c) => c + c);
  return /^[0-9a-f]{6}$/i.test(s) ? `#${s.toUpperCase()}` : null;
};
const intIn = (v, { min, max }) => (Number.isSafeInteger(v) && v >= min && v <= max ? v : null);

/** Zmiany z argumentów narzędzia nałożone na zapisane ustawienia; błąd → { error, field }. */
export function patchSettings(saved, args) {
  const s = structuredClone(saved && typeof saved === "object" ? saved : {});
  const at = (...keys) => keys.reduce((o, k) => (o[k] = o[k] && typeof o[k] === "object" ? o[k] : {}), s);
  for (const [arg, key] of [["team_a_name", "teamA"], ["team_b_name", "teamB"]]) {
    if (args[arg] == null) continue;
    const name = String(args[arg]).trim();
    if (name.length > SETTINGS_LIMITS.teamName) return { error: "too_long", field: arg, max: SETTINGS_LIMITS.teamName };
    at("teams")[key] = name;
  }
  if (args.colors != null) {
    for (const [arg, key] of Object.entries(COLOR_KEYS)) {
      if (args.colors[arg] == null) continue;
      const c = hex(args.colors[arg]);
      if (!c) return { error: "invalid_color", field: `colors.${arg}` };
      at("display", "colors")[key] = c;
    }
  }
  if (args.logo_id !== undefined) at("display").logoId = args.logo_id || null;
  if (args.has_final != null) at("game").hasFinal = !!args.has_final;
  if (args.end_screen != null) {
    if (!END_SCREENS.includes(args.end_screen)) return { error: "invalid_value", field: "end_screen" };
    at("game", "advanced").endScreenMode = args.end_screen;
  }
  for (const [arg, key] of [["final_min_points", "finalMinPoints"], ["final_target", "finalTarget"], ["main_prize_amount", "mainPrizeAmount"], ["final_prize_multiplier", "finalPrizeMultiplier"]]) {
    if (args[arg] == null) continue;
    const v = intIn(args[arg], SETTINGS_LIMITS[key]);
    if (v == null) return { error: "out_of_range", field: arg, ...SETTINGS_LIMITS[key] };
    at("game", "advanced")[key] = v;
  }
  if (args.round_multipliers != null) {
    const list = Array.isArray(args.round_multipliers) ? args.round_multipliers.map((n) => intIn(n, SETTINGS_LIMITS.roundMultiplier)) : [];
    if (!list.length || list.length > 20 || list.includes(null)) return { error: "out_of_range", field: "round_multipliers", ...SETTINGS_LIMITS.roundMultiplier };
    at("game", "advanced").roundMultipliers = list;
  }
  return { settings: s };
}

function view(s) {
  const adv = s?.game?.advanced || {};
  return {
    team_a_name: s?.teams?.teamA || "", team_b_name: s?.teams?.teamB || "",
    colors: { team_a: s?.display?.colors?.A ?? null, team_b: s?.display?.colors?.B ?? null, background: s?.display?.colors?.BACKGROUND ?? null, dots: s?.display?.colors?.DOT ?? null },
    logo_id: s?.display?.logoId ?? null,
    has_final: s?.game?.hasFinal ?? true,
    end_screen: adv.endScreenMode ?? "money",
    final_min_points: adv.finalMinPoints ?? 300, final_target: adv.finalTarget ?? 200,
    main_prize_amount: adv.mainPrizeAmount ?? 25000, final_prize_multiplier: adv.finalPrizeMultiplier ?? 3,
    round_multipliers: adv.roundMultipliers ?? [1, 1, 1, 2, 3],
    note: "null colors = default colors.",
  };
}

const colorArg = { type: "string", description: "Hex colour, e.g. #FF8C1A." };

export default [
  {
    name: "get_game_settings",
    description: "Read a game's settings: team names, board colours, logo, final round on/off, end screen, prize amounts, round point multipliers.",
    inputSchema: { type: "object", properties: { game_id: uuid }, required: ["game_id"] },
    readOnly: true,
    async run({ game_id }, ctx) {
      const [game] = await rows(ctx.db.from("games").select("id,name,settings").eq("id", game_id));
      if (!game) return { error: "not_found" };
      return { game: { id: game.id, name: game.name }, settings: view(game.settings) };
    },
  },
  {
    name: "update_game_settings",
    description: "Change a game's settings. Give only the fields to change. Choosing questions for rounds/final and sounds are done on the game's settings page (open_page).",
    inputSchema: {
      type: "object",
      properties: {
        game_id: uuid,
        team_a_name: { type: "string", description: `Max ${SETTINGS_LIMITS.teamName} characters; empty = default.` },
        team_b_name: { type: "string", description: `Max ${SETTINGS_LIMITS.teamName} characters; empty = default.` },
        colors: { type: "object", properties: { team_a: colorArg, team_b: colorArg, background: colorArg, dots: colorArg } },
        logo_id: { type: "string", description: "UUID from list_logos; empty string = default logo." },
        has_final: { type: "boolean", description: "Play the final round." },
        end_screen: { type: "string", enum: END_SCREENS, description: "What the display shows at the end." },
        final_min_points: { type: "integer", description: "Points a team needs to enter the final (0–9999)." },
        final_target: { type: "integer", description: "Final score to win the main prize (1–480)." },
        main_prize_amount: { type: "integer", description: "Main prize amount (1–99999)." },
        final_prize_multiplier: { type: "integer", description: "Final points × multiplier when the target is missed (1–10)." },
        round_multipliers: { type: "array", items: { type: "integer" }, description: "Point multiplier per round, e.g. [1,1,1,2,3]; the last one repeats." },
      },
      required: ["game_id"],
    },
    async run(args, ctx) {
      if (args.logo_id) {
        const [logo] = await rows(ctx.db.from("user_logos").select("id").eq("id", args.logo_id));
        if (!logo) return { error: "logo_not_found" };
      }
      // Kontrola równoczesnego zapisu: przy „conflict” jedna próba na świeżych danych.
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const [game] = await rows(ctx.db.from("games").select("id,settings").eq("id", args.game_id));
        if (!game) return { error: "not_found" };
        const patched = patchSettings(game.settings, args);
        if (patched.error) return patched;
        const res = await rpc(ctx, "game_settings_save", { p_game_id: args.game_id, p_expected: game.settings ?? null, p_settings: patched.settings, p_tab_id: ctx.tabId });
        if (res?.ok) { ctx.changed({ type: "game", id: args.game_id }); return { ok: true, settings: view(patched.settings) }; }
        if (res?.error !== "conflict") return res;
      }
      return { error: "conflict" };
    },
  },
];
