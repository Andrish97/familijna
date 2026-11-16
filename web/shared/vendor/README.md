# Biblioteki zewnętrzne serwowane z własnej domeny

Przypięte wersje, bez CDN (decyzja użytkownika 2026-10-23): strona nie zależy
od dostępności jsDelivr, a nowa wersja biblioteki trafia na produkcję tylko
świadomie, razem z testami.

| Plik | Pakiet npm | Wersja | Licencja | Skąd |
|---|---|---|---|---|
| `supabase-js.js` | `@supabase/supabase-js` | 2.119.0 | MIT | `dist/umd/supabase.js` |
| `fabric.min.js` | `fabric` | 7.4.0 | MIT | `dist/index.min.js` |
| `jsQR.min.js` | `jsqr` | 1.4.0 | Apache-2.0 | `dist/jsQR.js`, zminifikowany esbuild |

Aktualizacja: manifest `vendor.json` (tu i w tabeli te same wersje). Co
tydzień workflow `.github/workflows/vendor-updates.yml` uruchamia
`scripts/vendor-update.mjs`: nowsza wersja w tej samej głównej serii trafia na
gałąź `vendor-update/…` z podmienionym plikiem, testami e2e stron, które jej
używają (`specs` w manifeście), i pull requestem do scalenia. Nowa główna seria
(np. fabric 6) jest tylko zgłaszana — wymaga zmian w kodzie stron. Ręcznie:
`node scripts/vendor-update.mjs` (albo `--check`). `scripts/version-assets.js`
nie skanuje tego katalogu (kod bibliotek), ale odwołania do plików dostają
`?v=` jak reszta.
