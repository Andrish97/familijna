import { t } from '../../translation/translation.js?v=v2026-11-05T23293';


export function showPollSubmitRetry({ button, container, seconds = 0, setMessage, onRetry }) {
  const created = !button;
  if (created) {
    button = document.createElement('button');
    button.type = 'button'; button.className = 'btn gold full';
    container.replaceChildren(button);
    button.addEventListener('click', onRetry);
  }
  const until = Date.now() + seconds * 1000;
  const message = () => {
    const remaining = Math.max(0, Math.ceil((until - Date.now()) / 1000));
    button.disabled = remaining > 0;
    button.textContent = t(remaining ? 'pollAnonymous.retryIn' : 'pollAnonymous.retry', { seconds: remaining });
    setMessage(t(remaining ? 'pollAnonymous.saved' : seconds > 0 ? 'pollAnonymous.ready' : 'pollAnonymous.failed', { seconds: remaining }));
  };
  message();
  const timer = setInterval(message, 250);
  window.addEventListener('i18n:lang', message);
  return () => { clearInterval(timer); window.removeEventListener('i18n:lang', message); };
}
