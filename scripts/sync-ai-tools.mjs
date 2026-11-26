#!/usr/bin/env node
// E30 (decyzja 19): kopia katalogu narzędzi czatu dla serwera MCP (funkcja Edge
// `mcp`). Źródło: web/shared/js/ai/tools/*.js + web/shared/js/core/logo-text.js;
// cel: supabase/functions/_shared/ai-tools/ (nie edytować ręcznie).
// Użycie: node scripts/sync-ai-tools.mjs        — zapis
//         node scripts/sync-ai-tools.mjs --check — tylko sprawdzenie (kod 1 przy różnicy)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "web/shared/js/ai/tools");
const OUT = path.join(ROOT, "supabase/functions/_shared/ai-tools");
const HEADER = "// Wygenerowane przez scripts/sync-ai-tools.mjs z web/shared/js/ai/tools — nie edytować.\n";

export function expectedFiles() {
  const files = new Map();
  for (const name of fs.readdirSync(SRC).filter((f) => f.endsWith(".js")).sort()) {
    const src = fs.readFileSync(path.join(SRC, name), "utf8");
    const bad = [...src.matchAll(/from\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']/g)]
      .map((m) => m[1] || m[2]).filter((p) => !p.startsWith("./") && p !== "../../core/logo-text.js");
    if (bad.length) throw new Error(`${name}: narzędzia nie mogą importować modułów przeglądarki: ${bad.join(", ")}`);
    files.set(name, HEADER + src.replaceAll("../../core/logo-text.js", "./logo-text.js"));
  }
  files.set("logo-text.js", HEADER + fs.readFileSync(path.join(ROOT, "web/shared/js/core/logo-text.js"), "utf8"));
  return files;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const check = process.argv.includes("--check");
  const files = expectedFiles();
  let diff = 0;
  if (!check) fs.mkdirSync(OUT, { recursive: true });
  const existing = fs.existsSync(OUT) ? fs.readdirSync(OUT) : [];
  for (const [name, body] of files) {
    const p = path.join(OUT, name);
    const cur = fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null;
    if (cur === body) continue;
    diff += 1;
    if (check) console.log(`różni się: ${name}`); else fs.writeFileSync(p, body);
  }
  for (const name of existing.filter((n) => !files.has(n))) {
    diff += 1;
    if (check) console.log(`zbędny: ${name}`); else fs.rmSync(path.join(OUT, name));
  }
  console.log(check ? (diff ? `różnic: ${diff}` : "zgodne") : `zapisano (zmian: ${diff})`);
  if (check && diff) process.exit(1);
}
