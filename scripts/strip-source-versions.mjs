#!/usr/bin/env node
// Usuwa znaczniki wersji ?v=… ze źródeł strony (web/). Od 2026-11-21 źródła są
// bez ?v=: wersje dokłada dopiero build przy wdrożeniu (npm run build:site —
// scripts/version-assets.js, potem skróty z treści w scripts/content-hash-assets.cjs).
// Użycie po scaleniu gałęzi sprzed tej zmiany: node scripts/strip-source-versions.mjs
// (--check: tylko sprawdza, kod wyjścia 1 przy znalezionych ?v=).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../web");
// Te same pliki co w scripts/version-assets.js (bez vendor/ i img/, bez sw.js).
const SKIP_DIRS = new Set(["vendor", "img", "node_modules"]);
const EXTS = new Set([".html", ".js", ".json", ".css", ".webmanifest"]);
export const VERSION_RE = /(\.[a-zA-Z0-9]+)\?v=[a-zA-Z0-9T:-]+/g;

export function sourceFiles(dir = WEB, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) { if (!SKIP_DIRS.has(entry.name)) sourceFiles(file, out); }
    else if (EXTS.has(path.extname(entry.name).toLowerCase()) && entry.name !== "sw.js") out.push(file);
  }
  return out;
}

export function stripVersions({ check = false } = {}) {
  const found = [];
  for (const file of sourceFiles()) {
    const source = fs.readFileSync(file, "utf8");
    const output = source.replace(VERSION_RE, "$1");
    if (output === source) continue;
    found.push(path.relative(WEB, file));
    if (!check) fs.writeFileSync(file, output);
  }
  return found;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes("--check");
  const found = stripVersions({ check });
  console.log(check ? `Pliki z ?v=: ${found.length}` : `Usunięto ?v= w plikach: ${found.length}`);
  for (const file of found) console.log(`  ${file}`);
  if (check && found.length) process.exitCode = 1;
}
