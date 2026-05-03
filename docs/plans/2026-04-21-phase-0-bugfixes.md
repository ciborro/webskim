# Phase 0 — Bugfixes

**Status:** Pending
**Target release:** 1.3.1 (B1–B5), 1.3.2 (B6–B8)
**Dependencies:** żadne — blokuje wszystkie pozostałe fazy
**Estimate:** 3–5h łącznie

## Summary

Naprawa dziewięciu zidentyfikowanych bugów: trzy krytyczne (off-by-2 w TOC, gubione nagłówki z wcięciem, filename sanitization cross-platform), cztery średnie (millisecond overflow, 30s w testach, `country` mapowany na zły header, scope miss w konfiguracji), dwa drobne.

## Checklist

- [ ] B1 — TOC line numbers off-by-2 [HIGH]
- [ ] B2 — TOC nie łapie wciętych nagłówków [HIGH]
- [ ] B3 — Filename sanitization cross-platform [HIGH]
- [ ] B4 — Millisecond overflow przy 999→1000 [MEDIUM]
- [ ] B5 — Test suite trwa 30s [MEDIUM — DX]
- [ ] B6 — `country` mapowany na `X-Locale` zamiast `gl` [MEDIUM]
- [ ] B7 — `prepare` → `prepublishOnly` [LOW]
- [ ] B8 — `process.cwd()` override env var [LOW]
- [ ] B9 — Code fence length w TOC [LOW — pomijamy, zakładka]

## Open questions

Brak — wszystkie bugi mają zweryfikowane fixy.

---

## B1 — TOC line numbers off-by-2 [HIGH]

**Files:** `src/services/file-manager.ts`, `src/tools/read.ts`
**Symptom:** Nagłówek w pliku na linii 3 raportowany w TOC jako L1.
**Cause:** `FileManager.savePage` dokleja przed contentem `<!-- Source: ... -->\n\n` (2 linie), ale `read.ts` generuje TOC z surowego `content`.

### Implementation

Podejście A (preferowane dla 1.3.1, potem znika w Phase 5):

```ts
// file-manager.ts
async savePage(content: string, url: string): Promise<{ filePath: string; fullContent: string }> {
  await mkdir(this.baseDir, { recursive: true });
  const filename = this.generateFilename(url);
  const filePath = join(this.baseDir, filename);
  const header = `<!-- Source: ${url} -->\n\n`;
  const fullContent = header + content;
  await writeFile(filePath, fullContent, "utf-8");
  return { filePath, fullContent };
}
```

```ts
// read.ts (fragment)
const { filePath, fullContent } = await fileManager.savePage(content, url);
const toc = generateToc(fullContent);
const totalLines = fullContent.split("\n").length;
```

Podejście B (odrzucone): parametryzować offset w `generateToc`. Problem: rozjazd przy zmianie rozmiaru headera.

### Call-site updates

Zmiana sygnatury `savePage` wymusza aktualizację istniejących testów i call sites:

- `tests/file-manager.test.ts:47,57` — destructure `{ filePath }` zamiast bezpośredniego przypisania.
- `src/tools/read.ts:27` — destructure `{ filePath, fullContent }`, użyć `fullContent` do `generateToc` i `totalLines`.

### Acceptance

Nowy test `tests/file-manager.test.ts` (albo `tests/read-toc-alignment.test.ts`) — weryfikacja end-to-end przez odczyt z dysku i odpalenie `generateToc` na zapisanej treści:

```ts
import { readFileSync } from "node:fs";
import { generateToc } from "../src/services/toc-generator.js";

it("TOC line numbers align with saved file content (header included)", async () => {
  const { filePath, fullContent } = await fm.savePage("# H1\nTekst", "https://example.com");
  const toc = generateToc(fullContent);
  // plik: L1 `<!-- Source: ... -->`, L2 pusta, L3 `# H1`, L4 `Tekst`
  expect(toc).toBe("L3: # H1");
  const savedLines = readFileSync(filePath, "utf-8").split("\n");
  expect(savedLines[2]).toBe("# H1"); // index 2 == L3
});

it("totalLines matches lines in written file", async () => {
  const { filePath, fullContent } = await fm.savePage("a\nb\nc", "https://example.com");
  const onDiskLines = readFileSync(filePath, "utf-8").split("\n").length;
  expect(fullContent.split("\n").length).toBe(onDiskLines);
});
```

### Note re Phase 5

Gdy przejdziemy na YAML frontmatter (Phase 5a), TOC i tak będzie liczony z całego pliku (frontmatter wliczony). Ten fix nie blokuje ani nie koliduje z 5a.

---

## B2 — TOC gubi nagłówki z wcięciem [HIGH]

**File:** `src/services/toc-generator.ts:14`
**Symptom:** `generateToc("   ## Indented\ntekst")` zwraca pustego string-a.
**Cause:** Regex `/^#{1,6}\s/` wymaga `#` w kolumnie 1, ale CommonMark §4.2 pozwala 0–3 spacje wcięcia.

### Implementation

```ts
if (!inCodeBlock && /^ {0,3}#{1,6}\s/.test(line)) {
  entries.push(`L${i + 1}: ${line.trimStart()}`);
}
```

### Acceptance

Dodać do `toc-generator.test.ts`:

```ts
it("matches headings with up to 3 spaces of indent", () => {
  expect(generateToc("   ## H\ntext")).toBe("L1: ## H");
  expect(generateToc("  # H\ntext")).toBe("L1: # H");
  expect(generateToc(" ### H")).toBe("L1: ### H");
});

it("rejects 4-space indent (code block) and tab", () => {
  expect(generateToc("    ## H")).toBe("");
  expect(generateToc("\t## H")).toBe("");
});
```

---

## B3 — Filename sanitization cross-platform [HIGH]

**File:** `src/services/file-manager.ts:12–23`
**Symptom:** URL `https://a.com/path?q=x:y*z` → nazwa zawiera `:`, `*`, `?` (niedozwolone na Windows).
**Cause:** Obecnie tylko slashe są zamieniane.

### Implementation

Kluczowa kolejność: sanityzacja Windows-reserved **przed** zamianą slashy na `__` (bo iterując w odwrotnej kolejności ucieklibyśmy się do collapse `__` → `_`, co zniszczyłoby obecny format slugów `domain__path__segment` weryfikowany w `tests/file-manager.test.ts:25`).

```ts
let path = parsed.pathname
  .slice(1)
  .replace(/\.[^.]+$/, "")                 // strip file extension
  .replace(/[<>:"|?*\x00-\x1f]/g, "_")     // Windows-reserved BEFORE slash replace
  .replace(/\//g, "__");                    // slashes → __ separator (preserved)

const MAX_SLUG = 150;
if (path.length > MAX_SLUG) path = path.slice(0, MAX_SLUG);
path = path.replace(/^_+|_+$/g, "");       // trim AFTER truncation
```

Świadomie **nie** robimy `.replace(/_+/g, "_")` — `__` ma semantykę separatora slashy i musi przetrwać.

Łączna nazwa pliku: `${ts}_${slug}.md` — ts ~17 znaków, slug max 150, `.md` 3, separator 1 → max 171 znaków. Mieści się w Windows 255-znakowym limicie i pozostawia margin.

### Decyzja: Unicode as-is

URL-e mogą zawierać non-ASCII (np. chińskie chars w pathname). NTFS i APFS obsługują Unicode, pliki typu `example_com__主页.md` są legalne. Sanityzacja obejmuje tylko znaki zabronione przez Windows; wszystko inne (w tym non-ASCII) przechodzi. Konsekwencja dla acceptance: **nie** testujemy `/^[a-zA-Z0-9_.-]+$/` — sprawdzamy wyłącznie nieobecność znaków zarezerwowanych.

### Acceptance

```ts
it("preserves __ slash separator convention (no underscore collapse)", () => {
  const name = fm.generateFilename("https://docs.python.org/3/tutorial/classes.html");
  expect(name).toMatch(/_docs_python_org__3__tutorial__classes\.md$/);
});

it("strips Windows-reserved characters from filename", () => {
  const name = fm.generateFilename('https://example.com/path/x:y*z');
  expect(name).not.toMatch(/[<>:"|?*\x00-\x1f]/);
  expect(name).toMatch(/_example_com__path__x_y_z\.md$/);
});

it("preserves Unicode characters in path", () => {
  const name = fm.generateFilename("https://example.com/主页");
  expect(name).toContain("example_com__主页");
});

it("caps slug length to 150 chars", () => {
  const longPath = 'a'.repeat(500);
  const name = fm.generateFilename(`https://example.com/${longPath}`);
  expect(name.length).toBeLessThanOrEqual(200);
});
```

---

## B4 — Millisecond overflow 999→1000 [MEDIUM]

**File:** `src/services/file-manager.ts:30–33`
**Cause:** `pad(1000, 3)` zwraca `"1000"` (4 cyfry). Format timestamp rozjeżdża się z 17 do 18 znaków.

### Implementation

Monotoniczny counter-sufix zamiast arytmetyki milisekund:

```ts
private lastTs = "";
private collisionCounter = 0;

generateFilename(url: string): string {
  // ...path sanitization (z B3)...

  const now = new Date();
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  const baseTs = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}${pad(now.getMilliseconds(), 3)}`;

  let ts: string;
  if (baseTs <= this.lastTs.split("_c")[0]) {
    this.collisionCounter++;
    ts = `${baseTs}_c${this.collisionCounter.toString().padStart(3, "0")}`;
  } else {
    this.collisionCounter = 0;
    ts = baseTs;
  }
  this.lastTs = ts;

  const slug = path ? `${domain}__${path}` : domain;
  return `${ts}_${slug}.md`;
}
```

Nazwy typu `20260421_153045123_domain.md` (99% przypadków) lub `20260421_153045123_c001_domain.md` (kolizja).

### Acceptance

Test musi być deterministyczny — zamrażamy `Date.now()`, żeby wszystkie 1500 iteracji trafiło w tę samą ms i wymusiło branch kolizji (inaczej wynik zależy od szybkości maszyny).

```ts
import { vi } from "vitest";

it("generates unique names when called 1500 times within same wall-clock ms", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-04-21T12:00:00.123Z"));
  try {
    const seen = new Set<string>();
    for (let i = 0; i < 1500; i++) {
      seen.add(fm.generateFilename('https://example.com'));
    }
    expect(seen.size).toBe(1500);
  } finally {
    vi.useRealTimers();
  }
});

it("uses plain timestamp (no _cNNN suffix) when calls span different ms", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-04-21T12:00:00.123Z"));
  try {
    const a = fm.generateFilename('https://example.com');
    vi.setSystemTime(new Date("2026-04-21T12:00:00.124Z"));
    const b = fm.generateFilename('https://example.com');
    expect(a).not.toMatch(/_c\d{3}_/);
    expect(b).not.toMatch(/_c\d{3}_/);
    expect(a).not.toBe(b);
  } finally {
    vi.useRealTimers();
  }
});
```

---

## B5 — Test suite trwa 30s [MEDIUM — DX]

**Files:** `src/services/jina-client.ts`, `tests/jina-client.test.ts:79`

### Implementation

```ts
// jina-client.ts
export class JinaClient {
  private apiKey: string;
  private readonly timeoutMs: number;

  constructor(apiKey: string, timeoutMs: number = 30_000) {
    this.apiKey = apiKey;
    this.timeoutMs = timeoutMs;
  }
  // ...
}
```

```ts
// jina-client.test.ts
it("aborts request after timeout", async () => {
  const fastClient = new JinaClient("test-api-key", 50);
  mockFetch.mockImplementationOnce((_url: string, init: RequestInit) => {
    return new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => {
        reject(new DOMException("The operation was aborted.", "AbortError"));
      });
    });
  });
  await expect(fastClient.search("test")).rejects.toThrow();
}); // brak długiego timeout na teście
```

### Acceptance

`npm test` kończy się w <2s.

---

## B6 — `country` mapowany na `X-Locale` zamiast `gl` [MEDIUM]

**File:** `src/services/jina-client.ts:51–52`
**Bug discovery:** Podczas researchu Phase 3. Zweryfikowane w [meta-prompt v8](https://github.com/jina-ai/meta-prompt/blob/main/v8.txt): `X-Locale` to locale renderowania strony przez Jina browser engine; geo-filtering w Search to body field `gl`.

### Implementation

```ts
// usuń ten blok:
if (options.country) {
  headers["X-Locale"] = options.country;
}

// dodaj do body:
const body: Record<string, unknown> = { q: query };
if (options.num_results) body.num = options.num_results;
if (options.country) body.gl = options.country.toLowerCase();
```

### Acceptance

```ts
it("passes country as body.gl, not X-Locale header", async () => {
  mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ data: [] }) });
  await client.search("test", { country: "PL" });
  const callArgs = mockFetch.mock.calls[0];
  expect(JSON.parse(callArgs[1].body)).toMatchObject({ q: "test", gl: "pl" });
  expect(callArgs[1].headers).not.toHaveProperty("X-Locale");
});
```

---

## B7 — `prepare` → `prepublishOnly` [LOW]

**File:** `package.json:12`

```json
"scripts": {
  "build": "tsc",
  "prepublishOnly": "npm run build",
  // reszta bez zmian
}
```

Konsumenci `npm install webskim` otrzymują pre-built `dist/` (`"files": ["dist"]`). Nie wymuszamy u nich TypeScript compilera.

### Acceptance

`prepublishOnly` odpala się wyłącznie przy `npm publish` (i `npm publish --dry-run`) — **nie** przy `npm pack --dry-run` ani przy `npm install` konsumenta. Weryfikacja:

1. `package.json` zawiera `"prepublishOnly": "npm run build"` i **nie** zawiera `"prepare": "npm run build"` (sprawdź `cat package.json | grep -E 'prepare|prepublishOnly'`).
2. `npm publish --dry-run` w świeżym klonie (bez lokalnego `dist/`) kończy się sukcesem i tarball zawiera `dist/*.js` — dowód, że hook się uruchomił i zbudował projekt przed pakowaniem.
3. `npm pack --dry-run` bez uprzedniego `npm run build` **nie** zawiera `dist/` (negatywna kontrola — potwierdza, że hook nie jest powiązany z `pack`).

---

## B8 — `WEBSKIM_CACHE_DIR` env override [LOW]

**File:** `src/index.ts:22`

```ts
const cacheDir = process.env.WEBSKIM_CACHE_DIR ?? join(process.cwd(), ".ai_pages");
const fileManager = new FileManager(cacheDir);
```

Update README (sekcja Configuration).

### Acceptance

Manualny test: `WEBSKIM_CACHE_DIR=/tmp/xyz npx webskim` — po `webskim_read` plik ląduje w `/tmp/xyz/`.

---

## B9 — Code fence length w TOC [LOW — SKIP na razie]

Nagłówek w zagnieżdżonym bloku markdown (fence-in-fence). CommonMark wymaga żeby fence zamykający miał ≥ znaków fence otwierającego. Obecna implementacja ignoruje długość — toggluje na każdym fence. Zakładka: jeśli ktoś kiedyś zgłosi.

---

## Commit order

1. `fix: align TOC line numbers with saved file content` (B1)
2. `fix: TOC picks up indented ATX headings` (B2)
3. `fix: sanitize filenames for Windows-reserved characters` (B3)
4. `fix: avoid millisecond overflow via monotonic counter suffix` (B4)
5. `test: speed up timeout test via configurable client timeout` (B5)
6. `fix: pass country as body.gl not X-Locale header` (B6) → **release 1.3.1**
7. `chore: replace prepare with prepublishOnly` (B7)
8. `feat: support WEBSKIM_CACHE_DIR env override` (B8) → **release 1.3.2**
