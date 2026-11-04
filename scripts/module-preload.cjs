#!/usr/bin/env node
// Wczesne pobieranie modułów strony (tylko artefakt wydania, po minifikacji,
// przed wersjami z treści). Przeglądarka odkrywa importy ES warstwami: dopiero
// po pobraniu modułu widzi jego importy, więc strona z łańcuchem 4–6 poziomów
// czekała 4–6 kolejnych zapytań. Tu wyliczamy cały statyczny graf importów
// każdej strony i dopisujemy <link rel="modulepreload"> — wszystkie moduły
// idą równolegle zaraz po HTML. Wykonanie bez zmian (preload tylko pobiera
// i parsuje). Do tego części słownika (<meta name="i18n-parts">) w języku
// użytkownika: translation.js wczytuje je dynamicznie, więc bez tego były
// ostatnią warstwą przed pokazaniem strony.
// Dynamiczne import() w modułach zostają leniwe; wyjątek: dosłowne import()
// w skrypcie modułowym wpisanym w HTML (Control, ustawienia gry — kod strony
// startuje po tłumaczeniach, ale pobierać go można od razu).
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { build } = createRequire(path.join(__dirname, '../tests/package.json'))('esbuild');

const MARK = 'data-preload';
const TRANSLATION = '/shared/translation/translation.js';

function htmlFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : htmlFiles(file);
    return entry.isFile() && entry.name.endsWith('.html') ? [file] : [];
  });
}

// Graf statycznych importów od podanych wejść: Map<plik, Set<zapytanie ?v=>>.
// Kolejność wstawienia = kolejność odkrywania (najpierw płytsze poziomy).
async function staticGraph(root, entries, inline) {
  const found = new Map();
  const edges = new Map();
  const plugin = {
    name: 'graph',
    setup(build) {
      build.onResolve({ filter: /.*/ }, args => {
        if (args.kind === 'entry-point') return null;
        if (args.kind !== 'import-statement') return { path: args.path, external: true };
        const [spec, query = ''] = args.path.split(/\?(.*)/s);
        if (/^[a-z]+:/i.test(spec) || spec.startsWith('//')) return { path: args.path, external: true };
        const file = spec.startsWith('/') ? path.join(root, spec) : path.resolve(args.resolveDir, spec);
        if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) return { path: args.path, external: true };
        const from = args.importer && args.importer !== '<stdin>' ? args.importer : null;
        if (!edges.has(from)) edges.set(from, []);
        edges.get(from).push({ file, query: query ? `?${query}` : '' });
        return { path: file };
      });
    },
  };
  const common = { bundle: true, write: false, format: 'esm', logLevel: 'silent', plugins: [plugin], outdir: 'out', metafile: false };
  if (entries.length) await build({ ...common, entryPoints: entries });
  for (const code of inline) await build({ ...common, stdin: { contents: code, resolveDir: root, loader: 'js' } });
  // BFS po krawędziach (esbuild rozwiązuje w dowolnej kolejności).
  const queue = [...entries, null];
  const seen = new Set(queue);
  while (queue.length) {
    const current = queue.shift();
    for (const { file, query } of edges.get(current) || []) {
      if (!found.has(file)) found.set(file, new Set());
      found.get(file).add(query);
      if (!seen.has(file)) { seen.add(file); queue.push(file); }
    }
  }
  for (const entry of entries) found.delete(entry); // wejścia stoją już w <script src>
  return found;
}

function translationScript(parts) {
  const list = JSON.stringify(['common', ...parts.filter(part => part !== 'common')]);
  // Ten sam wybór języka co getUiLang() w translation.js. Wersja części = wersja translation.js.
  return '<script ' + MARK + '>(function(){var q="";try{q=new URLSearchParams(location.search).get("lang")||"";if(!q)q=localStorage.getItem("uiLang")||""}catch(e){}'
    + 'if(!q)q=navigator.language||"";q=String(q).toLowerCase();var l=/^pl/.test(q)?"pl":/^en/.test(q)?"en":/^(uk|ua)/.test(q)?"uk":"pl";'
    + `var v=new URL("${TRANSLATION}?v=vASSET",location.href).search;`
    + `${list}.forEach(function(p){var e=document.createElement("link");e.rel="modulepreload";e.href="/shared/translation/"+l+"/"+p+".js"+v;document.head.appendChild(e)})})()</script>`;
}

async function addModulePreloads(root) {
  root = path.resolve(root);
  let pages = 0, links = 0;
  for (const file of htmlFiles(root)) {
    let html = fs.readFileSync(file, 'utf8');
    if (html.includes(` ${MARK}`)) continue;
    const head = html.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
    if (!head) continue;
    const entries = [], inline = [];
    for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      if (!/\btype=["']module["']/i.test(m[1])) continue;
      const src = m[1].match(/\bsrc=["']([^"']+)["']/i)?.[1];
      if (src) {
        const spec = src.split('?')[0];
        if (/^[a-z]+:/i.test(spec) || spec.startsWith('//')) continue;
        const target = spec.startsWith('/') ? path.join(root, spec) : path.resolve(path.dirname(file), spec);
        if (fs.existsSync(target)) entries.push(target);
      } else if (m[2].trim()) {
        inline.push(m[2]);
        // Dosłowne import("…") w skrypcie strony: pobrać od razu, wykonać jak dotąd.
        for (const d of m[2].matchAll(/\bimport\(\s*["']([^"'`]+)["']\s*\)/g)) inline.push(`import ${JSON.stringify(d[1])};`);
      }
    }
    if (!entries.length && !inline.length) continue;
    const graph = await staticGraph(root, entries, inline);
    const tags = [];
    for (const [target, queries] of graph) {
      const url = '/' + path.relative(root, target).split(path.sep).join('/');
      for (const query of queries) tags.push(`<link rel="modulepreload" href="${url}${query}" fetchpriority="low" ${MARK}>`);
    }
    const parts = html.match(/<meta\s+name=["']i18n-parts["']\s+content=["']([^"']*)["']/i)?.[1];
    const usesTranslation = graph.has(path.join(root, TRANSLATION)) || entries.includes(path.join(root, TRANSLATION));
    const script = parts !== undefined && usesTranslation ? translationScript(parts.split(/\s+/).filter(Boolean)) : '';
    if (!tags.length && !script) continue;
    const headStart = head.index + head[0].indexOf('>') + 1;
    const headEnd = head.index + head[0].length - '</head>'.length;
    // Moduły: koniec <head>, niski priorytet — arkusze CSS (pierwsze
    // wyświetlenie) idą przed nimi. Pomiar 2026-11-04: preload przed CSS
    // z wysokim priorytetem opóźniał FCP w Lighthouse (1,4 → 1,6 s).
    if (tags.length) html = html.slice(0, headEnd) + '  ' + tags.join('\n  ') + '\n' + html.slice(headEnd);
    // Słownik: przed pierwszym arkuszem (skrypt inline za arkuszem czekałby na
    // CSS), zwykły priorytet — strona w innym języku czeka na niego z pokazaniem.
    if (script) {
      const rel = html.slice(headStart, headEnd).search(/<link\b[^>]*rel=["']stylesheet["']/i);
      const at = rel >= 0 ? headStart + rel : headEnd;
      html = html.slice(0, at) + script + '\n  ' + html.slice(at);
    }
    fs.writeFileSync(file, html);
    pages++; links += tags.length + (script ? 1 : 0);
  }
  return { pages, links };
}

module.exports = { addModulePreloads };
if (require.main === module) {
  const root = process.argv[2];
  if (!root) { console.error('Użycie: module-preload.cjs KATALOG_ARTEFAKTU'); process.exitCode = 2; }
  else addModulePreloads(root).then(result => console.log(JSON.stringify(result)))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
