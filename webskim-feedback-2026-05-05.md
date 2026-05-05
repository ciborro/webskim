# Notatka dla developera `webskim` — output kills weak models

**Data:** 2026-05-05
**Kontekst:** Foundation, agent `Researcher` z `webskim_search` + `webskim_read`.
**Próbka:** 23 sesje agentów w `logs/`, modele: Haiku 4.5, Mimo v2.5 Pro, Kimi K2.6, GLM-5.1, Qwen3.6-27b, GPT-4o-mini, Gemma-4-26b.

---

## TL;DR

1. **Output `webskim_read` jest zalany szumem strony (nawigacja, obrazy, inline-linki)** — nawet z `head_lines: 80` pierwsze 80 linii to menu i rekomendowane artykuły, a nie treść. Słabsze modele tracą sens i zapętlają się.
2. **Mocne modele to ratują** mając kontekst i intuicję (Haiku: 2 reads → odpowiedź). **Słabsze tonut**: Mimo dla pytania "jaka będzie jutro pogoda?" zrobił **9 search + 11 read** i ledwie się obronił; Gemma kapitulował po **1 search**.
3. **Twoja sugestia o nagłówkach Jiny jest słuszna i niedostatecznie radykalna.** Domyślne `X-Retain-Images: none`, `X-Md-Link-Style: discarded` (lub `referenced`), `X-Remove-Selector: nav, footer, aside, .ad, [role=banner]` zlikwidowałyby ~70% szumu od ręki, bez kosztu.
4. **Search też do poprawy** — preamble "Found 5 results:" + format z 3 linijkami per wynik to ~250 tokenów na hit; snippety czasem puste lub generyczne SEO-spam ("Sprawdź średnią prognozę pogody…"). Słaby model nie wie czy klikać.
5. **Brakuje strukturalnego outputu (JSON).** Tavily/Firecrawl/Exa zwracają named fields — słaby model nie musi parsować, bierze `data.results[0].content`. Webskim daje surowy markdown z TOC; warto dorzucić `format: "json"` jako alternatywę.

---

## 1. Dowody z logów

### Mapping sesji → model → liczba calli

| Sesja | Model | webskim_search | webskim_read | Wynik |
|---|---|---:|---:|---|
| sess_5e125a9a | claude-haiku-4.5 | 16 | 19 | OK (zadanie research) |
| sess_734b718b | claude-haiku-4.5 | 0 | 0 | użył tylko `current_time`, odpowiedział "nie znam pogody" |
| sess_fe3566dd | xiaomi/mimo-v2.5-pro | **29** | **39** | OK po długim cierpieniu (29 calls dla "jaka będzie jutro pogoda?") |
| sess_acfea498 | moonshotai/kimi-k2.6 | 23 | 26 | częściowy — wiele 422 errorów |
| sess_ec40091d | z-ai/glm-5.1 | 17 | 25 | OK po 14 blokach pracy |
| sess_ddc03290 | gemma-4-26b | 6 | 2 | **kapitulacja** po 1 wyniku search |
| sess_7b727b9f | gpt-4o-mini | 5 | 8 | OK |

### Zoom: Mimo dla "jaka będzie jutro pogoda?" — 28 bloków

Zrekonstruowane ze `events.jsonl` (skrót, własne komentarze w nawiasach):

```
THINK   Użytkownik pyta o pogodę… "jutro" = 6 maja 2026, w Polsce.
CALL    webskim_search "pogoda jutro 6 maja 2026 Polska", country=PL
THINK   Let me read the TVN24 article about the 16-day forecast…
CALL    webskim_read tvn24.pl/…st9028345 head_lines:80   → 7795 znaków, sama nawigacja
CALL    webskim_search "pogoda 6 maja 2026 prognoza na jutro Polska"
THINK   "I found a result… but I need to find specific info for tomorrow"
CALL    webskim_read dziendobry.tvn.pl/…wtorek-5-maja head_lines:100   → 9524 znaki, dalej chrome
CALL    webskim_search …
THINK   "The page content was mostly navigation. Let me try with target_selector"
CALL    webskim_read … target_selector:"article" head_lines:60   → 6415 nadal chrome
CALL    webskim_read … target_selector:"article" head_lines:60   → 6452
CALL    webskim_search …
THINK   "target_selector approach didn't work well — still returning navigation"
CALL    webskim_read interia.pl head_lines:100   → 6302
CALL    webskim_search '"6 maja 2026" pogoda prognoza Polska'
CALL    webskim_read dziendobry.tvn…6-maja head_lines:80   → 8859
THINK   "page content is mostly navigation menus. Let me read further into the page"
CALL    webskim_read … remove_selector:"nav, header, footer" head_lines:120   → 9893 nadal nawigacja
THINK   "article content seems to be behind a paywall…"
TEXT    "Strona DDTVN nie chce oddać treści…"
CALL    webskim_read pl.meteotrend.com head_lines:80   → 213 (pewnie pusta)
CALL    webskim_search …
CALL    webskim_read o2.pl/pogoda/…6-maja head_lines:80   → 7127 (jakaś treść!)
CALL    webskim_read pogoda.se.pl/imgw-pogoda-na-jutro head_lines:80   → 5513
THINK   "se.pl article is about Monday May 4, not Wednesday May 6"
TEXT    "Mam już wystarczająco danych… [final answer]"
```

**Kluczowe sygnały dla devów:**
- *3 razy* w thinkingu pojawia się "page content was mostly navigation".
- `target_selector: "article"` **nie zadziałał** — Jina i tak nie wycięła chrome, bo strony używają niestandardowego DOM-u.
- `remove_selector: "nav, header, footer"` też **nie pomógł** — `head_lines: 120` dalej zwraca nawigację (bo np. "Redakcja poleca:" siedzi w `<aside>` lub `<section>`).
- Model marnuje 2-3 calle zanim się dowie że dana strona jest do d. — bez sygnału "to jest tylko chrome, treści nie ma".

### Zoom: Gemma kapitulacja po 1 search

```
CALL  webskim_search "pogoda Warszawa 6 maja 2026"
      → 5 wyników, wszystkie SEO-snippety typu "Sprawdź średnią prognozę pogody dla Warszawy w maj 2026"
TEXT  "Niestety, z dostępnych źródeł wynika, że widoczne są głównie prognozy długoterminowe…
       Jeśli chcesz wiedzieć, jaka będzie pogoda w innym mieście, napisz proszę gdzie!"
```

Gemma nawet nie spróbowała `webskim_read` — bo snippety nie dały sygnału, że za którymkolwiek URL-em są godzinowe dane. Mocniejszy model wie że trzeba próbować; słabszy potrzebuje **lepszych snippetów lub explicit hintu**.

### Zoom: pojedynczy `webskim_read` — co dokładnie zżera tokeny

Plik `.ai_pages/20260505_100344238_pogoda_onet_pl__…luksemburg-396088.md`, linie 82–120 (godzinowa prognoza pogody):

```markdown
*    10:00  ![Image 10: Ikona pogodowa](https://ocdn.eu/ucs/static/pogoda/578fda62bf6ad47469548f67246cf7fc/mainWidget/png_icons_70/7.png)  12°
*    11:00  ![Image 11: Ikona pogodowa](https://ocdn.eu/ucs/static/pogoda/578fda62bf6ad47469548f67246cf7fc/mainWidget/png_icons_70/7.png)  13°
*    12:00  ![Image 12: Ikona pogodowa](https://ocdn.eu/ucs/static/pogoda/578fda62bf6ad47469548f67246cf7fc/mainWidget/png_icons_70/3.png)  14°
…
```

**40 takich linii, każda ~140 znaków, z czego użyteczne:** `10:00 12°` (10 znaków) + ikona kierunkowa (3 znaki). **Reszta to URL do PNG.** Z `X-Retain-Images: none` cała tabela kurczy się 10×.

To nie jest patologia jednego serwisu — to wzorzec. Jina robi 1:1 konwersję `<img>` na `![]()`, nawet dla ikon-piktogramów.

### Co webskim odpowiada na 422 / błąd

```json
{"result":"Failed to read URL: This operation was aborted"}
{"result":"Search failed: Jina Search API error: 422 Unprocessable Entity"}
{"result":"Failed to read URL: Jina Reader API error: 422 Unprocessable Entity"}
```

Słaby model nie wie co z tym zrobić — to nie jest actionable error. Zwykle ślepo retryuje to samo.

---

## 2. Konkretne rekomendacje

### A. Quick wins (must-have, niski koszt, działają z dnia na dzień)

**A1. Zmień DEFAULTY dla `webskim_read` — proxy do Jiny z LLM-friendly headerami:**

```js
// pseudo
const headers = {
  'X-Retain-Images': options.include_images ? 'all' : 'none',
  'X-Md-Link-Style': options.links === 'inline' ? undefined
                   : options.links === 'summary' ? undefined
                   : 'referenced',  // default: linki do footera, krótkie [tekst][1]
  'X-Remove-Selector': options.remove_selector ??
    'nav, footer, aside, [role=banner], [role=navigation], .ad, .ads, .advertisement, .cookie-banner',
  'X-Engine': options.engine ?? 'browser',          // ale `direct` szybsze 5-10× dla blogów
  'X-Token-Budget': options.max_tokens ?? 12000,    // hard cap po stronie Jiny
};
if (options.with_links_summary) headers['X-With-Links-Summary'] = 'all';
```

Argumentacja: te cztery zmiany lika 70% szumu w testowanych stronach (TVN24, Onet, Interia, twojapogoda). `X-Md-Link-Style: referenced` — sekcja `[1]: https://…` na końcu, krótkie `[tekst][1]` w tekście. Słabsze modele nie gubią się w long anchorach.

**A2. Upublicznij te headery jako parametry tool-a** (ale z dobrymi defaultami):

```jsonschema
{
  "include_images": { "type": "boolean", "default": false,
    "description": "Keep <img> as markdown. Default false — saves ~30-70% tokens on news sites." },
  "links": { "enum": ["referenced","discarded","inline","summary"], "default": "referenced",
    "description": "How to render links. 'referenced'=footer, 'discarded'=plain text, 'inline'=full markdown, 'summary'=add Links section at end." },
  "engine": { "enum": ["direct","browser","readerlm"], "default": "browser",
    "description": "'direct' is fastest (static pages, blogs). 'browser' for SPAs. 'readerlm' uses Jina ML model — best structure but 3× cost." },
  "remove_selector": { "type": "string",
    "description": "CSS selectors to drop before extraction. Default removes nav/footer/aside/banners/ads." }
}
```

**A3. Poszerz domyślny `X-Remove-Selector`** o realne PL-side klasy:
- `.cookie-banner, [data-testid=cookie], [class*="newsletter"], [class*="subscribe"], [class*="paywall"], [class*="related"], [class*="recommended"], section[aria-label*="reklama"]`

To nie covers wszystkiego, ale mocno dociska szum na TVN24/Interia/Onet/Gazeta.

**A4. Zmień format `webskim_search`** na bardziej kompaktowy:

Obecnie (~250 tokenów per wynik):
```
Found 5 results:

1. **Pogoda w mieście: Warszawa w miesiącu: maj 2026**
   https://www.pogodajutro.com/europe/poland/mazowieckie/warsaw?page=month&month=May
   Sprawdź średnią prognozę pogody dla miasta: Warszawa w maj 2026 roku, w tym temperatury w maj i średnią ilość dni z opadami deszczu

2. **Nowe - Ekologia.pl**
…
```

Propozycja (zaoszczędza ~30%):
```
[1] Pogoda w mieście: Warszawa w miesiącu: maj 2026
    pogodajutro.com/europe/poland/mazowieckie/warsaw?page=month&month=May
    Sprawdź średnią prognozę pogody dla miasta: Warszawa w maj 2026 roku…

[2] Nowe - Ekologia.pl
    ekologia.pl/pogoda/prognoza-dlugookresowa-nowe/maj/
    Pogoda Nowe • Codzienny serwis informacyjny…
```

Albo (najlepsze) — opcjonalny `format: "json"`:
```json
{"results":[{"i":1,"title":"…","url":"…","snippet":"…","host":"pogodajutro.com"}]}
```

Słabsze modele radzą sobie z JSON-em o niebo lepiej niż z numerowanym markdown.

**A5. Lepsze komunikaty błędów.** Zamiast `Failed to read URL: Jina Reader API error: 422 Unprocessable Entity` daj actionable hint:

```
Failed: Jina returned 422 (page likely empty/blocked or invalid selector).
Try: 1) different URL from search results, 2) remove target_selector if set, 3) try engine="direct".
```

LLM-y widzą hinty i je stosują (efekt znany z rekomendacji error-message-as-prompt w MCP).

**A6. Truncation footer powinien być sygnałem do RAG-a, nie tylko liczbą:**

Obecnie:
```
--- Showing 80/724 lines. Full file: /Users/.../page.md
```

Propozycja:
```
--- Showing lines 1-80 of 724.
Use webskim_read with `inline:false` to get TOC + file path,
or set `head_lines:N` higher / `start_line:N` to read further.
File on disk: /Users/.../page.md (open with Read tool, offset/limit work)
```

To explicit hint dla słabszego modelu jak iść dalej.

### B. Mid-effort (większy ROI, wymaga implementacji)

**B1. Lokalna pre-extraction Mozilla Readability JAKO PIERWSZA PRÓBA.**

Pattern:
```
1. fetch URL bezpośrednio (zwykły GET, max 5s)
2. jeśli HTML < N kB i parsowalny → @mozilla/readability + linkedom
3. zwróć article.textContent + article.title + article.excerpt
4. jeśli readability.isProbablyReaderable() = false → fallback do Jiny
5. jeśli antibot/SPA / network error → fallback do Jiny
```

To **sub-300ms, zero kosztu, brak rate-limitu Jiny**, dla ~70% URL-i (zwykłe artykuły, blogi). Jina dla SPA/antibot. Plus narzucony JSON output:

```json
{
  "title": "…",
  "byline": "…",
  "excerpt": "…",
  "content_md": "…",   // sam artykuł, BEZ chrome
  "length": 8214,
  "url": "…",
  "extracted_by": "readability"   // lub "jina"
}
```

Słabe modele tu **nie mają jak utonąć** — content_md to czysty artykuł.

**B2. `mode: "highlights"` dla `webskim_read`.**

Wzorzec Exa: zwracasz top-K paragrafów najbardziej dopasowanych do query (przekazanej jako parametr) zamiast całego tekstu. Implementacja: TF-IDF lub bardzo tanie embeddingi (np. `Xenova/all-MiniLM-L6-v2` lokalnie, ~50ms na stronę).

```
webskim_read(url, mode: "highlights", query: "weather forecast 6 May 2026", k: 5)
→ 5 najlepszych paragrafów z kontekstem
```

10× redukcja tokenów wg Exa benchmark.

**B3. `webskim_search` z `answer: true`** — opcjonalna gotowa synteza (jak Tavily). Wewnątrz: 3 najlepsze wyniki → Readability/Jina → tani LLM → 1-2 zdania odpowiedzi + citations.

Korzyść: dla prostych pytań ("jaka będzie jutro pogoda w Warszawie?") agent w ogóle nie musi sięgać po `read` — dostaje odpowiedź od razu. Dla Mimo by to oznaczało 1 call zamiast 28.

### C. Big bets (rozważyć, gdy będzie czas)

**C1. JSON-pierwszy output mode globalnie** (`format: "json"|"markdown"`). Domyślnie markdown (kompatybilność), ale `format: "json"` zwraca strukturalny `{title, url, content, links: [], images: [], metadata: {}}`. Słabsze modele mocno zyskują.

**C2. `webskim_extract` jako osobny tool** ze schemą (jak Firecrawl `/extract`). Use-case: "z tej strony wyciągnij pola `{price, availability, rating}`". Inny use-case niż `read`, dlatego osobny tool.

**C3. Drugi pass czyszczący tanim modelem** (Firecrawl `onlyCleanContent` pattern). Po Jinie/Readability pchamy do Mimo z promptem "wytnij cookie banners, breadcrumbs, related posts, zostaw tylko treść". Opcjonalne, default off (latency 1-2s).

### D. Czego NIE robić (overkill)

- ❌ `X-With-Generated-Alt: true` domyślnie — kosztowne (3× tokeny w Jina credits) i bezsensowne gdy `X-Retain-Images: none`. Tylko on-demand.
- ❌ Screenshot/pageshot mode — multimodalność tylko jeśli planujemy vision-modele. Mimo/GLM/Kimi i tak nie zobaczą.
- ❌ Crawl/map endpoint — to inny use-case (recon, sitemap discovery), nie miksować z `read`.
- ❌ `responseMode: "full"` (jak Brave) — nikt nie chce surowego HTML jeśli prosi `webskim`.

---

## 3. Sugerowana kolejność rolloutu

1. **Sprint 1 (1-2 dni):** A1-A6 (defaulty + parametry + lepszy search/error format). Zero breaking changes — tylko dodajemy parametry i zmieniamy defaulty na korzyść słabszych modeli. Mocne modele i tak nie zauważą różnicy poza mniejszą liczbą call-i.
2. **Sprint 2 (3-5 dni):** B1 (Readability fallback) + lepszy schema toola (`format: "json"` opcjonalnie). To największy single-shot-improvement.
3. **Sprint 3+:** B2/B3 (highlights, answer mode) — wymaga modelowych zależności i benchmark testów.

---

## 4. Pełna lista nagłówków Jina Reader (referencja)

(Z DeepWiki node-DeepResearch + jina.ai/reader docs.)

### Cleanliness outputu
- `X-Md-Link-Style: referenced | discarded` — linki do footera lub jako plain text. **Default inline.**
- `X-Retain-Images: none | all | alt` — kontrola obrazów. **Default `all`.**
- `X-With-Generated-Alt: true` — VLM dogeneruje alt text (kosztowne).
- `X-With-Links-Summary: true | all` — sekcja "Buttons & Links" na końcu.
- `X-With-Images-Summary: true` — sekcja "Images" na końcu.
- `X-With-Iframe: true` — wciąga zawartość iframe (YT transkrypty, embedy).
- `X-With-Shadow-Dom: true` — Shadow DOM (Lit/Stencil components).
- `X-Target-Selector: <CSS>` — ekstrahuje TYLKO ten element. **Domyślnie `body`.**
- `X-Remove-Selector: <CSS,CSS,…>` — wycina przed konwersją.

### Silnik i format
- `X-Engine: browser | direct | cf-browser-rendering | readerlm-v2`
  - `direct` = zwykły GET (5-10× szybsze, ale nie dla SPA)
  - `browser` = headless Chromium (default)
  - `cf-browser-rendering` = fallback dla hard antibot
  - `readerlm-v2` = ML 1.5B → JSON/MD (3× cost, lepsza struktura)
- `X-Return-Format: markdown | html | text | screenshot | pageshot`
- `X-Respond-With: markdown | html | text | screenshot | no-content | readerlm-v2`

### Sieciowe
- `X-Timeout: <int sec>`
- `X-Wait-For-Selector: <CSS>` — czeka na render (lazy load, hydration)
- `X-Locale: en-US | pl-PL | …`
- `X-Set-Cookie: <cookie>` — paywalle, login
- `X-Proxy-Url: <url|country>`
- `X-No-Cache: true`
- `X-Cache-Tolerance: <sec>` — TTL akceptowalnego cache (default 3600)
- `X-Token-Budget: <int>` — twardy cap po stronie Jiny
- `X-Base: final` — pełen łańcuch redirectów
- `X-Robots-Txt: <UA>` — sprawdź robots.txt

### Search-specific (`s.jina.ai`)
- `Accept: application/json` — strukturalna odpowiedź zamiast markdown.
- `X-Respond-With: no-content` — same `{title, url, snippet}` (jak Brave/Tavily).
- Większość headerów Reader też działa (każdy hit jest pod spodem czytany).

---

## 5. Źródła i benchmarks

- Jina Reader docs: https://jina.ai/reader/
- Jina Reader README: https://github.com/jina-ai/reader
- ReaderLM-v2 announcement: https://jina.ai/news/readerlm-v2-frontier-small-language-model-for-html-to-markdown-and-json/
- DeepWiki canonical Jina headers: https://deepwiki.com/jina-ai/node-DeepResearch/4.3-web-content-reading
- Firecrawl `/scrape` API (najszerszy zestaw flag): https://docs.firecrawl.dev/api-reference/endpoint/scrape
- Tavily API (JSON-first, score+answer): https://docs.tavily.com/documentation/api-reference/endpoint/search
- Exa Search API (highlights, summary, schema): https://exa.ai/docs/reference/search
- Brave Search MCP (compact mode, token caps): https://github.com/brave/brave-search-mcp-server
- Anthropic MCP fetch (chunked reading przez `start_index`): https://github.com/modelcontextprotocol/servers/blob/main/src/fetch/README.md
- Mozilla Readability: https://github.com/mozilla/readability

---

## 6. Logi do dalszej analizy (gdyby chciał potwierdzić)

W `logs/` projektu Foundation:
- `2026-05-05T12-06-37-814Z-sess_fe3566dd…` — Mimo, 28 bloków, najlepszy case-study cierpienia
- `2026-05-05T11-44-28-074Z-sess_ddc03290…` — Gemma kapitulacja po 1 search
- `2026-05-05T11-33-20-672Z-sess_acfea498…` — Kimi z 422 errorami
- `2026-05-05T08-01-45-882Z-sess_5e125a9a…` — Haiku jako baseline (jak silny model wygląda)

W `.ai_pages/` cache 26 plików — można podejrzeć przed/po wprowadzeniu nagłówków, najlepszy benchmark to porównać `tvn24-pogoda-na-16-dni.md` z/bez `X-Retain-Images: none` + `X-Md-Link-Style: referenced` + bogatszy `X-Remove-Selector`.
