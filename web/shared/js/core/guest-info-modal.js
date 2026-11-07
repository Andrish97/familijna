// js/core/guest-info-modal.js
// Jednorazowy modal informacyjny dla konta gościa.

import { alertModal } from './modal.js?v=v2026-11-07T22371';
import { t } from '../../translation/translation.js?v=v2026-11-07T22371';


const GUEST_INFO_SHOWN_PREFIX = 'fam:guest:info_shown:';

function buildGuestInfoBody() {
  const wrap = document.createElement('div');
  wrap.className = 'guest-info';

  ['guestInfo.warning1', 'guestInfo.warning2'].forEach((htmlKey) => {
    const row = document.createElement('div');
    row.innerHTML = t(htmlKey);
    wrap.appendChild(row);
  });

  const sep = document.createElement('hr');
  sep.className = 'guest-info-sep';
  wrap.appendChild(sep);

  const migrateTitle = document.createElement('div');
  migrateTitle.className = 'guest-info-title';
  migrateTitle.textContent = t('guestInfo.migrateTitle');
  wrap.appendChild(migrateTitle);

  const steps = document.createElement('ol');
  steps.className = 'guest-info-steps';

  ['step1', 'step2', 'step3', 'step4'].forEach((key) => {
    const li = document.createElement('li');
    li.innerHTML = t(`guestInfo.${key}`);
    steps.appendChild(li);
  });

  wrap.appendChild(steps);
  return wrap;
}

/**
 * Pokazuje modal informacyjny dla gościa jednorazowo (per konto).
 * Wywołaj zaraz po requireAuth() gdy user.is_guest === true.
 *
 * @param {object} user - enriched user z requireAuth() / getUser()
 */
export async function maybeShowGuestInfoModal(user) {
  if (!user?.is_guest) return;

  const key = GUEST_INFO_SHOWN_PREFIX + (user.id || 'unknown');
  try {
    if (localStorage.getItem(key) === '1') return;
  } catch { /* storage niedostępny — pokaż mimo to */ }

  const body = buildGuestInfoBody();

  await alertModal({
    title: t('guestInfo.title'),
    text: t('guestInfo.subtitle'),
    okText: t('guestInfo.ok'),
    onReady: ({ overlay }) => {
      const sub = overlay?.querySelector('.mSub');
      if (sub) sub.after(body);
    },
  });

  try { localStorage.setItem(key, '1'); } catch {}
}