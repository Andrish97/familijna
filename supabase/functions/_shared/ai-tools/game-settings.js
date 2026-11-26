// Wygenerowane przez scripts/sync-ai-tools.mjs z web/shared/js/ai/tools — nie edytować.
// Narzędzia czatu AI: ustawienia gry (drużyny, kolory, motyw, logo, finał,
// pytania rund i finału, dźwięki, ekran końca, nagrody). Zapis przez endpoint game_settings_save (właściciel, reguły
// edycji, blokady, kontrola równoczesnego zapisu). Te same reguły co strona
// Ustawień gry; własne pliki dźwięków i motywów wgrywa się na stronie.
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

/**
 * Zmiany z argumentów narzędzia nałożone na zapisane ustawienia; błąd → { error, field }.
 * known: { questions: [{ id, ord, text }], sounds: { key: [plik] }, themes: [klucz] }
 * — potrzebne tylko dla pól pytań, dźwięków i motywu.
 */
export function patchSettings(saved, args, known = {}) {
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
  if (args.has_final != null) {
    at("game").hasFinal = !!args.has_final;
    // bez finału: wybrane pytania finału wracają na koniec rund (jak strona)
    if (!args.has_final && args.final_questions == null) args = { ...args, final_questions: { mode: "random" } };
  }
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
  if (args.host_logo != null) {
    if (!["source", "pixel"].includes(args.host_logo)) return { error: "invalid_value", field: "host_logo" };
    at("display").hostLogoMode = args.host_logo;
  }
  if (args.theme !== undefined) {
    if (args.theme && !(known.themes || []).includes(args.theme)) return { error: "unknown_theme", field: "theme", available: known.themes || [] };
    at("display").theme = args.theme || null;
  }
  if (args.sounds != null) {
    for (const item of Array.isArray(args.sounds) ? args.sounds : []) {
      const files = known.sounds?.[item?.sound];
      if (!files) return { error: "unknown_sound", field: "sounds", available: Object.keys(known.sounds || {}) };
      if (item.variant != null) {
        if (!files.includes(item.variant)) return { error: "unknown_variant", field: `sounds.${item.sound}`, available: files };
        at("sound", "variants")[item.sound] = item.variant;
      }
      if (item.volume != null) {
        const v = intIn(item.volume, { min: 0, max: 100 });
        if (v == null) return { error: "out_of_range", field: `sounds.${item.sound}.volume`, min: 0, max: 100 };
        at("sound", "volumes")[item.sound] = v;
      }
    }
  }
  const byId = new Map((known.questions || []).map((q) => [String(q.id), { id: q.id, ord: q.ord, text: q.text }]));
  const pickList = (ids, field) => {
    const list = [];
    for (const id of Array.isArray(ids) ? ids : []) {
      const q = byId.get(String(id));
      if (!q) return { error: "unknown_question", field, question_id: id };
      if (list.some((x) => x.id === q.id)) return { error: "duplicate_question", field, question_id: id };
      list.push(q);
    }
    return { list };
  };
  if (args.final_questions != null) {
    const { mode, question_ids } = args.final_questions;
    if (!["random", "pick"].includes(mode)) return { error: "invalid_value", field: "final_questions.mode" };
    const game = at("game");
    const questions = at("questions");
    const prevFinal = Array.isArray(questions.final) ? questions.final : [];
    if (mode === "pick") {
      const picked = pickList(question_ids, "final_questions");
      if (picked.error) return picked;
      if (picked.list.length !== 5) return { error: "final_needs_5", field: "final_questions", count: picked.list.length };
      const ids = new Set(picked.list.map((q) => q.id));
      questions.final = picked.list;
      // pytania finału znikają z rund (jak na stronie)
      questions.rounds = (Array.isArray(questions.rounds) ? questions.rounds : []).filter((q) => !ids.has(q.id));
    } else {
      // losowy finał: poprzednio wybrane pytania finału wracają na koniec rund (jak strona)
      const inRounds = new Set((questions.rounds || []).map((q) => String(q.id)));
      questions.rounds = [...(questions.rounds || []), ...prevFinal.filter((q) => q?.id && !inRounds.has(String(q.id)))];
      questions.final = [];
    }
    game.finalQuestionsMode = mode;
  }
  if (args.round_questions != null) {
    const { mode, question_ids } = args.round_questions;
    if (!["random", "pick"].includes(mode)) return { error: "invalid_value", field: "round_questions.mode" };
    if (mode === "pick") {
      const picked = pickList(question_ids, "round_questions");
      if (picked.error) return picked;
      if (!picked.list.length) return { error: "no_questions", field: "round_questions" };
      const finalIds = new Set((s.questions?.final || []).map((q) => String(q.id)));
      const clash = picked.list.find((q) => finalIds.has(String(q.id)));
      if (clash) return { error: "question_in_final", field: "round_questions", question_id: clash.id };
      at("questions").rounds = picked.list;
    }
    at("game").roundsQuestionsMode = mode;
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
    theme: s?.display?.theme ?? null,
    host_logo: s?.display?.hostLogoMode === "pixel" ? "pixel" : "source",
    final_questions: { mode: s?.game?.finalQuestionsMode ?? "random", question_ids: (s?.questions?.final || []).map((q) => q.id) },
    round_questions: { mode: s?.game?.roundsQuestionsMode ?? "random", question_ids: (s?.questions?.rounds || []).map((q) => q.id) },
    sounds: { variants: s?.sound?.variants || {}, volumes: s?.sound?.volumes || {} },
    note: "null colors/theme = defaults; sounds not listed = first variant at 100%.",
  };
}

// Dane do sprawdzenia pól: pytania gry, dźwięki (shared/data/sounds.json), motywy
// (wbudowane z shared/themes/index.json + własne my_display_themes).
async function loadKnown(ctx, gameId, args = null) {
  const need = (k) => !args || args[k] != null;
  const known = {};
  if (need("final_questions") || need("round_questions")) {
    known.questions = await rows(ctx.db.from("questions").select("id,ord,text").eq("game_id", gameId).order("ord"));
  }
  if (need("sounds")) {
    const json = await ctx.loadJson("/shared/data/sounds.json");
    known.sounds = Object.fromEntries((json.categories || []).map((c) => [c.key, (c.sounds || []).map((x) => String(x.file).split("?")[0])]));
  }
  if (args ? args.theme : true) {
    const index = await ctx.loadJson("/shared/themes/index.json");
    let custom = [];
    try { custom = ((await rpc(ctx, "my_display_themes", {}))?.themes || []).map((t) => `custom:${String(t.id).toLowerCase()}`); } catch { custom = []; }
    known.themes = [...(index.themes || []).map((t) => t.key), ...custom];
  }
  return known;
}

const colorArg = { type: "string", description: "Hex colour, e.g. #FF8C1A." };

export default [
  {
    name: "get_game_settings",
    description: "Read a game's settings (team names, colours, theme, logo, host logo, final on/off, which questions go to the final and to the rounds, sounds, end screen, prizes, round multipliers) and the options to choose from (themes, sound variants, the game's questions with ids).",
    inputSchema: { type: "object", properties: { game_id: uuid }, required: ["game_id"] },
    readOnly: true,
    async run({ game_id }, ctx) {
      const [game] = await rows(ctx.db.from("games").select("id,name,settings").eq("id", game_id));
      if (!game) return { error: "not_found" };
      const known = await loadKnown(ctx, game_id);
      return {
        game: { id: game.id, name: game.name }, settings: view(game.settings),
        options: { themes: known.themes, sounds: known.sounds, questions: known.questions.map((q) => ({ id: q.id, position: q.ord, text: q.text })) },
      };
    },
  },
  {
    name: "update_game_settings",
    description: "Change a game's settings. Give only the fields to change. Questions: final_questions / round_questions with mode random (drawn before the game) or pick (final: exactly 5 question ids; rounds: ids in playing order, without final questions). Sounds: choose a variant and volume per sound; own sound files are uploaded on the settings page (show_on_page gameSettings sound).",
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
        theme: { type: "string", description: "Board theme key from get_game_settings options; empty string = default." },
        host_logo: { type: "string", enum: ["source", "pixel"], description: "Host tablet shows the logo as drawn (source) or as board dots (pixel)." },
        final_questions: { type: "object", properties: { mode: { type: "string", enum: ["random", "pick"] }, question_ids: { type: "array", items: { type: "string" } } }, required: ["mode"] },
        round_questions: { type: "object", properties: { mode: { type: "string", enum: ["random", "pick"] }, question_ids: { type: "array", items: { type: "string" } } }, required: ["mode"] },
        sounds: {
          type: "array",
          items: { type: "object", properties: { sound: { type: "string", description: "Sound key (options.sounds)." }, variant: { type: "string", description: "File of the variant (options.sounds[key])." }, volume: { type: "integer", description: "0–100 %." } }, required: ["sound"] },
        },
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
        const patched = patchSettings(game.settings, args, await loadKnown(ctx, args.game_id, args));
        if (patched.error) return patched;
        const res = await rpc(ctx, "game_settings_save", { p_game_id: args.game_id, p_expected: game.settings ?? null, p_settings: patched.settings, p_tab_id: ctx.tabId });
        if (res?.ok) { ctx.changed({ type: "game", id: args.game_id }); return { ok: true, settings: view(patched.settings) }; }
        if (res?.error !== "conflict") return res;
      }
      return { error: "conflict" };
    },
  },
];
