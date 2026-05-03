# Phase 1 — MCP tool description redesign

**Status:** Pending
**Target release:** 1.3.2 (wraz z końcówką Phase 0)
**Dependencies:** żadne
**Estimate:** 1–2h + 30 min na eval

## Summary

Redesign opisów `webskim_search` i `webskim_read` żeby Claude konsekwentnie wybierał je zamiast `WebSearch` / `WebFetch`. Problem: obecne opisy używają słabego słowa „preferred" i brakuje im trigger phrases. Rozwiązanie: explicit „USE INSTEAD OF X for: ..." + lista konkretnych use cases + anti-description.

## Analiza przyczyn

Zweryfikowane na [Anthropic: Writing tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents):

1. **„Preferred" ≠ „use instead of".** Obecny opis: *„Preferred over built-in search — minimal token usage."* Słowo „preferred" sugeruje opcjonalność. Anthropic guidance: opisy mają być jednoznaczne co do trigger conditions.
2. **Brak trigger phrases.** Dobry opis mówi *kiedy* użyć (np. „use when user asks about a library, fetching API docs, any URL"). Obecny mówi tylko *co* narzędzie robi.
3. **Brak anti-description.** Nie mówimy, kiedy webskim *nie* jest odpowiedni (lokalne pliki, git, SSH) — agent zgaduje.
4. **Training-set bias.** `WebSearch`/`WebFetch` są built-in Claude Code, wysoki priorytet systemowy. MCP tools ładowane dynamicznie, „default" signal niższy.
5. **CLAUDE.md drift w długich sesjach.** CLAUDE.md trafia do kontekstu na starcie, ale po compactingu może zostać zastąpiony streszczeniem. Tool description jest w system prompcie na stałe.
6. **Subagenty nie dziedziczą CLAUDE.md.** Gdy dispatchujemy subagenta, startuje on z własnym promptem. Tool definitions są przekazywane, ale CLAUDE.md projektu — nie. (Stąd w promptach researchowych w tej sesji explicit „używaj mcp__webskim__..." — i to zadziałało.)
7. **Commit [83e37e7](https://github.com/local/webskim/commit/83e37e7) skrócił opisy dla oszczędności tokenów.** Trade-off poszedł w złą stronę dla routing accuracy.

## Propozycja redesignu

### `webskim_search`

**Obecnie (~25 tokenów):**
> Web search → compact results (title, URL, snippet). Preferred over built-in search — minimal token usage. Follow up with webskim_read to fetch full pages.

**Proponowane (~60 tokenów):**
> Web search for ANY query requiring external information. USE INSTEAD OF WebSearch for: library docs, API references, current events, research, fact-checking, version lookups. Returns compact snippets (title/URL/description), ~5x fewer tokens than WebSearch. Always chain with webskim_read when you need page content. Skip only if webskim errors or returns empty; then fall back to WebSearch.

### `webskim_read`

**Obecnie (~40 tokenów):**
> Fetch URL/PDF → save as markdown to disk, return file path + TOC with line numbers. Near-zero context tokens. Use Read tool with offset/limit on the returned path to view specific sections.

**Proponowane (~90 tokenów):**
> Fetch URL or PDF content. USE INSTEAD OF WebFetch for: documentation pages, articles, PDFs, any URL the agent needs to read. Saves full page as markdown to disk and returns ONLY file path + table of contents with line numbers (near-zero context cost). Then call the Read tool with offset/limit on the returned path to view specific sections — avoids dumping full page into context. Supports CSS selectors (target_selector/remove_selector), token budget, PDFs. Skip only if webskim errors; then fall back to WebFetch.

### Parameter descriptions

Aktualne są skrótowe. Dodać przykłady i use cases:

**`webskim_search`:**
```
query: Search query. Natural language works best; be specific.
       Example: "React Server Components official docs" beats "RSC".

num_results: 1-10, default 5. Higher only when triaging many candidates.

site: Restrict to domain. Examples: "python.org", "react.dev".
      Use when authoritative source is known.

country: ISO-3166-1 alpha-2 code for geo-localized results (e.g. "US", "PL", "DE").
         Use for locale-sensitive queries like news, jobs, products.
```

(Przy okazji po Phase 3 dojdą `language`, `location`, `page`.)

**`webskim_read`:**
```
url: URL of web page or PDF. Must be absolute http(s) URL.

max_tokens: Server-side truncation (tokens). Use for very long pages
            to save context budget. Typical: 2000-5000.

target_selector: CSS selector to extract only this element. Use when
                 page has lots of chrome (nav/sidebar) around main content.
                 Example: "article", "main", ".content".

remove_selector: CSS selector for elements to remove before extraction.
                 Example: "nav, footer, .ads".
```

## Open questions

1. **Czy wydłużenie opisów o ~60 tokenów w system promcie jest akceptowalnym trade-offem?** Szacunkowo: 2 tools × 60 tokenów = 120 tokenów więcej. Claude Code system prompt ma ~15k tokenów, overhead 0.8%. Akceptowalne.
2. **Czy inne klienty MCP (Cursor, Windsurf) respektują tę samą formę opisu?** Zakładam tak — MCP spec nie zmienia semantyki per klient. Zweryfikować w eval.

## Eval — scenariusze testowe

Metodologia: dla każdego scenariusza uruchomić świeżą sesję Claude Code z webskim skonfigurowanym, ale BEZ CLAUDE.md preference (żeby izolować wpływ samego opisu narzędzia). Zapisać które tools agent wybrał. Uruchomić dla baseline (obecne opisy) i dla nowych opisów.

### Scenariusze (5 + 2 edge cases)

1. **Docs lookup:** „Sprawdź dokumentację React Server Components i powiedz mi, jak działa 'use server'."
   - Expected: webskim_search (znalezienie react.dev) → webskim_read → Read(offset)
   - Baseline expected: WebSearch → WebFetch (oba built-in)

2. **Direct URL fetch:** „Pobierz treść z https://nodejs.org/en/blog/release/v22.0.0 i streść."
   - Expected: webskim_read
   - Baseline expected: WebFetch

3. **Version lookup:** „Jaka jest najnowsza stabilna wersja Rust?"
   - Expected: webskim_search
   - Baseline expected: WebSearch

4. **Multi-source research:** „Zbierz info o ICAV (fundusz inwestycyjny) z 3 różnych źródeł."
   - Expected: webskim_search → 3× webskim_read → 3× Read
   - Baseline expected: WebSearch → 3× WebFetch

5. **PDF fetch:** „Pobierz http://example.com/paper.pdf i znajdź wnioski z abstraktu."
   - Expected: webskim_read
   - Baseline expected: WebFetch (często failuje na PDF)

### Edge cases

6. **Trivial knowledge (no tool needed):** „Jaka jest stolica Francji?"
   - Expected: żaden tool
   - Ryzyko: agresywny opis webskim może popchnąć do niepotrzebnego search.

7. **Local file:** „Pokaż zawartość package.json."
   - Expected: Read (local)
   - Ryzyko: opis webskim mówi „USE INSTEAD OF WebFetch" — nie powinien kolidować z lokalnym Read, ale zweryfikować.

### Acceptance

- Scenariusze 1-5: nowy opis → webskim w ≥80% przypadków (baseline: zakładam <50%).
- Scenariusze 6-7: nowy opis → zachowanie bez regresji (no tool / Read).
- Eval wykonać przez `claude` CLI w świeżym katalogu, logi zebrać ręcznie (5 scenariuszy × 2 wersje opisu × ~1 min/scenariusz ≈ 20 min pracy).

## CLAUDE.md konsumentów

Skoro tool description sam w sobie ma wystarczyć, rola CLAUDE.md jest redundant-but-nice-to-have. Jednak dla projektów z długimi sesjami (gdzie system prompt może być skompresowany) CLAUDE.md zabezpiecza. README powinien to wyjaśnić:

- „Minimum: dodaj webskim do `.mcp.json`, opisy narzędzi same wymuszą użycie."
- „Zalecane: dodaj też sekcję do CLAUDE.md projektu, bo w długich sesjach system prompt może być streszczony."
- Pokaż konkretne przykłady dla Claude Code, Cursor, Windsurf.

Wzmocnić istniejącą sekcję „Make It the Default" w README.md.

## Commit plan

1. `feat: rewrite tool descriptions with explicit routing guidance` (zmiany w `src/tools/search.ts` + `src/tools/read.ts`)
2. `docs: expand parameter descriptions with use cases and examples` (tam gdzie nie było dodanych w commicie 1)
3. `docs: strengthen README section on CLAUDE.md setup` (opcjonalny, można w oddzielnym PR)

Release: 1.3.2.
