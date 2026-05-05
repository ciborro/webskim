# Sprint 2 — Implementation Spec

> Implementuj task-by-task. Każdy task ma checkboxy (`- [ ]`) — odznaczaj po zaliczeniu testu i commitcie.

**Goal:** Dodać lokalny fallback Mozilla Readability jako pierwszą próbę dla `webskim_read`. Jeśli sukces — zwracamy artykuł bez kosztu Jiny i z mniejszą latency. Jeśli nie — istniejąca ścieżka Jiny pozostaje bez zmian.

**Architecture:** Nowy serwis `ReadabilityExtractor` izolowany od reszty (czyste IO + parsing). `handleRead` decyduje na podstawie `shouldTryReadability(args)` czy próbować lokalnie, czy iść prosto do Jiny. Feature flag środowiskowa `WEBSKIM_READABILITY=1` **włącza** ścieżkę Readability w 1.6.0 (opt-in); w 1.6.1+ semantyka się odwraca — wtedy `WEBSKIM_READABILITY=0` ją **wyłącza** (default-on, opt-out). `format: "json"` zwraca strukturalne pole `extracted_by` informujące którym torem poszedł read; markdown response ma footer `_Extracted by: …_`.

**Tech Stack:** TypeScript 5.9, MCP SDK, Vitest. Nowe deps: `@mozilla/readability` (~30kB), `linkedom` (~150kB lightweight DOM), `turndown` (~5kB HTML→MD).

**Plan:** `docs/plans/2026-05-05-sprint2-plan.md`.

**Dependency:** Sprint 1 wdrożony (handler `handleRead` ekstrahowany, `format: "json"` jako pojęcie znane w search'u).

---

## Pliki — wpływ

| Plik | Akcja | Co się zmienia |
|------|-------|----------------|
| `package.json` | modify | Deps: `@mozilla/readability`, `linkedom`, `turndown` (+ `@types/turndown`); bump `1.5.0` → `1.6.0` |
| `package-lock.json` | modify | Auto-update (deps + version) |
| `src/services/readability-extractor.ts` | create | Naive fetch + Readability + HTML→MD; early-skip dla `.pdf`/`.zip`/etc. |
| `tests/readability-extractor.test.ts` | create | Testy z fixturami HTML; gated benchmark |
| `tests/fixtures/*.html` | create | Min. 5 fixture'ów: artykuł newsowy, blog, Wikipedia, SPA shell, antibot |
| `src/tools/read.ts` | modify | `shouldTryReadability` + dispatch; fallback do Jiny; `format: "json"`; markdown footer `_Extracted by: …_`; `HandleReadDeps` rozszerzone o `readability` |
| `tests/read-handler.test.ts` | modify | **Update istniejących testów** (Sprint 1) o mocked `ReadabilityExtractor` w deps; nowe testy ścieżki Readability i wszystkich gates |
| `src/index.ts` | modify | Wstrzykiwanie `ReadabilityExtractor`; bump w `new McpServer({...})` |
| `README.md` | modify | Dokumentacja nowego flow + `format: "json"` + opt-in flag |

---

## Task 1: Dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1.1: Install deps**

```bash
npm install @mozilla/readability linkedom turndown
npm install --save-dev @types/turndown
```

- [ ] **Step 1.2: Verify install**

```bash
npm ls @mozilla/readability linkedom turndown
```

Expected: wszystkie trzy widoczne.

- [ ] **Step 1.3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add @mozilla/readability, linkedom, turndown deps"
```

---

## Task 2: Fixtures HTML do testów

**Files:**
- Create: `tests/fixtures/article-news.html`
- Create: `tests/fixtures/article-wikipedia.html`
- Create: `tests/fixtures/article-blog.html`
- Create: `tests/fixtures/spa-shell.html`
- Create: `tests/fixtures/antibot-cloudflare.html`

> **Why:** testy jednostkowe `ReadabilityExtractor` nie powinny chodzić do internetu. Fixture'y dają deterministyczne pokrycie różnych typów stron.

- [ ] **Step 2.1: Stwórz `tests/fixtures/article-news.html`**

Realistic newsroom HTML — `<header><nav></nav></header>`, `<aside class="related"></aside>`, ale `<article>` z 1000+ znaków treści. Można skopiować szablon z dowolnego serwisu (sanitised).

```html
<!doctype html>
<html lang="pl">
<head><title>Test artykuł newsowy</title></head>
<body>
  <header>
    <nav>... menu ...</nav>
  </header>
  <main>
    <article>
      <h1>Test artykuł newsowy: tytuł</h1>
      <p class="byline">Jan Kowalski · 5 maja 2026</p>
      <p>Akapit pierwszy artykułu — wystarczająco długi żeby przekroczyć próg 500 znaków który stosujemy do oceny jakości ekstrakcji. Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.</p>
      <p>Akapit drugi — ważne że jest tu prawdziwa, długa treść, nie sam chrome. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore.</p>
      <p>Akapit trzeci ze strukturą: pierwszy punkt to <strong>coś ważnego</strong>, drugi to <a href="https://example.com">link</a>, trzeci to kropka kończąca akapit.</p>
    </article>
  </main>
  <aside class="related">Powiązane artykuły: ...</aside>
  <footer>Stopka...</footer>
</body>
</html>
```

- [ ] **Step 2.2: Stwórz `tests/fixtures/spa-shell.html`**

```html
<!doctype html>
<html><head><title>Loading...</title></head>
<body>
  <div id="root"></div>
  <script src="/bundle.js"></script>
</body>
</html>
```

(Pusty shell — Readability powinien się tu wywalić.)

- [ ] **Step 2.3: Stwórz `tests/fixtures/antibot-cloudflare.html`**

```html
<!doctype html>
<html><head><title>Just a moment...</title></head>
<body>
  <div class="cf-browser-verification">
    <p>Checking your browser before accessing the site.</p>
  </div>
</body>
</html>
```

- [ ] **Step 2.4: Stwórz dwa kolejne (Wikipedia-like, blog-like)**

Wikipedia: `<div id="mw-content-text">` z 5+ akapitami.

Blog: `<article>` lub `<main>` z h1 + 3-4 akapitami treści.

- [ ] **Step 2.5: Commit fixtures**

```bash
git add tests/fixtures/
git commit -m "test: HTML fixtures for ReadabilityExtractor coverage"
```

---

## Task 3: `ReadabilityExtractor` — interface i type-only setup

**Files:**
- Create: `src/services/readability-extractor.ts`
- Create: `tests/readability-extractor.test.ts`

- [ ] **Step 3.1: Failing test — moduł nie istnieje**

`tests/readability-extractor.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { ReadabilityExtractor } from "../src/services/readability-extractor.js";

describe("ReadabilityExtractor", () => {
  let extractor: ReadabilityExtractor;

  beforeEach(() => {
    extractor = new ReadabilityExtractor();
  });

  it("exports the class", () => {
    expect(extractor).toBeInstanceOf(ReadabilityExtractor);
  });
});
```

- [ ] **Step 3.2: Verify FAIL — moduł nie istnieje**

```bash
npx vitest run tests/readability-extractor.test.ts
```

- [ ] **Step 3.3: Stwórz szkielet modułu**

`src/services/readability-extractor.ts`:

```typescript
export interface ExtractedArticle {
  title: string;
  byline: string | null;
  excerpt: string | null;
  content_md: string;
  length: number;
  url: string;
}

export interface ReadabilityExtractorOptions {
  fetchTimeoutMs?: number;       // default 5000
  maxBytes?: number;             // default 5 * 1024 * 1024
  userAgent?: string;            // default realistic Chrome UA
  minContentLength?: number;     // default 500
}

export class ReadabilityExtractor {
  private readonly fetchTimeoutMs: number;
  private readonly maxBytes: number;
  private readonly userAgent: string;
  private readonly minContentLength: number;

  constructor(options: ReadabilityExtractorOptions = {}) {
    this.fetchTimeoutMs = options.fetchTimeoutMs ?? 5000;
    this.maxBytes = options.maxBytes ?? 5 * 1024 * 1024;
    this.userAgent = options.userAgent ??
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
    this.minContentLength = options.minContentLength ?? 500;
  }

  async tryExtract(_url: string): Promise<ExtractedArticle | null> {
    return null; // placeholder; wypełnimy w Task 4
  }
}
```

- [ ] **Step 3.4: Verify PASS dla Step 3.1 testu**

- [ ] **Step 3.5: Commit**

```bash
git add src/services/readability-extractor.ts tests/readability-extractor.test.ts
git commit -m "feat: ReadabilityExtractor skeleton"
```

---

## Task 4: `tryExtract` — happy path z fixture'em

**Files:**
- Modify: `src/services/readability-extractor.ts`
- Modify: `tests/readability-extractor.test.ts`

> **Why osobne metody:** dla testów chcemy wstrzykiwać HTML, nie chodzić do prawdziwej sieci. Wprowadzimy `extractFromHtml(html, url)` jako pure function, a `tryExtract(url)` woła `fetch` + `extractFromHtml`.

- [ ] **Step 4.1: Failing test — extract z fixture'a**

> ⚠️ **ESM:** `__dirname` nie istnieje w module ESM (projekt ma `"type": "module"`). Ładujemy fixtures przez `import.meta.url`.

```typescript
import * as fs from "node:fs";
import { fileURLToPath } from "node:url";
import * as path from "node:path";

const fixturesDir = fileURLToPath(new URL("./fixtures/", import.meta.url));
const newsHtml = fs.readFileSync(path.join(fixturesDir, "article-news.html"), "utf8");

it("extracts article content from news HTML fixture", async () => {
  const result = await extractor.extractFromHtml(newsHtml, "https://example.com/article");

  expect(result).not.toBeNull();
  expect(result!.title).toContain("Test artykuł newsowy");
  expect(result!.content_md).toContain("Akapit pierwszy");
  expect(result!.content_md).not.toContain("Powiązane artykuły");
  expect(result!.content_md).not.toContain("menu");
  expect(result!.length).toBeGreaterThan(500);
  expect(result!.url).toBe("https://example.com/article");
});

it("returns null for SPA shell (no real content)", async () => {
  const shellHtml = fs.readFileSync(path.join(fixturesDir, "spa-shell.html"), "utf8");
  const result = await extractor.extractFromHtml(shellHtml, "https://example.com/spa");
  expect(result).toBeNull();
});

it("returns null for Cloudflare antibot challenge page", async () => {
  const antibotHtml = fs.readFileSync(path.join(fixturesDir, "antibot-cloudflare.html"), "utf8");
  const result = await extractor.extractFromHtml(antibotHtml, "https://example.com/x");
  expect(result).toBeNull();
});
```

- [ ] **Step 4.2: Verify FAIL — `extractFromHtml` nie istnieje**

- [ ] **Step 4.3: Implement `extractFromHtml`**

W `src/services/readability-extractor.ts` dopisz:

```typescript
import { Readability, isProbablyReaderable } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import TurndownService from "turndown";

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
  linkStyle: "referenced",
  linkReferenceStyle: "collapsed",
});

// (klasa wyżej już zdefiniowana w Task 3)

export class ReadabilityExtractor {
  // ... (constructor jak w Task 3)

  extractFromHtml(html: string, url: string): ExtractedArticle | null {
    const { document } = parseHTML(html);

    if (!isProbablyReaderable(document)) {
      return null;
    }

    const article = new Readability(document, { charThreshold: this.minContentLength }).parse();
    if (!article || !article.content) {
      return null;
    }

    if ((article.length ?? 0) < this.minContentLength) {
      return null;
    }

    const contentMd = turndown.turndown(article.content);

    return {
      title: article.title ?? "",
      byline: article.byline ?? null,
      excerpt: article.excerpt ?? null,
      content_md: contentMd,
      length: article.length ?? contentMd.length,
      url,
    };
  }

  // tryExtract pozostaje placeholderem do Task 5
}
```

- [ ] **Step 4.4: Run testy, expect PASS**

```bash
npx vitest run tests/readability-extractor.test.ts
```

> **Jeśli `extractFromHtml` zwraca treść z fixture'a article-news ale niepełną** — zweryfikuj fixture: musi mieć ≥500 znaków treści w `<article>`. Jeśli mniej — zwiększ tekst w fixture'a.

- [ ] **Step 4.5: Test dodatkowy — fallback gdy artykuł za krótki**

```typescript
it("returns null when article shorter than minContentLength", () => {
  const shortHtml = `<html><body><article><h1>T</h1><p>Too short.</p></article></body></html>`;
  const result = extractor.extractFromHtml(shortHtml, "https://x");
  expect(result).toBeNull();
});
```

Run, expect PASS (już działa dzięki `minContentLength` check).

- [ ] **Step 4.6: Commit**

```bash
git add src/services/readability-extractor.ts tests/readability-extractor.test.ts
git commit -m "feat: extractFromHtml with Readability + linkedom + turndown"
```

---

## Task 5: `tryExtract` — fetch + size limit + timeout

**Files:**
- Modify: `src/services/readability-extractor.ts`
- Modify: `tests/readability-extractor.test.ts`

- [ ] **Step 5.1: Failing test — z mocked fetch**

W `tests/readability-extractor.test.ts`:

```typescript
import { vi } from "vitest";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("ReadabilityExtractor.tryExtract", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    extractor = new ReadabilityExtractor();
  });

  it("returns null for URL ending with .pdf without fetching", async () => {
    const result = await extractor.tryExtract("https://example.com/doc.pdf");
    expect(result).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns null for non-HTML extensions (.zip, .docx, .xlsx)", async () => {
    expect(await extractor.tryExtract("https://x/a.zip")).toBeNull();
    expect(await extractor.tryExtract("https://x/a.docx")).toBeNull();
    expect(await extractor.tryExtract("https://x/a.xlsx")).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("fetches URL and extracts article on 200 OK with text/html", async () => {
    const html = fs.readFileSync(path.join(fixturesDir, "article-news.html"), "utf8");
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "text/html; charset=utf-8" }),
      text: async () => html,
    });

    const result = await extractor.tryExtract("https://example.com/article");

    expect(mockFetch).toHaveBeenCalledWith(
      "https://example.com/article",
      expect.objectContaining({
        headers: expect.objectContaining({ "User-Agent": expect.stringContaining("Mozilla") }),
      })
    );
    expect(result).not.toBeNull();
    expect(result!.title).toContain("Test artykuł");
  });

  it("returns null on non-200 status", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 403, headers: new Headers(), text: async () => "" });
    const result = await extractor.tryExtract("https://x");
    expect(result).toBeNull();
  });

  it("returns null when content-type not text/html", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/pdf" }),
      text: async () => "binary",
    });
    const result = await extractor.tryExtract("https://x");
    expect(result).toBeNull();
  });

  it("returns null on fetch network error", async () => {
    mockFetch.mockRejectedValueOnce(new Error("ECONNRESET"));
    const result = await extractor.tryExtract("https://x");
    expect(result).toBeNull();
  });

  it("returns null when content-length exceeds maxBytes", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "text/html", "content-length": String(10 * 1024 * 1024) }),
      text: async () => "should not be called",
    });
    const result = await extractor.tryExtract("https://x");
    expect(result).toBeNull();
  });

  it("returns null on AbortError (timeout)", async () => {
    const err = new Error("aborted");
    err.name = "AbortError";
    mockFetch.mockRejectedValueOnce(err);
    const result = await extractor.tryExtract("https://x");
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 5.2: Verify FAIL**

- [ ] **Step 5.3: Implement `tryExtract`**

W `src/services/readability-extractor.ts` zamień placeholder na:

```typescript
private static readonly NON_HTML_EXTENSIONS = /\.(pdf|zip|docx?|xlsx?|pptx?|tar|gz|rar|7z|jpg|jpeg|png|gif|webp|svg|mp4|mp3|wav)(\?|#|$)/i;

async tryExtract(url: string): Promise<ExtractedArticle | null> {
  // Early-skip: niektóre rozszerzenia wiemy że nie są HTML — nie zaczynamy fetch.
  if (ReadabilityExtractor.NON_HTML_EXTENSIONS.test(url)) {
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), this.fetchTimeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent": this.userAgent,
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9,pl;q=0.8",
      },
    });

    if (!response.ok) return null;

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.startsWith("text/html") && !contentType.includes("xhtml")) {
      return null;
    }

    // Size limit: dwie warstwy.
    // (1) Pre-check Content-Length jeśli serwer go wystawia.
    const contentLengthRaw = response.headers.get("content-length");
    if (contentLengthRaw) {
      const contentLength = Number.parseInt(contentLengthRaw, 10);
      if (Number.isFinite(contentLength) && contentLength > this.maxBytes) {
        return null;
      }
    }

    // (2) Post-check po pobraniu (gdy Content-Length brak / kłamie).
    // Streaming abort z byte-counterem nie jest w scope — pobieramy do RAM
    // i sprawdzamy. Liczymy realną długość w bajtach (UTF-8 może mieć
    // 2-4 bajty na znak), żeby `maxBytes` znaczyło to samo w obu warstwach.
    // Buffer.byteLength nie alokuje kopii — to szybkie binding do V8.
    const html = await response.text();
    if (Buffer.byteLength(html, "utf8") > this.maxBytes) {
      return null;
    }

    return this.extractFromHtml(html, url);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
```

- [ ] **Step 5.4: Run testy, expect PASS**

```bash
npx vitest run tests/readability-extractor.test.ts
```

- [ ] **Step 5.5: Commit**

```bash
git add src/services/readability-extractor.ts tests/readability-extractor.test.ts
git commit -m "feat: tryExtract with timeout, size limit, content-type guard"
```

---

## Task 6: Integracja w `handleRead` za feature flagą

**Files:**
- Modify: `src/tools/read.ts`
- Modify: `tests/read-handler.test.ts`

- [ ] **Step 6.1: Failing test — Readability path z feature flagą (OPT-IN)**

W `tests/read-handler.test.ts` dodaj:

```typescript
import { ReadabilityExtractor } from "../src/services/readability-extractor.js";

describe("handleRead — Readability path", () => {
  let client: JinaClient;
  let fileManager: FileManager;
  let readability: ReadabilityExtractor;

  beforeEach(() => {
    client = new JinaClient("test-key");
    vi.spyOn(client, "read").mockResolvedValue({ title: "Jina", content: "via jina" });
    fileManager = new FileManager("/tmp/.ai_pages");
    vi.spyOn(fileManager, "savePage").mockResolvedValue({
      filePath: "/tmp/.ai_pages/x.md",
      fullContent: "# Source\n\nbody",
    });
    readability = new ReadabilityExtractor();
    process.env.WEBSKIM_READABILITY = "1";  // OPT-IN — flag musi być explicit
  });

  afterEach(() => {
    delete process.env.WEBSKIM_READABILITY;
  });

  it("uses Readability when flag enabled and extractor returns article", async () => {
    vi.spyOn(readability, "tryExtract").mockResolvedValue({
      title: "Local",
      byline: "Anna",
      excerpt: "summary",
      content_md: "# Local\n\nLocal extracted body content (≥500 chars padding)…".padEnd(600, "x"),
      length: 600,
      url: "https://x",
    });

    const result = await handleRead(
      { url: "https://x" },
      { client, fileManager, readability }
    );

    expect(readability.tryExtract).toHaveBeenCalledWith("https://x");
    expect(client.read).not.toHaveBeenCalled();
    expect(result.content[0].text).toContain("Local");
  });

  it("falls back to Jina when Readability returns null", async () => {
    vi.spyOn(readability, "tryExtract").mockResolvedValue(null);

    await handleRead({ url: "https://x" }, { client, fileManager, readability });

    expect(client.read).toHaveBeenCalled();
  });

  it("skips Readability when flag NOT set (default = opt-in)", async () => {
    delete process.env.WEBSKIM_READABILITY;
    vi.spyOn(readability, "tryExtract");

    await handleRead({ url: "https://x" }, { client, fileManager, readability });

    expect(readability.tryExtract).not.toHaveBeenCalled();
    expect(client.read).toHaveBeenCalled();
  });

  it("skips Readability when flag set to '0'", async () => {
    process.env.WEBSKIM_READABILITY = "0";
    vi.spyOn(readability, "tryExtract");

    await handleRead({ url: "https://x" }, { client, fileManager, readability });

    expect(readability.tryExtract).not.toHaveBeenCalled();
    expect(client.read).toHaveBeenCalled();
  });

  describe("Jina-specific params force fallback (semantic skip)", () => {
    beforeEach(() => {
      vi.spyOn(readability, "tryExtract").mockResolvedValue({
        title: "Local",
        byline: null,
        excerpt: null,
        content_md: "x".repeat(600),
        length: 600,
        url: "https://x",
      });
    });

    it("target_selector → skip Readability", async () => {
      await handleRead(
        { url: "https://x", target_selector: "article" },
        { client, fileManager, readability }
      );
      expect(readability.tryExtract).not.toHaveBeenCalled();
      expect(client.read).toHaveBeenCalled();
    });

    it("remove_selector → skip Readability", async () => {
      await handleRead(
        { url: "https://x", remove_selector: ".chrome" },
        { client, fileManager, readability }
      );
      expect(readability.tryExtract).not.toHaveBeenCalled();
    });

    it("max_tokens → skip Readability (Jina cap protection)", async () => {
      await handleRead(
        { url: "https://x", max_tokens: 1000 },
        { client, fileManager, readability }
      );
      expect(readability.tryExtract).not.toHaveBeenCalled();
    });

    it("include_images=true → skip Readability", async () => {
      await handleRead(
        { url: "https://x", include_images: true },
        { client, fileManager, readability }
      );
      expect(readability.tryExtract).not.toHaveBeenCalled();
    });

    it("links!='referenced' → skip Readability", async () => {
      await handleRead(
        { url: "https://x", links: "inline" },
        { client, fileManager, readability }
      );
      expect(readability.tryExtract).not.toHaveBeenCalled();
    });

    it("links='referenced' (default match) → Readability OK", async () => {
      await handleRead(
        { url: "https://x", links: "referenced" },
        { client, fileManager, readability }
      );
      expect(readability.tryExtract).toHaveBeenCalled();
    });
  });

  describe("extracted_by visibility", () => {
    it("markdown response (default mode) ends with 'Extracted by:' footer", async () => {
      vi.spyOn(readability, "tryExtract").mockResolvedValue({
        title: "Local",
        byline: null,
        excerpt: null,
        content_md: "x".repeat(600),
        length: 600,
        url: "https://x",
      });
      const result = await handleRead({ url: "https://x" }, { client, fileManager, readability });
      expect(result.content[0].text).toMatch(/Extracted by:\s*readability/i);
    });

    it("markdown response shows 'jina' when Readability skipped", async () => {
      vi.spyOn(readability, "tryExtract").mockResolvedValue(null);
      const result = await handleRead({ url: "https://x" }, { client, fileManager, readability });
      expect(result.content[0].text).toMatch(/Extracted by:\s*jina/i);
    });

    it("format='json' includes extracted_by field set to 'jina' on fallback", async () => {
      vi.spyOn(readability, "tryExtract").mockResolvedValue(null);
      const result = await handleRead(
        { url: "https://x", format: "json" },
        { client, fileManager, readability }
      );
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.extracted_by).toBe("jina");
    });
  });
});
```

- [ ] **Step 6.2: Verify FAIL**

- [ ] **Step 6.3: Update `HandleReadDeps` żeby przyjmować Readability**

W `src/tools/read.ts`:

```typescript
import { ReadabilityExtractor, type ExtractedArticle } from "../services/readability-extractor.js";

export interface HandleReadDeps {
  client: JinaClient;
  fileManager: FileManager;
  readability: ReadabilityExtractor;
}
```

> ⚠️ **Breaking change w sygnaturze `HandleReadDeps`.** Wszystkie istniejące testy ze Sprintu 1 wołające `handleRead(args, { client, fileManager })` zaczną padać kompilacją TypeScript. Naprawiamy w Step 6.3.5.

- [ ] **Step 6.3.5: Migracja istniejących testów Sprint 1**

W `tests/read-handler.test.ts` znajdź wszystkie `handleRead(...args, { client, fileManager })` (z testów napisanych w Sprincie 1, Task 3+4) i dodaj `readability` do deps. Najprostsze: dopisz w głównym `beforeEach`:

```typescript
let readability: ReadabilityExtractor;

beforeEach(() => {
  // ...existing client + fileManager setup...
  readability = new ReadabilityExtractor();
  // Default: stub żeby Readability nie chodziło do sieci w testach Sprintu 1.
  // Sprint 1 testy nie ustawiają WEBSKIM_READABILITY, więc shouldTryReadability
  // zwróci false (opt-in default), ale stub jest defensywny.
  vi.spyOn(readability, "tryExtract").mockResolvedValue(null);
});
```

I zamień wszystkie wywołania:

```typescript
// PRZED
await handleRead(args, { client, fileManager });

// PO
await handleRead(args, { client, fileManager, readability });
```

Sprawdź też `tests/read-inline.test.ts` jeśli używa `handleRead` (raczej tylko `formatInlineResponse` więc nie powinno).

Run wszystkie testy — powinny przejść:

```bash
npm test
```

Expected: zielono. Sprint 1 testy wciąż weryfikują forwarding parametrów do Jiny (bo flaga jest off w domyślnym env), Sprint 2 testy weryfikują ścieżkę Readability (z `WEBSKIM_READABILITY=1` w `beforeEach`).

- [ ] **Step 6.4: Update `handleRead` — try Readability first (z guardami)**

Zamień ciało `handleRead` na:

```typescript
function shouldTryReadability(args: HandleReadArgs): boolean {
  // Opt-in flag (Sprint 2 first release).
  if (process.env.WEBSKIM_READABILITY !== "1") return false;

  // Jina-specific options force fallback — Readability nie ma odpowiedników.
  if (args.target_selector !== undefined) return false;
  if (args.remove_selector !== undefined) return false;
  if (args.max_tokens !== undefined) return false;
  if (args.include_images === true) return false;
  if (args.links !== undefined && args.links !== "referenced") return false;

  return true;
}

export async function handleRead(
  args: HandleReadArgs,
  deps: HandleReadDeps
): Promise<{ isError?: boolean; content: { type: "text"; text: string }[] }> {
  const { client, fileManager, readability } = deps;
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
    let title: string;
    let content: string;
    let extractedBy: "readability" | "jina";

    let article: ExtractedArticle | null = null;
    if (shouldTryReadability(args)) {
      article = await readability.tryExtract(args.url);
    }

    if (article) {
      title = article.title || args.url;
      content = article.content_md;
      extractedBy = "readability";
    } else {
      const jinaResult = await client.read(args.url, {
        target_selector: args.target_selector,
        remove_selector: args.remove_selector,
        max_tokens: args.max_tokens,
        include_images: args.include_images,
        links: args.links,
      });
      title = jinaResult.title;
      content = jinaResult.content;
      extractedBy = "jina";
    }

    const { filePath, fullContent } = await fileManager.savePage(content, args.url);

    if (args.format === "json") {
      const payload = {
        title,
        byline: article?.byline ?? null,
        excerpt: article?.excerpt ?? null,
        content_md: content,
        length: content.length,
        url: args.url,
        extracted_by: extractedBy,
        file_path: filePath,
      };
      return { content: [{ type: "text", text: JSON.stringify(payload) }] };
    }

    const baseText = inlineFlag
      ? formatInlineResponse({ title, fullContent, filePath, head_lines: args.head_lines })
      : formatFileResponse({ title, content, fullContent, filePath });

    // extracted_by widoczne dla agenta także w markdown — jednolinijkowy footer.
    const text = `${baseText}\n\n_Extracted by: ${extractedBy}_`;

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

> **Note:** integruje też `format: "json"` (z Task 7) — kod się splata; jeden krok.

- [ ] **Step 6.5: Update `HandleReadArgs`**

Dodaj `format`:

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
  format?: "markdown" | "json";
}
```

- [ ] **Step 6.6: Update `registerReadTool`**

Stwórz `ReadabilityExtractor` w `index.ts` i przekazuj. Najpierw zaktualizuj sygnaturę:

```typescript
export function registerReadTool(
  server: McpServer,
  client: JinaClient,
  fileManager: FileManager,
  readability: ReadabilityExtractor
) {
  server.tool(
    "webskim_read",
    "...",  // opis poniżej
    {
      // ...existing params...
      format: z.enum(["markdown", "json"]).optional().describe(
        "Output format. Default markdown (file path + TOC, or inline). 'json' returns {title, byline, excerpt, content_md, length, url, extracted_by, file_path}."
      ),
    },
    async (args) => handleRead(args, { client, fileManager, readability })
  );
}
```

- [ ] **Step 6.7: Update `src/index.ts` żeby wstrzykuje `ReadabilityExtractor`**

```typescript
import { ReadabilityExtractor } from "./services/readability-extractor.js";

const readability = new ReadabilityExtractor();
registerReadTool(server, client, fileManager, readability);
```

- [ ] **Step 6.8: Run testy, expect PASS**

```bash
npm test
```

- [ ] **Step 6.9: Commit**

```bash
git add src/tools/read.ts src/index.ts tests/read-handler.test.ts
git commit -m "feat: try Readability first; fallback to Jina; format:json with extracted_by"
```

---

## Task 7: Integracja z fixture'ami end-to-end (smoke test)

**Files:**
- Modify: `tests/read-handler.test.ts`

- [ ] **Step 7.1: Failing test — happy path z fixturem**

```typescript
import { fileURLToPath } from "node:url";
const fixturesDir = fileURLToPath(new URL("./fixtures/", import.meta.url));

it("end-to-end: news article fixture → Readability → markdown response", async () => {
  process.env.WEBSKIM_READABILITY = "1";
  const html = fs.readFileSync(path.join(fixturesDir, "article-news.html"), "utf8");

  // mock low-level fetch dla ReadabilityExtractor
  mockFetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    headers: new Headers({ "content-type": "text/html" }),
    text: async () => html,
  });

  const realReadability = new ReadabilityExtractor();
  const result = await handleRead(
    { url: "https://example.com/news" },
    { client, fileManager, readability: realReadability }
  );

  expect(client.read).not.toHaveBeenCalled();
  expect(result.content[0].text).toContain("Test artykuł");
  expect(result.content[0].text).not.toContain("Powiązane artykuły");
  expect(result.content[0].text).toMatch(/Extracted by:\s*readability/i);
});

it("end-to-end: SPA shell fixture → fallback to Jina", async () => {
  process.env.WEBSKIM_READABILITY = "1";
  const html = fs.readFileSync(path.join(fixturesDir, "spa-shell.html"), "utf8");

  mockFetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    headers: new Headers({ "content-type": "text/html" }),
    text: async () => html,
  });

  const realReadability = new ReadabilityExtractor();
  const result = await handleRead(
    { url: "https://example.com/spa" },
    { client, fileManager, readability: realReadability }
  );

  expect(client.read).toHaveBeenCalled();
  expect(result.content[0].text).toMatch(/Extracted by:\s*jina/i);
});

it("end-to-end: format='json' returns structured payload with extracted_by='readability'", async () => {
  process.env.WEBSKIM_READABILITY = "1";
  const html = fs.readFileSync(path.join(fixturesDir, "article-news.html"), "utf8");

  mockFetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    headers: new Headers({ "content-type": "text/html" }),
    text: async () => html,
  });

  const realReadability = new ReadabilityExtractor();
  const result = await handleRead(
    { url: "https://example.com/news", format: "json" },
    { client, fileManager, readability: realReadability }
  );

  const parsed = JSON.parse(result.content[0].text);
  expect(parsed.extracted_by).toBe("readability");
  expect(parsed.title).toContain("Test artykuł");
  expect(parsed.length).toBeGreaterThan(500);
  expect(parsed.url).toBe("https://example.com/news");
  expect(typeof parsed.file_path).toBe("string");
});
```

- [ ] **Step 7.2: Run, expect PASS**

(Już powinno działać dzięki Task 6 — to weryfikacja end-to-end.)

- [ ] **Step 7.3: Commit**

```bash
git add tests/read-handler.test.ts
git commit -m "test: end-to-end Readability path + Jina fallback via fixtures"
```

---

## Task 8: Sanity benchmark (vitest, gated, real network)

**Files:**
- Modify: `tests/readability-extractor.test.ts`

> **Why:** kryterium sukcesu sprintu wymaga ≥4/5 hit rate na realnych URL-ach. Nie chodzimy do sieci w CI — używamy `it.skipIf` z env-flagą żeby uruchamiać benchmark świadomie z `WEBSKIM_BENCHMARK=1`.
>
> **Why not `scripts/`:** `tsconfig.json:include` to `["src/**/*"]`, więc katalog `scripts/` nie wchodzi do `dist/`. `tsx` nie jest depką. Vitest jest już zainstalowany i działa z TypeScript out-of-the-box, więc reuse istniejącej infry.

- [ ] **Step 8.1: Dodaj benchmark jako gated test**

Na końcu `tests/readability-extractor.test.ts`:

```typescript
const BENCH = process.env.WEBSKIM_BENCHMARK === "1";

describe.skipIf(!BENCH)("Sanity benchmark — real network (set WEBSKIM_BENCHMARK=1)", () => {
  // Używamy realnego fetch — restoreAllMocks żeby nie kolidowało z innymi testami w pliku.
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  // 5 stabilnych URL-i (low churn, public, archival-friendly):
  // - Wikipedia: niemal wieczne
  // - MDN: stable, tech doc
  // - Stripe blog: dobrze ustrukturyzowany article
  // - The Verge "feature" article: archiwum journalistic, nie newsroom
  // - Hacker News story: prosty layout, mało chrome'u
  // Jeśli któryś z URL-i przestanie działać — zaktualizuj listę przed runem.
  const urls = [
    "https://en.wikipedia.org/wiki/TypeScript",
    "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise",
    "https://stripe.com/blog/payment-api-design",
    "https://overreacted.io/jsx-over-the-wire/",
    "https://news.ycombinator.com/item?id=1",
  ];

  for (const url of urls) {
    it(`extracts: ${url}`, { timeout: 15_000 }, async () => {
      const extractor = new ReadabilityExtractor();
      const t0 = Date.now();
      const result = await extractor.tryExtract(url);
      const ms = Date.now() - t0;

      if (result) {
        // eslint-disable-next-line no-console
        console.log(`OK   ${ms}ms  ${result.length}ch  ${url}`);
      } else {
        // eslint-disable-next-line no-console
        console.log(`MISS ${ms}ms  -        ${url}`);
      }
      // Nie failujemy — benchmark zbiera dane. Hit rate ocenia developer ręcznie.
    });
  }
});
```

- [ ] **Step 8.2: Uruchom benchmark**

```bash
WEBSKIM_BENCHMARK=1 npm test -- tests/readability-extractor.test.ts
```

- [ ] **Step 8.3: Zweryfikuj kryterium sukcesu**

Min. 4/5 OK na realnych URL-ach. Jeśli mniej — sprawdź:
- Czy User-Agent jest realistyczny (niektóre serwisy odrzucają nodejs UA mimo headera).
- Czy `minContentLength: 500` nie ucina za wcześnie.
- Czy `linkedom` poprawnie parsuje (np. `<noscript>` może chować treść).

- [ ] **Step 8.4: Commit benchmark suite (sam test, bez wyników)**

```bash
git add tests/readability-extractor.test.ts
git commit -m "test: gated real-network benchmark for Readability hit rate"
```

---

## Task 9: README + version bump

**Files:**
- Modify: `README.md`
- Modify: `package.json`

- [ ] **Step 9.1: README — sekcja `webskim_read` (nowy flow)**

Dodaj sekcję:

```markdown
## How `webskim_read` extracts content

webskim can try two paths:

1. **Local Readability** (~200ms, $0): direct fetch + Mozilla Readability (same engine as Firefox Reader View). Best for static articles, blogs, Wikipedia, docs.
2. **Jina** (~2-5s, uses credits): handles SPAs, antibot CDNs, paywalled pages.

**Default in 1.6.0: Jina-only (opt-in for Readability).** Enable Readability by setting `WEBSKIM_READABILITY=1` in env. Future release (1.6.1+) will flip the default to Readability-first.

Readability is also automatically skipped when caller passes Jina-specific options: `target_selector`, `remove_selector`, `max_tokens`, `include_images: true`, or `links` other than `referenced`.

Every response — markdown and `format: "json"` — includes which path was used: a footer line `_Extracted by: readability_` (or `jina`) in markdown, or the `extracted_by` field in JSON.
```

- [ ] **Step 9.2: README — `format: "json"` dla `webskim_read`**

```markdown
**`format` parameter:**

- `markdown` (default): file path + TOC, or inline markdown if `inline:true`.
- `json`: structured response — `{title, byline, excerpt, content_md, length, url, extracted_by, file_path}`.
```

- [ ] **Step 9.3: Bump wersji w trzech miejscach**

`package.json` (pole `"version"`):

```json
"version": "1.6.0",
```

`src/index.ts` — pole `version` w `new McpServer({...})`:

```typescript
const server = new McpServer({
  name: "webskim",
  version: "1.6.0",
});
```

`package-lock.json`:

```bash
npm install --package-lock-only
```

Verify:

```bash
grep -nE '"version"\s*:\s*"' package.json package-lock.json | head
grep -n 'version: "' src/index.ts
```

- [ ] **Step 9.4: Build i tests**

```bash
npm run build && npm test
```

Expected: zero errors, all tests pass.

- [ ] **Step 9.5: Commit**

```bash
git add README.md package.json package-lock.json src/index.ts
git commit -m "docs: document Readability flow and format:json; bump 1.6.0"
```

---

## Task 10 (osobny PR-5, po obserwacji): Flip do default-on

**Files:**
- Modify: `src/tools/read.ts` (`shouldTryReadability` logika)
- Modify: `package.json`, `package-lock.json`, `src/index.ts` (`McpServer({version})`) — bump 1.6.1
- Modify: README

> **NIE wykonuj jako część Sprintu 2 / 1.6.0.** To osobny PR po sanity benchmarcie + tygodniu obserwacji w prod.

- [ ] **Step 10.1: Flip default**

W `shouldTryReadability` w `src/tools/read.ts` zamień:

```typescript
if (process.env.WEBSKIM_READABILITY !== "1") return false;
```

na:

```typescript
if (process.env.WEBSKIM_READABILITY === "0") return false;
```

(Default-on; `=0` to escape hatch.)

- [ ] **Step 10.2: Update testy**

W `tests/read-handler.test.ts`:
- `it("skips Readability when flag NOT set (default = opt-in)")` → przeciw-test: zmień na "uses Readability by default" + `delete process.env.WEBSKIM_READABILITY` + assert called.
- `it("skips Readability when flag set to '0'")` → bez zmian.

- [ ] **Step 10.3: Bump 1.6.1 (3 miejsca)**

Jak w Step 9.3, ale wersja `1.6.1`.

- [ ] **Step 10.4: Update CHANGELOG**

```
1.6.1 — Sprint 2 follow-up

- WEBSKIM_READABILITY default flipped to ON. Set =0 to force Jina path.
```

- [ ] **Step 10.5: Commit**

```bash
git add src/tools/read.ts tests/read-handler.test.ts README.md package.json package-lock.json src/index.ts
git commit -m "feat: enable Readability path by default (1.6.1)"
```

---

## Self-Review

- ✅ **Spec coverage:**
  - B1 podstawowy: Task 1–7.
  - `format: "json"` dla `webskim_read`: Task 6 (zintegrowany razem z dispatch); test integracyjny w Task 7.
  - Feature flag `WEBSKIM_READABILITY` jako **opt-in** (`=== "1"`): `shouldTryReadability` w Step 6.4. Flip do default-on osobny PR (Task 10).
  - Skip-when-Jina-params (`target_selector` / `remove_selector` / `max_tokens` / `include_images: true` / `links !== "referenced"`): testy w Step 6.1, implementacja w `shouldTryReadability` (Step 6.4).
  - Skip dla `.pdf`/`.zip`/etc.: Step 5.1 testy + `NON_HTML_EXTENSIONS` regex (Step 5.3).
  - `extracted_by` widoczne w obu modach: markdown footer + JSON field (Step 6.4 + testy w Step 6.1).
  - Sanity benchmark: Task 8 (vitest gated z `WEBSKIM_BENCHMARK=1`, nie `scripts/`).
  - Bump w 3 miejscach: Step 9.3 (`package.json` + `package-lock.json` + `src/index.ts` w `new McpServer({...})`).
- ✅ **ESM-friendly:** wszystkie fixtures path używają `new URL("./fixtures/", import.meta.url) + fileURLToPath` (Step 4.1, 7.1). Brak `__dirname`.
- ✅ **Size limit:** dwie warstwy (Content-Length pre-check + `html.length` post-check). Brak streaming-abort (poza scope, plan i spec spójne).
- ✅ **Placeholders:** brak TBD/TODO; każdy task ma konkretny kod.
- ✅ **Type consistency:** `ExtractedArticle`, `ReadabilityExtractor`, `HandleReadDeps`, `extracted_by`, `shouldTryReadability` — używane spójnie w testach i kodzie.
- ⚠️ **Gap:** fixture'y dla Wikipedia / blog / PrincePerfect dopisane lakonicznie w Task 2.4 — spec zostawia formę dla developera, ale każdy musi mieć ≥500 znaków treści w `<article>` / `<main>` / `<div id="mw-content-text">`.
- ⚠️ **Risk: linkedom DOM differences.** Jeśli pojawią się false-negatives na Readability (treść jest, a `isProbablyReaderable` zwraca false) — można dodać liberalniejszy fallback bezpośrednio przez `Readability.parse()` z większym `charThreshold`. Dopisać przy issue.

## Execution Handoff

Po zaaprobowaniu tego speca dwie opcje:

**1. Subagent-Driven (recommended)** — fresh subagent per task, two-stage review między taskami.

**2. Inline Execution** — wykonanie w obecnej sesji z checkpointami.

Pytanie do usera: który tryb po zaakceptowaniu speca?
