# Sprint 1 — Implementation Spec

> Implementuj task-by-task. Każdy task ma checkboxy (`- [ ]`) — odznaczaj po zaliczeniu testu i commitcie.

**Goal:** Wprowadzić LLM-friendly defaulty dla `webskim_read` i `webskim_search`, dodać brakujące parametry, lepsze error messages i truncation footer — bez breaking changes.

**Architecture:** Wszystkie zmiany w istniejących modułach. `JinaClient.read` wstrzykuje defaulty Jiny na podstawie znormalizowanej `ReadOptions`. `webskim_search` zyskuje dyskryminację po `format` (markdown|json). Handler `webskim_read` ekstrahowany do nazwanej funkcji `handleRead` żeby był testowalny bez bootstrapu MCP server (analogicznie dla search jeśli nie jest jeszcze).

**Tech Stack:** TypeScript 5.9, MCP SDK 1.26, Zod 4.3, Vitest 4.

**Plan:** `docs/plans/2026-05-05-sprint1-plan.md`.

---

## Pliki — wpływ

| Plik | Akcja | Co się zmienia |
|------|-------|----------------|
| `src/services/jina-client.ts` | modify | Rozszerzony `ReadOptions`, defaulty Jiny, mapowanie status → error hint |
| `src/tools/read.ts` | modify | Nowe Zod params (`include_images`, `links`); ekstrakcja `handleRead`; eksport `readToolSchema`; lepszy footer |
| `src/tools/search.ts` | modify | Ekstrakcja `handleSearch`; nowy `format` param; kompaktowy markdown |
| `tests/jina-client.test.ts` | modify | Testy: defaulty headerów, override, `remove_selector=""` escape hatch, reader + search error hints |
| `tests/read-handler.test.ts` | create | Testy `handleRead` (params forwarding, footer); test schemy Zod przez `readToolSchema` |
| `tests/search-handler.test.ts` | create | Testy `handleSearch` (markdown/json) |
| `README.md` | modify | Dokumentacja nowych parametrów |
| `package.json` | modify | Bump `1.4.2` → `1.5.0` |
| `package-lock.json` | modify | Auto-update przez `npm install --package-lock-only` |
| `src/index.ts` | modify | Bump w `new McpServer({ name, version })` |

---

## Task 1: `ReadOptions` — `include_images` i `links`

**Files:**
- Modify: `src/services/jina-client.ts` (`ReadOptions` interface)
- Test: `tests/jina-client.test.ts`

- [ ] **Step 1.1: Failing test — defaulty Jiny dla read**

W `tests/jina-client.test.ts`, w `describe("read", …)` dodaj nowy blok:

```typescript
describe("read defaults (Sprint 1)", () => {
  it("sets X-Retain-Images: none and X-Md-Link-Style: referenced by default", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { title: "T", content: "C" } }),
    });

    await client.read("https://example.com/a");

    const headers = mockFetch.mock.calls[0][1].headers;
    expect(headers["X-Retain-Images"]).toBe("none");
    expect(headers["X-Md-Link-Style"]).toBe("referenced");
  });
});
```

- [ ] **Step 1.2: Run, verify FAIL**

```bash
npx vitest run tests/jina-client.test.ts -t "Sprint 1"
```

Expected: FAIL — assertion na `undefined`.

- [ ] **Step 1.3: Update `ReadOptions` interface**

W `src/services/jina-client.ts` zamień obecny blok `ReadOptions` na:

```typescript
export interface ReadOptions {
  target_selector?: string;
  remove_selector?: string;
  max_tokens?: number;
  include_images?: boolean;            // default false → X-Retain-Images: none
  links?: "referenced" | "discarded" | "inline"; // default "referenced"
}
```

- [ ] **Step 1.4: Inject defaulty w `JinaClient.read`**

W `src/services/jina-client.ts` w metodzie `read`, zaraz po linii `headers["X-Return-Format"] = "markdown"` (linia ~87), dodaj:

```typescript
headers["X-Retain-Images"] = options.include_images ? "all" : "none";

const linksMode = options.links ?? "referenced";
if (linksMode === "referenced") {
  headers["X-Md-Link-Style"] = "referenced";
} else if (linksMode === "discarded") {
  headers["X-Md-Link-Style"] = "discarded";
}
// "inline" = brak headera (Jina default)
```

- [ ] **Step 1.5: Run test, expect PASS**

```bash
npx vitest run tests/jina-client.test.ts -t "Sprint 1"
```

- [ ] **Step 1.6: Test override `include_images: true`**

Dodaj test:

```typescript
it("sets X-Retain-Images: all when include_images=true", async () => {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ data: { title: "T", content: "C" } }),
  });

  await client.read("https://example.com/a", { include_images: true });

  expect(mockFetch.mock.calls[0][1].headers["X-Retain-Images"]).toBe("all");
});
```

Run, expect PASS.

- [ ] **Step 1.7: Test warianty `links`**

```typescript
it("sets X-Md-Link-Style: discarded when links=discarded", async () => {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ data: { title: "T", content: "C" } }),
  });
  await client.read("https://example.com/a", { links: "discarded" });
  expect(mockFetch.mock.calls[0][1].headers["X-Md-Link-Style"]).toBe("discarded");
});

it("omits X-Md-Link-Style when links=inline", async () => {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ data: { title: "T", content: "C" } }),
  });
  await client.read("https://example.com/a", { links: "inline" });
  expect(mockFetch.mock.calls[0][1].headers).not.toHaveProperty("X-Md-Link-Style");
});
```

Run, expect PASS.

- [ ] **Step 1.8: Commit**

```bash
git add src/services/jina-client.ts tests/jina-client.test.ts
git commit -m "feat(read): add include_images and links options with LLM-friendly defaults"
```

---

## Task 2: Default `X-Remove-Selector` — usuwanie chrome stron

**Files:**
- Modify: `src/services/jina-client.ts`
- Test: `tests/jina-client.test.ts`

- [ ] **Step 2.1: Failing tests**

```typescript
describe("default remove selector (Sprint 1)", () => {
  it("uses default X-Remove-Selector when none provided", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { title: "T", content: "C" } }),
    });
    await client.read("https://example.com/a");

    const v = mockFetch.mock.calls[0][1].headers["X-Remove-Selector"];
    expect(v).toContain("nav");
    expect(v).toContain("footer");
    expect(v).toContain("aside");
    expect(v).toContain("[role=banner]");
    expect(v).toContain('[class*="newsletter"]');
  });

  it("respects user-provided remove_selector (override default)", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { title: "T", content: "C" } }),
    });
    await client.read("https://example.com/a", { remove_selector: ".only-this" });
    expect(mockFetch.mock.calls[0][1].headers["X-Remove-Selector"]).toBe(".only-this");
  });

  it("treats remove_selector='' (empty string) as escape hatch — omits header entirely", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { title: "T", content: "C" } }),
    });
    await client.read("https://example.com/a", { remove_selector: "" });
    expect(mockFetch.mock.calls[0][1].headers).not.toHaveProperty("X-Remove-Selector");
  });
});
```

- [ ] **Step 2.2: Run, verify FAIL**

- [ ] **Step 2.3: Add constant + apply default**

W górnej części `src/services/jina-client.ts`, przed `export class JinaClient`, dodaj:

```typescript
export const DEFAULT_REMOVE_SELECTOR = [
  "nav",
  "footer",
  "aside",
  "[role=banner]",
  "[role=navigation]",
  ".ad",
  ".ads",
  ".advertisement",
  ".cookie-banner",
  '[class*="newsletter"]',
  '[class*="subscribe"]',
  '[class*="paywall"]',
  '[class*="related"]',
  '[class*="recommended"]',
  'section[aria-label*="reklama"]',
].join(", ");
```

W `JinaClient.read` zamień obecny blok:

```typescript
if (options.remove_selector) {
  headers["X-Remove-Selector"] = options.remove_selector;
}
```

na (UWAGA: `??` nie odpala dla `""`, więc rozróżniamy `undefined` (default) od `""` (opt-out)):

```typescript
if (options.remove_selector === undefined) {
  headers["X-Remove-Selector"] = DEFAULT_REMOVE_SELECTOR;
} else if (options.remove_selector !== "") {
  headers["X-Remove-Selector"] = options.remove_selector;
}
// "" → header pomijany (escape hatch)
```

- [ ] **Step 2.4: Run, expect PASS**

- [ ] **Step 2.5: Commit**

```bash
git add src/services/jina-client.ts tests/jina-client.test.ts
git commit -m "feat(read): apply default X-Remove-Selector to strip site chrome"
```

---

## Task 3: Ekstrakcja `handleRead` (refactor pod testowalność)

**Files:**
- Modify: `src/tools/read.ts`
- Test: `tests/read-handler.test.ts` (NEW)

> **Why:** obecnie handler `webskim_read` jest lambdą wewnątrz `server.tool(...)`. Żeby testować forwarding parametrów bez bootstrapu MCP server, ekstrahujemy go do funkcji `handleRead`. To powtarza wzorzec Sprint 1 (B5 z poprzednich planów).

- [ ] **Step 3.1: Failing test (handler nie istnieje)**

`tests/read-handler.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { JinaClient } from "../src/services/jina-client.js";
import { FileManager } from "../src/services/file-manager.js";
import { handleRead } from "../src/tools/read.js";

describe("handleRead", () => {
  let client: JinaClient;
  let fileManager: FileManager;

  beforeEach(() => {
    client = new JinaClient("test-key");
    vi.spyOn(client, "read").mockResolvedValue({ title: "T", content: "C" });

    fileManager = new FileManager("/tmp/.ai_pages");
    vi.spyOn(fileManager, "savePage").mockResolvedValue({
      filePath: "/tmp/.ai_pages/x.md",
      fullContent: "# Source: https://x\n\nC",
    });
  });

  it("forwards include_images, links, target_selector, remove_selector to client.read", async () => {
    const spy = client.read as ReturnType<typeof vi.spyOn>;
    await handleRead(
      {
        url: "https://example.com",
        include_images: true,
        links: "discarded",
        target_selector: "article",
        remove_selector: ".chrome",
      },
      { client, fileManager }
    );

    expect(spy).toHaveBeenCalledWith("https://example.com", {
      target_selector: "article",
      remove_selector: ".chrome",
      max_tokens: undefined,
      include_images: true,
      links: "discarded",
    });
  });
});
```

- [ ] **Step 3.2: Run, verify FAIL**

```bash
npx vitest run tests/read-handler.test.ts
```

Expected: FAIL — `handleRead` is not exported.

- [ ] **Step 3.3: Ekstraktuj handler**

W `src/tools/read.ts` dodaj funkcję (przed `registerReadTool`):

```typescript
export interface HandleReadArgs {
  url: string;
  max_tokens?: number;
  target_selector?: string;
  remove_selector?: string;
  include_images?: boolean;
  links?: "referenced" | "discarded" | "inline";
  inline?: boolean;
  head_lines?: number;
}

export interface HandleReadDeps {
  client: JinaClient;
  fileManager: FileManager;
}

export async function handleRead(
  args: HandleReadArgs,
  deps: HandleReadDeps
): Promise<{ isError?: boolean; content: { type: "text"; text: string }[] }> {
  const { client, fileManager } = deps;
  const inlineFlag = args.inline ?? false;

  const validationError = validateReadArgs({
    inline: inlineFlag,
    head_lines: args.head_lines,
  });
  if (validationError) {
    return {
      isError: true,
      content: [{ type: "text", text: `Validation error: ${validationError}` }],
    };
  }

  try {
    const { title, content } = await client.read(args.url, {
      target_selector: args.target_selector,
      remove_selector: args.remove_selector,
      max_tokens: args.max_tokens,
      include_images: args.include_images,
      links: args.links,
    });

    const { filePath, fullContent } = await fileManager.savePage(content, args.url);

    const text = inlineFlag
      ? formatInlineResponse({ title, fullContent, filePath, head_lines: args.head_lines })
      : formatFileResponse({ title, content, fullContent, filePath });

    return { content: [{ type: "text", text }] };
  } catch (error) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Failed to read URL: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
    };
  }
}
```

- [ ] **Step 3.4: Refaktor `registerReadTool` żeby używała handler**

Zamień ciało lambdy w `server.tool(…)` na:

```typescript
async (args) => handleRead(args, { client, fileManager })
```

- [ ] **Step 3.5: Run testy, expect PASS**

```bash
npx vitest run tests/read-handler.test.ts
```

- [ ] **Step 3.6: Commit**

```bash
git add src/tools/read.ts tests/read-handler.test.ts
git commit -m "refactor(read): extract handleRead for direct testing"
```

---

## Task 4: Wystaw `include_images` i `links` w narzędziu `webskim_read`

**Files:**
- Modify: `src/tools/read.ts` (Zod schema obj w `server.tool(...)`)
- Test: `tests/read-handler.test.ts`

- [ ] **Step 4.1: Failing test — defaulty Zod**

W `tests/read-handler.test.ts` dodaj test:

```typescript
it("uses default links='referenced' and include_images=false when not specified", async () => {
  const spy = client.read as ReturnType<typeof vi.spyOn>;
  await handleRead({ url: "https://example.com" }, { client, fileManager });

  // handler nie wstrzykuje defaulty samodzielnie — Zod schema robi to
  // w handler args powinny przyjść już z defaultami
  // ale handleRead sam nie wstrzykuje, więc test sprawdza forwarding undefined →
  // defaulty są w warstwie Zod (poniżej dodajemy)
  expect(spy).toHaveBeenCalledWith("https://example.com", expect.objectContaining({
    include_images: undefined,
    links: undefined,
  }));
});
```

> **Note:** defaulty Zod są aplikowane przez MCP framework przed wywołaniem handler. W jednostkowym teście handler dostaje surowe args (no defaults injected). Realny smoke check defaultów Zod robimy w Step 4.4 niżej — z użyciem `server.tool` schema w izolacji.

- [ ] **Step 4.2: Add Zod params do schemy**

W `src/tools/read.ts`, w obiekcie schematu przekazywanym do `server.tool(...)`, dodaj:

```typescript
include_images: z
  .boolean()
  .optional()
  .default(false)
  .describe(
    "Keep <img> tags in markdown. Default false saves ~30-70% tokens on news/blog pages."
  ),
links: z
  .enum(["referenced", "discarded", "inline"])
  .optional()
  .default("referenced")
  .describe(
    "How to render links. 'referenced' (default) = footer with [text][N] in body. 'discarded' = plain text only. 'inline' = full markdown links. Weak models prefer 'referenced' or 'discarded'."
  ),
```

- [ ] **Step 4.3: Forward do handlera**

`registerReadTool` lambda:

```typescript
async ({ url, max_tokens, target_selector, remove_selector, include_images, links, inline, head_lines }) =>
  handleRead(
    { url, max_tokens, target_selector, remove_selector, include_images, links, inline, head_lines },
    { client, fileManager }
  )
```

- [ ] **Step 4.4: Eksport `readToolSchema` i smoke test realnej schemy**

Testujemy **dokładnie ten obiekt** który idzie do `server.tool(...)`, nie replikę. Wymaga małego refaktoru: ekstrakcja schemy do `export const`.

W `src/tools/read.ts`, podnieś obiekt schematu poza wywołanie `server.tool(...)`:

```typescript
import { z } from "zod";

export const readToolSchema = {
  url: z.string().url().describe("URL of web page or PDF to read"),
  max_tokens: z.number().positive().optional().describe("Truncate content to this many tokens (saves context window)"),
  target_selector: z.string().optional().describe("CSS selector — extract only this element from the page"),
  remove_selector: z.string().optional().describe("CSS selector — remove these elements before extraction. Empty string '' opts out of the default chrome stripper."),
  inline: z.boolean().optional().default(false).describe("Return markdown content directly in the response instead of file path + TOC. File is still saved to disk."),
  head_lines: z.number().int().positive().optional().describe("When inline=true, return only the first N lines (1-indexed, includes the Source header line). Requires inline=true."),
  include_images: z.boolean().optional().default(false).describe(
    "Keep <img> tags in markdown. Default false saves ~30-70% tokens on news/blog pages."
  ),
  links: z.enum(["referenced", "discarded", "inline"]).optional().default("referenced").describe(
    "How to render links. 'referenced' (default) = footer with [text][N]. 'discarded' = plain text only. 'inline' = full markdown links."
  ),
} as const;
```

W `registerReadTool` użyj eksportu:

```typescript
server.tool(
  "webskim_read",
  "...",
  readToolSchema,
  async (args) => handleRead(args, { client, fileManager })
);
```

Test (w `tests/read-handler.test.ts`):

```typescript
import { z } from "zod";
import { readToolSchema } from "../src/tools/read.js";

it("readToolSchema applies defaults: include_images=false, links='referenced', inline=false", () => {
  const schema = z.object(readToolSchema);
  const parsed = schema.parse({ url: "https://example.com" });
  expect(parsed.include_images).toBe(false);
  expect(parsed.links).toBe("referenced");
  expect(parsed.inline).toBe(false);
});
```

Run, expect PASS.

- [ ] **Step 4.5: Run wszystkie testy**

```bash
npx vitest run
```

- [ ] **Step 4.6: Update opis tool-a**

W `src/tools/read.ts` przy `server.tool("webskim_read", "…",`, zaktualizuj opis:

```
"Fetch URL/PDF → save as markdown to disk. Default: file path + TOC (near-zero context). Set inline:true + head_lines:N to receive markdown directly. Defaults are LLM-friendly: images stripped (include_images:true to keep), links rendered as footer references (links:'inline' to keep inline), site chrome (nav/footer/aside/ads) removed (override via remove_selector)."
```

- [ ] **Step 4.7: Commit**

```bash
git add src/tools/read.ts tests/read-handler.test.ts
git commit -m "feat(read): expose include_images and links params on webskim_read"
```

---

## Task 5: Kompaktowy `webskim_search` + `format: "json"`

**Files:**
- Modify: `src/tools/search.ts`
- Test: `tests/search-handler.test.ts` (NEW)

- [ ] **Step 5.1: Failing tests**

`tests/search-handler.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { JinaClient } from "../src/services/jina-client.js";
import { handleSearch } from "../src/tools/search.js";

describe("handleSearch", () => {
  let client: JinaClient;

  beforeEach(() => {
    client = new JinaClient("test-key");
    vi.spyOn(client, "search").mockResolvedValue([
      { title: "Result 1", url: "https://a.com/x", snippet: "Snippet A" },
      { title: "Result 2", url: "https://b.com/y", snippet: "Snippet B" },
    ]);
  });

  it("default markdown is compact: '[i] title\\n   url\\n   snippet'", async () => {
    const result = await handleSearch({ query: "x" }, client);
    const text = result.content[0].text;

    expect(text).toContain("[1] Result 1");
    expect(text).toContain("https://a.com/x");
    expect(text).toContain("Snippet A");
    expect(text).toContain("[2] Result 2");
    expect(text).not.toContain("Found 2 results");
    expect(text).not.toContain("**Result 1**");
  });

  it("format='json' returns parseable JSON with i, title, url, snippet, host", async () => {
    const result = await handleSearch({ query: "x", format: "json" }, client);
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.results).toHaveLength(2);
    expect(parsed.results[0]).toEqual({
      i: 1,
      title: "Result 1",
      url: "https://a.com/x",
      snippet: "Snippet A",
      host: "a.com",
    });
  });

  it("returns 'No results found.' when empty", async () => {
    (client.search as ReturnType<typeof vi.spyOn>).mockResolvedValueOnce([]);
    const result = await handleSearch({ query: "nothing" }, client);
    expect(result.content[0].text).toBe("No results found.");
  });

  it("format='json' returns empty results array when no hits", async () => {
    (client.search as ReturnType<typeof vi.spyOn>).mockResolvedValueOnce([]);
    const result = await handleSearch({ query: "nothing", format: "json" }, client);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.results).toEqual([]);
  });
});
```

- [ ] **Step 5.2: Run, verify FAIL**

```bash
npx vitest run tests/search-handler.test.ts
```

- [ ] **Step 5.3: Ekstraktuj `handleSearch`**

W `src/tools/search.ts` dodaj (przed `registerSearchTool`):

```typescript
export interface HandleSearchArgs {
  query: string;
  num_results?: number;
  site?: string;
  country?: string;
  format?: "markdown" | "json";
}

function hostFromUrl(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

export async function handleSearch(
  args: HandleSearchArgs,
  client: JinaClient
): Promise<{ isError?: boolean; content: { type: "text"; text: string }[] }> {
  try {
    const results = await client.search(args.query, {
      num_results: args.num_results,
      site: args.site,
      country: args.country,
    });

    if (args.format === "json") {
      const payload = {
        results: results.map((r, i) => ({
          i: i + 1,
          title: r.title,
          url: r.url,
          snippet: r.snippet,
          host: hostFromUrl(r.url),
        })),
      };
      return { content: [{ type: "text", text: JSON.stringify(payload) }] };
    }

    if (results.length === 0) {
      return { content: [{ type: "text", text: "No results found." }] };
    }

    const formatted = results
      .map((r, i) => `[${i + 1}] ${r.title}\n   ${r.url}\n   ${r.snippet}`)
      .join("\n\n");

    return { content: [{ type: "text", text: formatted }] };
  } catch (error) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Search failed: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
    };
  }
}
```

- [ ] **Step 5.4: Update `registerSearchTool`**

Zamień ciało:

```typescript
export function registerSearchTool(server: McpServer, client: JinaClient) {
  server.tool(
    "webskim_search",
    "Web search → compact results (title, URL, snippet). Set format:'json' for structured output (preferred for weak models). Follow up with webskim_read to fetch full pages.",
    {
      query: z.string().describe("Search query"),
      num_results: z.number().min(1).max(10).default(5).describe("Number of results (1-10, default 5)"),
      site: z.string().optional().describe("Restrict search to this domain, e.g. 'python.org'"),
      country: z.string().optional().describe("Country code for localized results, e.g. 'US', 'PL'"),
      format: z
        .enum(["markdown", "json"])
        .optional()
        .default("markdown")
        .describe("Output format. 'markdown' (default) = compact text. 'json' = structured {results:[{i,title,url,snippet,host}]} — preferred for weak models."),
    },
    async (args) => handleSearch(args, client)
  );
}
```

- [ ] **Step 5.5: Run testy, expect PASS**

```bash
npx vitest run
```

- [ ] **Step 5.6: Commit**

```bash
git add src/tools/search.ts tests/search-handler.test.ts
git commit -m "feat(search): compact markdown format and optional JSON output"
```

---

## Task 6: Actionable error messages

**Files:**
- Modify: `src/services/jina-client.ts`
- Test: `tests/jina-client.test.ts`

- [ ] **Step 6.1: Failing tests**

W `tests/jina-client.test.ts` dodaj `describe`:

```typescript
describe("error hints (Sprint 1)", () => {
  it("422 from reader → hint about empty page or invalid selector", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 422,
      statusText: "Unprocessable Entity",
    });
    await expect(client.read("https://x")).rejects.toThrow(/422/);

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 422,
      statusText: "Unprocessable Entity",
    });
    await expect(client.read("https://x")).rejects.toThrow(
      /page likely empty.*or invalid selector/i
    );
  });

  it("403 from reader → hint about antibot / login wall", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      statusText: "Forbidden",
    });
    await expect(client.read("https://x")).rejects.toThrow(
      /blocked by site|antibot|login wall/i
    );
  });

  it("429 → hint about rate limit and retry", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      statusText: "Too Many Requests",
    });
    await expect(client.read("https://x")).rejects.toThrow(/rate limited/i);
  });

  it("timeout (AbortError) → hint about timeout + retry", async () => {
    const abortErr = new Error("aborted");
    abortErr.name = "AbortError";
    mockFetch.mockRejectedValueOnce(abortErr);

    await expect(client.read("https://x")).rejects.toThrow(/timeout/i);
  });
});

describe("search error hints (Sprint 1)", () => {
  it("429 from search → rate-limited hint", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      statusText: "Too Many Requests",
    });
    await expect(client.search("x")).rejects.toThrow(/rate limited/i);
  });

  it("500 from search → upstream error hint", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    });
    await expect(client.search("x")).rejects.toThrow(/upstream|retry/i);
  });
});
```

- [ ] **Step 6.2: Verify FAIL**

- [ ] **Step 6.3: Implement helper**

W `src/services/jina-client.ts` dodaj (przed `class JinaClient`):

```typescript
export function readerErrorMessage(status: number, statusText: string): string {
  const base = `Jina Reader API error: ${status} ${statusText}`;
  switch (status) {
    case 422:
      return `${base} — page likely empty/blocked or invalid selector. Try: 1) different URL from search results, 2) remove target_selector if set, 3) shorter URL.`;
    case 403:
    case 401:
      return `${base} — blocked by site (antibot, login wall, or paywall). Try a different source URL or verify URL is publicly accessible.`;
    case 404:
      return `${base} — URL not found. Verify URL exists; try a search.`;
    case 429:
      return `${base} — rate limited. Wait a few seconds before retrying.`;
    case 500:
    case 502:
    case 503:
    case 504:
      return `${base} — Jina/upstream error. Retry once; if still failing, try a different URL.`;
    default:
      return base;
  }
}

export function searchErrorMessage(status: number, statusText: string): string {
  const base = `Jina Search API error: ${status} ${statusText}`;
  if (status === 429) return `${base} — rate limited. Wait a few seconds before retrying.`;
  if (status >= 500) return `${base} — Jina/upstream error. Retry once.`;
  return base;
}
```

- [ ] **Step 6.4: Wire helper do read/search**

W `JinaClient.read`, zamień:

```typescript
if (!response.ok) {
  throw new Error(`Jina Reader API error: ${response.status} ${response.statusText}`);
}
```

na:

```typescript
if (!response.ok) {
  throw new Error(readerErrorMessage(response.status, response.statusText));
}
```

I analogicznie w `JinaClient.search`:

```typescript
if (!response.ok) {
  throw new Error(searchErrorMessage(response.status, response.statusText));
}
```

- [ ] **Step 6.5: Improve `fetchWithTimeout` dla AbortError**

Zamień metodę na:

```typescript
private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      throw new Error(
        `Request timeout after ${this.timeoutMs}ms — page took too long to load. Try a different URL.`
      );
    }
    throw e;
  } finally {
    clearTimeout(timeout);
  }
}
```

- [ ] **Step 6.6: Run testy, expect PASS**

- [ ] **Step 6.7: Commit**

```bash
git add src/services/jina-client.ts tests/jina-client.test.ts
git commit -m "feat: map HTTP status to actionable error hints"
```

---

## Task 7: Truncation footer z hintami

**Files:**
- Modify: `src/tools/read.ts` (`formatInlineResponse` function)
- Test: `tests/read-inline.test.ts`

- [ ] **Step 7.1: Failing test**

W `tests/read-inline.test.ts` dodaj:

```typescript
it("truncation footer hints at next-step options", () => {
  const fullContent = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`).join("\n");
  const result = formatInlineResponse({
    title: "T",
    fullContent,
    filePath: "/tmp/p.md",
    head_lines: 10,
  });

  expect(result).toContain("--- Showing lines 1-10 of 100");
  expect(result).toContain("inline:false");
  expect(result).toContain("Read tool");
  expect(result).toContain("offset");
  expect(result).toContain("/tmp/p.md");
});

it("no footer when content fits within head_lines", () => {
  const result = formatInlineResponse({
    title: "T",
    fullContent: "line 1\nline 2",
    filePath: "/tmp/p.md",
    head_lines: 10,
  });
  expect(result).not.toContain("Showing lines");
});
```

- [ ] **Step 7.2: Run, verify FAIL**

- [ ] **Step 7.3: Update `formatInlineResponse`**

W `src/tools/read.ts` zamień funkcję `formatInlineResponse` na:

```typescript
export function formatInlineResponse(params: {
  title: string;
  fullContent: string;
  filePath: string;
  head_lines?: number;
}): string {
  const { title, fullContent, filePath, head_lines } = params;
  const lines = fullContent.split("\n");
  const totalLines = lines.length;
  const cap =
    head_lines !== undefined ? Math.min(head_lines, totalLines) : totalLines;
  const visible = lines.slice(0, cap).join("\n");

  if (cap >= totalLines) {
    return `**${title}**\n\n${visible}`;
  }

  const footer = [
    `--- Showing lines 1-${cap} of ${totalLines}.`,
    `For more: increase head_lines, or call again with inline:false to get TOC + file path.`,
    `Read tool with offset/limit also works on file: ${filePath}`,
  ].join("\n");

  return `**${title}**\n\n${visible}\n\n${footer}`;
}
```

- [ ] **Step 7.4: Run, expect PASS**

- [ ] **Step 7.5: Commit**

```bash
git add src/tools/read.ts tests/read-inline.test.ts
git commit -m "feat(read): hint at next-step options in truncation footer"
```

---

## Task 8: README + version bump

**Files:**
- Modify: `README.md`
- Modify: `package.json`

- [ ] **Step 8.1: README — sekcja `webskim_read`**

W `README.md` w sekcji `webskim_read` dodaj listę nowych parametrów (jeśli są) lub upewnij się że sekcja zawiera:

```markdown
**Parameters:**

- `url` (required): Web page or PDF URL
- `inline` (default `false`): Return markdown directly instead of file path + TOC
- `head_lines`: With `inline:true`, cap to first N lines
- `target_selector`: CSS selector — extract only this element
- `remove_selector`: CSS selector — drop these elements (overrides default chrome stripper)
- `include_images` (default `false`): Keep `<img>` tags. Default off saves 30-70% tokens on news pages
- `links` (default `referenced`): How to render links. `referenced` = footer notation, `discarded` = plain text, `inline` = full markdown
- `max_tokens`: Truncate to N tokens

**Defaults note:** webskim removes site chrome (nav/footer/aside/ads/cookie banners) before extraction. Override with explicit `remove_selector` if your target selector is e.g. `aside.article-content`.
```

- [ ] **Step 8.2: README — sekcja `webskim_search`**

```markdown
**Parameters:**

- `query` (required)
- `num_results` (1-10, default 5)
- `site`: Restrict to a domain
- `country`: Country code for localized results (e.g. `PL`)
- `format` (default `markdown`): `markdown` for compact text, `json` for `{results:[{i,title,url,snippet,host}]}` (preferred for weak models)
```

- [ ] **Step 8.3: Bump wersji w trzech miejscach**

`package.json` (pole `"version"`):

```json
"version": "1.5.0",
```

`src/index.ts` — pole `version` w `new McpServer({...})`:

```typescript
const server = new McpServer({
  name: "webskim",
  version: "1.5.0",
});
```

(Linia w bieżącym repo to ~18, ale lepiej szukać po patternie — zob. weryfikacja niżej.)

`package-lock.json` — auto przez:

```bash
npm install --package-lock-only
```

Zweryfikuj że wszystkie trzy miejsca pokazują `1.5.0`:

```bash
grep -nE '"version"\s*:\s*"' package.json package-lock.json | head
grep -n 'version: "' src/index.ts
```

- [ ] **Step 8.4: Build**

```bash
npm run build
```

Expected: zero errors.

- [ ] **Step 8.5: Run all tests**

```bash
npm test
```

Expected: all green.

- [ ] **Step 8.6: Commit**

```bash
git add README.md package.json package-lock.json src/index.ts
git commit -m "docs: document Sprint 1 read/search options; bump 1.5.0"
```

---

## Self-Review

- ✅ **Spec coverage:** A1 (Task 1+2), A2 (Task 3+4), A4 (Task 5), A5 (Task 6), A6 (Task 7). Bonus: Task 3 ekstraktuje handler dla testowalności (techniczny prerequisite).
- ✅ **Placeholders:** brak TBD/TODO; każdy task ma konkretny kod.
- ✅ **Type consistency:** `ReadOptions`, `HandleReadArgs`, `HandleReadDeps`, `HandleSearchArgs`, `readerErrorMessage`, `searchErrorMessage`, `DEFAULT_REMOVE_SELECTOR` — używane spójnie.
- ✅ **Frequent commits:** każdy Task ma własny commit; build/test gate w Task 8.

## Execution Handoff

Po zaaprobowaniu tego speca dwie opcje:

**1. Subagent-Driven (recommended)** — fresh subagent per task, two-stage review między taskami.

**2. Inline Execution** — wykonanie w obecnej sesji z checkpointami.

Pytanie do usera: który tryb po zaakceptowaniu speca?
