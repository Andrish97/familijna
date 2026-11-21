#!/usr/bin/env node

/**
 * scripts/version-assets.js
 * Globalny cache-buster: JEDEN timestamp dla WSZYSTKICH zasobów w całym repozytorium.
 * Przeszukuje automatycznie wszystkie pliki tekstowe i aktualizuje odniesienia do zasobów.
 */

const fs = require('fs');
const path = require('path');

const ROOT = fs.existsSync(path.join(process.cwd(), 'web'))
  ? path.join(process.cwd(), 'web') : process.cwd();
const version = process.env.VERSION_HASH || `v${new Date().toISOString().replace(/[:.]/g, '').slice(0, -5)}`;

// Rozszerzenia plików, które chcemy wersjonować (zasoby)
const ASSET_EXT = 'js|css|json|png|svg|ico|jpg|jpeg|gif|woff2?|ttf|otf|webp|avif|xml|webmanifest|eot|mp3|wav|ogg|mp4|webm';

// Rozszerzenia plików, w których szukamy odniesień do zasobów (pliki źródłowe)
const SOURCE_EXT = ['.html', '.js', '.json', '.css', '.webmanifest'];

// Katalogi do całkowitego pominięcia
// "tests" pomijamy w całości: to zaplecze Playwright (package-lock.json,
// specy Node.js), a nie zasoby serwowane przeglądarce. Regex wersjonujący
// dopasowywał się też do składni JSON `"klucz": "cli.js"` w polach "bin"
// w tests/package-lock.json, dopisując tam "?v=..." i psując binarkę
// playwright w CI (npm ci przechodziło, ale bin/playwright nie istniał).
// "audio" NIE jest tu pomijane: audio/sounds.json to plik źródłowy (odsyła
// do plików .mp3 przez pole "file") i musi być wersjonowany jak każdy inny
// JSON. "img" zostaje pominięte — zawiera wyłącznie binarne obrazy, żadnych
// plików źródłowych do przeskanowania.
// "cloudflare" pomijane od tej zmiany: regex wersjonujący dopasowywał się
// też do porównań ścieżek w routingu Workera, np.
// `url.pathname === "/sitemap.xml?v=..."` — url.pathname z definicji nigdy
// nie zawiera "?...", więc taki warunek nigdy nie jest prawdziwy. Efekt:
// /sitemap.xml po cichu serwował statyczny plik zapasowy (3 adresy) zamiast
// dynamicznej listy gier, a /maintenance-state.json zwracał 404 zamiast
// żywego stanu z KV — przy każdym deployu ten sam auto-wersjoner na nowo
// psuł ręcznie naprawiony kod. Worker nie potrzebuje wersjonowania swoich
// referencji tym mechanizmem (to kod routingu, nie strona ładująca assety).
// "supabase" i "services" pomijane z tego samego powodu co "cloudflare" —
// to kod backendu (Edge Functions, migracje, osobno wdrażany serwis
// lead-finder), nigdy nie trafia do plików strony, więc nie ma czego
// wersjonować, a skanowanie go to tylko niepotrzebna praca i ryzyko takiej
// samej pomyłki jak w Workerze. Cała ta lista jest teraz świadomie
// lustrem dawnych wykluczeń z rsync w workflow wdrożenia strony (krok
// "Prepare public-only deployment directory") — jeśli tamta lista się
// zmieni, zmień i tę.
// "vendor" (web/shared/vendor) jest wyjątkiem od lustra rsync: pliki trafiają
// na Pages, ale to zminifikowany kod bibliotek — regex wersjonujący mógłby
// dopisać "?v=" do napisów w ich środku. Odwołania do nich (w HTML i JS
// stron) wersjonują się normalnie.
const IGNORE_DIRS = ['.git', 'node_modules', '.claude', '.qwen', '.github', 'img', 'tests', 'cloudflare', 'supabase', 'services', 'docs', 'searxng', 'vendor'];

/**
 * Rekurencyjnie pobiera listę plików do przetworzenia
 */
function getFiles(dir, allFiles = []) {
  const files = fs.readdirSync(dir, { withFileTypes: true });
  for (const file of files) {
    const fullPath = path.join(dir, file.name);
    if (file.isDirectory()) {
      if (!IGNORE_DIRS.includes(file.name)) {
        getFiles(fullPath, allFiles);
      }
    } else {
      if (SOURCE_EXT.includes(path.extname(file.name).toLowerCase())) {
        allFiles.push(fullPath);
      }
    }
  }
  return allFiles;
}

console.log(`[Versioner] Target version: ${version}`);

const filesToProcess = getFiles(ROOT);
let updatedCount = 0;

filesToProcess.forEach(filePath => {
  // Pomiń sam skrypt wersjonujący i sw.js (on ma specjalną logikę na końcu)
  if (filePath.endsWith('version-assets.js') || filePath.endsWith('sw.js')) return;

  let content = fs.readFileSync(filePath, 'utf8');
  const originalContent = content;
  const ext = path.extname(filePath).toLowerCase();

  // 1. Uniwersalne zastępowanie istniejących wersji: path.ext?v=stara_wersja
  const existingVersionRegex = new RegExp(`(\\.[a-zA-Z0-9]+)\\?v=[a-zA-Z0-9T:-]+`, 'g');
  content = content.replace(existingVersionRegex, `$1?v=${version}`);

  // Atrybut accept (<input type="file" accept=".json">) to filtr rozszerzeń,
  // nie adres pliku — ?v= psuł filtr okna wyboru plików. Czyścimy też stare
  // wpisy, które wcześniej dostały ?v= przez pomyłkę.
  content = content.replace(/(\baccept=["'][^"']*?)\?v=[a-zA-Z0-9T:-]+/g, '$1');

  // 2. Dodawanie wersji tam, gdzie jej nie ma
  // Wzorce: ="path.ext", ='path.ext', : "path.ext", url("path.ext"), from "path.ext", import("path.ext")
  // oraz import "path.ext" (import samych efektów ubocznych, bez nazw) — bez
  // tego import contact-modal.js na stronach zostawał bez ?v=, przeglądarka
  // trzymała jego starą wersję, a ta ładowała translation.js/pl.js ze STARYM
  // ?v= (drugi egzemplarz modułu tłumaczeń). Jego handler "pageshow" nakładał
  // na całą stronę stary słownik — po zmianie nazwy strony „Moje gry” na
  // /games widać było klucze tłumaczeń zamiast tekstów.
  const noVersionRegex = new RegExp(`((?:(?<!\\baccept)=|: |from |import\\s*\\(|import\\s+|url\\s*\\()\\s*['"])([^'"]+\\.(?:${ASSET_EXT}))(?=['"]|\\s*\\))`, 'g');
  
  content = content.replace(noVersionRegex, (match, prefix, assetPath) => {
    // Jeśli ścieżka już ma wersję (co nie powinno się stać po kroku 1, ale na wszelki wypadek)
    if (assetPath.includes('?v=')) return match;
    // Nie wersjonuj linków zewnętrznych (http/https)
    if (assetPath.startsWith('http') || assetPath.startsWith('//')) return match;
    return `${prefix}${assetPath}?v=${version}`;
  });

  // 3. Specjalna obsługa dla HTML (meta version i Cache-Control)
  if (ext === '.html') {
    content = content.replace(/<meta name="app-version" content="[^"]*"/g, `<meta name="app-version" content="${version}"`);
    if (!content.includes('http-equiv="Cache-Control"')) {
      content = content.replace(/<head>/i, `<head>\n  <meta http-equiv="Cache-Control" content="no-store, no-cache, must-revalidate">`);
    }
  }

  if (content !== originalContent) {
    fs.writeFileSync(filePath, content, 'utf8');
    updatedCount++;
  }
});

// ─── Update version.txt ───────────────────────────────────────────────────
fs.writeFileSync(path.join(ROOT, 'version.txt'), version, 'utf8');

// ─── Update sw.js ────────────────────────────────────────────────────────
const swPath = path.join(ROOT, 'sw.js');
if (fs.existsSync(swPath)) {
  let swContent = fs.readFileSync(swPath, 'utf8');
  swContent = swContent.replace(/^\/\/ Version: .*$/gm, '').trim();
  swContent = `// Version: ${version}\n${swContent}`;
  fs.writeFileSync(swPath, swContent, 'utf8');
  console.log(`[Versioner] Updated sw.js`);
}

console.log(`[Versioner] Finished. Processed ${filesToProcess.length} files, updated ${updatedCount} files.`);
