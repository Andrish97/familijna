import { controlLayoutGeometry, DEVICE_VIEWPORT } from './layoutGeometry.js?v=v2026-11-05T14442';
import { t } from '../../shared/translation/translation.js?v=v2026-11-05T14442';
import { backHref } from '../../shared/js/core/nav-map.js?v=v2026-11-05T14442';
import { showPageGuard, hidePageGuard } from '../../shared/js/core/page-overlay.js?v=v2026-11-05T14442';


export function currentControlGeometry(testMode = false, { width = innerWidth, height = innerHeight } = {}) {
  const topbarHeight = document.querySelector('.topbar')?.offsetHeight || 68;
  return controlLayoutGeometry({ width, height, topbarHeight, testMode });
}

export function createControlTestMode({ urls, onActivity, onResize }) {
  const wrap = document.querySelector('.wrap.wide');
  const stage = document.createElement('div');
  stage.id = 'controlStage';
  const panel = document.createElement('div');
  panel.id = 'controlStagePanel';
  const sidebar = document.createElement('aside');
  sidebar.id = 'controlTestDevices';
  sidebar.hidden = true;
  wrap.before(stage);
  stage.append(panel, sidebar);
  const surface = document.createElement('div');
  surface.id = 'controlSurface';
  panel.append(surface);
  surface.append(document.querySelector('.topbar'), wrap);
  let enabled = false;
  let ownsGuard = false;
  function mountDevices() {
    for (const kind of ['display', 'host', 'buzzer']) {
      const slot = document.createElement('section');
      slot.className = 'control-test-device';
      const frame = document.createElement('iframe');
      frame.dataset.testDevice = kind;
      frame.dataset.controlTestMode = 'true';
      frame.title = t(`control.device${kind[0].toUpperCase()}${kind.slice(1)}`);
      frame.width = String(DEVICE_VIEWPORT.width);
      frame.height = String(DEVICE_VIEWPORT.height);
      frame.allow = 'autoplay';
      const url = new URL(urls[`${kind}Url`]);
      url.searchParams.delete('d');
      url.pathname = `/control/${kind}/`;
      frame.src = url.href;
      frame.addEventListener('load', () => {
        const doc = frame.contentDocument;
        if (!doc) return;
        for (const event of ['pointerdown', 'keydown', 'input', 'change']) {
          doc.addEventListener(event, onActivity, { passive: true, capture: true });
        }
        // pełny ekran nie ma sensu w podglądzie trybu testowego
        doc.getElementById('btnFullscreen')?.remove();
      });
      slot.append(frame);
      sidebar.append(slot);
    }
  }
  function resize() {
    const g = currentControlGeometry(enabled);
    stage.dataset.testMode = String(enabled);
    for (const [name, value] of Object.entries({ 'sidebar-width':g.sidebarWidth, 'panel-width':g.virtualWidth, 'panel-height':g.virtualHeight, 'surface-width':g.virtualSurfaceWidth, 'surface-height':g.virtualSurfaceHeight })) {
      stage.style.setProperty(`--control-${name}`, `${value}px`);
    }
    stage.style.setProperty('--control-scale', String(g.scale));
    stage.style.setProperty('--control-device-scale', String(g.deviceScale));
    if (enabled && !g.fits && document.documentElement.dataset.deviceGuard === 'ok') {
      showPageGuard({ kind:'device', state:'test-narrow', iconName:'fullscreen-enter', titleKey:'pageGuard.narrowTitle', messageKey:'control.testModeTooSmall', backHref:backHref('control') });
      ownsGuard = true;
    } else if (ownsGuard && (g.fits || !enabled)) {
      if (document.documentElement.dataset.deviceGuard === 'ok') hidePageGuard();
      ownsGuard = false;
    }
  }
  function update(value) {
    const next = value === true;
    if (next !== enabled) {
      enabled = next;
      sidebar.hidden = !enabled;
      if (enabled) mountDevices();
      else sidebar.replaceChildren();
    }
    resize();
  }
  window.addEventListener('resize', () => { resize(); onResize(); });
  resize();
  return { update, canEnable:() => currentControlGeometry(true).fits, blocked:() => !currentControlGeometry(enabled).fits };
}
