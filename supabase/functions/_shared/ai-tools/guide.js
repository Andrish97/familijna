// Wygenerowane przez scripts/sync-ai-tools.mjs z web/shared/js/ai/tools — nie edytować.
// Narzędzia czatu AI: wskazywanie na stronie. Gdy czegoś nie zrobi sam
// (wgranie pliku, rysowanie odręczne, podłączenie urządzenia, rozgrywka
// w Control) albo użytkownik pyta „gdzie to jest”, czat przechodzi na stronę,
// odsłania kartę/sekcję i podświetla element z krótkim tekstem (ctx.pointAt).
// Serwer MCP nie ma strony — zwraca link i opis miejsca.
import { POINT_TARGETS, POINT_PAGES, PAGE_PATHS, NEEDS_ID } from "./targets.js";

export default [
  {
    name: "list_page_places",
    description: "Places that show_on_page can point to on a page (key and what it is).",
    inputSchema: { type: "object", properties: { page: { type: "string", enum: POINT_PAGES } }, required: ["page"] },
    readOnly: true,
    run({ page }) {
      const places = POINT_TARGETS[page];
      if (!places) return { error: "unknown_page" };
      return { page, needs_id: NEEDS_ID.has(page), places: Object.entries(places).map(([key, p]) => ({ key, about: p.about, needs_selected_item: p.select || undefined })) };
    },
  },
  {
    name: "show_on_page",
    description: "Show the user where to do something: go to the page (if needed), open the right tab or section, highlight the element and put your short explanation next to it. Use it when you cannot do the thing yourself (uploading a file, drawing by hand, sounds from files, connecting a device, anything during a game in Control) or when the user asks where something is. Place keys: list_page_places. For places on a selected game/logo/base and for pages of one item, give its id. During a game (Control) only places on Control can be shown.",
    inputSchema: {
      type: "object",
      properties: {
        page: { type: "string", enum: POINT_PAGES },
        place: { type: "string", description: "Key from list_page_places." },
        id: { type: "string", description: "UUID of the game, base or logo (page of one item, or the item to select first)." },
        text: { type: "string", description: "What to do there, 1–2 short sentences in the user's language (max 200 characters)." },
      },
      required: ["page", "place", "text"],
    },
    readOnly: true,
    async run({ page, place, id, text }, ctx) {
      const target = POINT_TARGETS[page]?.[place];
      if (!target) return { error: "unknown_place", hint: "Use list_page_places." };
      if (NEEDS_ID.has(page) && !id) return { error: "id_required" };
      if (target.select && !id) return { error: "id_required", hint: `Give the ${target.select} id to select.` };
      const note = String(text || "").trim().slice(0, 200);
      if (!ctx.pointAt) {
        const url = new URL(PAGE_PATHS[page], ctx.site || "https://www.familijna.app");
        if (NEEDS_ID.has(page) || (target.select && page !== "games")) url.searchParams.set("id", id);
        return { ok: true, link: url.toString(), place: target.about, note: "Give the user this link and say where the place is." };
      }
      if (ctx.pageId === "control" && page !== "control") return { error: "game_in_progress", hint: "During a game only places on Control can be shown." };
      if (page === "control" && ctx.pageId !== "control") return { error: "control_not_open", hint: "Control opens when the user starts a game (games page, Play)." };
      return ctx.pointAt({ page, place, id: id || null, text: note });
    },
  },
];
