# webskim — plan ulepszeń (kwiecień 2026)

Indeks faz. Każda faza ma osobny spec z full-detail implementation + acceptance + commits.

## Fazy

| # | Phase | Spec | Target release | Status |
|---|---|---|---|---|
| 0 | Bugfixes (9 bugów) | [phase-0-bugfixes](./2026-04-21-phase-0-bugfixes.md) | 1.3.1 + 1.3.2 | Pending |
| 1 | MCP tool description redesign | [phase-1-tool-descriptions](./2026-04-21-phase-1-tool-descriptions.md) | 1.3.2 | Pending |
| 2 | Jina Reader feature parity | [phase-2-reader-parity](./2026-04-21-phase-2-reader-parity.md) | 1.4.0 | Pending |
| 3 | Jina Search feature parity + optymalizacja | [phase-3-search-parity](./2026-04-21-phase-3-search-parity.md) | 1.5.0 | Pending |
| 4 | `webskim_grep` tool | [phase-4-grep-tool](./2026-04-21-phase-4-grep-tool.md) | 1.6.0 | Pending |
| 5 | YAML frontmatter + cache manifest | [phase-5-metadata-cache](./2026-04-21-phase-5-metadata-cache.md) | 2.0.0 (breaking) | Pending |

Łącznie: ~14–20h pracy, 5 releasów.

## Zależności

```
Phase 0 (bugi) ──┬──► Phase 1 (opisy)
                 ├──► Phase 2 (Reader parity) ──► Phase 5 (jeśli linki idą do frontmattera)
                 ├──► Phase 3 (Search parity)
                 └──► Phase 4 (grep) ──► Phase 5 (frontmatter interakcja)

Phase 5 — breaking change, na koniec.
```

Phase 0 **blokuje** wszystko — kilka bugów (B1, B3, B6) dotyka kodu zmienianego w kolejnych fazach.

Phase 1 (opisy) jest technicznie niezależna od Phase 2/3/4, ale jej ewaluacja korzysta z realnego workflow — lepiej testować po Phase 2 kiedy są nowe parametry.

## Jak czytać specy

Każdy phase-spec zawiera:
1. **Status / release / dependencies / estimate** — meta na górze.
2. **Summary** — jedno-zdaniowe streszczenie.
3. **Checklist** — pola do odhaczenia przy implementacji.
4. **Open questions** — rzeczy do wyjaśnienia przed lub podczas prac.
5. **Details** — sekcje z konkretnym kodem, plikami, acceptance criteria.
6. **Tests** — plan testów (jednostkowe + manualne).
7. **Commit plan** — proponowana sekwencja commitów + release.

Gdy faza startuje: update `Status: In progress` w jej pliku + w tej tabeli.

## Kontekst — skąd ten plan

Review projektu 2026-04-21 wykazał trzy grupy problemów:

- **Bugi** — TOC off-by-2, regex nie łapie wciętych nagłówków, filenames nie safe na Windows + kilka mniejszych.
- **Niewykorzystane możliwości Jina API** — webskim używa ~4 z ~25 headerów Reader API, 3 z ~8 opcji Search API.
- **Tool description effectiveness** — Claude czasem wybiera `WebSearch`/`WebFetch` zamiast webskim; przyczyny wyjaśnione w [Phase 1 spec](./2026-04-21-phase-1-tool-descriptions.md).

Research wykonany na:
- [jina-ai/meta-prompt v8](https://github.com/jina-ai/meta-prompt/blob/main/v8.txt) — pełna lista headerów Reader/Search.
- [jina-ai/reader README](https://github.com/jina-ai/reader/blob/main/README.md) — dokumentacja referencyjna.
- [Anthropic — Writing tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents) — best practices dla tool descriptions.
- Konkurencja MCP: Firecrawl, Crawl4AI, ScrapeGraphAI, Tavily, Exa, Brave, Perplexity — feature gap analysis.
- [Augment/SWE-bench: grep beat embeddings](https://jxnl.co/writing/2025/09/11/why-grep-beat-embeddings-in-our-swe-bench-agent-lessons-from-augment/) — motywacja dla Phase 4.

## Out of scope (odrzucone)

Rozważone i świadomie **nie włączone** w plan:

- **Crawl całej domeny** (Firecrawl/Crawl4AI mają) — scope creep, webskim jest minimalistyczny.
- **LLM extraction ze schematem** (ScrapeGraphAI) — zadanie dla agenta, nie middleware.
- **Knowledge graphs / cross-doc references** — overkill dla 2-3 toolowego serwera.
- **Semantic chunking / embeddings w webskim** — Jina Segmenter + Embeddings API istnieją osobno.
- **`webskim_summarize` tool** — agent robi to lepiej i bardziej kontekstowo po `Read`.
- **Browser automation (click, type)** — Playwright MCP robi to lepiej.
- **Vision Language Model OCR pipeline** — Jina Reader już sensownie obsługuje PDF.
- **BM25 / hybrid search w lokalnych plikach** — grep z Phase 4 wystarczy dla rozmiarów plików webskim.

## Aktualizacja planu

Ten plik + per-phase specy są snapshotem z 2026-04-21. W miarę implementacji:
- Zmieniać `Status` w tabeli.
- Dodawać `Post-mortem` sekcje w phase-specach po skończeniu (co wyszło inaczej, co learned).
- Nie zmieniać historycznych decyzji bez adnotacji.
