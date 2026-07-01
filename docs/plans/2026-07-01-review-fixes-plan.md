# Review Fixes (2026-07-01) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Naprawić wszystkie błędy z code review 2026-07-01: regex zjadający segmenty ścieżki w nazwach plików, marnowanie creditów Jiny w search, kruchą detekcję code fence w TOC, ciche wycinanie treści bez sygnału dla agenta, nadpisywanie plików między procesami, mylący komunikat timeoutu, zdriftowaną wersję i nieaktualne README/plany.

**Architecture:** Zmiany punktowe w istniejących modułach (`file-manager`, `toc-generator`, `jina-client`, `tools/read`, `index`) + aktualizacja dokumentacji. Zero nowych plików źródłowych, zero nowych zależności. Każdy task ma własny cykl test → implementacja → commit.

**Tech Stack:** TypeScript (ESM, Node 22), vitest, MCP SDK. Bez nowych bibliotek.

## Global Constraints

- **Shell tego środowiska ma zepsuty wrapper nvm** (`_nvm_load` rekursja). NIE używaj gołych `node` / `npm` / `npx`. Zawsze pełne ścieżki:
  - node: `/Users/przemek/.nvm/versions/node/v22.14.0/bin/node`
  - npm: `/Users/przemek/.nvm/versions/node/v22.14.0/bin/npm`
  - testy: `/Users/przemek/.nvm/versions/node/v22.14.0/bin/node node_modules/.bin/vitest run`
  - build: `/Users/przemek/.nvm/versions/node/v22.14.0/bin/node node_modules/typescript/bin/tsc`
- Katalog roboczy: `/Users/przemek/new-wave/webskim`. Wszystkie ścieżki w tasках względem niego.
- **Subagenci pracują na wspólnym working tree — NIGDY `git checkout` / zmiana brancha** (patrz memory: feedback_subagent_git_inspect). Inspekcja historii tylko przez `git show`.
- Docelowa wersja release: **1.7.0** (zmiany w output: nowy opcjonalny hint w read, query w slugach nazw plików, zmiana headerów search — kontrakt w README każe bumpować minor).
- Nagłówek `X-Respond-With: no-content` dla `s.jina.ai` jest potwierdzony w oficjalnej dokumentacji Jiny (https://docs.jina.ai/ — "You can do search-only, without attempting to retrieve the underlying page, by adding the header X-Respond-With: no-content").
- Styl commitów: conventional commits, jak w historii repo (`feat:`, `fix:`, `docs:`).
- README jest po angielsku — edycje README po angielsku. Plany w `docs/plans/` po polsku.

---

### Task 1: file-manager — regex rozszerzenia nie może zjadać segmentów ścieżki

**Problem:** `.replace(/\.[^.]+$/, "")` działa na całej ścieżce PRZED zamianą `/` na `__`, a `[^.]+` dopasowuje slashe. `/releases/v2.5/index` → `releases/v2` (zweryfikowane w Node). Fix: wykluczyć `/` z klasy znaków.

**Files:**
- Modify: `src/services/file-manager.ts:28`
- Test: `tests/file-manager.test.ts`

**Interfaces:**
- Consumes: nic (samodzielny fix).
- Produces: `generateFilename(url: string): string` — sygnatura bez zmian; slugi z kropką w środkowym segmencie przestają być ucinane.

- [ ] **Step 1: Write the failing test**

W `tests/file-manager.test.ts`, w bloku `describe("generateFilename", ...)`, dodaj:

```typescript
    it("does not eat path segments when a middle segment contains a dot", () => {
      // Bug: /\.[^.]+$/ matched ".5/index" because [^.]+ spans slashes
      const name = fm.generateFilename("https://example.com/releases/v2.5/index");
      expect(name).toMatch(/_example_com__releases__v2\.5__index\.md$/);
    });

    it("still strips a real file extension on the last segment", () => {
      const name = fm.generateFilename("https://example.com/docs/v1.2/page.html");
      expect(name).toMatch(/_example_com__docs__v1\.2__page\.md$/);
    });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `/Users/przemek/.nvm/versions/node/v22.14.0/bin/node node_modules/.bin/vitest run tests/file-manager.test.ts`
Expected: FAIL — pierwszy nowy test dostaje slug `_example_com__releases__v2.md` (ucięty ogon).

- [ ] **Step 3: Write minimal implementation**

W `src/services/file-manager.ts` zmień linię:

```typescript
      .replace(/\.[^.]+$/, "")                  // strip file extension
```

na:

```typescript
      .replace(/\.[^./]+$/, "")                 // strip file extension (never across /)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `/Users/przemek/.nvm/versions/node/v22.14.0/bin/node node_modules/.bin/vitest run tests/file-manager.test.ts`
Expected: PASS (wszystkie testy pliku).

- [ ] **Step 5: Commit**

```bash
git add src/services/file-manager.ts tests/file-manager.test.ts
git commit -m "fix(file-manager): extension-strip regex no longer eats path segments across slashes"
```

---

### Task 2: file-manager — query string w slugu nazwy pliku

**Problem:** `?day=6` i `?day=7` dają identyczny slug (rozróżnia tylko timestamp) — agent nie odróżni plików po nazwie. Dokładamy zsanityzowany query do sluga. Fragment (`#...`) nadal pomijany (client-side, nie zmienia treści).

**Files:**
- Modify: `src/services/file-manager.ts` (funkcja `generateFilename`, po zamianie slashy, przed truncation)
- Test: `tests/file-manager.test.ts` (w tym AKTUALIZACJA istniejącego testu "strips query parameters and fragments")

**Interfaces:**
- Consumes: Task 1 (ta sama funkcja — wykonać po Tasku 1).
- Produces: `generateFilename` — URL z query dostaje suffix `__<query-sanitized>`, np. `example_com__page__q-test.md`. Testy nazw plików w innych taskach zakładają tę konwencję.

- [ ] **Step 1: Write the failing tests (i zaktualizuj stary)**

W `tests/file-manager.test.ts` ZASTĄP istniejący test:

```typescript
    it("strips query parameters and fragments", () => {
      const name = fm.generateFilename("https://example.com/page?q=test#section");
      expect(name).toMatch(/^\d{8}_\d{9}_example_com__page.md$/);
    });
```

tym blokiem:

```typescript
    it("encodes query string into slug, drops fragment", () => {
      const name = fm.generateFilename("https://example.com/page?q=test#section");
      expect(name).toMatch(/^\d{8}_\d{9}_example_com__page__q-test\.md$/);
    });

    it("distinguishes URLs differing only by query", () => {
      const a = fm.generateFilename("https://example.com/pogoda?day=6");
      const b = fm.generateFilename("https://example.com/pogoda?day=7");
      expect(a).toMatch(/_example_com__pogoda__day-6\.md$/);
      expect(b).toMatch(/_example_com__pogoda__day-7\.md$/);
    });

    it("caps very long query strings at 60 chars in the slug", () => {
      const name = fm.generateFilename(`https://example.com/p?x=${"a".repeat(300)}`);
      // slug part after "__" from query must be <= 60 chars
      const queryPart = name.split("__").pop()!.replace(/\.md$/, "");
      expect(queryPart.length).toBeLessThanOrEqual(60);
    });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `/Users/przemek/.nvm/versions/node/v22.14.0/bin/node node_modules/.bin/vitest run tests/file-manager.test.ts`
Expected: FAIL — 3 nowe/zmienione testy (query obecnie w ogóle nie trafia do sluga).

- [ ] **Step 3: Write minimal implementation**

W `src/services/file-manager.ts`, w `generateFilename`, bezpośrednio PO bloku `.replace(/\//g, "__")` a PRZED `const MAX_SLUG = 150;` wstaw:

```typescript
    // Query string distinguishes pages (?day=6 vs ?day=7); encode a sanitized,
    // capped form into the slug. Fragments (#...) stay dropped — client-side only.
    let rawQuery: string;
    try {
      rawQuery = decodeURIComponent(parsed.search);
    } catch {
      rawQuery = parsed.search;
    }
    let query = rawQuery
      .slice(1)                                 // remove leading ?
      .replace(/[^\p{L}\p{N}]+/gu, "-")         // anything non-alphanumeric → -
      .replace(/^-+|-+$/g, "");
    const MAX_QUERY = 60;
    if (query.length > MAX_QUERY) query = query.slice(0, MAX_QUERY);
    if (query) path = path ? `${path}__${query}` : query;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `/Users/przemek/.nvm/versions/node/v22.14.0/bin/node node_modules/.bin/vitest run tests/file-manager.test.ts`
Expected: PASS (wszystkie, łącznie z "caps slug length to 150 chars" — MAX_SLUG tnie po dodaniu query).

- [ ] **Step 5: Commit**

```bash
git add src/services/file-manager.ts tests/file-manager.test.ts
git commit -m "feat(file-manager): encode sanitized query string into cache filenames"
```

---

### Task 3: file-manager — zapis bez nadpisywania (wx + retry)

**Problem:** licznik kolizji jest in-memory per proces; dwa serwery dzielące `WEBSKIM_CACHE_DIR` (udokumentowany use-case "shared volumes") piszące w tej samej ms nadpiszą sobie plik. Fix: `writeFile` z flagą `wx` (fail on exist) + retry z nową nazwą.

**Files:**
- Modify: `src/services/file-manager.ts` (metoda `savePage`)
- Test: `tests/file-manager.test.ts`

**Interfaces:**
- Consumes: `generateFilename` z Tasków 1–2 (bez zmian sygnatury).
- Produces: `savePage(content: string, url: string): Promise<{ filePath: string; fullContent: string }>` — sygnatura bez zmian; gwarancja: nigdy nie nadpisze istniejącego pliku.

- [ ] **Step 1: Write the failing test**

W `tests/file-manager.test.ts`, w bloku `describe("savePage", ...)`, dodaj:

```typescript
    it("does not overwrite an existing file — retries with a regenerated name", async () => {
      const spy = vi
        .spyOn(fm, "generateFilename")
        .mockReturnValueOnce("collision.md")
        .mockReturnValueOnce("collision.md") // second savePage: first attempt collides
        .mockReturnValueOnce("retry.md");    // second savePage: retry succeeds

      const a = await fm.savePage("first", "https://example.com/a");
      const b = await fm.savePage("second", "https://example.com/b");

      expect(a.filePath).toMatch(/collision\.md$/);
      expect(b.filePath).toMatch(/retry\.md$/);
      expect(readFileSync(a.filePath, "utf-8")).toContain("first");
      expect(readFileSync(b.filePath, "utf-8")).toContain("second");
      spy.mockRestore();
    });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `/Users/przemek/.nvm/versions/node/v22.14.0/bin/node node_modules/.bin/vitest run tests/file-manager.test.ts`
Expected: FAIL — obecny `savePage` nadpisuje `collision.md` treścią "second" i zwraca `collision.md` dla obu wywołań (mock `generateFilename` wywoływany tylko raz per savePage).

- [ ] **Step 3: Write minimal implementation**

W `src/services/file-manager.ts` ZASTĄP całą metodę `savePage`:

```typescript
  async savePage(content: string, url: string): Promise<{ filePath: string; fullContent: string }> {
    await mkdir(this.baseDir, { recursive: true });
    const header = `<!-- Source: ${url} -->\n\n`;
    const fullContent = header + content;

    // Collision counter is per-process; two servers sharing WEBSKIM_CACHE_DIR
    // can generate the same name in the same ms. "wx" fails on existing file;
    // retry regenerates a name (same-ms regeneration gets a _cNNNN suffix).
    const MAX_ATTEMPTS = 5;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const filePath = join(this.baseDir, this.generateFilename(url));
      try {
        await writeFile(filePath, fullContent, { encoding: "utf-8", flag: "wx" });
        return { filePath, fullContent };
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      }
    }
    throw new Error(`Could not create a unique cache file for ${url} after ${MAX_ATTEMPTS} attempts`);
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `/Users/przemek/.nvm/versions/node/v22.14.0/bin/node node_modules/.bin/vitest run tests/file-manager.test.ts`
Expected: PASS (wszystkie — istniejące testy savePage używają realnych nazw, `wx` na świeżym katalogu przechodzi).

- [ ] **Step 5: Commit**

```bash
git add src/services/file-manager.ts tests/file-manager.test.ts
git commit -m "fix(file-manager): never overwrite existing cache files (wx flag + retry)"
```

---

### Task 4: toc-generator — poprawna detekcja code fence

**Problem:** toggle na każdej linii `` ``` ``/`~~~`: (a) fence z wcięciem 1–3 spacji niewykryty (nagłówki wcięcie 0–3 akceptują — niespójność), (b) fence 4+ backticków zawierający przykładowe `` ``` `` w środku mis-toggluje, (c) `~~~` zamykane przez `` ``` `` (mismatch znaków). Fix: śledzić znak i długość fence'a otwierającego; zamykać tylko fencem tego samego znaku o długości >= otwierającego (CommonMark).

**Files:**
- Rewrite: `src/services/toc-generator.ts`
- Test: `tests/toc-generator.test.ts`

**Interfaces:**
- Consumes: nic.
- Produces: `generateToc(markdown: string): string` — sygnatura i format wyjścia (`L<n>: <heading>`) bez zmian.

- [ ] **Step 1: Write the failing tests**

W `tests/toc-generator.test.ts` dodaj na końcu `describe("generateToc", ...)`:

```typescript
  it("recognizes fences indented 1-3 spaces", () => {
    const markdown = [
      "# Real",
      "  ```",           // indented fence — must open a block
      "# fake heading",
      "  ```",
      "## Also Real",
    ].join("\n");
    expect(generateToc(markdown)).toBe(["L1: # Real", "L5: ## Also Real"].join("\n"));
  });

  it("does not close a 4-backtick fence with a 3-backtick line", () => {
    const markdown = [
      "````",            // opens with 4 backticks
      "```",             // example fence inside — must NOT close
      "# fake heading",
      "```",
      "````",            // closes
      "# Real",
    ].join("\n");
    expect(generateToc(markdown)).toBe("L6: # Real");
  });

  it("does not close a backtick fence with a tilde line (and vice versa)", () => {
    const markdown = [
      "```",
      "~~~",             // different marker — must NOT close
      "# fake heading",
      "```",             // closes
      "# Real",
    ].join("\n");
    expect(generateToc(markdown)).toBe("L5: # Real");
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `/Users/przemek/.nvm/versions/node/v22.14.0/bin/node node_modules/.bin/vitest run tests/toc-generator.test.ts`
Expected: FAIL — wszystkie 3 nowe testy (fake headingi trafiają do TOC lub prawdziwe znikają).

- [ ] **Step 3: Write minimal implementation**

ZASTĄP całą zawartość `src/services/toc-generator.ts`:

```typescript
export function generateToc(markdown: string): string {
  const lines = markdown.split("\n");
  const entries: string[] = [];
  // CommonMark: a fence opens with 3+ backticks or tildes (0-3 spaces indent)
  // and closes only with the SAME character repeated at least as many times.
  let fence: { char: string; len: number } | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const fenceMatch = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1];
      if (!fence) {
        fence = { char: marker[0], len: marker.length };
      } else if (marker[0] === fence.char && marker.length >= fence.len) {
        fence = null;
      }
      continue;
    }

    if (!fence && /^ {0,3}#{1,6}\s/.test(line)) {
      entries.push(`L${i + 1}: ${line.trimStart()}`);
    }
  }

  return entries.join("\n");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `/Users/przemek/.nvm/versions/node/v22.14.0/bin/node node_modules/.bin/vitest run tests/toc-generator.test.ts tests/file-manager.test.ts`
Expected: PASS (toc-generator w całości; file-manager.test.ts też, bo importuje `generateToc` w teście wyrównania TOC).

- [ ] **Step 5: Commit**

```bash
git add src/services/toc-generator.ts tests/toc-generator.test.ts
git commit -m "fix(toc): track fence char+length per CommonMark; support indented fences"
```

---

### Task 5: jina-client — search bez pobierania pełnych stron (X-Respond-With: no-content)

**Problem:** `s.jina.ai` domyślnie pobiera pełną treść top wyników (potwierdzone w README jina-ai/reader), a webskim mapuje tylko `title/url/description` i resztę wyrzuca — płacimy creditami i latencją za treść, której nie używamy. Oficjalna dokumentacja Jiny (docs.jina.ai): header `X-Respond-With: no-content` = search-only, bez pobierania stron. Usuwamy też bezcelowy w tym trybie `X-Return-Format: markdown`.

**Files:**
- Modify: `src/services/jina-client.ts` (metoda `search`, nagłówki)
- Test: `tests/jina-client.test.ts` (AKTUALIZACJA testu z exact-match nagłówków + nowy test)

**Interfaces:**
- Consumes: nic.
- Produces: `search(query, options): Promise<SearchResult[]>` — sygnatura i kształt wyniku bez zmian; zmienia się tylko zestaw wysyłanych nagłówków.

- [ ] **Step 1: Update the exact-header test and add a dedicated one**

W `tests/jina-client.test.ts`, w pierwszym teście `describe("search")` ZASTĄP blok `headers:`:

```typescript
        headers: {
          Authorization: "Bearer test-api-key",
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-Respond-With": "no-content",
        },
```

oraz dodaj w `describe("search", ...)` nowy test:

```typescript
    it("sends X-Respond-With: no-content and no X-Return-Format (search-only, no page fetching)", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ data: [] }) });
      await client.search("test");
      const headers = mockFetch.mock.calls[0][1].headers;
      expect(headers["X-Respond-With"]).toBe("no-content");
      expect(headers).not.toHaveProperty("X-Return-Format");
    });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `/Users/przemek/.nvm/versions/node/v22.14.0/bin/node node_modules/.bin/vitest run tests/jina-client.test.ts`
Expected: FAIL — 2 testy (stary exact-match i nowy).

- [ ] **Step 3: Write minimal implementation**

W `src/services/jina-client.ts`, w metodzie `search`, ZASTĄP definicję nagłówków:

```typescript
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      // Search-only: without this, s.jina.ai fetches full content of every hit
      // (billed per token) which webskim discards — we only use title/url/description.
      "X-Respond-With": "no-content",
    };
```

(usuwając linię `"X-Return-Format": "markdown",` — dotyczy tylko `search()`; w `read()` zostaje bez zmian).

- [ ] **Step 4: Run tests to verify they pass**

Run: `/Users/przemek/.nvm/versions/node/v22.14.0/bin/node node_modules/.bin/vitest run tests/jina-client.test.ts`
Expected: PASS (wszystkie 23+1 testy).

- [ ] **Step 5: Commit**

```bash
git add src/services/jina-client.ts tests/jina-client.test.ts
git commit -m "fix(search): request no-content from s.jina.ai — stop paying for discarded page content"
```

---

### Task 6: jina-client — neutralny komunikat timeoutu

**Problem:** timeout w `fetchWithTimeout` mówi "page took too long to load. Try a different URL" — mylące dla search (nie ma "page" ani "URL" do zmiany). Komunikat wspólny dla obu endpointów musi być neutralny.

**Files:**
- Modify: `src/services/jina-client.ts:88-92`
- Test: `tests/jina-client.test.ts`

**Interfaces:**
- Consumes: nic.
- Produces: komunikat błędu timeoutu pasujący do search i read; nadal łapie `/timeout/i` (istniejący test).

- [ ] **Step 1: Write the failing test**

W `tests/jina-client.test.ts`, w `describe("error hints (Sprint 1)", ...)` dodaj:

```typescript
    it("timeout message is endpoint-neutral (mentions URL or query, not just page)", async () => {
      const abortErr = new Error("aborted");
      abortErr.name = "AbortError";
      mockFetch.mockRejectedValueOnce(abortErr);
      await expect(client.search("x")).rejects.toThrow(/different URL or query/i);
    });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `/Users/przemek/.nvm/versions/node/v22.14.0/bin/node node_modules/.bin/vitest run tests/jina-client.test.ts`
Expected: FAIL — obecny komunikat to "page took too long to load. Try a different URL."

- [ ] **Step 3: Write minimal implementation**

W `src/services/jina-client.ts`, w `fetchWithTimeout`, ZASTĄP:

```typescript
        throw new Error(
          `Request timeout after ${this.timeoutMs}ms — page took too long to load. Try a different URL.`
        );
```

na:

```typescript
        throw new Error(
          `Request timeout after ${this.timeoutMs}ms — upstream took too long. Retry once; if it persists, try a different URL or query.`
        );
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `/Users/przemek/.nvm/versions/node/v22.14.0/bin/node node_modules/.bin/vitest run tests/jina-client.test.ts`
Expected: PASS — nowy test i stary `timeout (AbortError) → hint about timeout + retry` (`/timeout/i` nadal pasuje).

- [ ] **Step 5: Commit**

```bash
git add src/services/jina-client.ts tests/jina-client.test.ts
git commit -m "fix(errors): endpoint-neutral timeout message (search has no 'page' to blame)"
```

---

### Task 7: read handler — jawny sygnał, gdy default chrome stripper mógł wyciąć treść

**Problem:** domyślny `DEFAULT_REMOVE_SELECTOR` używa substring-matchy (`[class*="related"]`, `[class*="newsletter"]`...), które mogą wyciąć prawdziwą treść. Agent widzi krótką/pustą stronę bez informacji, że coś wycięto — słabe modele wpadają w pętlę (patrz webskim-feedback-2026-05-05.md). Fix: gdy treść po ekstrakcji jest krótka (<500 znaków) i działał domyślny stripper, dokładamy hint z instrukcją wyłączenia.

**Files:**
- Modify: `src/tools/read.ts` (funkcja `handleRead`)
- Test: `tests/read-handler.test.ts`

**Interfaces:**
- Consumes: `handleRead(args, deps)` — istniejąca sygnatura.
- Produces: odpowiedź tekstowa może kończyć się linią hintu (`Note: content is very short...retry with remove_selector: ''`). Task 9 dokumentuje to w README Output Contract.

- [ ] **Step 1: Write the failing tests**

W `tests/read-handler.test.ts`, w `describe("handleRead", ...)` dodaj:

```typescript
  it("appends a stripper hint when content is short and default remove_selector was active", async () => {
    vi.spyOn(client, "read").mockResolvedValue({ title: "T", content: "tiny" });
    const result = await handleRead({ url: "https://example.com" }, { client, fileManager });
    expect(result.content[0].text).toContain("remove_selector: ''");
  });

  it("no stripper hint when caller set remove_selector explicitly", async () => {
    vi.spyOn(client, "read").mockResolvedValue({ title: "T", content: "tiny" });
    const result = await handleRead(
      { url: "https://example.com", remove_selector: ".x" },
      { client, fileManager }
    );
    expect(result.content[0].text).not.toContain("remove_selector: ''");
  });

  it("no stripper hint when content is long", async () => {
    vi.spyOn(client, "read").mockResolvedValue({ title: "T", content: "x".repeat(600) });
    const result = await handleRead({ url: "https://example.com" }, { client, fileManager });
    expect(result.content[0].text).not.toContain("remove_selector: ''");
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `/Users/przemek/.nvm/versions/node/v22.14.0/bin/node node_modules/.bin/vitest run tests/read-handler.test.ts`
Expected: FAIL — pierwszy test (brak hintu w obecnym kodzie); pozostałe dwa przechodzą od razu (to guard-testy).

- [ ] **Step 3: Write minimal implementation**

W `src/tools/read.ts`, w `handleRead`, ZASTĄP fragment budujący `text`:

```typescript
    const text = inlineFlag
      ? formatInlineResponse({ title, fullContent, filePath: displayPath, head_lines: args.head_lines })
      : formatFileResponse({ title, content, fullContent, filePath: displayPath });

    return { content: [{ type: "text", text }] };
```

na:

```typescript
    let text = inlineFlag
      ? formatInlineResponse({ title, fullContent, filePath: displayPath, head_lines: args.head_lines })
      : formatFileResponse({ title, content, fullContent, filePath: displayPath });

    // The default remove_selector uses substring class matches that can strip
    // real content. When the result is suspiciously short and the default
    // stripper was active, tell the agent how to opt out instead of letting it
    // conclude the page is empty (weak models loop on "empty" pages).
    const STRIPPER_HINT_THRESHOLD = 500;
    if (args.remove_selector === undefined && content.length < STRIPPER_HINT_THRESHOLD) {
      text +=
        "\n\nNote: content is very short and the default chrome stripper was active. " +
        "If this page seems empty, retry with remove_selector: '' to disable stripping.";
    }

    return { content: [{ type: "text", text }] };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `/Users/przemek/.nvm/versions/node/v22.14.0/bin/node node_modules/.bin/vitest run tests/read-handler.test.ts tests/read-inline.test.ts`
Expected: PASS bez zmian w istniejących testach (zweryfikowane podczas planowania: testy formatterów w `read-inline.test.ts` wołają `formatFileResponse`/`formatInlineResponse` bezpośrednio — hint dodawany w `handleRead` ich nie dotyczy; jedyny test integracyjny "returns formatted file-mode envelope on success" i testy w `read-handler.test.ts` używają wyłącznie asercji `toContain`/`not.toContain`, które hint spełnia). Jeśli mimo to coś padnie — zatrzymaj się i pokaż failure, nie łataj w ciemno.

- [ ] **Step 5: Commit**

```bash
git add src/tools/read.ts tests/read-handler.test.ts tests/read-inline.test.ts
git commit -m "feat(read): hint when default chrome stripper may have removed real content"
```

---

### Task 8: index.ts — wersja czytana z package.json (koniec driftu)

**Problem:** wersja hardcoded w `src/index.ts:18` + `package.json` (+ README) — DoD Sprintu 2 każe pamiętać o bumpie "w trzech miejscach". Odczyt z `package.json` w runtime eliminuje jedno z nich.

**Files:**
- Modify: `src/index.ts:16-19`

**Interfaces:**
- Consumes: `package.json` w root pakietu (npm gwarantuje jego obecność obok `dist/`).
- Produces: `McpServer` rejestrowany z wersją z `package.json`. Brak zmian API.

- [ ] **Step 1: Write the implementation** (index.ts nie ma testów jednostkowych — weryfikacja przez build + uruchomienie)

W `src/index.ts` ZASTĄP:

```typescript
const server = new McpServer({
  name: "webskim",
  version: "1.6.0",
});
```

na:

```typescript
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
// dist/index.js lives one level below package root, so ../package.json
// resolves to this package's manifest both in dev and when installed via npx.
const { version } = require("../package.json") as { version: string };

const server = new McpServer({
  name: "webskim",
  version,
});
```

(import `createRequire` przenieś na górę pliku, do pozostałych importów).

- [ ] **Step 2: Build and verify the server starts and reports the right version**

Run:
```bash
/Users/przemek/.nvm/versions/node/v22.14.0/bin/node node_modules/typescript/bin/tsc
printf '' | JINA_API_KEY=test-key /Users/przemek/.nvm/versions/node/v22.14.0/bin/node dist/index.js
```
Expected: build bez błędów; serwer wypisuje `webskim server started` na stderr i kończy się po EOF na stdin (bez crasha).

- [ ] **Step 3: Run the full test suite (regression gate)**

Run: `/Users/przemek/.nvm/versions/node/v22.14.0/bin/node node_modules/.bin/vitest run`
Expected: PASS — wszystkie pliki testów.

- [ ] **Step 4: Commit**

```bash
git add src/index.ts
git commit -m "fix(version): read server version from package.json instead of hardcoding"
```

---

### Task 9: Dokumentacja + bump 1.7.0

**Problem:** (a) README Quick Start dla Claude Desktop nie ustawia `WEBSKIM_CACHE_DIR` — Desktop startuje serwery z cwd `/`, `mkdir /.ai_pages` → EACCES, każdy read pada; Desktop nie ma też narzędzia `Read`, więc trzeba wskazać `inline: true`. (b) Stale "~230 tokens per tool definition". (c) Plan Sprintu 2 celuje w zajęte numery wersji (1.6.0/1.6.1) i każe bumpować wersję w `src/index.ts`, którego już nie ma po Tasku 8. (d) Bump do 1.7.0 + wpis w Output Contract.

**Files:**
- Modify: `README.md` (sekcje: Claude Desktop, Why webskim?, Output Contract/Versioning, Configuration)
- Modify: `docs/plans/2026-05-05-sprint2-plan.md` (numery wersji, DoD)
- Modify: `package.json`, `package-lock.json` (wersja 1.7.0)

**Interfaces:**
- Consumes: zachowanie z Tasków 2 (query w slugach), 5 (search no-content), 7 (hint) — opisujemy je w kontrakcie.
- Produces: spójna dokumentacja wydania 1.7.0.

- [ ] **Step 1: Fix the Claude Desktop section in README.md**

ZASTĄP blok "Claude Desktop" (linie ~48-60):

````markdown
**Claude Desktop** — add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "webskim": {
      "command": "npx",
      "args": ["-y", "webskim"],
      "env": {
        "JINA_API_KEY": "jina_...",
        "WEBSKIM_CACHE_DIR": "/Users/you/.webskim-pages"
      }
    }
  }
}
```

> **Desktop notes:** Claude Desktop launches MCP servers with cwd `/`, so the
> default cache dir (`<cwd>/.ai_pages`) is not writable — always set
> `WEBSKIM_CACHE_DIR` to a writable absolute path. Claude Desktop also has no
> `Read` tool, so use `inline: true` (optionally with `head_lines`) to get page
> content back directly; the default file-path + TOC response is designed for
> agentic clients like Claude Code.
````

- [ ] **Step 2: Drop the stale token-count claim in README.md**

ZASTĄP linię:

```markdown
**Tiny footprint** — ~230 tokens per tool definition in system prompt. Minimal overhead vs. built-in alternatives.
```

na:

```markdown
**Tiny footprint** — two lean tool definitions in the system prompt. Minimal overhead vs. built-in alternatives.
```

- [ ] **Step 3: Update Output Contract + version note in README.md**

W sekcji `### Versioning` ZASTĄP:

```markdown
The output contract follows the package version (semver). Current: **1.6.0**. Schema-affecting changes bump the minor version and are noted here.
```

na:

```markdown
The output contract follows the package version (semver). Current: **1.7.0**. Schema-affecting changes bump the minor version and are noted here.

1.7.0 changes:
- `webskim_read` (both modes) may append a final `Note: content is very short and the default chrome stripper was active...` line when extracted content is under 500 chars and the default `remove_selector` was applied.
- Cache filenames now encode a sanitized query string (`?day=6` → `..._pogoda__day-6.md`); fragments are still dropped.
- `webskim_search` no longer fetches page content server-side (`X-Respond-With: no-content`) — same response shape, lower Jina credit usage and latency.
```

- [ ] **Step 4: Renumber Sprint 2 plan and fix its DoD**

W `docs/plans/2026-05-05-sprint2-plan.md`:
- Zamień wszystkie wystąpienia `1.6.0` na `1.8.0` i `1.6.1` na `1.8.1` (sekcje Scope, Decyzje projektowe pkt 7, Sekwencja PR-ów, Kryteria sukcesu, DoD).
- W DoD ZASTĄP punkt:

```markdown
- [ ] Wersja bump'nięta na `1.8.0` w **trzech miejscach**: `package.json`, `package-lock.json`, `src/index.ts` (hardcoded w `new McpServer({ name, version })`).
```

na:

```markdown
- [ ] Wersja bump'nięta na `1.8.0` w `package.json` + `package-lock.json` (`src/index.ts` czyta wersję z `package.json` w runtime — nie wymaga edycji). Zaktualizować "Current" w sekcji Output Contract w README.
```

- Dopisz pod nagłówkiem `**Status:** Draft` linię: `**Uwaga (2026-07-01):** wersje przenumerowane 1.6.x → 1.8.x — 1.6.0 zostało wydane wcześniej z innym zakresem, 1.7.0 to release poprawek z review.`

- [ ] **Step 5: Bump version to 1.7.0**

W `package.json` zmień `"version": "1.6.0"` na `"version": "1.7.0"`, potem zsynchronizuj lockfile:

Run: `/Users/przemek/.nvm/versions/node/v22.14.0/bin/npm install --package-lock-only`
Expected: `package-lock.json` ma `"version": "1.7.0"` w obu miejscach (root i `packages[""]`).

- [ ] **Step 6: Full regression + build**

Run:
```bash
/Users/przemek/.nvm/versions/node/v22.14.0/bin/node node_modules/.bin/vitest run
/Users/przemek/.nvm/versions/node/v22.14.0/bin/node node_modules/typescript/bin/tsc
printf '' | JINA_API_KEY=test-key /Users/przemek/.nvm/versions/node/v22.14.0/bin/node dist/index.js
```
Expected: wszystkie testy PASS; build czysty; serwer wypisuje `webskim server started`.

- [ ] **Step 7: Commit**

```bash
git add README.md docs/plans/2026-05-05-sprint2-plan.md package.json package-lock.json
git commit -m "docs: 1.7.0 — Desktop cache-dir requirement, contract notes, sprint2 renumber"
```

---

## Weryfikacja końcowa (po wszystkich taskach)

- [ ] `/Users/przemek/.nvm/versions/node/v22.14.0/bin/node node_modules/.bin/vitest run` — komplet zielony (70 istniejących + ~14 nowych).
- [ ] `/Users/przemek/.nvm/versions/node/v22.14.0/bin/node node_modules/typescript/bin/tsc` — zero błędów.
- [ ] Live smoke (opcjonalnie, wymaga `JINA_API_KEY` z `.env`): jedno wywołanie search przez zbudowany serwer i porównanie czasu odpowiedzi z ~2.5s baseline — `no-content` powinno zejść poniżej sekundy.
- [ ] `git log --oneline` — 9 commitów zgodnych z taskami.
