// E30 (decyzja 19): kopia narzędzi czatu dla serwera MCP jest zgodna ze źródłem
// (naprawa: node scripts/sync-ai-tools.mjs).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expectedFiles } from "../../scripts/sync-ai-tools.mjs";

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../supabase/functions/_shared/ai-tools");

test("kopia narzędzi dla serwera MCP zgodna ze źródłem", () => {
  const files = expectedFiles();
  assert.deepEqual(fs.readdirSync(OUT).sort(), [...files.keys()].sort());
  for (const [name, body] of files) assert.equal(fs.readFileSync(path.join(OUT, name), "utf8"), body, `${name} — uruchom node scripts/sync-ai-tools.mjs`);
});
