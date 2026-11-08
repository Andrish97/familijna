// E24 (przegląd 2026-11-08, R11): od migracji 529 każda nowa funkcja w public ma
// jawne prawa (GRANT/REVOKE EXECUTE w tym samym pliku), a każda nowa tabela public
// ma RLS. Domyślnie (528) nowe funkcje nie są wykonywalne przez anon/authenticated —
// funkcja wołana ze strony potrzebuje GRANT EXECUTE … TO anon/authenticated.
import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.resolve(__dirname, "..", "..", "supabase", "migrations");
const FROM = 529;

function migrations() {
  return fs.readdirSync(DIR).filter((f) => /^\d{4}-\d{2}-\d{2}_(\d+)_.*\.sql$/.test(f))
    .filter((f) => Number(f.split("_")[1]) >= FROM)
    .map((f) => ({ f, sql: fs.readFileSync(path.join(DIR, f), "utf8").replace(/--[^\n]*/g, "") }));
}

test("nowe funkcje public mają jawne GRANT/REVOKE EXECUTE", () => {
  const bad = [];
  for (const { f, sql } of migrations()) {
    const re = /create\s+(?:or\s+replace\s+)?function\s+(?:"?public"?\.)"?([a-z_0-9]+)"?\s*\(/gi;
    let m;
    while ((m = re.exec(sql))) {
      const name = m[1];
      const has = new RegExp(`(grant|revoke)[^;]*execute[^;]*on\\s+function\\s+(?:"?public"?\\.)"?${name}"?\\b`, "i").test(sql)
        || new RegExp(`(grant|revoke)[^;]*on\\s+function\\s+(?:"?public"?\\.)"?${name}"?\\b`, "i").test(sql);
      const trigger = new RegExp(`function\\s+(?:"?public"?\\.)"?${name}"?\\s*\\([^)]*\\)\\s*returns\\s+trigger`, "i").test(sql);
      if (!has && !trigger) bad.push(`${f}: ${name}`);
    }
  }
  assert.deepStrictEqual(bad, [], "funkcje bez jawnych praw:\n" + bad.join("\n"));
});

test("nowe tabele public mają RLS", () => {
  const bad = [];
  for (const { f, sql } of migrations()) {
    const re = /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:"?public"?\.)"?([a-z_0-9]+)"?/gi;
    let m;
    while ((m = re.exec(sql))) {
      const name = m[1];
      if (!new RegExp(`alter\\s+table\\s+(?:if\\s+exists\\s+)?(?:only\\s+)?(?:"?public"?\\.)"?${name}"?\\s+enable\\s+row\\s+level\\s+security`, "i").test(sql)) bad.push(`${f}: ${name}`);
    }
  }
  assert.deepStrictEqual(bad, [], "tabele bez RLS:\n" + bad.join("\n"));
});
