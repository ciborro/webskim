# Phase 5 — YAML frontmatter + cache manifest

**Status:** Pending
**Target release:** 2.0.0 (breaking change formatu plików)
**Dependencies:** Phase 0 (wszystkie), Phase 2 (rendering linków w pliku, do ew. przesunięcia do frontmattera)
**Estimate:** 3–4h

## Summary

Dwa niezależne ulepszenia w jednej fazie, bo oba dotykają formatu zapisywanych plików:

- **5a:** HTML komentarz `<!-- Source: ... -->` zastąpiony YAML frontmatter z bogatą metadaną (hash, timestamp, options, version).
- **5b:** `.manifest.json` śledzi zapisane pliki po URL + options_hash — przy powtórnym fetchu tego samego URL serwer zwraca cached path z „age" metadaną zamiast re-fetchować Jina.

Breaking change: nowy format plików. Stare pliki pozostają czytelne (grep, Read), ale nie są indeksowane w manifest chyba że zostaną ponownie fetched.

## Checklist

- [ ] 5a — YAML frontmatter
  - [ ] `FileManager.savePage` dokleja YAML zamiast HTML komentarza
  - [ ] `format_version: 1` w frontmatter
  - [ ] `content_hash` (sha256)
  - [ ] TOC liczony z całego pliku (nie tylko content) — frontmatter wpada do L1-LN
  - [ ] Testy parsowania
- [ ] 5b — Cache manifest
  - [ ] `.ai_pages/.manifest.json` struktura + atomic write (tmp + rename)
  - [ ] Hit check przed Jina call
  - [ ] TTL konfigurowalne (env `WEBSKIM_CACHE_TTL`, default 86400s)
  - [ ] `no_cache` webskim param (webskim-level, różne od Jina `X-No-Cache`)
  - [ ] `options_hash` dla różnicowania selektorów/tokenów
  - [ ] Reconciliation: plik usunięty → cache miss
- [ ] Migracja: stare pliki tolerowane, grep nie crashuje
- [ ] README update

## Open questions

1. **Pełny rewrite vs additive?** → Additive: zostawić stare pliki in situ, nowe zapisywać w nowym formacie. Grep nie parsuje YAML, więc po prostu traktuje jak 8 zbędnych linii kontekstu.
2. **Czy backward-read stare pliki do re-saveu w nowym formacie?** → Nie. User może ręcznie wyczyścić cache. Reconciliation tylko jeśli user re-fetchuje URL.
3. **Gdzie trzymać linki/obrazy z Phase 2 — w frontmatter czy sekcji markdown?** → Sekcja markdown. YAML frontmatter to structured metadata o STRONIE, nie jej zawartości. Linki to zawartość — reprezentują elementy renderowalne na stronie.
4. **Czy `content_hash` wymaga dużo CPU?** → Nie. sha256 na 10-100kB to <5ms. Akceptowalne.

---

## 5a — YAML frontmatter

### Nowy format pliku

```markdown
---
source_url: https://example.com/docs/api
fetched_at: 2026-04-21T15:32:12.123Z
format_version: 1
content_hash: sha256:3a2b4c5d6e7f...
estimated_tokens: 2800
total_lines: 342
jina_options:
  target_selector: null
  remove_selector: null
  token_budget: null
  wait_for_selector: null
  no_cache: false
  include_links: true
---

# Title of the page

Content begins here...
```

### Implementation

```ts
// src/services/file-manager.ts
import { createHash } from "node:crypto";

async savePage(content: string, url: string, options: SavedOptions): Promise<SaveResult> {
  await mkdir(this.baseDir, { recursive: true });
  const filename = this.generateFilename(url);
  const filePath = join(this.baseDir, filename);

  const contentHash = createHash("sha256").update(content).digest("hex");
  const now = new Date();
  const totalLines = content.split("\n").length + /* frontmatter lines */ 10; // approx

  const frontmatter = [
    "---",
    `source_url: ${url}`,
    `fetched_at: ${now.toISOString()}`,
    `format_version: 1`,
    `content_hash: sha256:${contentHash}`,
    `estimated_tokens: ${Math.round(content.length / 4)}`,
    `jina_options:`,
    `  target_selector: ${options.target_selector ?? "null"}`,
    `  remove_selector: ${options.remove_selector ?? "null"}`,
    `  token_budget: ${options.max_tokens ?? "null"}`,
    `  wait_for_selector: ${options.wait_for_selector ?? "null"}`,
    `  no_cache: ${options.no_cache ?? false}`,
    `  include_links: ${options.include_links ?? false}`,
    "---",
    "",
  ].join("\n");

  const fullContent = frontmatter + content;
  await writeFile(filePath, fullContent, "utf-8");

  return {
    filePath,
    fullContent,
    contentHash,
    fetchedAt: now,
  };
}
```

Uwaga: `total_lines` trzeba liczyć PO skleceniu (bo frontmatter też zwiększa). Robimy recompute:

```ts
const fullContent = frontmatter + content;
const totalLines = fullContent.split("\n").length;
// Jeśli chcemy total_lines w samym frontmatter, trzeba dwuprzebiegowo albo szacować.
```

Proste rozwiązanie: nie pakować `total_lines` do frontmattera. Zostawić je w response od tool (read.ts).

### TOC + frontmatter

Z B1 TOC jest generowany z `fullContent`. YAML frontmatter nie zawiera `# headings`, więc nie dostanie się do TOC. Line numbers są prawidłowe względem pliku.

### Testy

```ts
it("saves page with YAML frontmatter", async () => {
  const { filePath } = await fm.savePage("# Hello\n\nBody", "https://x.com/p", { });
  const saved = readFileSync(filePath, "utf-8");
  expect(saved).toMatch(/^---\n/);
  expect(saved).toContain("source_url: https://x.com/p");
  expect(saved).toContain("format_version: 1");
  expect(saved).toContain("content_hash: sha256:");
});

it("content_hash is deterministic for same input", async () => {
  const a = await fm.savePage("abc", "https://x.com", {});
  const b = await fm.savePage("abc", "https://x.com", {});
  expect(a.contentHash).toBe(b.contentHash);
});
```

---

## 5b — Cache manifest

### Struktura `.ai_pages/.manifest.json`

```json
{
  "version": 1,
  "entries": {
    "<cache_key>": {
      "url": "https://example.com/x",
      "file_path": ".ai_pages/20260421_153045_example_com__x.md",
      "fetched_at": "2026-04-21T15:32:12.123Z",
      "content_hash": "sha256:..."
    }
  }
}
```

Gdzie `cache_key = sha256(url + "|" + options_hash)`. Różne selektory = różne entries pod tym samym URL.

### Atomic write

Bez race'ów przy równoczesnych callach:

```ts
import { rename, writeFile } from "node:fs/promises";

async saveManifest(manifest: Manifest): Promise<void> {
  const tmpPath = join(this.baseDir, `.manifest.json.tmp.${process.pid}.${Date.now()}`);
  const finalPath = join(this.baseDir, ".manifest.json");
  await writeFile(tmpPath, JSON.stringify(manifest, null, 2), "utf-8");
  await rename(tmpPath, finalPath);
}
```

### Cache check flow

```ts
// src/tools/read.ts (pseudo)
async function handleRead(params) {
  const cacheKey = buildCacheKey(url, options);
  const manifest = await cacheStore.load();
  const entry = manifest.entries[cacheKey];

  if (!params.no_cache && entry) {
    const age = Date.now() - new Date(entry.fetched_at).getTime();
    const ttlMs = (parseInt(process.env.WEBSKIM_CACHE_TTL ?? "86400")) * 1000;
    if (age < ttlMs && existsSync(entry.file_path)) {
      return {
        filePath: entry.file_path,
        cached: true,
        ageSeconds: Math.round(age / 1000),
      };
    }
    // Stale lub file deleted → continue to fetch
  }

  const { title, content, links } = await client.read(url, jinaOptions);
  const { filePath, contentHash } = await fileManager.savePage(content, url, options);

  manifest.entries[cacheKey] = {
    url,
    file_path: filePath,
    fetched_at: new Date().toISOString(),
    content_hash: contentHash,
  };
  await cacheStore.save(manifest);

  return { filePath, cached: false };
}
```

### `options_hash`

```ts
function buildCacheKey(url: string, options: ReadOptions): string {
  // Sort keys deterministycznie
  const sortedKeys = Object.keys(options).sort();
  const sortedOpts = Object.fromEntries(sortedKeys.map(k => [k, options[k]]));
  const optsJson = JSON.stringify(sortedOpts);
  return createHash("sha256").update(`${url}|${optsJson}`).digest("hex").slice(0, 16);
}
```

16 znaków hex = 64 bits = wystarczające dla dedup.

### Response z cache hit

Dodać do response webskim_read:

```
**Title**
File: /path/to/cached-file.md
Lines: 342 | ~2800 tokens (estimate)
CACHED: fetched 3h 12m ago — add no_cache: true to force refresh.

Table of Contents:
...
```

Agent od razu widzi że content jest cached, może zdecydować o `no_cache` jeśli potrzebuje świeżego.

### Parametr `no_cache` (webskim-level)

Różne od Jina `X-No-Cache` (który jest w ReadOptions jako header do Jina):

```ts
// webskim_read tool schema
{
  // ... existing params
  no_cache: z.boolean().optional()
    .describe("Bypass webskim cache (re-fetch from source). Different from Jina-level cache which is controlled by Jina API."),
}
```

W `read.ts` handler:
- `no_cache: true` → skip cache lookup, nadal używaj Jina cache.
- Jeśli user chce BOTH (fresh from webskim + fresh from Jina), musi podać `no_cache: true` w webskim params, **and** Phase 2 doda osobny `jina_no_cache` flag? Albo reużywamy `no_cache` dla obu warstw?

**Decyzja:** `no_cache` w webskim_read dotyczy OBU warstw (webskim + Jina). Prostsze mental model. Jeden flag = „daj mi świeże".

### Testy

```ts
it("returns cached file on second read of same URL", async () => {
  mockFetch.mockResolvedValue({ ok: true, json: async () => ({ data: { title: "T", content: "C" } }) });
  const r1 = await handleRead({ url: "https://x.com" });
  const r2 = await handleRead({ url: "https://x.com" });
  expect(mockFetch).toHaveBeenCalledTimes(1); // drugi nie fetchuje
  expect(r2.filePath).toBe(r1.filePath);
});

it("re-fetches when no_cache: true", async () => {
  mockFetch.mockResolvedValue(/* ... */);
  await handleRead({ url: "https://x.com" });
  await handleRead({ url: "https://x.com", no_cache: true });
  expect(mockFetch).toHaveBeenCalledTimes(2);
});

it("re-fetches when options change", async () => {
  mockFetch.mockResolvedValue(/* ... */);
  await handleRead({ url: "https://x.com" });
  await handleRead({ url: "https://x.com", target_selector: "main" });
  expect(mockFetch).toHaveBeenCalledTimes(2);
});

it("re-fetches when cached file deleted from disk", async () => {
  mockFetch.mockResolvedValue(/* ... */);
  const r1 = await handleRead({ url: "https://x.com" });
  rmSync(r1.filePath);
  await handleRead({ url: "https://x.com" });
  expect(mockFetch).toHaveBeenCalledTimes(2);
});
```

---

## Migracja

### Stare pliki

Pliki zapisane w formacie <1.3 (HTML komentarz) pozostają w `.ai_pages/`. Nie są w manifest. Konsekwencje:

- `webskim_grep` na nich działa — grep nie parsuje frontmatter, tylko linie.
- Kolejne `webskim_read` tego samego URL-a nie rozpozna cache (bo URL nie w manifest) → nowy fetch, nowy plik w nowym formacie. Stary plik zostaje jako sierota.
- Użytkownik może wyczyścić `.ai_pages/` ręcznie. README zaleci to po upgrade do 2.0.0.

### Wersjonowanie

`format_version: 1` w każdym nowym pliku. Gdyby w przyszłości format się zmienił, będzie clear delinka. Manifest też ma `version: 1`.

Polityka: przy starcie serwera wczytać `.manifest.json`, jeśli `version` mismatch — zarchiwizować jako `.manifest.json.v1.bak` i zacząć świeży. Ostrzeżenie na stderr.

### Interakcja z Phase 4 (`webskim_grep`)

Po upgrade, plik zaczyna się od 14-liniowego YAML bloku. Grep z `context_lines: 2` na linii 20 pokaże linie 18-22. OK.

Problem: jeśli user grep'uje `source_url` albo inne pole YAML, dostanie matche we frontmatter. To może być pożądane (np. „gdzie jest plik z URL-em X?" — wtedy grep na `source_url: x.com/y` działa).

**Decyzja:** nie filtrować. Grep na frontmatter jest feature, nie bug.

---

## Acceptance

- Wszystkie testy jednostkowe zielone.
- Ręczny test end-to-end:
  1. `webskim_read("https://x.com")` → plik z YAML, manifest updated.
  2. Drugi `webskim_read("https://x.com")` → response pokazuje CACHED + age.
  3. `webskim_read("https://x.com", no_cache: true)` → fresh fetch, plik zaktualizowany.
  4. `rm` na pliku → następny read bez `no_cache` i tak fetchuje (reconciliation).
- README: sekcja „File format" + „Caching" + „Upgrading from 1.x".
- CHANGELOG: opis breaking change.

## Commit plan

1. `feat: save pages with YAML frontmatter (v1 format)` (5a)
2. `feat: cache manifest with hash-based deduplication` (5b) — osobny commit bo niezależna feature
3. `feat: add no_cache param to webskim_read`
4. `docs: document 2.0.0 file format changes and migration`

Release: 2.0.0.
