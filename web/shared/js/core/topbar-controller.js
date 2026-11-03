import { registerPageLayout } from "./page-layout.js?v=v2026-11-03T22453";
// js/core/topbar-controller.js
// Zarządza całym topbarem:
//  - Desktop: overflow nav ("Więcej") w section-2, dropdown .account-wrap w section-4
//  - Układ telefonu (data-compact: telefon albo okno do 600 px): panel boczny z section-2 i section-4 płasko (bez dropdown, bez overflow)
//
// Eksportuje: setTopbarNavPriority, setTopbarAccount (alias: initTopbarAccountDropdown), autoInitTopbarAuthButton

import { placeDropdown, clearPlacement } from "./popover.js?v=v2026-11-03T22453";
import { isGuestUser } from './guest-mode.js?v=v2026-11-03T22453';
import { t, withLangParam } from '../../translation/translation.js?v=v2026-11-03T22453';
import { icon, iconText } from './icons.js?v=v2026-11-03T22453';
import { isCompactLayout, onDeviceChange } from './device-attrs.js?v=v2026-11-03T22453';


// ── Narzędzie: pozycjonowanie fixed dropdown ──────────────────────────────────
// ── Stan modułu ───────────────────────────────────────────────────────────────
let _overflowState = null; // { expandAll, collapseAll, recalc }
let _accountState = null;  // { expand, collapse }
let _mobileActive = false;
// Strona ustawiła konto sama (initPage: adresy z mapy, opcje strony) —
// automatyczne ustawienie z domyślnymi adresami nie może go nadpisać.
let _accountByPage = false;

// Ten sam stan steruje dostępnością i ruchem strzałki, także przy zamknięciu z zewnątrz.
function bindDisclosureState(trigger, popup, inline = () => false) {
  const sync = () => trigger?.setAttribute('aria-expanded', String(!popup.hidden && !inline()));
  if (popup.id) trigger?.setAttribute('aria-controls', popup.id);
  new MutationObserver(sync).observe(popup, { attributes: true, attributeFilter: ['hidden', 'class'] });
  sync();
  return sync;
}

// ── Liczniki powiadomień (.badge) ─────────────────────────────────────────────
// Wspólny zapis/odczyt licznika .badge: pusty tekst gdy 0 (CSS chowa pusty
// .badge), „99+” powyżej 99. Używane przez „Więcej” i hamburger.
function parseBadgeNumber(raw) {
  const m = String(raw || '').trim().match(/\d+/);
  const n = m ? Number(m[0]) : 0;
  return Number.isFinite(n) ? n : 0;
}

function readBadgeCount(btn) {
  return parseBadgeNumber(btn?.querySelector('.badge')?.textContent);
}

function setBadgeCount(badgeEl, n) {
  if (badgeEl) badgeEl.textContent = n > 99 ? '99+' : (n > 0 ? String(n) : '');
}

// ── Overflow nav (section-2) ──────────────────────────────────────────────────
/**
 * Rejestruje overflow nav dla section-2 (używane tylko na stronie gier).
 * Desktop: ResizeObserver → chowa mniej ważne przyciski do "Więcej ▾".
 * Mobile: kontroler wywołuje expandAll() → wszystkie przyciski widoczne płasko.
 *
 * @param {Function} getButtons  fn() → HTMLElement[] od najważniejszego do najmniej ważnego
 * @param {{ moreEl: HTMLElement, moreDropdownEl: HTMLElement }} config
 * @returns {{ recalc: Function }}
 */
export function setTopbarNavPriority({ moreEl, moreDropdownEl } = {}) {
  if (!moreEl || !moreDropdownEl) return { recalc: () => {} };

  const section2 = document.querySelector('.topbar-section-2');
  if (!section2) return { recalc: () => {} };

  function getButtons() {
    return Array.from(section2.querySelectorAll(':scope > .btn'));
  }

  const moreBadge = moreEl.querySelector('.badge');
  const btnMore = document.getElementById('btnMore') || moreEl.querySelector('button');

  document.body.appendChild(moreDropdownEl);
  moreDropdownEl.className = 'nav-more-dropdown';
  moreDropdownEl.hidden = true;
  bindDisclosureState(btnMore, moreDropdownEl);

  let _hiddenBtns = [];

  function updateMoreBadge(hiddenBtns) {
    const hasActiveHiddenButton = hiddenBtns.some(btn => btn.classList.contains('is-active'));
    btnMore?.classList.toggle('is-active', hasActiveHiddenButton);
    if (!moreBadge) return;
    const sum = hiddenBtns.reduce((acc, btn) => acc + readBadgeCount(btn), 0);
    setBadgeCount(moreBadge, sum);
  }

  // Zmiana licznika na którymś przycisku: odśwież sumę na „Więcej” ORAZ
  // klony w rozwijanym menu (to kopie z chwili recalc(), same się nie
  // aktualizują — bez tego dropdown pokazywał nieaktualne liczby).
  const badgeObserver = new MutationObserver(() => {
    if (_mobileActive) return;
    recalc();
  });
  badgeObserver.observe(section2, {
      subtree: true,
      characterData: true,
      childList: true,
      attributes: true,
      attributeFilter: ['class', 'hidden', 'data-nav-hidden'],
  });

  function getVisibleBtns() {
    return getButtons().filter(btn => {
      if (!btn || btn.dataset.navHidden === 'true') return false;
      const computed = getComputedStyle(btn);
      // Nie licz przycisków wyłączonych przez breakpoint (np. „Gry
      // Producenta”). Nadal uwzględniaj elementy schowane przez poprzedni
      // pomiar overflow (klasa .hidden).
      if (btn.classList.contains('hidden-on-mobile') && computed.display === 'none') return false;
      return computed.display !== 'none' || _hiddenBtns.includes(btn);
    });
  }

  // Pomiar sam przełącza klasę .hidden przycisków — te zmiany nie mogą
  // wracać do obserwatora liczników (pętla bez końca, zawieszona strona).
  function recalc() {
    try { measureOverflow(); updateTopbarHeight(); } finally { badgeObserver.takeRecords(); }
  }

  function measureOverflow() {
    if (_mobileActive) return;

    const section2Width = section2.getBoundingClientRect().width;
    // Topbar Ustawień jest początkowo display:none pod ekranem logowania.
    // Pomiar zerowej szerokości błędnie uruchamiał hamburger i zostawiał go
    // po późniejszym odblokowaniu panelu.
    // Widoczna sekcja może mieć 0 px, gdy konto zajęło całe wolne miejsce.
    // To właśnie wymaga hamburgera; pomijamy wyłącznie brak układu (display:none).
    if (!section2.isConnected || !section2.getClientRects().length) return;

    const btns = getVisibleBtns();
    btns.forEach(btn => btn.classList.remove('hidden'));
    _hiddenBtns = [];
    moreEl.hidden = true;
    moreDropdownEl.innerHTML = '';

    const gap = Number.parseFloat(getComputedStyle(section2).columnGap) || 0;
    const btnWidths = btns.map(btn => btn.getBoundingClientRect().width);
    const totalWidth = btnWidths.reduce((sum, width, i) => sum + width + (i > 0 ? gap : 0), 0);
    const buttonSet = new Set(btns);
    const fixedItems = Array.from(section2.children).filter(el => {
      if (buttonSet.has(el) || el === moreEl || el.hidden) return false;
      return getComputedStyle(el).display !== 'none';
    });
    const fixedWidth = fixedItems.reduce((sum, el) => sum + el.getBoundingClientRect().width, 0);
    // Stałe elementy sekcji (np. selektor Narzędzi w panelu admina) nie
    // trafiają do menu Więcej, ale muszą zmniejszać miejsce dla przycisków.
    const availableWidth = Math.max(0, section2Width - fixedWidth - fixedItems.length * gap);

    moreEl.hidden = false;
    const moreWidth = moreEl.getBoundingClientRect().width;
    moreEl.hidden = true;

    // Jeśli nawet najważniejszy przycisk razem z „Więcej” nie mieszczą się,
    // przełącz cały pasek na hamburger. Nie używamy stałego progu viewportu:
    // decyzję podejmujemy z faktycznych szerokości elementów i dostępnej sekcji.
    const primaryButtonWidth = btnWidths[0] || 0;
    const needsHamburger = totalWidth > availableWidth && btns.length > 0 &&
      primaryButtonWidth + moreWidth + gap > availableWidth;
    window.dispatchEvent(new CustomEvent('topbar:mobile-required', {
      detail: { required: needsHamburger },
    }));
    if (needsHamburger) {
      _hiddenBtns = btns;
      updateMoreBadge(btns);
      return;
    }

    // Suma szerokości to przybliżenie — na styk przyciski potrafiły wyjść poza
    // sekcję (na „Wyloguj”) albo zawinąć się do drugiego wiersza. Przed
    // uznaniem, że wszystko się mieści, sprawdzamy faktyczne położenie.
    const s2Rect = section2.getBoundingClientRect();
    const firstTop = btns[0]?.getBoundingClientRect().top ?? 0;
    const reallyFits = () => [...btns, ...fixedItems].every((el) => {
      const r = el.getBoundingClientRect();
      return r.right <= s2Rect.right + 0.5 && Math.abs(r.top - firstTop) <= 1;
    });
    if (totalWidth <= availableWidth && reallyFits()) {
      _hiddenBtns = [];
      updateMoreBadge([]);
      return;
    }

    const hidden = [];
    // Bez rozjazdu sumy i układu „remaining” liczy od pełnej szerokości; gdy
    // układ się nie zmieścił mimo sumy, schowany zostaje co najmniej jeden przycisk.
    let remaining = Math.max(totalWidth, availableWidth - moreWidth - gap + 1);
    for (let i = btns.length - 1; i >= 0; i--) {
      if (remaining + moreWidth + gap <= availableWidth) break;
      btns[i].classList.add('hidden');
      hidden.unshift(btns[i]);
      remaining -= btnWidths[i] + gap;
    }

    if (!hidden.length) return;

    _hiddenBtns = hidden;
    updateMoreBadge(hidden);
    moreEl.hidden = false;
    hidden.forEach(btn => {
      const clone = btn.cloneNode(true);
      clone.classList.remove('hidden');
      clone.addEventListener('click', () => btn.click());
      moreDropdownEl.appendChild(clone);
    });
  }

  const toggleMore = (e) => {
    e.stopPropagation();
    if (_mobileActive) return;
    if (moreDropdownEl.hidden) {
      // Najpierw oblicz pozycję, gdy dropdown jest niewidoczny. Odsłonięcie
      // przed pomiarem potrafiło pokazać go na moment w lewym górnym rogu.
      placeDropdown(moreEl, moreDropdownEl);
      moreDropdownEl.hidden = false;
    } else {
      moreDropdownEl.hidden = true;
    }
  };
  btnMore?.addEventListener('pointerdown', toggleMore);
  btnMore?.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggleMore(event); }
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !event.defaultPrevented && !_mobileActive && !moreDropdownEl.hidden) {
      event.preventDefault(); moreDropdownEl.hidden = true; btnMore?.focus();
    }
  });

  document.addEventListener('pointerdown', (e) => {
    if (!moreEl.contains(e.target) && !moreDropdownEl.contains(e.target)) {
      moreDropdownEl.hidden = true;
    }
  });

  window.addEventListener('resize', () => {
    if (!moreDropdownEl.hidden) placeDropdown(moreEl, moreDropdownEl);
    if (!_mobileActive) recalc();
  }, { passive: true });
  window.addEventListener('nav:visibilitychange', () => {
    if (!_mobileActive) recalc();
  });

  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => { if (!_mobileActive) recalc(); }).observe(section2);
  }

  function expandAll() {
    getButtons().forEach(btn => btn?.classList.remove('hidden'));
    badgeObserver.takeRecords();
    // Na mobile „Więcej” jest schowane — jego licznik nie może zostać,
    // bo hamburger sumuje widoczne liczniki i liczyłby je podwójnie.
    _hiddenBtns = [];
    updateMoreBadge([]);
    moreEl.hidden = true;
    moreDropdownEl.hidden = true;
    moreDropdownEl.innerHTML = '';
  }

  function collapseAll() {
    requestAnimationFrame(() => recalc());
  }

  _overflowState = { expandAll, collapseAll, recalc };
  if (_mobileActive) expandAll();

  requestAnimationFrame(() => recalc());
  return { recalc };
}

// ── Account slot (section-4) ──────────────────────────────────────────────────
/**
 * Używa istniejącego #who/#whoStatic jako triggera dropdown.
 * Desktop: klik na #who → dropdown z opcjami.
 * Mobile: #who jako label + opcje płasko poniżej.
 *
 * @param {object|null} user
 * @param {object}  [opts]
 * @param {string}  [opts.loginHref='/login/']
 * @param {string}  [opts.accountHref='/account/']
 * @param {boolean} [opts.withAccountSettings=true]  pokaż ustawienia konta w menu nazwy
 * @param {boolean} [opts.showAuthEntry=true]  false → ukryj dla niezalogowanego
 * @param {function} [opts.onLogout]  callback przed wylogowaniem (może zwrócić Promise)
 * @returns {{ guestMode: boolean }}
 */
export function setTopbarAccount(user, opts) {
  _accountByPage = true;
  return applyTopbarAccount(user, opts);
}

function applyTopbarAccount(user, {
  loginHref = '/login/',
  accountHref = '/account/',
  withAccountSettings = true,
  showAuthEntry = true,
  onLogout = null,
} = {}) {
  const section4 = document.querySelector('.topbar-section-4');
  if (!section4) return { guestMode: true };

  // Przywróć poprzedni stan (obsługa ponownego wywołania)
  // Szukaj w całym dokumencie — elementy mogą być przeniesione do mobile panelu
  const prevMenu = document.getElementById('topbarAccountMenu');
  if (prevMenu) prevMenu.remove();
  const prevWho = document.querySelector('#who, #whoStatic');
  if (prevWho) {
    prevWho.innerHTML = '—';
    prevWho.className = prevWho.className.replace(/\baccount-btn\b|\baccount-btn--mobile-label\b/g, '').trim();
    prevWho.removeAttribute('tabindex');
    prevWho.onclick = null;
  }
  _accountState = null;

  const whoEl = document.querySelector('#who, #whoStatic');
  const btnLoginEl = document.getElementById('btnLogout');

  if (!user) {
    if (whoEl) whoEl.hidden = true;
    if (btnLoginEl) {
      if (showAuthEntry) {
        btnLoginEl.hidden = false;
        btnLoginEl.innerHTML = iconText('person', t('common.authEntry') || 'Zaloguj / Załóż konto');
        btnLoginEl.dataset.i18n = 'common.authEntry';
        btnLoginEl.dataset.i18nIcon = 'person';
        btnLoginEl.onclick = () => { location.href = withLangParam(loginHref); };
      } else {
        btnLoginEl.hidden = true;
      }
    }
    return { guestMode: true };
  }

  const guestMode = isGuestUser(user);
  const username = user.username || user.email || '—';

  if (btnLoginEl) btnLoginEl.hidden = true;

  if (!whoEl) return { guestMode };

  // Przekształć #who w trigger
  whoEl.hidden = false;
  whoEl.innerHTML = '';
  const whoSpan = document.createElement('span');
  whoSpan.className = 'account-who';
  whoSpan.textContent = username;
  const chevron = document.createElement('span');
  chevron.className = 'account-chevron';
  chevron.innerHTML = icon('caret-down', { animation: 'disclosure' });
  whoEl.append(whoSpan, chevron);
  whoEl.classList.add('account-btn', 'btn');
  if (!whoEl.matches('button')) whoEl.tabIndex = 0;

  // Menu — wstawiamy za #who w DOM, position:fixed na desktop
  const menu = document.createElement('div');
  menu.className = 'account-menu';
  menu.id = 'topbarAccountMenu';
  menu.hidden = true;
  whoEl.after(menu);
  const syncAccountExpanded = bindDisclosureState(whoEl, menu, () => menu.classList.contains('account-menu--inline'));
  if (!whoEl.matches('button')) whoEl.setAttribute('role', 'button');

  if (withAccountSettings) {
    const btnSettings = document.createElement('button');
    btnSettings.className = 'btn menu-item';
    btnSettings.type = 'button';
    btnSettings.textContent = t('nav.menu.account') || 'Ustawienia konta';
    btnSettings.addEventListener('click', () => {
      menu.hidden = true;
      location.href = withLangParam(accountHref);
    });
    menu.appendChild(btnSettings);
  }

  const btnAction = document.createElement('button');
  btnAction.className = 'btn menu-item';
  btnAction.type = 'button';
  if (guestMode && showAuthEntry) {
    btnAction.textContent = t('common.authEntry') || 'Zaloguj / Załóż konto';
    btnAction.addEventListener('click', () => {
      menu.hidden = true;
      location.href = withLangParam(loginHref);
    });
  } else {
    btnAction.textContent = t('common.logout') || 'Wyloguj';
    btnAction.addEventListener('click', async () => {
      menu.hidden = true;
      if (onLogout) {
        try { await onLogout(); } catch(e) { console.warn('logout callback error:', e); }
      }
      const { signOut } = await import("./auth.js?v=v2026-11-03T22453");
      await signOut();
      location.href = withLangParam(loginHref);
    });
  }
  menu.appendChild(btnAction);

  // Desktop: dropdown
  const toggleAccount = (e) => {
    e.stopPropagation();
    if (_mobileActive) return;
    menu.hidden = !menu.hidden;
    if (!menu.hidden) placeDropdown(whoEl, menu);
  };
  whoEl.addEventListener('pointerdown', toggleAccount);
  whoEl.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggleAccount(event); }
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !event.defaultPrevented && !_mobileActive && !menu.hidden) {
      event.preventDefault(); menu.hidden = true; whoEl.focus();
    }
  });

  document.addEventListener('pointerdown', (e) => {
    // Na telefonie konto jest stałą częścią hamburgera, nie dropdownem.
    if (_mobileActive) return;
    if (!whoEl.contains(e.target) && !menu.contains(e.target)) menu.hidden = true;
  });

  window.addEventListener('resize', () => {
    if (!menu.hidden && !_mobileActive) placeDropdown(whoEl, menu);
  }, { passive: true });

  // Mobile API
  function expand() {
    clearPlacement(menu);
    menu.hidden = false;
    menu.classList.add('account-menu--inline');
    whoEl.classList.add('account-btn--mobile-label');
    syncAccountExpanded();
  }

  function collapse() {
    menu.classList.remove('account-menu--inline');
    menu.hidden = true;
    whoEl.classList.remove('account-btn--mobile-label');
    syncAccountExpanded();
  }

  _accountState = { expand, collapse };
  if (_mobileActive) expand();

  return { guestMode };
}

// ── Auto init (strony bez własnego auth flow) ─────────────────────────────────
// Alias dla kompatybilności z istniejącymi importami
export { setTopbarAccount as initTopbarAccountDropdown };

export async function autoInitTopbarAuthButton(btn = document.getElementById('btnLogout')) {
  if (!btn) return;
  if (btn.dataset.topbarAuthReady === '1' || _accountByPage) return;
  const { getUser } = await import('./auth.js?v=v2026-11-03T22453');

  if (btn.dataset.topbarAuthReady === '1' || _accountByPage) return;
  const user = await getUser();
  // getUser bywa wolniejsze niż initPage strony — wtedy zostaje jej ustawienie
  // (?ret= w „Ustawieniach konta”, ukryte „Zaloguj” na Prywatności).
  if (btn.dataset.topbarAuthReady === '1' || _accountByPage) return;
  applyTopbarAccount(user);
  btn.dataset.topbarAuthReady = '1';
}

// ── Kontroler mobilny ─────────────────────────────────────────────────────────
function initTopbarController() {
  const topbar = document.querySelector('.topbar.topbar-layout-4');
  if (!topbar || topbar.classList.contains('topbar-mobile-hidden')) return;
  if (topbar.dataset.mobileMenuControllerReady === '1') return;

  const section1 = topbar.querySelector('.topbar-section-1');
  const section2 = topbar.querySelector('.topbar-section-2');
  const section3 = topbar.querySelector('.topbar-section-3');
  const section4 = topbar.querySelector('.topbar-section-4');
  if (!section1 || !section2 || !section3 || !section4) return;

  topbar.dataset.mobileMenuControllerReady = '1';

  const hasOverflowNav = !!document.getElementById('navMore');
  if (hasOverflowNav) topbar.classList.add('topbar-has-overflow-nav');
  // Układ telefonu: data-compact (core/device-attrs.js), ten sam atrybut co CSS.
  const useMediaMobileMode = () => isCompactLayout() && !hasOverflowNav;
  const section2Placeholder = document.createComment('topbar-section-2-restore');
  const section4Placeholder = document.createComment('topbar-section-4-restore');
  const tabsPlaceholder = document.createComment('topbar-tabs-restore');
  const simpleTabs = document.querySelector('.simple-tabs');
  const menuContentSelector =
    'button, a, [role="button"], [role="tab"], .btn, .user-btn, .lang-switcher, .theme-switcher, .top-status';

  let overlay, panel, mount, tabGroup, group2, group4, sep, toggleBtn, toggleBadge, badgeObserver;
  let isMobileMounted = false;
  let navRequiresMobile = false;

  // Suma liczników przycisków WIDOCZNYCH w panelu (schowane, np. „Więcej”
  // albo przycisk ukryty dla gościa, nie mogą podbijać licznika hamburgera).
  // Panel bywa zamknięty (display:none na overlayu), więc nie getClientRects —
  // sprawdzamy własny display elementu i jego przodków do korzenia panelu.
  const isHiddenWithin = (el, root) => {
    for (let n = el; n && n !== root; n = n.parentElement) {
      if (getComputedStyle(n).display === 'none') return true;
    }
    return false;
  };

  const computeMenuBadgeSum = () =>
    [...(mount || document).querySelectorAll('.badge')]
      .filter((b) => !isHiddenWithin(b, mount))
      .reduce((sum, b) => sum + parseBadgeNumber(b.textContent), 0);

  const updateMenuBadge = () => {
    if (!toggleBtn || !toggleBadge) return;
    setBadgeCount(toggleBadge, computeMenuBadgeSum());
  };

  const isVisible = (el) => {
    if (!el) return false;
    const st = getComputedStyle(el);
    return st.display !== 'none' && st.visibility !== 'hidden' && st.opacity !== '0';
  };

  const hasVisibleMenuItems = () => {
    if (!isMobileMounted || !mount) return false;
    return (tabGroup?.childElementCount || 0) > 0 ||
      [...mount.querySelectorAll(menuContentSelector)].some(el => !isHiddenWithin(el, mount));
  };

  const hasMenuContent = () => {
    const hasTabs = !!simpleTabs?.querySelector('.tab, button, [role="tab"]');
    const sel = 'button, a, .btn, [role="button"], [role="tab"], .user-btn, .lang-switcher, .theme-switcher, .top-status';
    return hasTabs ||
      [...section2.querySelectorAll(sel)].some(isVisible) ||
      [...section4.querySelectorAll(sel)].some(isVisible);
  };

  const close = () => {
    const focusInMenu = overlay?.contains(document.activeElement);
    overlay?.classList.remove('is-open');
    if (overlay) overlay.inert = true;
    document.body.classList.remove('topbar-mobile-lock');
    document.documentElement.removeAttribute('data-menu-scrollbar');
    toggleBtn?.setAttribute('aria-expanded', 'false');
    toggleBtn?.setAttribute('aria-label', t('common.menuOpen'));
    if (focusInMenu) toggleBtn?.focus();
  };

  const open = () => {
    document.documentElement.toggleAttribute('data-menu-scrollbar', window.innerWidth > document.documentElement.clientWidth);
    document.dispatchEvent(new CustomEvent('drawer:open', { detail: { panel: overlay } }));
    if (overlay) overlay.inert = false;
    overlay?.classList.add('is-open');
    document.body.classList.add('topbar-mobile-lock');
    toggleBtn?.setAttribute('aria-expanded', 'true');
    toggleBtn?.setAttribute('aria-label', t('common.menuClose'));
  };

  const mountMobile = () => {
    if (isMobileMounted) return;
    if (!hasMenuContent()) return;
    isMobileMounted = true;
    topbar.classList.add('topbar-mobile-forced');

    overlay = document.createElement('div');
    overlay.className = 'topbar-mobile-overlay';
    overlay.id = 'topbarMobileMenu';
    overlay.inert = true;
    if (!useMediaMobileMode()) overlay.classList.add('topbar-mobile-forced');

    panel = document.createElement('div');
    panel.className = 'topbar-mobile-panel';

    mount = document.createElement('div');
    mount.className = 'topbar-mobile-mount';

    tabGroup = document.createElement('div');
    tabGroup.className = 'topbar-mobile-tab-group';

    group2 = document.createElement('div');
    group2.className = 'topbar-mobile-group topbar-mobile-group-2';

    group4 = document.createElement('div');
    group4.className = 'topbar-mobile-group topbar-mobile-group-4';

    if (simpleTabs?.parentNode) {
      simpleTabs.parentNode.insertBefore(tabsPlaceholder, simpleTabs);
      tabGroup.appendChild(simpleTabs);
    }
    if (tabGroup.childElementCount > 0) mount.append(tabGroup);

    if (section2.firstChild) section2.insertBefore(section2Placeholder, section2.firstChild);
    else section2.appendChild(section2Placeholder);

    if (section4.firstChild) section4.insertBefore(section4Placeholder, section4.firstChild);
    else section4.appendChild(section4Placeholder);

    // Płaskie menu: overflow nav i account dropdown nieaktywne. MUSI się
    // wykonać PRZED przeniesieniem przycisków niżej — expandAll() liczy
    // swoją listę przycisków przez section2.querySelectorAll(...), więc
    // gdyby section2 było już puste (przyciski przeniesione do group2),
    // nie miałoby czego odkryć i przyciski ukryte wcześniej przez desktopowy
    // "More ▾" (recalc(), display:none) zostawałyby niewidoczne również w
    // panelu mobilnym.
    _overflowState?.expandAll();
    _accountState?.expand();
    _mobileActive = true;

    // Tytuł strony (.topbar-title) zostaje w topbarze — na telefonie pokazuje
    // go klasa body.topbar-title-mobile; do menu trafiają tylko przyciski.
    section2.querySelectorAll(':scope > .topbar-title').forEach((el) => {
      section2.insertBefore(el, section2Placeholder);
    });
    while (section2Placeholder.nextSibling) group2.appendChild(section2Placeholder.nextSibling);
    while (section4Placeholder.nextSibling) group4.appendChild(section4Placeholder.nextSibling);

    sep = document.createElement('div');
    sep.className = 'topbar-mobile-sep';
    mount.append(group2, sep, group4);

    const visibleItems = (root) => [...root.querySelectorAll(menuContentSelector)].filter(isVisible);
    const hasAnything =
      (tabGroup?.childElementCount || 0) > 0 ||
      visibleItems(group2).length > 0 ||
      visibleItems(group4).length > 0;

    if (!hasAnything) { unmountMobile(); return; }

    panel.append(mount);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.className = 'btn topbar-menu-toggle';
    toggleBtn.setAttribute('aria-controls', overlay.id);
    toggleBtn.setAttribute('aria-expanded', 'false');
    toggleBtn.setAttribute('aria-label', t('common.menuOpen'));
    toggleBtn.innerHTML = `<span class="topbar-menu-icon" aria-hidden="true">${icon('hamburger', { animation: 'menu' })}</span><span class="badge" aria-hidden="true"></span>`;
    toggleBadge = toggleBtn.querySelector('.badge');
    section3.append(toggleBtn);

    // Hide the old panel before a navigation handler starts loading a page.
    panel.addEventListener('click', (event) => {
      const action = event.target.closest('[data-nav-href],a[href]');
      if (!action || action.disabled || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      if (action.tagName === 'A' && (action.target === '_blank' || action.hasAttribute('download'))) return;
      action.blur();
      close();
    }, true);
    toggleBtn.addEventListener('click', () => {
      if (toggleBtn.getAttribute('aria-expanded') === 'true') close(); else open();
    });
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    if (!section2.querySelector(':scope > .topbar-title')) section2.hidden = true;
    section4.hidden = true;

    const backBtn = section1.querySelector('#btnBack,#btnBackToGames');
    if (backBtn) backBtn.classList.add('mobile-primary-back');

    badgeObserver = new MutationObserver(() => {
      updateMenuBadge();
      if (!hasVisibleMenuItems()) unmountMobile();
    });
    badgeObserver.observe(mount, { subtree: true, childList: true, characterData: true, attributes: true });
    updateMenuBadge();
  };

  const unmountMobile = () => {
    if (!isMobileMounted) return;
    isMobileMounted = false;
    topbar.classList.remove('topbar-mobile-forced');
    close();

    // Przywróć account slot i overflow przed przeniesieniem elementów
    _accountState?.collapse();
    _mobileActive = false;

    while (group2?.firstChild) section2.insertBefore(group2.firstChild, section2Placeholder);
    while (group4?.firstChild) section4.insertBefore(group4.firstChild, section4Placeholder);

    if (simpleTabs && tabsPlaceholder.parentNode) {
      tabsPlaceholder.parentNode.insertBefore(simpleTabs, tabsPlaceholder);
      tabsPlaceholder.remove();
    }

    section2Placeholder.remove();
    section4Placeholder.remove();

    section2.hidden = false;
    section4.hidden = false;

    toggleBtn?.remove();
    overlay?.remove();

    try { badgeObserver?.disconnect(); } catch {}
    badgeObserver = toggleBadge = null;
    overlay = panel = mount = tabGroup = group2 = group4 = sep = toggleBtn = null;

    // Przelicz overflow po przywróceniu section-2
    _overflowState?.collapseAll();
  };

  const syncMode = () => {
    if (useMediaMobileMode() || navRequiresMobile) mountMobile();
    else unmountMobile();
  };

  window.addEventListener('topbar:mobile-required', (event) => {
    navRequiresMobile = !!event.detail?.required;
    syncMode();
  });

  document.addEventListener('keydown', (event) => {
    if (toggleBtn?.getAttribute('aria-expanded') !== 'true') return;
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      toggleBtn?.focus();
    } else if (event.key === 'Tab') {
      // Nawigacja klawiaturą pozostaje w otwartym menu i jego przełączniku.
      const items = [toggleBtn, ...overlay.querySelectorAll('a[href],button,input,select,textarea,[tabindex]')]
        .filter(el => !el.disabled && el.tabIndex >= 0 && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
      const index = items.indexOf(document.activeElement);
      event.preventDefault();
      items[(index + (event.shiftKey ? -1 : 1) + items.length) % items.length]?.focus();
    }
  });
  document.addEventListener('drawer:open', event => {
    if (event.detail?.panel !== overlay) close();
  });
  window.addEventListener('i18n:lang', () => {
    toggleBtn?.setAttribute('aria-label', t(toggleBtn.getAttribute('aria-expanded') === 'true' ? 'common.menuClose' : 'common.menuOpen'));
  });

  syncMode();

  onDeviceChange(syncMode);

  // Na części tabletów obrót ekranu nie zawsze odpala zdarzenia zmiany
  // niezawodnie — przyciski zostają wtedy zablokowane w nieaktualnym stanie
  // (schowane, a hamburger też już niewidoczny wg CSS) aż do przeładowania.
  // orientationchange jako dodatkowy, redundantny trigger; opóźnienie, bo
  // niektóre przeglądarki chwilę raportują stare wymiary tuż po evencie.
  window.addEventListener('orientationchange', () => {
    syncMode();
    setTimeout(syncMode, 300);
  });

  // Gdy hamburger włączono z powodu braku miejsca, po zmianie rozmiaru
  // przywróć na chwilę układ zwykły i ponownie zmierz rzeczywiste szerokości.
  let resizeTimer;
  window.addEventListener('resize', () => {
    if (!navRequiresMobile || useMediaMobileMode()) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      navRequiresMobile = false;
      unmountMobile();
      requestAnimationFrame(() => _overflowState?.recalc());
    }, 120);
  }, { passive: true });

  // „Więcej” na każdej stronie (E23, spójność): strony bez własnego #navMore
  // w HTML dostają je tutaj — przyciski sekcji 2 zwijają się zamiast zawijać
  // pasek; gdy nie mieści się nawet jeden (np. jedyny przycisk): hamburger.
  if (!hasOverflowNav && section2.querySelector(':scope > .btn')) {
    const more = document.createElement('div');
    more.className = 'nav-more';
    more.id = 'navMore';
    more.hidden = true;
    const label = t('nav.menu.more');
    more.innerHTML = `<button class="btn" id="btnMore" type="button"><span data-i18n="nav.menu.more"></span> ${icon('caret-down', { animation: 'disclosure' })}<span class="badge" id="moreBadge" aria-hidden="true"></span></button><div class="nav-more-dropdown" id="navMoreDropdown" hidden></div>`;
    more.querySelector('[data-i18n]').textContent = label && label !== 'nav.menu.more' ? label : 'Więcej';
    const dropdown = more.querySelector('#navMoreDropdown');
    // Na telefonie przyciski siedzą w panelu (group2) i wracają do sekcji 2
    // przy odmontowaniu — „Więcej” musi wrócić za nimi.
    (isMobileMounted && group2 ? group2 : section2).append(more);
    setTopbarNavPriority({ moreEl: more, moreDropdownEl: dropdown });
  }
}

function updateTopbarHeight() {
  const topbar = document.querySelector('.topbar');
  if (!topbar) return;
  // `--topbar-h` opisuje wyłącznie wysokość paska, nigdy jego położenie.
  // Body używa jej do paddingu i wysokości mobilnych arkuszy.
  const height = Math.ceil(topbar.getBoundingClientRect().height);
  document.body.style.setProperty('--topbar-h', `${height}px`);
}

registerPageLayout(() => {
  initTopbarController();
  _overflowState?.recalc();
  updateTopbarHeight();
});

window.addEventListener('DOMContentLoaded', () => {
  initTopbarController();
  void autoInitTopbarAuthButton();
  requestAnimationFrame(updateTopbarHeight);
});

window.addEventListener('load', updateTopbarHeight);
window.addEventListener('resize', updateTopbarHeight);
window.visualViewport?.addEventListener('resize', updateTopbarHeight, { passive: true });
window.addEventListener('DOMContentLoaded', () => {
  const topbar = document.querySelector('.topbar');
  if (topbar && typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(updateTopbarHeight).observe(topbar);
  }
}, { once: true });
