// tests/playwright.config.js
// @ts-check
const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./e2e",
  timeout: 90_000, // logowanie gościa (auth signup + seed demo) bywa wolne w CI
  retries: 0,
  use: {
    // Motyw Auto idzie za systemem; spece sprawdzają kolory ciemnego motywu.
    // Jasny motyw ma własny spec (theme.spec.js).
    colorScheme: "dark",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    baseURL: "https://www.familijna.app",
    screenshot: "only-on-failure",
    trace: "off", // celowo wyłączone — trace potrafi nagrać nagłówki żądań (patrz tests/README.md)
    // video to samo nagranie ekranu (bez sieci/nagłówków, w odróżnieniu od
    // trace) -- bezpieczne, włączone tylko dla failujących testów, żeby
    // zdiagnozować zawieszenia D&D w CI bez realnego podglądu (patrz
    // Runda 11, familijna-server/docs/plan-testy-i-poprawki.md)
    video: "retain-on-failure",
  },
  // Domyślnie (bez jawnego username) każdy test loguje się na to samo
  // test1@familiada.online — przy domyślnej równoległości dwa jednoczesne
  // logowania na jedno konto powodowały niedeterministyczne błędy (raz
  // zawieszony modal potwierdzenia, raz timeout samego logowania). To jest
  // wartość TYLKO dla lokalnego `npx playwright test` — w CI
  // (.github/workflows/e2e-tests.yml) każde wywołanie jawnie nadpisuje to
  // przez `--workers="$TEST_ACCOUNT_COUNT"`.
  workers: 1,
  reporter: [["list"]],
});
