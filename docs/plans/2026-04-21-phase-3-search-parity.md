# Phase 3 — Jina Search feature parity + internal optimization

**Status:** Pending
**Target release:** 1.5.0
**Dependencies:** Phase 0 B6 (fix `country` → `gl`)
**Estimate:** 2–3h

## Summary

Dwa wątki. (1) Dodanie brakujących parametrów Jina Search (`hl`, `location`, `page`). (2) **Kluczowa wewnętrzna optymalizacja:** wymuszenie `X-Respond-With: no-content`, żeby Jina nie pobierała top-5 stron dla każdego search call (obecnie robi to niepotrzebnie — webskim_search zwraca snippet z `description`, content jest wyrzucany).

## Checklist

- [ ] Internal: wymuszenie `X-Respond-With: no-content` (duża optymalizacja latency + koszt)
- [ ] P0: `language` (body `hl`)
- [ ] P1: `location` (body `location`)
- [ ] P1: `page` (body `page`, paginacja)
- [ ] P2: `fresh` → `X-No-Cache: true`
- [ ] Weryfikacja: upewnić się że `description` zostaje w response mimo `no-content`

## Weryfikacja Jina Search API

Zweryfikowane na [meta-prompt v8](https://github.com/jina-ai/meta-prompt/blob/main/v8.txt) 2026-04-21.

### Body params

| Pole | Opis | webskim? |
|---|---|---|
| `q` | query | ✅ jest |
| `num` | max results | ✅ jest |
| `gl` | country (dwuliter) | ⚠️ B6 fix |
| `hl` | language (dwuliter) | ❌ brak |
| `location` | city-level, np. "Warsaw" | ❌ brak |
| `page` | offset | ❌ brak |

### Headery

| Header | Znaczenie | webskim? |
|---|---|---|
| `X-Site` | in-site search (alternatywa dla ?site=) | ✅ jest |
| `X-Respond-With: no-content` | **nie zwracaj treści stron** | ❌ brak — huge optymalizacja |
| `X-No-Cache` | bypass cache | ❌ brak |
| `X-With-Favicons` | favicons w response | ❌ brak — nie potrzebujemy |
| `X-Engine` | browser/direct | ❌ brak |
| `X-Timeout` | max wait | ❌ brak |

### Response shape (z docs)

```json
{
  "code": 200,
  "data": [
    {
      "title": "...",
      "description": "...",   // snippet z search engine
      "url": "...",
      "content": "...",        // TYLKO gdy NIE ustawione X-Respond-With: no-content
      "usage": { "tokens": ... }
    }
  ]
}
```

## Kluczowa optymalizacja: `X-Respond-With: no-content`

### Problem

Jina Search domyślnie dla każdego wywołania:
1. Wykonuje search query → dostaje TOP 5 (lub `num`) URLi.
2. Fetchuje każdy z TYCH URLi przez Jina Reader.
3. Zwraca dla każdego `{title, description, url, content}`.

webskim_search używa TYLKO `description` (snippet) — content wyrzucamy.

**Koszt dla użytkownika:** 1 search call = 1 search + N reader calls (N = num_results). Obecnie `num_results: 5` → 6 requestów do Jina pod spodem.

### Rozwiązanie

Zawsze wysyłać `X-Respond-With: no-content`. Wtedy Jina zwraca tylko SERP bez fetchu stron.

**Oczekiwane efekty:**
- Latency: ~10x szybszy search (~250ms zamiast ~2.5s).
- Koszt Jina tokens: zredukowany o rząd wielkości.
- Żaden efekt na funkcjonalność webskim_search — `description` jest odrębne od `content`.

### Open question — weryfikacja

Przed implementacją: zrobić 1 curl żeby potwierdzić, że `description` jest w response w no-content mode. Docs to sugerują, ale lepiej zweryfikować:

```bash
curl -X POST 'https://s.jina.ai/' \
  -H "Authorization: Bearer $JINA_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -H "X-Respond-With: no-content" \
  -d '{"q":"test query","num":3}'
```

Jeśli `description` jest w `data[].description` — wchodzimy z optymalizacją. Jeśli nie — fallback: eksponujemy jako opcjonalny flag `full_content: true` (domyślnie false = no-content), ale defaultowo nie pobieramy contentu.

### Fallback jeśli `description` znika

Gdyby `description` w no-content mode był pusty, response spada do `{title, url}`. Opcje:
- Agent dostaje mniej kontekstu na decyzję „czy ten URL warto otwierać" → gorzej.
- Można kompensować przez Jina Rerank API, ale to complexity creep.

**Decyzja:** jeśli verify pokaże brak description — NIE wprowadzamy `no-content`. Zostawiamy jako known issue.

## Nowe parametry

### `language` (P0)

```ts
language?: string;  // ISO-639-1, e.g. "en", "pl", "de"
```

Zdecydowanie zmienia wyniki dla non-English queries. Przykład: „react" po polsku vs po angielsku.

Mapping: body `hl`.

### `location` (P1)

```ts
location?: string;  // city-level, e.g. "Warsaw", "San Francisco"
```

Dla geo-sensitive queries (restauracje, eventy, lokalne usługi). Rzadsze w AI-agent workflows, ale nie zero.

Mapping: body `location`.

### `page` (P1)

```ts
page?: number;  // 1-indexed offset for pagination
```

Gdy top-5 nie trafia — agent może „page: 2" i dostać kolejną piątkę bez zmiany query.

Mapping: body `page`.

### `fresh` (P2)

```ts
fresh?: boolean;
```

Bypass Jina cache. Mapping: `X-No-Cache: true`.

## Implementation

### SearchOptions

```ts
export interface SearchOptions {
  num_results?: number;
  site?: string;
  country?: string;
  language?: string;
  location?: string;
  page?: number;
  fresh?: boolean;
}
```

### JinaClient.search

```ts
async search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${this.apiKey}`,
    Accept: "application/json",
    "Content-Type": "application/json",
    "X-Return-Format": "markdown",
    "X-Respond-With": "no-content",  // optymalizacja
  };
  if (options.site) headers["X-Site"] = options.site;
  if (options.fresh) headers["X-No-Cache"] = "true";

  const body: Record<string, unknown> = { q: query };
  if (options.num_results) body.num = options.num_results;
  if (options.country) body.gl = options.country.toLowerCase();
  if (options.language) body.hl = options.language.toLowerCase();
  if (options.location) body.location = options.location;
  if (options.page) body.page = options.page;

  // ... rest unchanged
}
```

### Zod schema w `src/tools/search.ts`

```ts
{
  query: z.string().describe("Search query. Natural language works best."),
  num_results: z.number().min(1).max(10).default(5),
  site: z.string().optional(),
  country: z.string().length(2).optional()
    .describe("Country code (ISO-3166-1 alpha-2), e.g. 'US', 'PL'"),
  language: z.string().length(2).optional()
    .describe("Language code (ISO-639-1), e.g. 'en', 'pl'. Affects result ranking significantly for non-English queries."),
  location: z.string().optional()
    .describe("City-level location for geo-sensitive queries, e.g. 'Warsaw'"),
  page: z.number().positive().max(10).optional()
    .describe("Pagination offset. Use when top-5 results don't match."),
  fresh: z.boolean().optional()
    .describe("Bypass Jina cache. Use for breaking news or rapidly changing pages."),
}
```

## Testy

```ts
it("always sends X-Respond-With: no-content", async () => {
  mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ data: [] }) });
  await client.search("test");
  expect(mockFetch.mock.calls[0][1].headers["X-Respond-With"]).toBe("no-content");
});

it("passes language as body.hl", async () => {
  mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ data: [] }) });
  await client.search("test", { language: "PL" });
  expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toMatchObject({ q: "test", hl: "pl" });
});

it("passes page for pagination", async () => {
  mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ data: [] }) });
  await client.search("test", { page: 2 });
  expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toMatchObject({ q: "test", page: 2 });
});
```

### Manual tests

Before & after benchmark:
- 5 różnych search queries, `num_results: 5`.
- Mierzone: latency end-to-end, Jina token usage (z response `usage.tokens` jeśli dostępne).
- Oczekiwane: ~10x krótszy latency, znacznie mniejsze `usage.tokens`.

## Acceptance

- Testy jednostkowe zielone.
- Benchmark potwierdza ≥5x przyspieszenie searcha.
- `description` w response zawiera sensowny snippet (nie pusty).
- README zaktualizowany o nowe parametry.

## Commit plan

1. `perf: always request no-content mode from Jina Search (~10x faster)` (optymalizacja, osobny commit bo mierzalny)
2. `feat: add language/location/page params to webskim_search`
3. `feat: add fresh param (bypass cache)`
4. `docs: expand webskim_search param documentation`

Release: 1.5.0.
