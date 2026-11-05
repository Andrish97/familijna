// control/display/js/qr.js
// Host/buzzer QR są NIEZALEŻNE (jeden LUB oba naraz, jak dzisiejszy
// display.html) — to jest czysty kontroler DOM, zero związku z systemem
// komend tekstowych, więc reużywamy dosłownie ten sam plik co dzisiejszy
// display.html zamiast pisać drugą kopię tej samej logiki.
export { createQRController } from "../../../shared/js/display/qr.js?v=v2026-11-05T01142";
