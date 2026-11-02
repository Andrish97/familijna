import { qrDataUrl } from "../core/qr-code.js?v=v2026-11-02T16570";

// QR generowany lokalnie i od razu (SVG w data:), bez zewnętrznego API:
// wcześniej przez chwilę widać było samą białą ramkę <img>. Cichą strefę
// daje biały padding .qr-img, w SVG tylko 1 moduł zapasu.
const mkQR = (url) => qrDataUrl(url, { margin: 1 });

export const createQRController = ({ qrScreen, gameScreen, hostCard, buzzerCard, hostImg, buzzerImg, hostCodeEl, buzzerCodeEl }) => {
  let hostUrl = "";
  let buzzerUrl = "";

  const setHost = (url) => {
    hostUrl = (url ?? "").toString();
    if (hostUrl) hostImg.src = mkQR(hostUrl);
    else if (hostImg) hostImg.removeAttribute("src");
  };

  const setBuzzer = (url) => {
    buzzerUrl = (url ?? "").toString();
    if (buzzerUrl) buzzerImg.src = mkQR(buzzerUrl);
    else if (buzzerImg) buzzerImg.removeAttribute("src");
  };

  const setHostCode = (code) => {
    if (hostCodeEl) hostCodeEl.textContent = code ?? "";
  };

  const setBuzzerCode = (code) => {
    if (buzzerCodeEl) buzzerCodeEl.textContent = code ?? "";
  };

  const setSingle = (single) => {
    const grid = qrScreen?.querySelector(".qr-grid");
    if (!grid) return;
    grid.classList.toggle("qr-single", !!single);
    if (hostCard)   hostCard.classList.toggle("hidden",  single && !hostUrl);
    if (buzzerCard) buzzerCard.classList.toggle("hidden", single && !buzzerUrl);
  };

  const show = () => {
    qrScreen.classList.remove("hidden");
    qrScreen.setAttribute("aria-hidden", "false");
    gameScreen.classList.add("hidden");
  };

  const hide = () => {
    qrScreen.classList.add("hidden");
    qrScreen.setAttribute("aria-hidden", "true");
    gameScreen.classList.remove("hidden");
  };

  return { setHost, setBuzzer, setHostCode, setBuzzerCode, setSingle, show, hide, get: () => ({ hostUrl, buzzerUrl }) };
};
