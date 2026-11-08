# Czcionki dołączone do serwisu i ich licencje

Jedno miejsce na wszystkie pliki czcionek: `web/shared/fonts/` (motywy wskazują
plik po nazwie — `host.fonts[].file`, lista `SHARED_FONT_FILES` w
`shared/js/display/theme-file.js`).

Wszystkie są na wolnych licencjach (SIL Open Font License 1.1 albo Apache 2.0),
które pozwalają je dołączać i rozpowszechniać razem z serwisem pod warunkiem
dołączenia tekstu licencji — teksty leżą obok plików.

| Gdzie | Czcionka | Plik | Licencja |
|---|---|---|---|
| Edytor rysunku logo (30 krojów) | lista w `shared/js/core/draw-fonts.js` | `*.woff2` | `licenses/<plik>.txt` (OFL 1.1; Roboto Slab — Apache 2.0) |
| Ekran prowadzącego — logo tekstowe „Źródło” | Unbounded | `unbounded.woff2` | `licenses/unbounded.txt` (OFL 1.1) |
| Ekran prowadzącego — „papier”, motyw Klasyczny | Caveat (motyw wskazuje plik: `host.fonts[].file`) | `caveat.woff2` | `licenses/caveat.txt` (OFL 1.1) |
| Ekran prowadzącego — „papier”, motywy Bridge, Modern, Radar, Ribbon, Wings | JetBrains Mono (`host.fonts[].file`) | `jetbrainsmono.woff2` | `licenses/jetbrainsmono.txt` (OFL 1.1) |
| Ekran prowadzącego — „papier”, motyw Kaseton (Cabinet) | Merriweather (`host.fonts[].file`) | `merriweather.woff2` | `licenses/merriweather.txt` (OFL 1.1) |
| Wyświetlacz | kroje kropkowe 5×7, 3×10, okna | `display/*.json` | własne serwisu |

Interfejs używa czcionki systemowej urządzenia.
