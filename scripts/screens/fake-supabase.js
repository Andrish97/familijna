// Atrapa klienta Supabase dla zrzutów ekranu (scripts/screens/run.cjs).
// Wstrzykiwana do strony zamiast @supabase/supabase-js z CDN. Strona działa
// na własnym, prawdziwym kodzie; podmieniona jest tylko warstwa danych.
//
// Dane: window.__SCREENS_DB__ = { user, tables, rpc, relations }
//   tables    -- { nazwa: [wiersze] } (zapisy insert/update/delete trafiają do pamięci)
//   rpc       -- { nazwa: wartość } albo { nazwa: "fn:<źródło funkcji (args, db)>" }
//   relations -- osadzenia select("..., answers(...)"): { "rodzic.dziecko": { fk, local?, one? } }
// Zapytania, których dane nie znają, trafiają do window.__SCREENS_MISSES__
// (runner wypisuje je po każdej scenie -- znak, że trzeba dopisać dane).
(() => {
  const db = window.__SCREENS_DB__;
  const misses = (window.__SCREENS_MISSES__ = []);
  const miss = (kind, name) => { const key = `${kind}:${name}`; if (!misses.includes(key)) misses.push(key); };
  const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
  // db.latency (ms): opóźnienie odpowiedzi tabel i RPC -- podgląd stopniowego ładowania.
  // window.__SCREENS_TRACE__: każde zapytanie { name, start, end } (ms od startu strony) -- pomiar
  // rund zapytań przy db.latency (scripts/screens/perf.cjs). getUser to w Supabase zapytanie do serwera.
  const trace = (window.__SCREENS_TRACE__ = []);
  const now = () => (globalThis.performance ? performance.now() : Date.now());
  const respond = (v, name = "?") => {
    const entry = { name, start: now(), end: null };
    trace.push(entry);
    const done = () => { entry.end = now(); return v; };
    return db.latency ? new Promise((resolve) => setTimeout(() => resolve(done()), db.latency)) : Promise.resolve(done());
  };
  let seq = 0;
  const newId = () => `00000000-0000-4000-9000-${String(++seq).padStart(12, "0")}`;

  // db.user === null: odwiedzający bez sesji (np. strona główna przed logowaniem).
  const user = db.user;
  const session = user ? { access_token: "screens-token", refresh_token: "screens-refresh", token_type: "bearer", expires_at: 4102444800, user } : null;

  // ---------- select z osadzeniami: "id,name,questions(count)" ----------
  function splitTop(str) {
    const out = []; let depth = 0; let cur = "";
    for (const ch of str) {
      if (ch === "(") depth++;
      if (ch === ")") depth--;
      if (ch === "," && depth === 0) { out.push(cur.trim()); cur = ""; } else cur += ch;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  }
  // Kolumny proste, aliasy i ścieżki JSON: "id,w:payload->w,mode:payload->source->>mode".
  function project(row, parts) {
    if (parts.some((p) => p === "*")) return { ...row };
    const out = {};
    for (const part of parts) {
      if (part.includes("(")) continue;
      const m = part.match(/^(?:(\w+):)?([\w]+)((?:->>?[\w]+)*)(?:::\w+)?$/);
      if (!m) { out[part] = row[part]; continue; }
      const [, alias, col, pathStr] = m;
      const keys = pathStr ? pathStr.split(/->>?/).filter(Boolean) : [];
      let v = row[col];
      for (const k of keys) v = v == null ? null : v[k];
      if (v !== undefined) out[alias || (keys.length ? keys[keys.length - 1] : col)] = v;
    }
    return out;
  }
  function embed(table, rows, columns) {
    if (!columns) return rows;
    const parts = splitTop(columns);
    const embeds = parts.map((part) => part.match(/^(?:(\w+):)?(\w+)(?:!\w+)?\((.*)\)$/s)).filter(Boolean);
    return rows.map((row) => {
      const copy = project(row, parts);
      for (const [, alias, child, inner] of embeds) {
        const rel = db.relations?.[`${table}.${child}`];
        const childRows = db.tables[child] || [];
        if (!rel) { miss("relation", `${table}.${child}`); copy[alias || child] = []; continue; }
        let found = rel.one
          ? childRows.filter((c) => c.id === row[rel.local])
          : childRows.filter((c) => c[rel.fk] === row.id);
        if (inner.trim() === "count") { copy[alias || child] = [{ count: found.length }]; continue; }
        found = embed(child, found.map(clone), inner);
        copy[alias || child] = rel.one ? found[0] || null : found;
      }
      return copy;
    });
  }

  // ---------- filtry PostgREST ----------
  const canonical = (value) => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.keys(v).sort().map(key => [key, v[key]])) : v);
  function equal(a, b) {
    if (a && typeof a === 'object') {
      try { return canonical(a) === canonical(typeof b === 'string' ? JSON.parse(b) : b); }
      catch { return false; }
    }
    return String(a) === String(b);
  }
  const ops = {
    eq: equal, neq: (a, b) => !equal(a, b),
    gt: (a, b) => a > b, gte: (a, b) => a >= b, lt: (a, b) => a < b, lte: (a, b) => a <= b,
    is: (a, b) => (b === null ? a == null : a === b),
    in: (a, b) => (Array.isArray(b) ? b : String(b).replace(/^\(|\)$/g, "").split(",")).map(String).includes(String(a)),
    like: (a, b) => new RegExp(`^${String(b).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*")}$`).test(String(a ?? "")),
    ilike: (a, b) => new RegExp(`^${String(b).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*")}$`, "i").test(String(a ?? "")),
    contains: (a, b) => (Array.isArray(b) ? b.every((x) => (a || []).includes(x)) : Object.entries(b || {}).every(([k, v]) => a?.[k] === v)),
  };

  function query(table) {
    if (!db.tables[table]) { miss("table", table); db.tables[table] = []; }
    const state = { filters: [], order: [], limit: null, range: null, single: null, mode: "select", payload: null, columns: "*", count: null, head: false, returning: false };
    const api = {
      select(columns = "*", opts = {}) {
        if (state.mode === "select") { state.columns = columns; state.count = opts.count || null; state.head = !!opts.head; }
        else { state.returning = true; state.columns = columns; }
        return api;
      },
      insert(rows) { state.mode = "insert"; state.payload = rows; return api; },
      upsert(rows) { state.mode = "upsert"; state.payload = rows; return api; },
      update(patch) { state.mode = "update"; state.payload = patch; return api; },
      delete() { state.mode = "delete"; return api; },
      filter(col, op, val) {
        const not = op.startsWith("not.");
        const name = not ? op.slice(4) : op;
        const fn = ops[name];
        if (!fn) { miss("filter", name); return api; }
        // filtr po osadzonej tabeli: "qb_questions.base_id" (relacja one)
        const dot = col.indexOf(".");
        if (dot > 0) {
          const child = col.slice(0, dot);
          const ccol = col.slice(dot + 1);
          const rel = db.relations?.[`${table}.${child}`];
          if (!rel?.one) { miss("relation", `${table}.${child}`); return api; }
          state.filters.push((r) => {
            const c = (db.tables[child] || []).find((x) => x.id === r[rel.local]);
            return !!c && fn(c[ccol], val) !== not;
          });
          return api;
        }
        state.filters.push((r) => fn(r[col], val) !== not);
        return api;
      },
      not(col, op, val) { return api.filter(col, `not.${op}`, val); },
      match(obj) { for (const [k, v] of Object.entries(obj)) api.eq(k, v); return api; },
      or() { return api; },
      textSearch() { return api; },
      order(col, opts = {}) { state.order.push([col, opts.ascending !== false]); return api; },
      limit(n) { state.limit = n; return api; },
      range(from, to) { state.range = [from, to]; return api; },
      single() { state.single = "single"; return chainable(run()); },
      maybeSingle() { state.single = "maybe"; return chainable(run()); },
      returns() { return api; },
      abortSignal() { return api; },
      throwOnError() { return api; },
      then(ok, ko) { return run().then(ok, ko); },
    };
    for (const name of Object.keys(ops)) if (!api[name]) api[name] = (col, val) => api.filter(col, name, val);

    function selected() {
      let rows = db.tables[table].filter((r) => state.filters.every((f) => f(r)));
      for (const [col, asc] of [...state.order].reverse()) {
        rows = [...rows].sort((a, b) => ((a[col] ?? "") > (b[col] ?? "") ? 1 : (a[col] ?? "") < (b[col] ?? "") ? -1 : 0) * (asc ? 1 : -1));
      }
      return rows;
    }
    function run() {
      let rows;
      if (state.mode === "insert" || state.mode === "upsert") {
        const list = (Array.isArray(state.payload) ? state.payload : [state.payload]).map((r) => ({ id: newId(), created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...r }));
        db.tables[table].push(...list);
        rows = list;
      } else if (state.mode === "update") {
        rows = selected();
        rows.forEach((r) => Object.assign(r, state.payload));
      } else if (state.mode === "delete") {
        rows = selected();
        db.tables[table] = db.tables[table].filter((r) => !rows.includes(r));
      } else rows = selected();
      const total = rows.length;
      if (state.range) rows = rows.slice(state.range[0], state.range[1] + 1);
      if (state.limit != null) rows = rows.slice(0, state.limit);
      rows = embed(table, rows.map(clone), state.columns);
      if (state.mode !== "select" && !state.returning && !state.single) rows = null;
      let data = state.head ? null : rows;
      if (state.single) {
        data = rows?.[0] ?? null;
        if (!data && state.single === "single") return respond({ data: null, error: { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" }, count: null, status: 406 }, `${state.mode} ${table}`);
      }
      return respond({ data, error: null, count: state.count ? total : null, status: 200 }, `${state.mode} ${table}`);
    }
    return api;
  }

  // Obietnica z metodami, które prawdziwy klient pozwala dopiąć po single()/rpc().
  function chainable(p) {
    p.single = () => p; p.maybeSingle = () => p; p.select = () => p; p.abortSignal = () => p; p.returns = () => p; p.throwOnError = () => p;
    return p;
  }

  // ---------- RPC ----------
  function rpc(name, args = {}) {
    let data = null;
    if (Object.prototype.hasOwnProperty.call(db.rpc, name)) {
      const v = db.rpc[name];
      data = typeof v === "string" && v.startsWith("fn:") ? (0, eval)(`(${v.slice(3)})`)(args || {}, db) : clone(v);
    } else miss("rpc", name);
    return chainable(respond({ data, error: null, status: 200 }, `rpc ${name}`));
  }

  const channel = () => { const c = { on: () => c, subscribe: (cb) => { try { cb?.("SUBSCRIBED"); } catch {} return c; }, unsubscribe: async () => "ok", send: async () => "ok", track: async () => "ok", untrack: async () => "ok", presenceState: () => ({}) }; return c; };
  const client = {
    auth: {
      getSession: async () => ({ data: { session }, error: null }),
      getUser: () => respond(user ? { data: { user }, error: null } : { data: { user: null }, error: { name: "AuthSessionMissingError", message: "Auth session missing!" } }, "auth getUser"),
      onAuthStateChange: (cb) => { setTimeout(() => { try { cb?.("INITIAL_SESSION", session); } catch {} }, 0); return { data: { subscription: { unsubscribe() {} } } }; },
      signOut: async () => ({ error: null }),
      refreshSession: async () => ({ data: { session, user }, error: user ? null : { message: "Auth session missing!" } }),
      updateUser: async () => ({ data: { user }, error: null }),
      signInAnonymously: async () => ({ data: { session, user }, error: null }),
    },
    from: query,
    rpc,
    schema: () => client,
    channel, removeChannel: async () => "ok", removeAllChannels: async () => [], getChannels: () => [],
    realtime: { setAuth() {} },
    storage: { from: (bucket) => ({
      getPublicUrl: (p) => ({ data: { publicUrl: db.storage?.[`${bucket}/${p}`] || "" } }),
      list: async () => ({ data: [], error: null }),
      download: async () => ({ data: null, error: null }),
      upload: async (p) => ({ data: { path: p }, error: null }),
      remove: async () => ({ data: [], error: null }),
      createSignedUrl: async (p) => ({ data: { signedUrl: db.storage?.[`${bucket}/${p}`] || "" }, error: null }),
    }) },
    functions: { invoke: async (name) => {
      // Odpowiedź funkcji Edge z danych sceny (db.functions), inaczej zgłoszenie braku.
      if (db.functions && Object.prototype.hasOwnProperty.call(db.functions, name)) return respond({ data: db.functions[name], error: null }, `function ${name}`);
      miss("function", name); return respond({ data: { ok: true }, error: null }, `function ${name}`);
    } },
  };
  window.supabase = { createClient: () => client };
})();
