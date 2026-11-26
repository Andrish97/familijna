// E30 (decyzja 19): rdzeń serwera MCP Familijnej (wzór: Makietka,
// supabase/functions/_shared/mcp-http.mjs). Zwykły JavaScript bez modułów
// Deno — funkcja Edge `mcp` podaje zależności, testy unit atrapy.
//
// Adresy (przez Workera: https://api.familijna.app/mcp…):
//   POST /mcp                                      — JSON-RPC (Streamable HTTP, odpowiedź JSON)
//   GET  /.well-known/oauth-protected-resource[/mcp]
//   GET  /.well-known/oauth-authorization-server   (i openid-configuration)
//   POST /mcp/oauth/register                       — rejestracja klienta (DCR)
//   GET  /mcp/oauth/authorize                      — PKCE S256 → okno zgody w Ustawieniach konta (przez /login/?next=account)
//   POST /mcp/oauth/token                          — kod → token fam_mcp_…
// Narzędzia: kopia katalogu czatu (./ai-tools, scripts/sync-ai-tools.mjs),
// wołane klientem Supabase z krótkotrwałym JWT użytkownika — te same
// endpointy i RLS co strona. Narzędzia przeglądarki (where: "browser") pominięte.
import { toolsForPage, toolByName } from "./ai-tools/index.js";

export const SERVER_INFO = { name: "familijna", title: "Familijna", version: "1.0.0" };
export const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26"];
const ERR = { PARSE: -32700, REQUEST: -32600, METHOD: -32601, PARAMS: -32602, INTERNAL: -32603 };
const INSTRUCTIONS = [
  "Familijna: games based on survey answers (prepared games, text polls, point polls), question bases, logos, friends and subscribers.",
  "Read ids with list_* / get_* tools before changing anything. Answer questions about the service from manual_contents and manual_chapter.",
  "Deleting, tallying or aborting polls and sending invitations cannot be undone or reach other people — ask the user first.",
  "Things the tools cannot do (uploading files, own sounds, drawing by hand, connecting devices, the live game in Control): show_on_page gives the link to the right page and says where the place is.",
  "Picture logos: draw_logo (150×70 dot board, preview_only first); text logos: create_text_logo.",
  "Game rules: ≥ 10 questions to play or start a poll; prepared and poll_points games: 3–6 answers per question; prepared: points ≥ 4 each, sum ≤ 100; answer text ≤ 17 characters, question ≤ 100.",
].join("\n");

const json = (status, body, headers = {}) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json", "cache-control": "no-store", ...headers },
});
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type, mcp-protocol-version, mcp-session-id",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-expose-headers": "www-authenticate, mcp-session-id",
};

export function oauthMetadata(pub) {
  return {
    resource: {
      resource: `${pub}/mcp`,
      authorization_servers: [pub],
      bearer_methods_supported: ["header"],
      resource_name: "Familijna",
    },
    server: {
      issuer: pub,
      authorization_endpoint: `${pub}/mcp/oauth/authorize`,
      token_endpoint: `${pub}/mcp/oauth/token`,
      registration_endpoint: `${pub}/mcp/oauth/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      scopes_supported: ["familijna"],
    },
  };
}

// Ścieżka względem /mcp (Worker: /mcp…, bezpośrednio: /functions/v1/mcp…).
export function routeOf(pathname) {
  const wk = pathname.indexOf("/.well-known/");
  if (wk >= 0) return pathname.slice(wk);
  const i = pathname.indexOf("/mcp");
  const rest = i >= 0 ? pathname.slice(i + 4) : pathname;
  return `/mcp${rest.replace(/\/+$/, "")}`;
}

/** Opis narzędzia dla klienta MCP (z podpowiedziami: tylko odczyt / nieodwracalne). */
export function toolDescriptor(x) {
  const destructive = typeof x.confirm === "function";
  return {
    name: x.name,
    description: x.description,
    inputSchema: x.inputSchema,
    annotations: { readOnlyHint: !!x.readOnly, destructiveHint: destructive, openWorldHint: false },
  };
}

function rpcResult(id, result) { return { jsonrpc: "2.0", id, result }; }
function rpcError(id, code, message) { return { jsonrpc: "2.0", id: id ?? null, error: { code, message } }; }

/**
 * Jedna wiadomość JSON-RPC. session: { ctx } — ctx narzędzi użytkownika.
 * Zwraca odpowiedź albo null (powiadomienie).
 */
export async function handleMessage(msg, session) {
  if (!msg || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") return rpcError(msg?.id, ERR.REQUEST, "Invalid request");
  const { id, method, params = {} } = msg;
  if (id === undefined || id === null) return null; // powiadomienia (notifications/initialized…)
  if (method === "initialize") {
    const asked = params.protocolVersion;
    return rpcResult(id, {
      protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
      capabilities: { tools: { listChanged: false } },
      serverInfo: SERVER_INFO,
      instructions: INSTRUCTIONS,
    });
  }
  if (method === "ping") return rpcResult(id, {});
  if (method === "tools/list") return rpcResult(id, { tools: toolsForPage(null, { server: true }).map(toolDescriptor) });
  if (method === "tools/call") {
    const tool = toolByName(params.name);
    if (!tool || tool.where === "browser") return rpcError(id, ERR.PARAMS, `Unknown tool: ${params.name}`);
    let result;
    try {
      result = await tool.run(params.arguments || {}, session.ctx);
    } catch (e) {
      result = { ok: false, error: String(e?.message || e) };
    }
    const failed = !!result?.error || result?.ok === false;
    return rpcResult(id, { content: [{ type: "text", text: JSON.stringify(result ?? {}) }], isError: failed });
  }
  return rpcError(id, ERR.METHOD, `Method not found: ${method}`);
}

/**
 * Obsługa żądania HTTP. deps:
 *   pub (https://api.familijna.app), site (https://www.familijna.app),
 *   anonRpc(fn, args) → data (rola anon), tokenUser(token) → { user_id, token_id } | null,
 *   userCtx({ userId, tokenId }) → ctx narzędzi (klient z JWT użytkownika, maile, Wskazówki…).
 */
export async function handleHttp(request, deps) {
  const url = new URL(request.url);
  const route = routeOf(url.pathname);
  const meta = oauthMetadata(deps.pub);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  if (route.startsWith("/.well-known/oauth-protected-resource")) return json(200, meta.resource, CORS);
  if (route.startsWith("/.well-known/oauth-authorization-server") || route.startsWith("/.well-known/openid-configuration")) return json(200, meta.server, CORS);

  if (route === "/mcp/oauth/register" && request.method === "POST") {
    let body = {};
    try { body = await request.json(); } catch { /* pusta */ }
    const res = await deps.anonRpc("mcp_client_register", {
      p_name: String(body.client_name || ""), p_redirect_uris: Array.isArray(body.redirect_uris) ? body.redirect_uris.map(String) : [],
    });
    if (!res?.ok) return json(400, { error: "invalid_redirect_uri", error_description: "Redirect URIs must be https or http://localhost." }, CORS);
    return json(201, {
      client_id: res.client_id, client_name: res.client_name, redirect_uris: body.redirect_uris,
      token_endpoint_auth_method: "none", grant_types: ["authorization_code"], response_types: ["code"],
    }, CORS);
  }

  if (route === "/mcp/oauth/authorize" && request.method === "GET") {
    const q = url.searchParams;
    if (q.get("response_type") !== "code" || q.get("code_challenge_method") !== "S256") {
      return json(400, { error: "invalid_request", error_description: "response_type=code and code_challenge_method=S256 required." });
    }
    const res = await deps.anonRpc("mcp_authorize_begin", {
      p_client: q.get("client_id") || "", p_redirect_uri: q.get("redirect_uri") || "",
      p_challenge: q.get("code_challenge") || "", p_state: q.get("state"),
    }).catch(() => null);
    if (!res?.ok) return json(400, { error: res?.error || "invalid_request" });
    return new Response(null, { status: 302, headers: { location: `${deps.site}/login/?next=account&ai=${encodeURIComponent(res.request_id)}`, "cache-control": "no-store" } });
  }

  if (route === "/mcp/oauth/token" && request.method === "POST") {
    const text = await request.text();
    const p = Object.fromEntries(new URLSearchParams(text));
    if (p.grant_type !== "authorization_code") return json(400, { error: "unsupported_grant_type" }, CORS);
    const res = await deps.anonRpc("mcp_token_exchange", {
      p_code: p.code || "", p_verifier: p.code_verifier || "", p_client: p.client_id || "", p_redirect_uri: p.redirect_uri || "",
    }).catch(() => null);
    if (!res?.ok) return json(400, { error: "invalid_grant" }, CORS);
    return json(200, { access_token: res.access_token, token_type: "Bearer", expires_in: res.expires_in, scope: "familijna" }, CORS);
  }

  if (route !== "/mcp") return json(404, { error: "not_found" }, CORS);
  if (request.method === "GET" || request.method === "HEAD") {
    return new Response("Familijna MCP server. Add it as a connector in Claude or ChatGPT: " + `${deps.pub}/mcp`, {
      status: 200, headers: { "content-type": "text/plain; charset=utf-8", ...CORS },
    });
  }
  if (request.method !== "POST") return json(405, rpcError(null, ERR.REQUEST, "POST only"), { ...CORS, allow: "POST, OPTIONS" });

  const unauthorized = (id) => json(401, rpcError(id, ERR.REQUEST, "Sign in to Familijna (OAuth)."), {
    ...CORS, "www-authenticate": `Bearer resource_metadata="${deps.pub}/.well-known/oauth-protected-resource/mcp"`,
  });
  let body;
  try { body = JSON.parse(await request.text()); } catch { return json(400, rpcError(null, ERR.PARSE, "Parse error"), CORS); }
  const token = /^Bearer\s+(fam_mcp_[0-9a-f]{64})$/i.exec(request.headers.get("authorization") || "")?.[1];
  const user = token ? await deps.tokenUser(token).catch(() => null) : null;
  if (!user) return unauthorized(Array.isArray(body) ? null : body?.id);

  const session = { ctx: await deps.userCtx({ userId: user.user_id, tokenId: user.token_id }) };
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map((m) => handleMessage(m, session)))).filter(Boolean);
    return out.length ? json(200, out, CORS) : new Response(null, { status: 202, headers: CORS });
  }
  const out = await handleMessage(body, session);
  return out ? json(200, out, CORS) : new Response(null, { status: 202, headers: CORS });
}
