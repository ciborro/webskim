# Sprint 1 — LLM-friendly defaults & DX

**Status:** Draft
**Source:** `webskim-feedback-2026-05-05.md` sekcje A1, A2, A4–A6 (A3 — rozszerzony `X-Remove-Selector` — zwija się w A1)
**Estimate:** 1–2 dni
**Spec:** `docs/plans/2026-05-05-sprint1-spec.md`
**Supersedes:** `docs/plans/2026-04-21-phase-2-reader-parity.md` (nigdy nie wdrożony)

## Cel

Zmniejszyć szum tokenowy w odpowiedziach `webskim_read` i poprawić user-experience dla słabszych modeli (Mimo, GLM, Gemma) **bez breaking changes** dla istniejących wywołań.

## Kontekst

Logi 23 sesji w projekcie Foundation pokazują, że:

- `webskim_read` zwraca 70%+ szumu (nawigacja, ikony PNG, inline-linki) — słabe modele tracą kontekst i zapętlają się (Mimo: 28 bloków na "jaka będzie jutro pogoda?", Gemma: kapitulacja po 1 search).
- `webskim_search` ma rozwlekły format (~250 tokenów per wynik) i brak strukturalnego wyjścia.
- Błędy 422 z Jiny nie są actionable — modele ślepo retryują to samo.

Aktualnie `src/services/jina-client.ts` używa **tylko 3 nagłówków Jiny** (`X-Target-Selector`, `X-Remove-Selector`, `X-Token-Budget`) z dostępnych ~25. Domyślne ustawienia Jiny zwracają obrazy + inline linki — to spore źródło szumu.

## Scope

| ID | Zmiana | Pliki |
|----|--------|-------|
| A1 (+ A3) | Defaulty Jiny: `X-Retain-Images: none`, `X-Md-Link-Style: referenced`, rozszerzony `X-Remove-Selector`. A3 (lista PL-side klas) zwinięta w to samo `DEFAULT_REMOVE_SELECTOR`. | `src/services/jina-client.ts` |
| A2 | Parametry `webskim_read`: `include_images`, `links` | `src/tools/read.ts`, `src/services/jina-client.ts` |
| A4 | Kompaktowy format `webskim_search` + opcjonalny `format: "json"` | `src/tools/search.ts` |
| A5 | Actionable error messages (mapping HTTP status → hint) — zarówno `readerErrorMessage` jak i `searchErrorMessage` | `src/services/jina-client.ts` |
| A6 | Truncation footer z hintami "co dalej" | `src/tools/read.ts` |

## Poza scope (Sprint 2 lub później)

- **B1** — Mozilla Readability lokalny fallback (Sprint 2).
- **B2** — `mode: "highlights"` (wymaga embeddingów / TF-IDF).
- **B3** — `answer: true` w search (wymaga LLM call po stronie webskim).
- `engine` parameter (`X-Engine: direct|browser|readerlm-v2`) — odraczamy do czasu benchmarka. Dla obecnych pain points (TVN/Onet/Interia, JS-rendered) `direct` nie pomoże, `browser` (default Jiny) jest właściwy.
- C1 globalny JSON output dla `read`, C2 `webskim_extract`, C3 cleanup pass.

## Decyzje projektowe

1. **Brak `engine` w Sprint 1.** Bez benchmarka nie zmieniamy defaultu. Domyślny `browser` Jiny działa dla SPA.
2. **`links: 'referenced'` jako default mimo lekkiej zmiany w semantyce odpowiedzi.** Ryzyko że ktoś parsuje inline linki — minimalne; opt-out przez `links: 'inline'`.
3. **Rozszerzony `X-Remove-Selector` ostrożny.** Notatka feedbacku proponowała `[class*="related"]` i `[class*="recommended"]` — zostawiamy je, ale callerzy mogą nadpisać przez parametr `remove_selector` (parametr już istnieje). Escape hatch: `remove_selector: ""` (pusty string) **wyłącza domyślny selector** i nie wysyła headera `X-Remove-Selector` do Jiny. Wartość non-empty zastępuje default.
4. **`format: "json"` w search opcjonalny, default `markdown`.** Brak breaking change; słabe modele mogą jawnie poprosić o JSON.
5. **Bez `format: json` w `webskim_read` w Sprint 1.** Tę zmianę ciągniemy razem z B1 (Readability) w Sprincie 2 — wtedy ma sens spójna struktura `{title, byline, excerpt, content_md, ...}`.

## Kryteria sukcesu

- `npm test` zielone (włącznie z nowymi testami).
- Nowe testy pokrywają: domyślne nagłówki w fetch, `include_images: true` (X-Retain-Images: all), warianty `links`, JSON format dla search, kształt error-message'a, format truncation footera.
- Sanity check na 1-2 świeżych URL-ach (out of band, nie w CI): tokeny wyjściowe ≥30% mniej niż przed zmianami.
- README zaktualizowany o nowe parametry.
- Wersja bumpnięta do `1.5.0`.

## Ryzyka

- **`links: 'referenced'` zmienia kształt odpowiedzi.** Mitygacja: parametr opt-out + zmiana udokumentowana w README/CHANGELOG.
- **Rozszerzony default-remove-selector trafia false-positive na niszowych stronach** (np. artykuł literalnie o "related searches"). Mitygacja: callerzy przekazują własny `remove_selector` (nadpisuje default).
- **Mocne modele zauważą krótszy output i mogą się zorientować mniej intuicyjnie jeśli zaufały starym pełnym dumpom.** Niskie ryzyko, ale warto śledzić sesje po wdrożeniu.

## Sekwencja PR-ów

Pojedynczy PR (zmiany powiązane semantycznie, testy współdzielą setup).

Alternatywnie iteracyjnie:

1. PR-1: A1 + A2 (defaulty + parametry `read`) — najwięcej testów, największe ryzyko regresji.
2. PR-2: A4 (search format).
3. PR-3: A5 + A6 (error hints + footer).

## Definition of Done

- [ ] Wszystkie taski ze speca zakończone.
- [ ] `npm test` zielone.
- [ ] `npm run build` bez błędów.
- [ ] README pokazuje wszystkie nowe parametry.
- [ ] CHANGELOG (lub commit message) wymienia zmiany defaulty (`links: referenced`, no images, default remove-selector).
- [ ] Wersja bump'nięta na `1.5.0` w **trzech miejscach**: `package.json`, `package-lock.json` (auto przez `npm install --package-lock-only`), `src/index.ts` (hardcoded w `new McpServer({ name, version })`).
