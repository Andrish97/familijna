// Lighthouse dla produkcji (workflow lighthouse.yml): telefon i komputer,
// RUNS przebiegów na adres, mediana wyniku. Adnotacje ::notice z wynikiem,
// LCP/CLS/TBT/FCP/SI i największymi oszczędnościami; raporty JSON w lighthouse/.
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ORIGIN = "https://www.familijna.app";
const paths = (process.env.PATHS || "/").split(/\s+/).filter(Boolean);
const runs = Math.max(1, Math.min(5, Number(process.env.RUNS) || 3));
const outDir = path.join(process.cwd(), "lighthouse");
fs.mkdirSync(outDir, { recursive: true });

const METRICS = {
  "largest-contentful-paint": "LCP",
  "cumulative-layout-shift": "CLS",
  "total-blocking-time": "TBT",
  "first-contentful-paint": "FCP",
  "speed-index": "SI",
};

function runOnce(url, device, i) {
  const file = path.join(outDir, `${device}-${url.replace(/[^a-z0-9]+/gi, "_")}-${i}.json`);
  const args = ["--yes", "lighthouse@12", url, "--only-categories=performance", "--output=json",
    `--output-path=${file}`, "--quiet", "--chrome-flags=--headless=new --no-sandbox"];
  if (device === "desktop") args.push("--preset=desktop");
  execFileSync("npx", args, { stdio: "inherit" });
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

for (const p of paths) {
  const url = new URL(p, ORIGIN).href;
  for (const device of ["mobile", "desktop"]) {
    const reports = [];
    // Pojedynczy błąd Lighthouse (np. NO_FCP) nie przerywa całego pomiaru:
    // jedna powtórka, potem przebieg pominięty (2026-11-04).
    for (let i = 0; i < runs; i++) {
      for (let attempt = 0; attempt < 2; attempt++) {
        try { reports.push(runOnce(url, device, i)); break; }
        catch (error) { console.log(`::warning title=Lighthouse ${device} ${p}::przebieg ${i + 1} próba ${attempt + 1}: ${String(error.message).split("\n")[0]}`); }
      }
    }
    if (!reports.length) { process.exitCode = 1; continue; }
    reports.sort((a, b) => a.categories.performance.score - b.categories.performance.score);
    const lhr = reports[Math.floor(reports.length / 2)];
    const scores = reports.map((r) => Math.round(r.categories.performance.score * 100));
    const metrics = Object.entries(METRICS).map(([id, name]) => `${name} ${lhr.audits[id].displayValue}`).join(", ");
    const savings = Object.values(lhr.audits)
      .filter((a) => a.details?.type === "opportunity" && (a.details.overallSavingsMs || 0) >= 100)
      .sort((a, b) => b.details.overallSavingsMs - a.details.overallSavingsMs)
      .slice(0, 5)
      .map((a) => `${a.id} ~${Math.round(a.details.overallSavingsMs)} ms`);
    const line = `${device} ${p}: wynik ${scores[Math.floor(scores.length / 2)]} (przebiegi ${scores.join("/")}); ${metrics}; oszczędności: ${savings.join(", ") || "brak ≥100 ms"}`;
    console.log(`::notice title=Lighthouse ${device} ${p}::${line}`);
    // Szczegóły do poprawek: element LCP i fazy LCP, pliki blokujące renderowanie.
    const lcpItems = lhr.audits["largest-contentful-paint-element"]?.details?.items || [];
    const node = lcpItems.flatMap((it) => it.items || [it]).find((it) => it.node)?.node;
    const phases = (lcpItems.find((it) => it.items && !it.items[0]?.node)?.items || [])
      .map((ph) => `${ph.phase || ph.label} ${Math.round(ph.timing || 0)} ms`).join(", ");
    const blocking = (lhr.audits["render-blocking-resources"]?.details?.items || [])
      .map((it) => `${it.url.replace(ORIGIN, "")} ${Math.round(it.wastedMs || 0)} ms`).join(", ");
    console.log(`::notice title=Szczegóły ${device} ${p}::LCP: ${node?.selector || "?"} [${(node?.nodeLabel || "").slice(0, 60)}]; fazy: ${phases || "?"}; blokujące: ${blocking || "brak"}`);
  }
}
