# Phase 2 — Jina Reader feature parity

**Status:** Pending
**Target release:** 1.4.0
**Dependencies:** Phase 0 (B1–B6), Phase 1 (opisy parametrów)
**Estimate:** 3–4h

## Summary

Jina Reader API wspiera ~25 headerów, webskim używa 4. Dodajemy 5 najwartościowszych jako nowe parametry `webskim_read`, z opcjonalnym fallback do Jina defaults. Największa wartość: `wait_for_selector` (SPA support), `include_links` (nawigacja dla agenta), `no_cache`, `timeout`, `strip_images`.

## Checklist

- [ ] P0: `include_links` (`X-With-Links-Summary: true`)
- [ ] P0: `wait_for_selector` (`X-Wait-For-Selector`)
- [ ] P1: `timeout` (`X-Timeout`)
- [ ] P1: `no_cache` (`X-No-Cache`)
- [ ] P1: `strip_images` (`X-Retain-Images: none`)
- [ ] P2 (opcjonalne): `include_images`, `generate_alt`, `engine`

## Weryfikacja Jina API

Zweryfikowane na [jina-ai/meta-prompt v8](https://github.com/jina-ai/meta-prompt/blob/main/v8.txt) 2026-04-21:

| Header | Wartość | Uwagi |
|---|---|---|
| `X-Wait-For-Selector` | CSS selector | Dla SPA. Bez tego wiele stron zwraca shell. |
| `X-With-Links-Summary` | `true` lub `all` | Dodaje `response.data.links` object. `true` = unique, `all` = wszystkie. |
| `X-With-Images-Summary` | `true` lub `all` | Analog `response.data.images`. |
| `X-Retain-Images` | `none` | Usuwa wszystkie obrazy z markdown. |
| `X-No-Cache` | `true` | Bypass 3600s cache. |
| `X-Cache-Tolerance` | integer (seconds) | Fine-grained cache control. |
| `X-Timeout` | integer (seconds) | Max wait na network idle. |
| `X-Engine` | `browser`/`direct`/`cf-browser-rendering` | Default: auto. |
| `X-With-Generated-Alt` | `true` | VLM generuje alt dla obrazów bez alt. Koszt rośnie. |

## Nowe parametry

| webskim param | Jina header | Priorytet | Uzasadnienie |
|---|---|---|---|
| `include_links` | `X-With-Links-Summary: true` | P0 | Agent widzi wszystkie linki, nawigacja po stronie bez ponownych fetchów |
| `wait_for_selector` | `X-Wait-For-Selector` | P0 | SPA (React/Vue/Angular) zwracają shell bez tego |
| `timeout` | `X-Timeout` | P1 | Dla slow pages, default Jina jest agresywny |
| `no_cache` | `X-No-Cache: true` | P1 | Breaking news, dev docs in flux |
| `strip_images` | `X-Retain-Images: none` | P1 | Realna oszczędność tokenów na galeriach/blogach |
| `include_images` | `X-With-Images-Summary: true` | P2 | Alt-teksy jako structured list |
| `generate_alt` | `X-With-Generated-Alt: true` | P2 | Koszt ×3, rzadki use case |
| `engine` | `X-Engine` | P2 | „direct" dla static sites, szybszy |

## Implementation

### ReadOptions

```ts
// src/services/jina-client.ts
export interface ReadOptions {
  target_selector?: string;
  remove_selector?: string;
  max_tokens?: number;
  wait_for_selector?: string;
  timeout?: number;
  no_cache?: boolean;
  include_links?: boolean;
  include_images?: boolean;
  strip_images?: boolean;
  generate_alt?: boolean;
  engine?: "browser" | "direct" | "cf-browser-rendering";
}
```

Mapowanie w `JinaClient.read`:

```ts
if (options.wait_for_selector) headers["X-Wait-For-Selector"] = options.wait_for_selector;
if (options.timeout) headers["X-Timeout"] = String(options.timeout);
if (options.no_cache) headers["X-No-Cache"] = "true";
if (options.include_links) headers["X-With-Links-Summary"] = "true";
if (options.include_images) headers["X-With-Images-Summary"] = "true";
if (options.strip_images) headers["X-Retain-Images"] = "none";
if (options.generate_alt) headers["X-With-Generated-Alt"] = "true";
if (options.engine) headers["X-Engine"] = options.engine;
```

### ReadResult rozszerzenie

```ts
export interface ReadResult {
  title: string;
  content: string;
  links?: Record<string, string>;  // pojawia się gdy include_links: true
  images?: Record<string, string>; // pojawia się gdy include_images: true
}
```

Parser response:

```ts
const result: ReadResult = {
  title: json.data.title,
  content: json.data.content,
};
if (json.data.links && typeof json.data.links === "object") {
  result.links = json.data.links;
}
if (json.data.images && typeof json.data.images === "object") {
  result.images = json.data.images;
}
return result;
```

### Rendering linków/obrazów w zapisanym pliku

**Decision point.** Trzy opcje:

**Opcja A — sekcja na końcu markdown (REKOMENDOWANE):**
```markdown
<!-- Source: https://... -->

<content>

## Links

- [label 1](url1)
- [label 2](url2)

## Images

- Image 1: url1
- Image 2: url2
```

Plus: TOC automatycznie łapie „## Links" / „## Images", agent widzi je jak zwykłe sekcje.
Minus: pomieszanie z prawdziwym contentem strony jeśli ona już ma h2 „Links" (rzadkie).

**Opcja B — sidecar files:**
`page.md` + `page.links.json` + `page.images.json`.
Plus: separation of concerns.
Minus: agent musi wiedzieć o dodatkowych plikach.

**Opcja C — YAML frontmatter (Phase 5):**
Odłożyć do Phase 5 gdzie i tak dodajemy frontmatter.

**Decyzja:** A w Phase 2. Jeśli user manifestuje problem z kolizją header'ów, mogą zostać przesunięte do frontmatter w Phase 5.

### Zod schema w `src/tools/read.ts`

```ts
{
  url: z.string().url(),
  max_tokens: z.number().positive().optional(),
  target_selector: z.string().optional(),
  remove_selector: z.string().optional(),
  wait_for_selector: z.string().optional()
    .describe("CSS selector to wait for before extraction. Use for SPAs (React/Vue/Angular) where content loads after initial render."),
  timeout: z.number().positive().max(120).optional()
    .describe("Max seconds to wait for page load. Default Jina behavior returns early. Use 30-60 for slow pages."),
  no_cache: z.boolean().optional()
    .describe("Bypass 1h Jina cache. Use when page is recently updated or you need fresh content."),
  include_links: z.boolean().optional()
    .describe("Append a '## Links' section with all page links. Useful for navigation without re-fetching."),
  strip_images: z.boolean().optional()
    .describe("Remove all images from markdown. Saves tokens on image-heavy pages."),
  // P2 params — pominąć w v1.4.0, dodać jeśli użytkownicy poproszą
}
```

## Open questions

1. **Format „## Links" sekcji — bullet list czy tabela?** Decyzja: bullet list (prostszy, lepsze dla agenta).
2. **Co jeśli response z Jina ma `links` ale my nie prosiliśmy?** Ignorować — nie renderować. Bo agent nie wie że linki tam są.
3. **Czy `strip_images` + `include_images` równocześnie jest sensowne?** Tak: usuwa inline obrazy (oszczędność tokenów w content) ale dodaje structured list na końcu.
4. **`X-Cache-Tolerance`** — pomijam w Phase 2, dodać jeśli `no_cache` okaże się za grubym młotkiem.

## Testy

```ts
// tests/jina-client.test.ts — nowe case'y

it("sets X-Wait-For-Selector header when wait_for_selector provided", async () => {
  mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ data: { title: "T", content: "C" } }) });
  await client.read("https://x.com", { wait_for_selector: "#app" });
  expect(mockFetch.mock.calls[0][1].headers["X-Wait-For-Selector"]).toBe("#app");
});

it("parses links from response when include_links is true", async () => {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ data: { title: "T", content: "C", links: { "Home": "https://x.com/" } } }),
  });
  const result = await client.read("https://x.com", { include_links: true });
  expect(result.links).toEqual({ "Home": "https://x.com/" });
});

// tests/read.test.ts (nowy plik) — renderowanie sekcji Links

it("appends ## Links section to saved file when links present", async () => {
  // mock client.read → zwraca links
  // wywołaj tool handler
  // sprawdź że zapisany plik ma "## Links\n\n- [Home](...)"
});
```

### Manual tests

- URL z SPA (np. https://vercel.com) z i bez `wait_for_selector: 'main'` — porównać content length.
- URL ze stałym contentem + 3 fetche (drugi z cache, trzeci z `no_cache: true`) — porównać latency.
- Image-heavy page (blog z dużą ilością zdjęć) z i bez `strip_images: true` — porównać `estimatedTokens`.

### Acceptance

- Wszystkie P0 + P1 testy jednostkowe zielone.
- Ręczny test SPA pokazuje więcej contentu z `wait_for_selector`.
- Ręczny test strony z linkami pokazuje sekcję „## Links" w pliku, odczytywalną przez Read tool.
- Update README sekcji Tools / Parameters.

## Commit plan

1. `feat: add wait_for_selector to webskim_read` (P0)
2. `feat: add include_links and Links section rendering` (P0)
3. `feat: add timeout, no_cache, strip_images params` (P1)
4. `docs: expand webskim_read param documentation` (update README)

Release: 1.4.0.
