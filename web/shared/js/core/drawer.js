// Wspólna obsługa bocznych paneli roboczych. Układ i ruch: .drawer w silniku.
import { setDrawerTop } from './geometry.js?v=v2026-11-04T10120';
import { registerPageLayout } from './page-layout.js?v=v2026-11-04T10120';

export function bindDrawer({ panel, backdrop, toggle, anchor = toggle?.parentElement, beforeOpen, onChange } = {}) {
  if (!panel || !backdrop) return null;
  const narrow = window.matchMedia('(max-width: 980px)');
  const isOpen = () => panel.classList.contains('is-open');
  let opener = toggle;
  const measure = () => {
    if (!anchor || !narrow.matches) return;
    const top = Math.max(0, anchor.getBoundingClientRect().bottom);
    setDrawerTop(panel, top);
    setDrawerTop(backdrop, top);
  };
  registerPageLayout(measure);
  if (anchor && typeof ResizeObserver !== 'undefined') new ResizeObserver(measure).observe(anchor);
  window.addEventListener('resize', measure, { passive: true });

  const setOpen = (requested) => {
    const open = !!requested && narrow.matches;
    if (open && !isOpen()) {
      opener = toggle || document.activeElement;
      beforeOpen?.();
      measure();
      document.dispatchEvent(new CustomEvent('drawer:open', { detail: { panel } }));
    }
    const restoreFocus = !open && panel.contains(document.activeElement);
    panel.classList.toggle('is-open', open);
    backdrop.classList.toggle('is-open', open);
    panel.inert = narrow.matches && !open;
    toggle?.setAttribute('aria-expanded', String(open));
    if (restoreFocus && opener?.isConnected) opener.focus();
    onChange?.(open);
  };
  const close = () => setOpen(false);
  toggle?.addEventListener('click', () => setOpen(!isOpen()));
  backdrop.addEventListener('click', close);
  narrow.addEventListener('change', close);
  document.addEventListener('drawer:open', event => {
    if (event.detail?.panel !== panel && isOpen()) close();
  });
  document.addEventListener('keydown', event => {
    if (!isOpen() || event.defaultPrevented) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      if (opener?.isConnected) opener.focus();
    }
  });
  panel.inert = narrow.matches && !isOpen();
  return { open: () => setOpen(true), close, setOpen, isOpen };
}
