import { initI18n, t } from '../../shared/translation/translation.js?v=v2026-11-07T20215';
import { icon, iconText, sharingActionIcon } from '../../shared/js/core/icons.js?v=v2026-11-07T20215';
import { toast } from '../../shared/js/core/toast.js?v=v2026-11-07T20215';
import { confirmModal } from '../../shared/js/core/modal.js?v=v2026-11-07T20215';
import { tabFromUrl, setTab as setUrlTab } from '../../shared/js/core/tabs.js?v=v2026-11-07T20215';
import { initSplitTabs } from '../../shared/js/core/split-tabs.js?v=v2026-11-07T20215';
import { attachListTools } from '../../shared/js/core/share-sections.js?v=v2026-11-07T20215';
import { initEntryPage } from "../../shared/js/core/page-init.js?v=v2026-11-07T20215";


const $ = id => document.getElementById(id);
attachListTools($('subscriptionTitle'), $('subscriptionList'), 'mail-subscriptions');
attachListTools($('itemsTitle'), $('itemsList'), 'mail-items');
const text = (key, vars) => t(`mailCenter.${key}`, vars);
let model = { state: 'entry' }, selectedTab = tabFromUrl(['subscriptions', 'items'], 'subscriptions'), csrf = '', busy = false;
let requestUntil = 0, cooldownTimer = null, pendingAccess = '';
async function exchangeAccess() { model = stateFrom(await api('exchange', { token: pendingAccess })); pendingAccess = ''; }

async function api(path, body) {
  const response = await fetch(`/_api/mail/${path}`, {
    method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json', 'X-Mail-CSRF': csrf },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json();
  if (data.csrf) csrf = data.csrf;
  if (!response.ok && !data.error) throw new Error('request_failed');
  return data;
}
function button(label, act, kind = 'btn sm', iconName = '') {
  const node = document.createElement('button'); node.type = 'button'; node.className = kind;
  node.innerHTML = iconText(iconName, text(label)); node.addEventListener('click', () => perform(act)); return node;
}
async function perform(fn) {
  if (busy) return;
  busy = true;
  document.querySelectorAll('.mail-wrap button').forEach(node => { node.disabled = true; });
  try { await fn(); } catch { toast(text('requestFailed'), { kind: 'error' }); }
  finally { busy = false; document.querySelectorAll('.mail-wrap button').forEach(node => { node.disabled = false; }); render(); }
}
function stateFrom(data) {
  if (data.ok) return { ...data, state: 'active' };
  if (data.error === 'requires_login') return { state: 'registered', email: data.email };
  if (['expired_token','expired_session','invalid_token','invalid_session','invalid_request'].includes(data.error)) return { state: 'expired' };
  return { state: 'entry' };
}
function badge(id, count) {
  const node = $(id); node.textContent = String(count); node.hidden = count === 0;
}
let split = null;
function setTab(value) {
  selectedTab = value;
  split ||= initSplitTabs(document.querySelector('.tabs-card--split'), { active: value, onChange: name => { selectedTab = name; setUrlTab(name, 'subscriptions'); } });
  split.select(value);
}
function empty(id, key) { const node = document.createElement('div'); node.className = 'empty-state'; node.textContent = text(key); $(id).replaceChildren(node); }
function actionIcon(name, label, act, href) {
  const node = document.createElement(href ? 'a' : 'button'); node.className = 'btn sm';
  node.title = text(label); node.setAttribute('aria-label', text(label)); node.innerHTML = icon(name);
  if (href) {
    let link = null;
    try { link = new URL(href, location.origin); } catch {}
    // Link spoza serwisu albo nie do /go/: wiersz bez odnośnika, reszta listy działa.
    if (!link || link.origin !== location.origin || link.pathname !== '/go/') return null;
    node.href = link.pathname + link.search;
  } else { node.type = 'button'; node.addEventListener('click', () => perform(act)); }
  return node;
}
async function sourceAction(item, action) {
  if (action === 'decline' && !await confirmModal({ title: text('declineTitle'), text: text(item.kind === 'subscription' ? 'declineSubscription' : 'declinePoll'), okText: text('decline'), cancelText: text('cancel') })) return;
  const result = await api('action', { kind: item.kind, id: item.id, action });
  if (!result.ok) { toast(text('sourceUnavailable'), { kind: 'error' }); }
  model = stateFrom(await api('session'));
}
function row(item) {
  const node = document.createElement('div'); node.className = `shareRow mail-row mail-row--${item.kind}`;
  // stan wiersza dla filtra listy (attachListTools)
  node.dataset.state = item.kind === 'subscription' ? (item.status === 'pending' ? 'pending' : 'active') : item.kind;
  node.dataset.stateLabel = item.kind === 'subscription' ? (item.status === 'pending' ? text('pending') : t('shareSections.active')) : t(`tasks.filter.${item.kind === 'poll' ? 'poll' : 'device'}`);
  const kind = document.createElement('span'); kind.className = 'mail-kind'; kind.innerHTML = icon(item.kind === 'subscription' ? 'envelope' : item.kind === 'poll' ? 'bell' : item.device_type || 'display');
  const copy = document.createElement('div'); copy.className = 'mail-row-copy';
  const title = document.createElement('div'); title.className = 'shareEmail';
  title.textContent = item.kind === 'subscription' ? item.owner_label || text('ownerFallback') : item.name;
  const status = document.createElement('div'); status.className = 'shareNote';
  const parts = [];
  if (item.kind !== 'subscription') parts.push(text('from', { owner: item.owner_label || text('ownerFallback') }));
  if (item.kind === 'subscription' && item.status === 'pending') parts.push(text('pending'));
  if (item.kind === 'poll') parts.push(text(item.status === 'opened' ? 'opened' : 'awaitsVote'));
  if (item.kind === 'device') parts.push(text(item.device_type || 'display'));
  status.textContent = parts.join(' · '); status.hidden = parts.length === 0;
  copy.append(title, status);
  const actions = document.createElement('div'); actions.className = 'shareRowActions';
  if (item.kind === 'subscription') {
    if (item.status === 'pending') actions.append(actionIcon('check', 'accept', () => sourceAction(item, 'accept')));
    actions.append(actionIcon(sharingActionIcon('withdraw'), item.status === 'active' ? 'withdraw' : 'decline', () => sourceAction(item, 'decline')));
  } else {
    const open = actionIcon('arrow-right', item.kind === 'poll' ? 'vote' : 'connect', null, item.link);
    if (open) actions.append(open);
    if (item.kind === 'poll') actions.append(actionIcon(sharingActionIcon('decline'), 'decline', () => sourceAction(item, 'decline')));
  }
  node.append(kind, copy, actions); return node;
}
function render() {
  const active = model.state === 'active', enabled = active && model.notifications_enabled;
  document.querySelector('.mail-wrap').classList.toggle('has-session',active);
  $('mailSummary').hidden=!active; $('mailEntry').hidden=active;
  (active ? $('mailSummary') : $('mailEntry')).prepend($('mailHeading'));
  $('mailTitle').className=active ? 'title' : 'poll-go-title';
  $('mailAddress').hidden = !model.email; $('mailAddress').textContent = model.email || '';
  $('mailPreference').hidden = !active; $('mailLists').hidden = !enabled;
  $('mailForm').hidden = !['entry','expired'].includes(model.state);
  $('mailActions').replaceChildren();
  if (active) {
    $('mailTitle').textContent = text('centerTitle'); $('mailMessage').textContent = '';
    $('mailPreference').classList.toggle('is-disabled', !enabled);
    $('mailPreferenceTitle').textContent = text(enabled ? 'enabledTitle' : 'disabledTitle');
    $('mailPreferenceText').textContent = text(enabled ? 'enabledText' : 'disabledText');
    $('mailPreferenceButton').innerHTML = iconText(enabled ? 'close' : 'restore', text(enabled ? 'resign' : 'restore'));
    $('mailPreferenceButton').disabled = false;
    if (enabled) {
      const subscriptions = model.subscriptions || [], items = model.items || [];
      if (subscriptions.length) $('subscriptionList').replaceChildren(...subscriptions.map(row)); else empty('subscriptionList','noSubscriptions');
      if (items.length) $('itemsList').replaceChildren(...items.map(row)); else empty('itemsList','noItems');
      badge('subscriptionBadge', subscriptions.filter(item => item.status === 'pending').length); badge('itemsBadge', items.length);
      setTab(selectedTab);
    }
  } else {
    $('mailTitle').textContent = text(`${model.state}Title`); $('mailMessage').textContent = text(`${model.state}Text`, { email: model.email || '' });
    if (model.state === 'confirm') $('mailActions').append(button('openCenter',exchangeAccess,'btn gold sm','arrow-right'));
    if (model.state === 'registered') {
      const login = document.createElement('a'); login.className = 'btn gold sm'; login.href = '/login/?next=account'; login.innerHTML = iconText('person', text('login')); $('mailActions').append(login);
    }
    if (model.state === 'sent') {
      const change = button('differentEmail', async () => { model = { state: 'entry' }; }, 'btn sm', 'envelope'); $('mailActions').append(change);
    }
  }
  $('mailMessage').hidden = !$('mailMessage').textContent;
  $('mailActions').hidden = !$('mailActions').children.length;
  if (!enabled) { $('subscriptionList').replaceChildren(); $('itemsList').replaceChildren(); }
  updateCooldown();
  if (active) $('mailSummary').classList.add('skel-step-ready');
  else $('mailEntry').classList.add('skel-step-ready');
  if (enabled) $('mailLists').classList.add('skel-step-ready');
}
function updateCooldown() {
  const remaining = Math.max(0, Math.ceil((requestUntil - Date.now()) / 1000));
  const submit = $('mailForm').querySelector('button'); submit.disabled = busy || remaining > 0;
  submit.textContent = remaining ? text('retryIn', { seconds: remaining }) : text('sendLink');
  clearTimeout(cooldownTimer); if (remaining) cooldownTimer = setTimeout(updateCooldown, 1000);
}
$('mailForm').addEventListener('submit', event => {
  event.preventDefault(); if (!$('mailForm').reportValidity() || Date.now() < requestUntil) return;
  perform(async () => {
    const email = $('mailInput').value.trim(); const result = await api('request', { email, lang: document.documentElement.lang });
    if (result.error === 'requires_login') model = { state: 'registered', email };
    else if (result.ok) { requestUntil = Date.now() + (result.cooldown_seconds || 60) * 1000; model = { state: 'sent', email }; }
    else if (result.error === 'cooldown') { requestUntil = Date.now() + result.cooldown_seconds * 1000; toast(text('cooldownMessage'), { kind: 'info' }); }
    else toast(text('requestFailed'), { kind: 'error' });
  });
});
$('mailPreferenceButton').addEventListener('click', () => perform(async () => {
  const enabled = !model.notifications_enabled;
  if (!enabled && !await confirmModal({ title: text('resign'), text: text('resignConfirm'), okText: text('resign'), cancelText: text('cancel') })) return;
  const result = await api('notifications', { enabled });
  if (!result.ok) { model = stateFrom(result); return; }
  model = stateFrom(await api('session'));
}));
window.addEventListener('i18n:lang', () => { if (document.querySelector('.topbar-ready')) render(); });

// Podręcznik bez ?ret= (manualHref) — adres tej strony niesie token dostępu (?m=).
await initEntryPage('mailCenter', { ready: initI18n({ withSwitcher: true }) });
document.getElementById('mailEntry')?.classList.add('skel-step-ready');
try {
  const url = new URL(location.href), access = url.searchParams.get('m');
  // Session bootstrap issues the nonce; peeking never consumes a one-time proof.
  const current = await api('session');
  if (url.searchParams.has('m')) {
    url.searchParams.delete('m'); history.replaceState(null, '', url.pathname + url.search);
    pendingAccess = access;
    const result = await api('peek', { token: access });
    if (!result.ok) model = stateFrom(result);
    else if (result.purpose === 'verification') model = { state: 'confirm' };
    else await exchangeAccess();
  } else model = stateFrom(current);
} catch { model = { state: 'entry' }; toast(text('requestFailed'), { kind: 'error' }); }
render();
