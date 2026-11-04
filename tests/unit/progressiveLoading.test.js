import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (file) => fs.readFileSync(path.join(here, '../../web', file), 'utf8');

test('guard poprzedza auth i odsłonięcie topbara', () => {
  const all = read('shared/js/core/page-init.js');
  const source = all.slice(all.indexOf('export async function initPage('));
  assert.ok(source.indexOf('await guard.ready') < source.indexOf('d.requireAuth(loginUrl()'));
  assert.ok(source.indexOf('await guard.ready') < source.indexOf('document.querySelector(".topbar")?.classList.add("topbar-ready")'));
});

test('strony bez initPage używają wspólnego guarda orientacji', () => {
  const home = read('home/js/index.js');
  const login = read('login/js/login.js');
  const pollQr = read('polls/vote/qr/js/poll-qr.js');
  const overlay = read('shared/js/core/page-overlay.js');
  const deviceGuard = read('shared/js/core/device-guard.js');
  assert.match(login, /from .*device-guard\.js/);
  assert.match(login, /guardViewportWidth\(\{ minWidth: 0 \}\)/);
  // Strony wejścia: wariant „bare” initEntryPage — guard z PAGES przed odsłonięciem.
  const pageInit = read('shared/js/core/page-init.js');
  const entry = pageInit.slice(pageInit.indexOf('export async function initEntryPage('), pageInit.indexOf('export async function initPage('));
  assert.ok(entry.indexOf('guardViewportWidth(') >= 0 && entry.indexOf('guardViewportWidth(') < entry.indexOf('topbar-ready'));
  assert.match(home, /initEntryPage\("home"/);
  assert.match(pollQr, /guardViewportWidth\(\{ minWidth: 980, minHeight: MIN_WORK_HEIGHT, minScreenShortSide: 800/);
  assert.match(deviceGuard, /profile\.formFactor === "phone" && profile\.orientation === "landscape"/);
  assert.match(deviceGuard, /if \(state !== "ok"\)[\s\S]*?hidePageGuard\(\)/);
  assert.match(deviceGuard, /visualViewport\?\.addEventListener\("resize", refresh/);
  // Obrót i nieobsługiwany TV nie dostają „Wróć” — rozwiązaniem nie jest wyjście ze strony.
  assert.match(deviceGuard, /backHref:\s*state\s*===\s*"rotate"\s*\|\|\s*tvUnsupported\s*\?\s*null\s*:\s*backHref/);
  // Blokada urządzenia chowa stronę atrybutem na <html> (base.css: html[data-page-guard] body).
  assert.match(overlay, /setAttribute\("data-page-guard"/);
  assert.match(read('shared/style/base.css'), /html\[data-page-guard\] body/);
});

test('logowanie pokazuje pierwszy etap po inicjalizacji języka i ukrywa go do tego momentu', () => {
  const html = read('login/index.html');
  const css = read('shared/style/base.css');
  const js = read('login/js/login.js');
  assert.match(html, /class="auth-shell" data-skel-step/);
  assert.match(css, /\[data-skel-step\] \{[\s\S]*?visibility:\s*hidden/);
  assert.ok(js.indexOf('setStatus(t("index.statusChecking"))') < js.indexOf('body > [data-skel-step]') );
});

test('ukryte etapy ładowania nie przyjmują fokusu ani kliknięć', () => {
  const css = read('shared/style/base.css');
  const hidden = css.match(/\[data-skel-step\]\s*\{([^}]+)\}/)?.[1] || '';
  const ready = css.match(/\[data-skel-step\]\.skel-step-ready\s*\{([^}]+)\}/)?.[1] || '';
  assert.match(hidden, /visibility:\s*hidden/);
  assert.match(hidden, /pointer-events:\s*none/);
  assert.match(ready, /visibility:\s*visible/);
  assert.match(ready, /pointer-events:\s*auto/);
});

test('każda strona aplikacji ma jawny etap odsłonięcia treści', () => {
  const root = path.join(here, '../../web');
  const pages = [];
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name === 'tools') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile() && (entry.name === 'index.html' || entry.name === '404.html')) pages.push(full);
    }
  };
  visit(root);
  assert.ok(pages.length >= 30, `zebrano tylko ${pages.length} stron`);
  for (const file of pages) {
    const html = fs.readFileSync(file, 'utf8');
    assert.match(html, /data-skel-step/, `${path.relative(root, file)} nie ma etapu treści`);
  }
});

test('galeria czeka na gotowe widoczne etapy, a widoczny device guard jest końcowym stanem', () => {
  const source = fs.readFileSync(path.join(here, '../e2e/e20-gallery.spec.js'), 'utf8');
  assert.match(source, /visibleSteps\.every\(\(step\) => step\.classList\.contains\("skel-step-ready"\)\)/);
  assert.match(source, /overlay\?\.style\.display === "flex" && Boolean\(overlay\.dataset\.state\)/);
  assert.match(source, /getElementById\("resourceLockGuard"\)/);
  assert.match(source, /step\.classList\.contains\("skel-step-ready"\) \|\| step\.getClientRects\(\)\.length > 0/);
  // Od bb11511 (2026-10-16) galeria nie podmienia już osobno HTML logowania;
  // helper serveBranchLoginHtml zostaje dla innych speców.
  const branchCode = fs.readFileSync(path.join(here, '../e2e/helpers/branch-code.js'), 'utf8');
  assert.match(branchCode, /loginPage !== "login" && pages\.includes\(loginPage\)/);
  assert.match(branchCode, /async function serveBranchLoginHtml/);
  assert.match(branchCode, /path\.join\(REPO_ROOT, "login", "index\.html"\)/);
});

test('kontakty i zadania odsłaniają listę po renderze, nie przed nim', () => {
  const contacts = read('shared/js/core/contacts-page.js');
  const tasks = read('tasks/js/tasks.js');
  assert.ok(contacts.indexOf('render();', contacts.indexOf('async function refresh')) < contacts.indexOf('contactsLoaded = true'));
  assert.ok(tasks.indexOf('render();', tasks.indexOf('async function refresh')) < tasks.indexOf('tasksLoaded = true'));
});

test('konto odsłania formularze po danych i po podpięciu akcji', () => {
  const source = read('account/js/account.js');
  assert.ok(source.indexOf('await loadProfile(await userP)') < source.indexOf('saveUsername?.addEventListener("click", handleUsernameSave)'));
  assert.ok(source.indexOf('saveUsername?.addEventListener("click", handleUsernameSave)')
    < source.lastIndexOf("document.querySelectorAll('[data-skel-step]')"));
});

test('ankiety mają osobny etap bazowy i wyników', () => {
  const html = read('polls/index.html');
  const js = read('polls/js/polls.js');
  assert.match(html, /id="pollBar"[^>]*data-skel-step/);
  assert.match(html, /id="cardMain"[^>]*data-skel-step/);
  assert.match(html, /id="resultsList" data-skel-step/);
  assert.match(js, /pollBar\?\.classList\.add\("skel-step-ready"\)/);
  assert.match(js, /resultsList\?\.classList\.add\("skel-step-ready"\)/);
});

test('Connect ma pełnowysokościową kartę główną z dwiema kartami etapowymi', () => {
  const html = read('connect/index.html');
  const js = read('connect/js/connect-device.js');
  assert.match(html, /class="games-shell" data-skel-step/);
  assert.match(html, /class="card games-card tasks-card connect-device-main-card"/);
  assert.match(html, /id="enterCodeCard"/);
  assert.match(html, /id="sharedDevicesCard" hidden/);
  assert.match(js, /sharedDevicesCard\.hidden = false/);
  assert.match(js, /games-shell\[data-skel-step\].*skel-step-ready/);
});

test('Eksplorator i strony urządzeń odsłaniają treść po stanie pierwszego wejścia', () => {
  const explorerHtml = read('bases/explorer/index.html');
  const explorerJs = read('bases/explorer/js/page.js');
  assert.match(explorerHtml, /id="toolbar"[^>]*data-skel-step/);
  assert.match(explorerJs, /wireKeyboard\(state\);[\s\S]{0,180}skeletonReady\(\);/);
  assert.match(explorerJs, /function skeletonReady\(\) \{[\s\S]{0,200}skel-step-ready/);
  for (const [htmlPath, jsPath] of [
    ['control/host/index.html', 'control/host/js/main.js'],
    ['control/buzzer/index.html', 'control/buzzer/js/main.js'],
    ['connect/tv/index.html', 'connect/tv/js/tv.js'],
  ]) {
    assert.match(read(htmlPath), /data-skel-step/);
    assert.match(read(jsPath), /skel-step-ready/);
  }
});

test('Buzzer ma etapy gotowości dla widoku wyłączonego i błędu początkowego', () => {
  const html = read('control/buzzer/index.html');
  const js = read('control/buzzer/js/main.js');
  assert.match(html, /id="offScreen" data-skel-step hidden/);
  assert.match(html, /id="deviceLoadError"[^>]*data-skel-step hidden/);
  assert.match(js, /offScreen\?\.classList\.add\("skel-step-ready"\)/);
  assert.match(js, /if \(!initialStateReady\) revealStep\(loadError\)/);
});

test('Gry społeczności nie zawierają etykiet Szukaj gier i Sortowanie', () => {
  const html = read('marketplace/index.html');
  assert.doesNotMatch(html, /<label[^>]*(?:searchInput|sortSelectLabel)/);
  assert.match(html, /id="searchInput"[^>]*data-i18n-aria-label="marketplace\.searchLabel"/);
  assert.match(html, /id="sortSelect"[\s\S]*?data-i18n-aria-label="marketplace\.sortLabel"/);
});

test('rotację sugeruje tylko Buzzer; podgląd testowy Control pomija guard dotyku', () => {
  const testMode = read('control/js/testMode.js');
  const host = read('control/host/js/main.js');
  const buzzer = read('control/buzzer/js/main.js');
  const deviceGuard = read('shared/js/core/device-guard.js');
  assert.match(host, /allowPhoneLandscape:\s*true/);
  assert.match(buzzer, /allowPhoneLandscape:\s*true/);
  assert.match(buzzer, /requirePhoneLandscape:\s*!controlTestFrame/);
  assert.match(buzzer, /rotateMessageKey:\s*"buzzer\.rotateMessage"/);
  assert.doesNotMatch(host, /requirePhoneLandscape|rotateMessageKey/);
  assert.match(deviceGuard, /requirePhoneLandscape && profile\.formFactor === "phone" && profile\.orientation === "portrait"/);
  assert.match(testMode, /frame\.dataset\.controlTestMode\s*=\s*'true'/);
  for (const source of [host, buzzer]) {
    assert.match(source, /controlTestFrame/);
    assert.match(source, /requiresTouch:\s*!controlTestFrame/);
  }
});
