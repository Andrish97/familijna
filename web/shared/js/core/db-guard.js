// js/core/db-guard.js
import { sb } from "./supabase.js?v=v2026-11-08T19282";

// Supabase/PostgREST UPDATE ... WHERE trafiający w 0 wierszy NIE zwraca
// błędu — to mechanizm stojący za "cichym sukcesem" przy edycji czegoś,
// co zostało usunięte w innym miejscu (ominięta blokada z resource-lock.js,
// albo zasób bez blokady w ogóle). updateChecked() wymusza .select() po
// update i rozpoznaje ten przypadek, rzucając błąd z kodem ROW_GONE
// zamiast fałszywie potwierdzać zapis.
export const ROW_GONE = "ROW_GONE";

export async function updateChecked(table, match, patch) {
  let q = sb().from(table).update(patch);
  for (const [col, val] of Object.entries(match)) {
    // supabase-js robi .eq(col, val) -> String(val) dla nie-prymitywów, czyli
    // dosłowne "[object Object]" zamiast JSON — dla kolumn jsonb (np. CAS na
    // games.settings w game-settings.js) to leci do PostgREST jako niepoprawny
    // JSON i całe zapytanie kończy się 400 (potwierdzone w e2e). Serializuj
    // ręcznie — PostgREST rzutuje string filtra na typ kolumny (jsonb), więc
    // porównanie wciąż jest po wartości, nie tekście.
    // NULL nie jest równy niczemu (`eq.null` nigdy nie trafia) — dopasowanie
    // pustej kolumny (np. settings nowej gry) wymaga `is null`.
    if (val === null || val === undefined) { q = q.is(col, null); continue; }
    const filterVal = typeof val === "object" ? JSON.stringify(val) : val;
    q = q.eq(col, filterVal);
  }
  const { data, error } = await q.select("id");
  if (error) throw error;
  if (!data || data.length === 0) {
    const e = new Error(`updateChecked: 0 rows matched in "${table}"`);
    e.code = ROW_GONE;
    throw e;
  }
  return data;
}

// Wariant zbiorczy dla operacji na wielu wierszach naraz (np. przenoszenie/
// reorder zaznaczenia w base-explorerze) -- gdzie updateChecked()'s pojedyncze
// .eq() nie pasuje, bo dopasowanie jest przez .in(idColumn, ids). Ten sam
// problem co przy pojedynczym wierszu: PostgREST po prostu pomija wiersze,
// które już nie istnieją, więc UPDATE "udaje się" nawet gdy część zaznaczenia
// zniknęła w międzyczasie gdzie indziej. Porównanie liczby zwróconych wierszy
// z liczbą żądanych id wykrywa ten częściowy, cichy brak skutku.
