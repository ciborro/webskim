# Sprint 2 — Lokalny fallback Mozilla Readability

**Status:** Draft
**Uwaga (2026-07-01):** wersje przenumerowane 1.6.x → 1.8.x — 1.6.0 zostało wydane wcześniej z innym zakresem, 1.7.0 to release poprawek z review.
**Source:** `webskim-feedback-2026-05-05.md` sekcja B1
**Estimate:** 3–5 dni
**Spec:** `docs/plans/2026-05-05-sprint2-spec.md`
**Dependency:** Sprint 1 wdrożony (`docs/plans/2026-05-05-sprint1-plan.md`)

## Cel

Spróbować wyciągnąć treść artykułu **lokalnie** (Mozilla Readability) zanim zapytamy Jinę. Dla ~70% URL-i (zwykłe artykuły, blogi) zapewnić **sub-300ms ścieżkę bez kosztu Jiny** i z deterministycznym, czystym outputem (bez chrome strony).

## Kontekst

Notatka feedbacku zauważa, że nawet po Sprincie 1 Jina zwraca dużo szumu, bo czyta cały DOM (1:1 konwersja `<img>` → `![]()`, breadcrumbs, related posts). Mozilla Readability — to silnik Firefox Reader View — działa wzorcowo dla artykułów/blogów: ekstrahuje tylko "main content".

Korzyści:
- **Latency:** ~200ms (fetch + parse) vs ~2-5s (Jina headless browser).
- **Koszt:** $0 vs koszt creditów Jiny.
- **Czystość:** algorytm dedykowany do extraction → minimalny chrome.
- **Brak rate-limitu** zewnętrznego.

Cena:
- Naive `fetch()` napotka antibot CDN (Cloudflare/Akamai) → fallback do Jiny.
- SPA bez SSR zwracają shell → fallback do Jiny.
- Część paywalled / login-walled stron → fallback do Jiny.

Dlatego B1 to **try-first**, nie zamiennik. Jina pozostaje dla SPA / antibot / login.

## Scope

- Nowy serwis `src/services/readability-extractor.ts`:
  - `tryExtract(url): Promise<ExtractedArticle | null>` — `null` gdy sygnał "nie ma sensu".
  - Wewnątrz: `fetch(url)` z 5s timeout + size limit, `parseHTML` z `linkedom`, `Readability.parse()` po sprawdzeniu `isProbablyReaderable`.
- Modyfikacja `src/tools/read.ts`:
  - Najpierw `readabilityExtractor.tryExtract(url)`.
  - Jeśli zwraca artykuł i jakość OK → ścieżka "lokalna".
  - W przeciwnym razie → istniejąca ścieżka Jiny.
- Nowe pole w odpowiedzi: `extracted_by: "readability" | "jina"` (informacja diagnostyczna dla agenta).
  - W `format: "json"`: pełnoprawne pole.
  - W markdown response (default i `inline:true`): jednolinijkowy footer `_Extracted by: readability_` (lub `jina`) na końcu odpowiedzi — żeby agent też mógł to zobaczyć.
- Opcjonalny `format: "json"` dla `webskim_read`:
  ```json
  {
    "title": "…",
    "byline": "…",
    "excerpt": "…",
    "content_md": "…",
    "length": 8214,
    "url": "…",
    "extracted_by": "readability"
  }
  ```
- Nowe dependencies: `@mozilla/readability`, `linkedom`, `turndown` (wszystkie MIT, ~200kB razem).
- Feature flag środowiskowy `WEBSKIM_READABILITY`:
  - **Pierwszy release (1.8.0): opt-in** — `WEBSKIM_READABILITY === "1"` aktywuje ścieżkę. Brak zmiennej / inna wartość → wszystko idzie do Jiny (zero ryzyka regresji).
  - **Po sanity benchmark + tygodniu obserwacji**: bumpa do 1.8.1 i zmiana semantyki na default-on (`WEBSKIM_READABILITY !== "0"`). Osobny PR.

## Poza scope

- **B2** highlights mode — osobny sprint, wymaga embeddingów lub TF-IDF.
- **B3** answer mode w search — wymaga LLM call po stronie webskim.
- C1/C2/C3.
- Cache HTML lokalnie — już mamy markdown cache w `.ai_pages` (zostaje bez zmian).
- Cookies / Set-Cookie / proxy headers — sprint 2 robi naive fetch; paywalle/login przechodzą do Jiny.

## Decyzje projektowe

1. **Readability JAKO PIERWSZA PRÓBA, nie jako fallback po Jinie.** Sens jest w cięciu kosztu i latency. Jeśli Readability ma sukces — Jina nie jest wołana.
2. **Sygnały do fallbacku na Jinę (po stronie `tryExtract`):**
   - Network error / timeout 5s na fetch.
   - HTTP status 4xx/5xx (poza 200).
   - `Content-Type` nie zaczyna się od `text/html` (pdf, json, etc.).
   - `Content-Length` > 5 MB (pre-check) **lub** `html.length` > 5 MB po pobraniu (post-check) — strony bez Content-Length nadal podlegają post-check po `await response.text()`. Streaming-abort z byte-counterem nie jest w scope (KISS).
   - URL kończy się na `.pdf` / `.zip` / `.docx` / `.xlsx` (early-skip — nie zaczynaj fetch).
   - `Readability.isProbablyReaderable()` zwraca `false`.
   - `Readability.parse()` zwraca `null`.
   - Ekstrahowana długość (`article.length`) < 500 znaków.

3. **Sygnały do fallbacku na Jinę (po stronie `handleRead`, semantyczne):**
   - Caller ustawił `target_selector` (chce konkretny element — Jina ma `X-Target-Selector`, Readability nie zna tego pojęcia).
   - Caller ustawił `remove_selector` (analogicznie).
   - Caller ustawił `max_tokens` (Readability nie tnie outputu — w Jinie mamy `X-Token-Budget`).
   - Caller ustawił `include_images: true` (Readability domyślnie usuwa ikony, nie ma fine-grained kontroli).
   - Caller ustawił `links` różny niż `'referenced'` (turndown w naszej konfiguracji robi `referenced` — `inline`/`discarded` wymaga przepięcia konfiguracji turndown'a; nie w scope Sprintu 2).

   Innymi słowy: Readability path to "happy path" dla domyślnych callerów. Każda jawnie ustawiona Jina-specific opcja → `extracted_by: "jina"`.
4. **`User-Agent` realistyczny.** Wiele serwisów zwraca 403 dla goło-fetchowych UA. Default: `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36` lub konfigurowalny.
5. **`format: "json"` jednolity wszędzie.** W `read`: pełna struktura artykułu (`title/byline/excerpt/content_md/length/url/extracted_by/file_path`). W `search` (z Sprintu 1): lista wyników. Obie formy spójne semantycznie — agent uczy się jednego wzorca.
6. **Markdown z Readability — `turndown`.** Readability daje `article.content` jako HTML. Konwertujemy przez `turndown` (battle-tested, ~5kB) z `linkStyle: "referenced"` żeby spójnie z Sprint 1 defaultami.
7. **Feature flag `WEBSKIM_READABILITY` opt-in w pierwszym release.** Patrz "Scope" wyżej. Domyślnie wszystko idzie do Jiny — Readability tylko dla użytkowników którzy aktywnie ustawią flagę. Po obserwacji w prod: osobny PR przerzuca semantykę na default-on.

## Kryteria sukcesu

- Test integracyjny: 5 cached URL-i (różne serwisy: tvn24, onet, blog Substack/Ghost, Wikipedia, oficjalna dokumentacja techniczna) — Readability dostaje ≥4/5 przypadków, Jina fallback dla pozostałych.
- p50 latency dla "happy path" (Readability success) — ≥3× szybciej względem dzisiejszego (mierzone lokalnie, nie w CI).
- `extracted_by` poprawnie sygnalizuje ścieżkę w 100% przypadków.
- Kiedy Readability success — output markdown ma <30% długości znakowej obecnego (mniej szumu).
- Existing API surface webskim_read niezmienione dla domyślnego callera (markdown response z file path + TOC).
- Bumpnięta wersja do `1.8.0`.

## Ryzyka

- **Readability na PL stronach.** Algorytm jest agnostyczny językowo, ale heurystyki "main content" mogą się mylić na nietypowych szablonach. **Mitygacja:** próg długości (>500 znaków) + fallback na Jinę.
- **`linkedom` ≠ Chromium DOM.** Niektóre sites z agresywnym JS mogą wymagać prawdziwego browsera. **Mitygacja:** `isProbablyReaderable` wcześnie odpada SPA bez SSR.
- **Antibot CDN-y (Cloudflare, Akamai, PerimeterX).** Naive fetch dostanie 403/503. To wprowadzi małą "podatkę latency" (5s timeout zanim fallback). **Mitygacja:** jeśli częste, w przyszłości HEAD pre-check albo szybszy timeout dla znanych domen.
- **Rozmiar HTML.** Strony newsowe z bundle'ami JS potrafią mieć 2 MB+ HTML. **Mitygacja:** limit 5 MB w dwóch warstwach: (1) `Content-Length` pre-check (gdy serwer wystawia), (2) `html.length` post-check po `await response.text()`. Streaming-abort z byte-counterem **nie jest w Sprincie 2** — gdyby okazało się że strony serwują wielo-MB shells bez Content-Length, dopiszemy w późniejszym sprincie.
- **Markdown converter z HTML.** Własna implementacja może rzeźbić edge-case'y. **Mitygacja:** zaczynamy od `turndown` (battle-tested, ~5kB) lub ograniczamy do podstawowych elementów; iterujemy jeśli output słaby.

## Sekwencja PR-ów

1. **PR-1:** dependencies + `readability-extractor.ts` w izolacji + jednostkowe testy z fixturami HTML (TVN/Onet/Wikipedia/blog/SPA shell).
2. **PR-2:** integracja w `read.ts` za feature-flagą env `WEBSKIM_READABILITY` (opt-in: `=== "1"` aktywuje ścieżkę).
3. **PR-3:** `format: "json"` dla `webskim_read` (zwraca strukturę zawsze, niezależnie od ścieżki ekstrakcji — `extracted_by` informuje który silnik użyty); `extracted_by` także w markdown footer.
4. **PR-4:** dokumentacja + bump 1.8.0.
5. **PR-5 (osobny, po obserwacji):** flip default na default-on (`WEBSKIM_READABILITY !== "0"`) + bump 1.8.1.

## Definition of Done

- [ ] Wszystkie taski ze speca zakończone.
- [ ] `npm test` zielone włącznie z fixturowymi testami HTML.
- [ ] `npm run build` bez błędów.
- [ ] README pokazuje nowe parametry (`format: json`) i wyjaśnia ścieżki ekstrakcji.
- [ ] Sanity benchmark (out of band): 5 URL-i, raport p50 latency + Readability hit rate.
- [ ] Wersja bump'nięta na `1.8.0` w `package.json` + `package-lock.json` (`src/index.ts` czyta wersję z `package.json` w runtime — nie wymaga edycji). Zaktualizować "Current" w sekcji Output Contract w README.
- [ ] Feature flag `WEBSKIM_READABILITY` udokumentowana (opt-in w 1.8.0; default-on w 1.8.1 po PR-5).
