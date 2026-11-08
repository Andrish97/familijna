// Nieużywane klucze tłumaczeń (web/shared/translation/<lang>/<część>.js).
//
// Klucz jest używany, gdy w kodzie (web, supabase, cloudflare, scripts)
// występuje dosłownie, gdy pasuje do prefiksu dynamicznego
// (t(`ns.${x}`), "ns." + x) albo gdy należy do sekcji czytanej w całości
// poza stroną (Worker, maile). Testy się nie liczą — tekst używany tylko
// w teście jest martwy.
//
// node scripts/i18n-unused.mjs          -> nieużywane (pl/en/uk) i użyte, a brakujące
// node scripts/i18n-unused.mjs --json   -> { unused, missing } dla testu
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LANGS, loadDicts } from "./i18n-parts.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export { LANGS, loadDicts };

// Sekcje czytane w całości poza stroną: send-email (authEmail),
// Worker (marketplaceSsr, contactEmail).
export const EXTERNAL_SECTIONS = ["authEmail", "marketplaceSsr", "contactEmail"];

const SCAN_DIRS = ["web", "supabase/functions", "cloudflare", "scripts"];
const SKIP = [
  /^web\/shared\/translation\/(pl|en|uk)\//,
  /^web\/shared\/vendor\//,
  /^scripts\/i18n-unused\.mjs$/,
  /\/node_modules\//,
  /^supabase\/functions\/_shared\/notification-mail-texts\.js$/,
  /^supabase\/functions\/_shared\/push-app-texts\.js$/,
];
const EXT = /\.(js|mjs|cjs|ts|html|json)$/;

function walk(dir, out) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    const rel = path.relative(root, full).split(path.sep).join("/");
    if (SKIP.some((re) => re.test(rel))) continue;
    if (ent.isDirectory()) walk(full, out);
    else if (EXT.test(ent.name)) out.push(rel);
  }
  return out;
}

export function flatten(obj, prefix = "", out = []) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) flatten(v, key, out);
    else out.push(key);
  }
  return out;
}

export function readCorpus() {
  const files = SCAN_DIRS.flatMap((d) => (fs.existsSync(path.join(root, d)) ? walk(path.join(root, d), []) : []));
  return files.map((f) => fs.readFileSync(path.join(root, f), "utf8")).join("\n");
}

// Prefiksy kluczy składanych w locie: `ns.sub.${x}`, "ns.sub." + x, 'ns.' + x.
export function dynamicPrefixes(corpus) {
  const out = new Set();
  for (const m of corpus.matchAll(/`([A-Za-z][\w]*(?:\.[\w]+)*\.?[\w]*)\$\{/g)) out.add(m[1]);
  for (const m of corpus.matchAll(/["']([A-Za-z][\w]*(?:\.[\w]+)*\.?[\w]*)["']\s*\+/g)) out.add(m[1]);
  // Same fragmenty bez kropki (np. "a" + x) nie są prefiksami kluczy.
  return [...out].filter((p) => p.includes("."));
}

export function findUnused(keys, corpus, prefixes) {
  const words = new Set(corpus.match(/[A-Za-z][\w]*(?:\.[\w$]+)+/g) || []);
  return keys.filter((key) => {
    if (EXTERNAL_SECTIONS.includes(key.split(".")[0])) return false;
    if (words.has(key)) return false;
    // Klucz-rodzic użyty w całości (t("x.list") zwraca obiekt).
    const parts = key.split(".");
    for (let i = 1; i < parts.length; i++) if (words.has(parts.slice(0, i).join("."))
      && corpus.includes(`"${parts.slice(0, i).join(".")}"`)) return false;
    if (prefixes.some((p) => key.startsWith(p))) return false;
    return true;
  });
}

// Klucze użyte w kodzie stron dosłownie (t("a.b"), data-i18n*="a.b"), których
// nie ma w słowniku -- strona pokazałaby wtedy surowy klucz.
export function findMissing(keys) {
  const have = new Set(keys);
  const files = walk(path.join(root, "web"), []);
  const used = new Map();
  for (const f of files) {
    const src = fs.readFileSync(path.join(root, f), "utf8");
    for (const m of src.matchAll(/\bt\(\s*["']([A-Za-z][\w]*(?:\.[\w]+)+)["']|data-i18n[a-z-]*="([A-Za-z][\w]*(?:\.[\w]+)+)"/g)) {
      const key = m[1] || m[2];
      if (!used.has(key)) used.set(key, f);
    }
  }
  return [...used].filter(([k]) => !have.has(k) && !keys.some((h) => h.startsWith(`${k}.`))).map(([k, f]) => `${k} (${f})`).sort();
}

export async function report() {
  const dicts = await loadDicts();
  const corpus = readCorpus();
  const prefixes = dynamicPrefixes(corpus);
  const all = new Set(LANGS.flatMap((l) => flatten(dicts[l])));
  const unused = findUnused([...all].sort(), corpus, prefixes);
  const missing = {};
  for (const lang of LANGS) {
    const own = new Set(flatten(dicts[lang]));
    missing[lang] = [...all].filter((k) => !own.has(k)).sort();
  }
  const missingInDict = findMissing(flatten(dicts.pl));
  return { unused, missing, missingInDict, total: all.size };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const r = await report();
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(r, null, 1));
  } else {
    console.log(`kluczy: ${r.total}, nieużywanych: ${r.unused.length}`);
    for (const k of r.unused) console.log(k);
    if (r.missingInDict.length) console.log(`\nużyte w kodzie, brak w słowniku: ${r.missingInDict.length}\n${r.missingInDict.join("\n")}`);
    for (const lang of LANGS) if (r.missing[lang].length) console.log(`\nbrak w ${lang}: ${r.missing[lang].length}\n${r.missing[lang].join("\n")}`);
  }
}
