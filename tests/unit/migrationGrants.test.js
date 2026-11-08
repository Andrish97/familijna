// E24 (przegląd 2026-11-08, R11): od migracji 529 każda nowa funkcja w public ma
// w tym samym pliku REVOKE … FROM PUBLIC (prawo domyślne Postgresa = także anon),
// a funkcja wołana ze strony jawne GRANT EXECUTE … TO anon/authenticated.
// Każda nowa tabela public ma RLS.
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

test("nowe funkcje public mają REVOKE … FROM PUBLIC", () => {
  const bad = [];
  for (const { f, sql } of migrations()) {
    const re = /create\s+(?:or\s+replace\s+)?function\s+(?:"?public"?\.)"?([a-z_0-9]+)"?\s*\(/gi;
    let m;
    while ((m = re.exec(sql))) {
      const name = m[1];
      // PUBLIC (domyślne prawo Postgresa) daje funkcję każdemu, także anon.
      const has = new RegExp(`revoke[^;]*on\\s+function\\s+(?:"?public"?\\.)"?${name}"?\\b[^;]*from[^;]*\\bpublic\\b`, "i").test(sql);
      const trigger = new RegExp(`function\\s+(?:"?public"?\\.)"?${name}"?\\s*\\([^)]*\\)\\s*returns\\s+trigger`, "i").test(sql);
      if (!has && !trigger) bad.push(`${f}: ${name}`);
    }
  }
  assert.deepStrictEqual(bad, [], "funkcje bez REVOKE … FROM PUBLIC:\n" + bad.join("\n"));
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
