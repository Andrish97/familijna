// src/lib/core/translations.js -- teksty z tłumaczeń strony, część serwera
// (translation/<lang>/server.js) pobierana z originu w trakcie działania.
//
// Workers nie pozwalają na eval/new Function, więc pliku nie wykonujemy:
// wycinamy z niego jedną sekcję najwyższego poziomu (np. `contactEmail: {`)
// i parsujemy ją ścisłym parserem literału obiektu — dozwolone są tylko
// obiekty i stringi. Sekcje używane przez workera muszą więc zawierać same
// stringi (placeholdery jak na stronie: "{ticket}"), bez funkcji.
//
// Gdy origin leży, a w pamięci nie ma żadnej wersji — rzucamy błąd.
import { ORIGIN_BASE, fetchWithOrigin } from "../origin/origin.js";
import { normalizeLang } from "./utils.js";

const CACHE_TTL_MS = 10 * 60 * 1000;

// lang -> { code, at, sections: Map<section, object> }
const cache = new Map();

async function fetchTranslationCode(lang) {
  const url = `${ORIGIN_BASE}/shared/translation/${lang}/server.js?t=${Date.now()}`;
  const res = await fetchWithOrigin(url, new Request(url));
  if (res.status !== 200) throw new Error(`HTTP ${res.status} for /shared/translation/${lang}/server.js`);
  return res.text();
}

async function loadEntry(lang, section) {
  const hit = cache.get(lang);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit;
  try {
    const code = await fetchTranslationCode(lang);
    // Stara wersja strony (np. tuż po deployu) bez potrzebnej sekcji — nie cache'ujemy.
    extractSection(code, section);
    const entry = { code, at: Date.now(), sections: new Map() };
    cache.set(lang, entry);
    return entry;
  } catch (err) {
    if (hit) {
      console.warn("[worker] translations fetch failed, using stale cache", lang, String(err));
      return hit;
    }
    throw new Error(`Cannot load translations (${lang}): ${String(err?.message || err)}`);
  }
}

/** Zwraca sekcję tłumaczeń (np. "contactEmail") dla języka; brak w en/uk → pl. */
export async function getTranslationSection(lang, section) {
  const safeLang = normalizeLang(lang);
  try {
    const entry = await loadEntry(safeLang, section);
    if (!entry.sections.has(section)) entry.sections.set(section, extractSection(entry.code, section));
    return entry.sections.get(section);
  } catch (err) {
    if (safeLang === "pl") throw err;
    console.warn("[worker] translations: falling back to pl", safeLang, section, String(err?.message || err));
    return getTranslationSection("pl", section);
  }
}

/** "Numer: {ticket}" + { ticket: "A1" } → "Numer: A1" (jak t() na stronie). */
export function formatText(template, vars = {}) {
  return String(template ?? "").replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? `{${k}}`));
}

// ── wycinanie i parsowanie sekcji ──────────────────────────────────────────

export function extractSection(code, section) {
  // Sekcje najwyższego poziomu mają w częściach tłumaczeń wcięcie 2 spacji.
  const re = new RegExp(`\\n {2}${section}\\s*:\\s*\\{`);
  const m = re.exec(code);
  if (!m) throw new Error(`no "${section}" section in translations`);
  const parser = new LiteralParser(code, m.index + m[0].length - 1);
  return parser.parseObject();
}

class LiteralParser {
  constructor(src, pos) {
    this.src = src;
    this.pos = pos;
  }

  fail(msg) {
    throw new Error(`translations parse error at ${this.pos}: ${msg}`);
  }

  skipWs() {
    const s = this.src;
    for (;;) {
      while (this.pos < s.length && /\s/.test(s[this.pos])) this.pos++;
      if (s.startsWith("//", this.pos)) {
        const nl = s.indexOf("\n", this.pos);
        this.pos = nl === -1 ? s.length : nl + 1;
      } else if (s.startsWith("/*", this.pos)) {
        const end = s.indexOf("*/", this.pos + 2);
        if (end === -1) this.fail("unterminated comment");
        this.pos = end + 2;
      } else {
        return;
      }
    }
  }

  expect(ch) {
    this.skipWs();
    if (this.src[this.pos] !== ch) this.fail(`expected "${ch}"`);
    this.pos++;
  }

  parseObject() {
    this.expect("{");
    const obj = {};
    for (;;) {
      this.skipWs();
      if (this.src[this.pos] === "}") { this.pos++; return obj; }
      const key = this.parseKey();
      this.expect(":");
      obj[key] = this.parseValue();
      this.skipWs();
      const ch = this.src[this.pos];
      if (ch === ",") { this.pos++; continue; }
      if (ch === "}") { this.pos++; return obj; }
      this.fail('expected "," or "}"');
    }
  }

  parseKey() {
    this.skipWs();
    const ch = this.src[this.pos];
    if (ch === '"' || ch === "'") return this.parseString();
    const m = /^[A-Za-z_$][\w$]*/.exec(this.src.slice(this.pos, this.pos + 200));
    if (!m) this.fail("expected key");
    this.pos += m[0].length;
    return m[0];
  }

  parseValue() {
    this.skipWs();
    const ch = this.src[this.pos];
    if (ch === "{") return this.parseObject();
    if (ch === '"' || ch === "'") return this.parseString();
    this.fail("only strings and objects are allowed in worker translation sections");
  }

  parseString() {
    const s = this.src;
    const quote = s[this.pos++];
    let out = "";
    while (this.pos < s.length) {
      const ch = s[this.pos++];
      if (ch === quote) return out;
      if (ch === "\n") this.fail("newline in string");
      if (ch !== "\\") { out += ch; continue; }
      const esc = s[this.pos++];
      if (esc === "n") out += "\n";
      else if (esc === "t") out += "\t";
      else if (esc === "r") out += "\r";
      else if (esc === "u") {
        const hex = s.slice(this.pos, this.pos + 4);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) this.fail("bad \\u escape");
        out += String.fromCharCode(parseInt(hex, 16));
        this.pos += 4;
      } else out += esc; // \" \' \\ i pozostałe
    }
    this.fail("unterminated string");
  }
}
