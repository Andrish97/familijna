#!/usr/bin/env node
// Podręcznik (E13): buduje treść strony /manual/ z roboczych plików Markdown.
//   docs/podrecznik/*.md        → web/manual/content/pl.js
//   docs/podrecznik/en/*.md     → web/manual/content/en.js
//   docs/podrecznik/uk/*.md     → web/manual/content/uk.js
// Użycie: node scripts/manual/build-content.mjs [--check]
//   --check — nic nie zapisuje; kod wyjścia 1, gdy pliki strony są nieaktualne.
//
// Obsługiwany zapis (podzbiór Markdown, opis: docs/podrecznik/README.md):
//   # Część I — …        część podręcznika (opcjonalnie; inaczej z PARTS)
//   # 7. Tytuł           rozdział;  ## 7.3 Tytuł  podrozdział;  ### 16.5.1 Tytuł
//   [Przycisk]  *Strona*  **pogrubienie**  `kod`  [tekst](https://…)  (→ 7.3, 8)
//   akapity, listy (- / 1.), tabele |…|, ``` bloki, > Uwaga: …  (ramka)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadDicts } from "../i18n-parts.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC = path.join(ROOT, "docs", "podrecznik");
const OUT = path.join(ROOT, "web", "manual", "content");
const LANGS = { pl: SRC, en: path.join(SRC, "en"), uk: path.join(SRC, "uk") };

// Części podręcznika: rozdziały 1–4, 5–17, 18–20 (tytuły z nagłówków „# Część …”).
const PART_OF = (n) => (n <= 4 ? 0 : n <= 17 ? 1 : 2);

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
export const sectionAnchor = (num) => `s-${String(num).replace(/\./g, "-")}`;
const chapterOf = (num) => String(num).split(".")[0];
// Nazwy stron w treści (*Moje gry*), które stają się odnośnikami do serwisu: nazwa → id strony
// w nav-map (PAGES). Tylko strony bez wymaganego id zasobu; „←” na stronie docelowej wraca
// do miejsca w podręczniku (manual w from celu — pilnuje test).
export const PAGE_LINKS = {
  games: { path: "/games/", names: ["Moje gry", "Moich grach", "Moich gier", "My games", "Мої ігри", "Моїх іграх", "Моїх ігор"] },
  bases: { path: "/bases/", names: ["Bazy pytań", "Question bases", "Бази питань"] },
  logoEditor: { path: "/logos/", names: ["Moje loga", "Moich log", "My logos", "Мої логотипи", "Моїх логотипів"] },
  friends: { path: "/friends/", names: ["Znajomi", "Friends", "Друзі"] },
  subscribers: { path: "/subscribers/", names: ["Subskrybenci", "Subscribers", "Підписники"] },
  tasks: { path: "/tasks/", names: ["Zadania", "Zadaniach", "Tasks", "Завдання", "Завданнях"] },
  marketplace: { path: "/marketplace/", names: ["Gry Społeczności", "Community Games", "Ігри Спільноти"] },
  connectDevice: { path: "/connect/", names: ["Podłącz urządzenie", "Connect a device", "Підключити пристрій"] },
  account: { path: "/account/", names: ["Ustawienia konta", "Ustawieniach konta", "Account settings", "Налаштування акаунта", "Налаштуваннях акаунта"] },
};
const PAGE_BY_NAME = new Map(Object.entries(PAGE_LINKS).flatMap(([id, p]) => p.names.map((n) => [n, id])));
const pageName = (name) => {
  const id = PAGE_BY_NAME.get(name);
  return id
    ? `<a class="m-page m-go" href="${PAGE_LINKS[id].path}" data-page="${id}">${name}</a>`
    : `<span class="m-page">${name}</span>`;
};

// Zrzut ekranu w treści: „![Podpis](zrzut:scena)” albo „…(zrzut:scena@phone)” (phone, tablet,
// phone-landscape, tablet-landscape — w ramce urządzenia, ten sam rozmiar co desktop) — scena z
// scripts/screens/scenes.cjs, plik publikuje scripts/screens/publish-manual.cjs. Kilka takich linii
// pod rząd to karuzela (np. widoki urządzeń przy prowadzeniu rozgrywki).
export const SHOT_RE = /^!\[([^\]]*)\]\(zrzut:([a-z0-9-]+)(?:@(desktop|phone-landscape|tablet-landscape|phone|tablet))?\)\s*$/;
export const shotPath = (lang, scene, device = "desktop") => `img/${lang}/${scene}-${device}.webp`;
// Jasny motyw (decyzja 2026-11-03): drugi komplet zrzutów w img/<język>/light/.
export const lightShotPath = (lang, scene, device = "desktop") => `img/${lang}/light/${scene}-${device}.webp`;
let LANG = "pl";
// Wymiary opublikowanego webp (nagłówek VP8 / VP8L / VP8X) — width/height w <img>, żeby
// wczytywane później zrzuty nie przesuwały treści (np. po przewinięciu do trafienia wyszukiwania).
function webpSize(file) {
  if (!fs.existsSync(file)) return null;
  const b = fs.readFileSync(file);
  const kind = b.toString("ascii", 12, 16);
  if (kind === "VP8 ") return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
  if (kind === "VP8L") { const v = b.readUInt32LE(21); return { w: (v & 0x3fff) + 1, h: ((v >> 14) & 0x3fff) + 1 }; }
  if (kind === "VP8X") return { w: b.readUIntLE(24, 3) + 1, h: b.readUIntLE(27, 3) + 1 };
  return null;
}
const shotFigure = (line) => {
  const [, caption, scene, device = "desktop"] = line.match(SHOT_RE);
  const alt = esc(caption.replace(/[*`]/g, ""));
  const size = webpSize(path.join(ROOT, "web/manual", shotPath(LANG, scene, device)));
  const dims = size ? ` width="${size.w}" height="${size.h}"` : "";
  // Zrzut w motywie czytelnika: oba obrazy, CSS pokazuje jeden (ukryty z loading="lazy" się nie pobiera).
  // Bez jasnego pliku — jeden obraz dla obu motywów.
  const lightSize = webpSize(path.join(ROOT, "web/manual", lightShotPath(LANG, scene, device)));
  const img = (src, cls, sz) => `<img${cls ? ` class="${cls}"` : ""} src="/manual/${src}" alt="${alt}"${sz ? ` width="${sz.w}" height="${sz.h}"` : ""} loading="lazy" decoding="async">`;
  const imgs = lightSize
    ? img(shotPath(LANG, scene, device), "m-shot-dark", size) + img(lightShotPath(LANG, scene, device), "m-shot-light", lightSize)
    : img(shotPath(LANG, scene, device), "", size);
  return `<figure class="m-shot m-shot-${device}"><button class="m-shot-zoom" type="button" data-zoom="1">${imgs}</button>${caption ? `<figcaption>${inline(caption, new Map(), TITLES)}</figcaption>` : ""}</figure>`;
};

export const refHref = (num) => (String(num).includes(".") ? `?ch=${chapterOf(num)}#${sectionAnchor(num)}` : `?ch=${num}`);

/* ---------- ikony przycisków z prawdziwych stron serwisu ---------- */

async function loadTranslation(lang) {
  return (await loadDicts())[lang];
}

function lookup(obj, key) {
  return key.split(".").reduce((o, k) => (o && typeof o === "object" ? o[k] : undefined), obj);
}

function walk(dir, exts, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) { if (ent.name !== "node_modules" && ent.name !== "content") walk(p, exts, out); }
    else if (exts.some((e) => ent.name.endsWith(e))) out.push(p);
  }
  return out;
}

// Etykieta przycisku → ikona, zebrane z data-i18n + data-i18n-icon w HTML
// i z iconText("ikona", t("klucz")) w JS. Przy kilku ikonach — najczęstsza.
function buildIconMap(tr) {
  const votes = new Map();
  const vote = (key, iconName) => {
    const label = lookup(tr, key);
    if (typeof label !== "string" || !iconName) return;
    const k = label.replace(/\s+/g, " ").trim();
    const m = votes.get(k) || new Map();
    m.set(iconName, (m.get(iconName) || 0) + 1);
    votes.set(k, m);
  };
  for (const file of walk(path.join(ROOT, "web"), [".html", ".js"])) {
    if (file.includes(`${path.sep}translation${path.sep}`)) continue;
    const src = fs.readFileSync(file, "utf8");
    for (const btn of src.matchAll(/<(button|a)\b[^>]*>[\s\S]*?<\/\1>/gi)) {
      const key = btn[0].match(/data-i18n="([^"]+)"/)?.[1];
      const ic = btn[0].match(/data-i18n-icon(?:-after)?="([^"]+)"/)?.[1] || btn[0].match(/data-icon="([^"]+)"/)?.[1];
      if (key && ic) vote(key, ic);
    }
    for (const tag of src.matchAll(/<[a-z][^>]*>/gi)) {
      const t = tag[0];
      const key = t.match(/data-i18n="([^"]+)"/)?.[1];
      const ic = t.match(/data-i18n-icon(?:-after)?="([^"]+)"/)?.[1];
      if (key && ic) vote(key, ic);
    }
    // Przyciski opisane w JS: { i18n: "klucz", iconName: "ikona" } (np. core/blocking-screen.js).
    for (const m of src.matchAll(/i18n:\s*"([^"]+)",\s*iconName:\s*"([^"]+)"/g)) vote(m[1], m[2]);
    for (const m of src.matchAll(/iconText\(\s*["']([\w-]+)["']\s*,\s*t\(\s*["']([\w.]+)["']/g)) vote(m[2], m[1]);
  }
  const map = new Map();
  for (const [label, m] of votes) map.set(label, [...m].sort((a, b) => b[1] - a[1])[0][0]);
  return map;
}

/* ---------- inline ---------- */

function inline(text, icons, titles = new Map()) {
  const slots = [];
  const keep = (html) => `\u0000${slots.push(html) - 1}\u0000`;
  let s = text;
  s = s.replace(/`([^`]+)`/g, (_, c) => keep(`<code class="m-code">${esc(c)}</code>`));
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_, t, u) => keep(`<a href="${esc(u)}" target="_blank" rel="noopener">${esc(t)}</a>`));
  // [Etykieta] — przycisk; [Etykieta|ikona] — z jawnie wskazaną ikoną (gdy etykieta jest niejednoznaczna)
  s = s.replace(/\[([^\]\n|]+)(?:\|([\w-]+))?\]/g, (_, label, forced) => {
    // „[ i ]” to klawisze [ i ], nie przycisk „i” — klawisze zapisuj jako `[` i `]`.
    if (/^\s|\s$/.test(label)) throw new Error(`Wskazówki: „[${label}]” wygląda na klawisze, nie przycisk — użyj \`[\` / \`]\``);
    const ic = forced || icons.get(label.replace(/\s+/g, " ").trim());
    const iconHtml = ic ? `<i data-icon="${esc(ic)}"></i>` : "";
    return keep(`<span class="m-control">${iconHtml}${esc(label)}</span>`);
  });
  // odnośniki: „→ 7.3”, „→ 10, 14, 15.4”, „→ 3 i 4”, „zob. 19.5”
  // „(→ 7.3)” → sam odnośnik-chip (bez nawiasu i strzałki); „zob. 19.5” → „zob.” + chip.
  // Numer jest tylko adresem — czytelnik widzi tytuł rozdziału/podrozdziału.
  // Strzałka sklejona z pierwszym słowem tytułu: wiersz nie łamie się między
  // nimi (zgłoszenie 2026-11-08: „→” zostawała sama na końcu linii).
  const refLabel = (title) => {
    const [, first, rest] = String(title).match(/^(\S+)([\s\S]*)$/) || [, String(title), ""];
    return `<span class="m-nobr"><i data-icon="arrow-right"></i>${esc(first)}</span>${esc(rest)}`;
  };
  const REF_LIST = "(\\d+(?:\\.\\d+)*(?:(?:,\\s*|\\s+(?:i|and|і|та)\\s+)\\d+(?:\\.\\d+)*)*)";
  const refs = (list) => list.split(/(,\s*|\s+(?:i|and|і|та)\s+)/)
    .map((p) => (/^\d/.test(p) ? `<a class="m-ref" href="${refHref(p)}">${refLabel(titles.get(p) || p)}</a>` : esc(p))).join("");
  s = s.replace(new RegExp(`\\(\\s*→\\s+${REF_LIST}\\s*\\)`, "g"), (_, list) => keep(refs(list)));
  s = s.replace(new RegExp(`(→|zob\\.|see|див\\.)\\s+${REF_LIST}`, "g"), (_, lead, list) => keep(lead === "→" ? refs(list) : `${esc(lead)} ${refs(list)}`));
  s = esc(s);
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|[\s(„"])\*([^*\s][^*]*?)\*(?=[\s).,:;!?”"]|$)/g, (_, lead, name) => `${lead}${pageName(name)}`);
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => slots[Number(i)]);
}

/* ---------- bloki ---------- */

let TITLES = new Map();

function renderBlocks(lines, icons) {
  const out = [];
  let i = 0;
  const isTable = (l) => /^\s*\|.*\|\s*$/.test(l);
  const isList = (l) => /^(\s*)([-*]|\d+\.)\s+/.test(l);
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    if (/^```/.test(line)) {
      const body = [];
      for (i++; i < lines.length && !/^```/.test(lines[i]); i++) body.push(lines[i]);
      i++;
      out.push(`<pre class="m-pre">${esc(body.join("\n"))}</pre>`);
      continue;
    }
    if (/^>\s?/.test(line)) {
      const body = [];
      for (; i < lines.length && /^>\s?/.test(lines[i]); i++) body.push(lines[i].replace(/^>\s?/, ""));
      // Ramki: „Uwaga:” (ostrzeżenie) albo „Wskazówka:” (podpowiedź); etykieta staje się nagłówkiem ramki.
      const head = body[0] || "";
      const warn = head.match(/^(Uwaga|Note|Увага):\s*/);
      const tip = head.match(/^(Wskazówka|Tip|Порада):\s*/);
      const kind = warn ? "warn" : tip ? "tip" : "note";
      const label = (warn || tip)?.[1];
      if (label) { const rest = head.slice((warn || tip)[0].length); body[0] = rest.charAt(0).toLocaleUpperCase() + rest.slice(1); }
      const icon = kind === "warn" ? "warning" : kind === "tip" ? "info" : "";
      const title = label ? `<div class="m-box-title">${icon ? `<i data-icon="${icon}"></i>` : ""}${esc(label)}</div>` : "";
      out.push(`<div class="m-note m-${kind}">${title}${renderBlocks(body, icons)}</div>`);
      continue;
    }
    if (SHOT_RE.test(line)) {
      const shots = [];
      for (; i < lines.length && SHOT_RE.test(lines[i]); i++) shots.push(shotFigure(lines[i]));
      out.push(shots.length === 1 ? shots[0] : `<div class="m-carousel" tabindex="0"><div class="m-carousel-track">${shots.join("")}</div></div>`);
      continue;
    }
    if (isTable(line)) {
      const rows = [];
      for (; i < lines.length && isTable(lines[i]); i++) rows.push(lines[i]);
      const cells = (r) => r.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      const head = cells(rows[0]);
      const body = rows.slice(2).map(cells);
      // data-label: nagłówek kolumny przy komórce — na telefonie wiersz tabeli
      // staje się kartą z etykietami (wąskie kolumny łamały tekst co 2–3 słowa).
      const label = (h) => esc(inline(h, icons, TITLES).replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").trim());
      out.push(`<div class="m-table-wrap"><table class="m-table"><thead><tr>${head.map((h) => `<th>${inline(h, icons, TITLES)}</th>`).join("")}</tr></thead><tbody>${body.map((r) => `<tr>${r.map((c, ci) => `<td data-label="${label(head[ci] ?? "")}">${inline(c, icons, TITLES)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`);
      continue;
    }
    if (isList(line)) {
      const block = [];
      for (; i < lines.length && (isList(lines[i]) || (/^\s{2,}\S/.test(lines[i]) && block.length)); i++) block.push(lines[i]);
      out.push(renderList(block, icons));
      continue;
    }
    const para = [];
    for (; i < lines.length && lines[i].trim() && !isTable(lines[i]) && !isList(lines[i]) && !SHOT_RE.test(lines[i]) && !/^(```|>|#)/.test(lines[i]); i++) para.push(lines[i].trim());
    out.push(`<p class="m-p">${inline(para.join(" "), icons, TITLES)}</p>`);
  }
  return out.join("\n");
}

function renderList(block, icons) {
  const indentOf = (l) => l.match(/^(\s*)/)[1].length;
  const base = indentOf(block[0]);
  const ordered = /^\s*\d+\./.test(block[0]);
  const items = [];
  for (const l of block) {
    if (indentOf(l) === base && /^(\s*)([-*]|\d+\.)\s+/.test(l)) items.push([l.replace(/^(\s*)([-*]|\d+\.)\s+/, "")]);
    else items[items.length - 1].push(l);
  }
  const li = items.map(([first, ...rest]) => {
    const nestedStart = rest.findIndex((l) => /^(\s*)([-*]|\d+\.)\s+/.test(l));
    const cont = (nestedStart === -1 ? rest : rest.slice(0, nestedStart)).map((l) => l.trim());
    const nested = nestedStart === -1 ? "" : renderList(rest.slice(nestedStart), icons);
    return `<li>${inline([first, ...cont].join(" "), icons, TITLES)}${nested}</li>`;
  });
  return ordered ? `<ol class="m-ol">${li.join("")}</ol>` : `<ul class="m-ul">${li.join("")}</ul>`;
}

/* ---------- rozdziały ---------- */

function collectTitles(markdownFiles) {
  const titles = new Map();
  for (const md of markdownFiles) {
    let fenced = false;
    for (const raw of md.split(/\r?\n/)) {
      if (/^```/.test(raw)) { fenced = !fenced; continue; }
      if (fenced) continue;
      const m = raw.match(/^#\s+(\d+)\.\s+(.+)$/) || raw.match(/^#{2,3}\s+(\d+(?:\.\d+)+)\s+(.+)$/);
      if (m) titles.set(m[1], m[2].trim().replace(/[*`]/g, ""));
    }
  }
  return titles;
}

// Przycisk (.m-control) to inline-flex: przeglądarka może złamać wiersz tuż za
// nim i kropka/przecinek spadał sam do nowej linii. Przycisk z następującą
// interpunkcją idzie do nierozdzielnego .m-nobr. Odnośnik (.m-ref) jest zwykłym
// tekstem (inline) — łamie się jak tekst i kropka zostaje przy nim sama.
export function glueTrailingPunctuation(html) {
  return html.replace(/(<span class="m-control">(?:(?!<\/span>)[\s\S])*<\/span>)([.,;:!?…)\]»”]+)/g,
    '<span class="m-nobr">$1$2</span>');
}

export function parseManual(markdownFiles, icons) {
  TITLES = collectTitles(markdownFiles);
  const parts = [{ title: "", chapters: [] }, { title: "", chapters: [] }, { title: "", chapters: [] }];
  const chapters = [];
  let ch = null;
  let buf = [];
  let partTitle = null;
  let partIntro = [];
  const flush = () => {
    if (ch) ch.bodyLines.push(...buf);
    else if (partTitle) partIntro.push(...buf);
    buf = [];
  };
  for (const md of markdownFiles) {
    let fenced = false;
    for (const raw of md.split(/\r?\n/)) {
      if (/^```/.test(raw)) fenced = !fenced;
      const h1 = fenced || /^```/.test(raw) ? null : raw.match(/^#\s+(.+)$/);
      if (h1) {
        flush();
        const num = h1[1].match(/^(\d+)\.\s+(.+)$/);
        if (num) {
          ch = { id: num[1], title: num[2].trim(), bodyLines: [] };
          chapters.push(ch);
          const p = parts[PART_OF(Number(num[1]))];
          if (partTitle && !p.title) {
            p.title = partTitle;
            p.intro = partIntro.some((l) => l.trim()) ? renderBlocks(partIntro, icons) : "";
          }
          p.chapters.push(num[1]);
          partTitle = null;
          partIntro = [];
        } else {
          partTitle = h1[1].trim();
          partIntro = [];
          ch = null;
        }
        continue;
      }
      buf.push(raw);
    }
    flush();
  }
  for (const c of chapters) {
    const sections = [];
    const html = [];
    let lines = [];
    const emit = () => { if (lines.length) html.push(renderBlocks(lines, icons)); lines = []; };
    let fenced = false;
    for (const l of c.bodyLines) {
      if (/^```/.test(l)) fenced = !fenced;
      const h = fenced ? null : l.match(/^(#{2,3})\s+(\d+(?:\.\d+)+)\s+(.+)$/);
      if (h) {
        emit();
        const level = h[1].length;
        sections.push({ id: h[2], title: h[3].trim(), level });
        const tag = level === 2 ? "h2" : "h3";
        html.push(`<${tag} class="m-h${level}" id="${sectionAnchor(h[2])}">${inline(h[3].trim(), icons, TITLES)}</${tag}>`);
        continue;
      }
      lines.push(l);
    }
    emit();
    c.sections = sections;
    c.html = glueTrailingPunctuation(html.join("\n"));
    // Opis rozdziału pochodzi z tej samej treści co dokument, nie z osobnej kopii SEO.
    const summary = c.html.match(/<p class="m-p">([\s\S]*?)<\/p>/)?.[1] || c.sections.map((s) => s.title).join(". ");
    c.description = summary.replace(/<[^>]+>/g, " ")
      .replace(/&(amp|lt|gt|quot|nbsp);/g, (_, e) => ({ amp: "&", lt: "<", gt: ">", quot: '"', nbsp: " " }[e]))
      .replace(/\s+/g, " ").trim().slice(0, 180);
    delete c.bodyLines;
  }
  return { parts: parts.filter((p) => p.chapters.length), chapters };
}

function readSources(dir) {
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir).filter((f) => /^\d{2}.*\.md$/.test(f)).sort();
  if (!files.length) return null;
  return files.map((f) => fs.readFileSync(path.join(dir, f), "utf8"));
}

export async function buildAll({ chunks = false } = {}) {
  const results = {};
  const chapterLoaders = {};
  for (const [lang, dir] of Object.entries(LANGS)) {
    const sources = readSources(dir);
    if (!sources) continue;
    const icons = buildIconMap(await loadTranslation(lang));
    LANG = lang;
    const data = parseManual(sources, icons);
    results[lang] = "// Wygenerowane przez scripts/manual/build-content.mjs z docs/podrecznik — nie edytować ręcznie.\n"
      + `const manual = ${JSON.stringify(data, null, 1)};\n\nexport default manual;\n`;
    if (chunks) {
      const metadata = { parts: data.parts, chapters: data.chapters.map(({ html, ...chapter }) => chapter) };
      results[`meta/${lang}.js`] = `// Wygenerowane przez scripts/manual/build-content.mjs — nie edytować.\nexport default ${JSON.stringify(metadata)};\n`;
      chapterLoaders[lang] = {};
      for (const chapter of data.chapters) {
        results[`chapters/${lang}/${chapter.id}.js`] = `// Wygenerowane przez scripts/manual/build-content.mjs — nie edytować.\nexport default ${JSON.stringify(chapter.html)};\n`;
        chapterLoaders[lang][chapter.id] = `() => import("./chapters/${lang}/${chapter.id}.js")`;
      }
    }
  }
  if (chunks) {
    const entries = Object.entries(chapterLoaders).map(([lang, chapters]) =>
      `  ${lang}: { ${Object.entries(chapters).map(([id, load]) => `${JSON.stringify(id)}: ${load}`).join(", ")} }`
    ).join(",\n");
    results["chapter-loaders.js"] = `// Wygenerowane przez scripts/manual/build-content.mjs — nie edytować.\nexport default {\n${entries}\n};\n`;
  }
  return results;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const check = process.argv.includes("--check");
  const results = await buildAll({ chunks: true });
  let stale = false;
  fs.mkdirSync(OUT, { recursive: true });
  for (const [lang, content] of Object.entries(results)) {
    const relative = lang.endsWith(".js") ? lang : `${lang}.js`;
    const file = path.join(OUT, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const cur = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
    // Deploymentowy wersjoner dopisuje ?v= do dynamicznych importów mapy.
    const compare = check && relative === "chapter-loaders.js" ? cur.replace(/\?v=[a-zA-Z0-9T:-]+/g, "") : cur;
    if (compare === content) continue;
    stale = true;
    if (check) console.error(`nieaktualne: web/manual/content/${relative}`);
    else { fs.writeFileSync(file, content); console.log(`zapisano: web/manual/content/${relative}`); }
  }
  if (check && stale) process.exit(1);
}
