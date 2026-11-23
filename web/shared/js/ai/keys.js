// E30: aktywny klucz dostawcy dla czatu. Klucze dodaje się w Ustawieniach
// konta (decyzja 1), w sejfie szyfrowanym w przeglądarce hasłem do kluczy
// (decyzja 8, wzór: Makietka). Sejf i sekcja ustawień — krok „Klucze”
// w familijna-server/docs/czat-ai-plan.md; do tego czasu brak klucza.

/** Stan kluczy: "none" (brak), "locked" (sejf wymaga hasła na tym urządzeniu), "ready". */
export async function keyStatus() {
  return "none";
}

/** Aktywny klucz { provider, model, key } albo null. */
export async function activeKey() {
  return null;
}
