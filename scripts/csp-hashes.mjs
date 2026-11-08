#!/usr/bin/env node
// Hashe skryptów wbudowanych w strony web/**/*.html dla CSP bez 'unsafe-inline'
// (E24 R12). Zapis: cloudflare/maintenance-worker/src/lib/core/csp-hashes.js.
// Użycie: node scripts/csp-hashes.mjs [--check]  (zapadka: unit/cspHashes.test.js)
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "cloudflare/maintenance-worker/src/lib/core/csp-hashes.js");

function htmlFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? htmlFiles(p) : e.name.endsWith(".html") ? [p] : [];
  });
}

export function inlineScripts() {
  const found = new Map();
  for (const file of htmlFiles(path.join(ROOT, "web")).sort()) {
    const html = fs.readFileSync(file, "utf8");
    for (const m of html.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/g)) {
      if (/type=["']?application\/(ld\+)?json/i.test(m[1])) continue;
      const hash = `'sha256-${crypto.createHash("sha256").update(m[2], "utf8").digest("base64")}'`;
      if (!found.has(hash)) found.set(hash, { file: path.relative(ROOT, file), versioned: m[2].includes("?v=") });
    }
  }
  return found;
}

export function render() {
  const found = inlineScripts();
  // Skrypt doklejany przy budowaniu strony (scripts/module-preload.cjs) — treść stała.
  const { TRANSLATION_PRELOAD_JS } = createRequire(import.meta.url)("./module-preload.cjs");
  found.set(`'sha256-${crypto.createHash("sha256").update(TRANSLATION_PRELOAD_JS, "utf8").digest("base64")}'`, { file: "scripts/module-preload.cjs (build)", versioned: false });
  const bad = [...found.values()].filter((x) => x.versioned).map((x) => x.file);
  if (bad.length) throw new Error(`skrypt wbudowany z ?v= (hash zmieniałby się przy wersjonowaniu): ${bad.join(", ")}`);
  const lines = [...found.entries()].map(([h, x]) => `  "${h}", // ${x.file}`);
  return `// Generowany: node scripts/csp-hashes.mjs — nie edytować ręcznie (E24 R12).\nexport const INLINE_SCRIPT_HASHES = [\n${lines.join("\n")}\n];\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const text = render();
  if (process.argv.includes("--check")) {
    const cur = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8") : "";
    if (cur !== text) { console.error("csp-hashes.js nieaktualny: node scripts/csp-hashes.mjs"); process.exit(1); }
  } else {
    fs.writeFileSync(OUT, text);
    console.log(`zapisano ${OUT}`);
  }
}
