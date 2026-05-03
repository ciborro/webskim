# Webskim Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all bugs, remove dead code, improve robustness (response validation, timeouts, filename collisions, tilde fences), shorten tool descriptions, and add `.env.example`.

**Architecture:** All changes are in existing files. No new services or files except `.env.example`. Each task is independent — they touch different files/functions with no interdependencies.

**Tech Stack:** TypeScript, vitest, Zod, Node.js `fetch`

---

### Task 1: Validate API response shapes in JinaClient

**Files:**
- Modify: `src/services/jina-client.ts:62-71` (search), `src/services/jina-client.ts:98-103` (read), `src/services/jina-client.ts:121-126` (segment)
- Test: `tests/jina-client.test.ts`

- [ ] **Step 1: Write failing tests for malformed API responses**

Add these tests to `tests/jina-client.test.ts` inside the existing `describe` blocks:

```typescript
// Inside describe("search")
it("throws descriptive error when response has no data field", async () => {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ results: [] }),
  });

  await expect(client.search("test")).rejects.toThrow(
    "Unexpected Jina Search API response"
  );
});

// Inside describe("read")
it("throws descriptive error when response has no data field", async () => {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ result: "something" }),
  });

  await expect(client.read("https://example.com")).rejects.toThrow(
    "Unexpected Jina Reader API response"
  );
});

// Inside describe("segment")
it("throws descriptive error when response has unexpected shape", async () => {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ data: "unexpected" }),
  });

  await expect(client.segment("text")).rejects.toThrow(
    "Unexpected Jina Segmenter API response"
  );
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: 3 new tests FAIL with `TypeError: Cannot read properties of undefined`

- [ ] **Step 3: Add response validation to all three methods**

In `src/services/jina-client.ts`, replace the response parsing sections:

**search method** — replace lines 66-71:
```typescript
    const json = await response.json();

    if (!json.data || !Array.isArray(json.data)) {
      throw new Error(`Unexpected Jina Search API response: missing or invalid 'data' array`);
    }

    return json.data.map((item: { title: string; url: string; description: string }) => ({
      title: item.title,
      url: item.url,
      snippet: item.description,
    }));
```

**read method** — replace lines 102-103:
```typescript
    const json = await response.json();

    if (!json.data || typeof json.data.title !== "string" || typeof json.data.content !== "string") {
      throw new Error(`Unexpected Jina Reader API response: missing 'data.title' or 'data.content'`);
    }

    return { title: json.data.title, content: json.data.content };
```

**segment method** — replace lines 125-126:
```typescript
    const json = await response.json();

    if (typeof json.num_tokens !== "number" || !Array.isArray(json.chunks)) {
      throw new Error(`Unexpected Jina Segmenter API response: missing 'num_tokens' or 'chunks'`);
    }

    return { num_tokens: json.num_tokens, chunks: json.chunks };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: All tests PASS including the 3 new ones

- [ ] **Step 5: Commit**

```bash
git add src/services/jina-client.ts tests/jina-client.test.ts
git commit -m "fix: validate Jina API response shapes before accessing fields"
```

---

### Task 2: Add fetch timeout with AbortController

**Files:**
- Modify: `src/services/jina-client.ts` (all three fetch calls)
- Test: `tests/jina-client.test.ts`

- [ ] **Step 1: Write failing test for timeout**

Add to `tests/jina-client.test.ts` inside `describe("search")`:

```typescript
it("aborts request after timeout", async () => {
  mockFetch.mockImplementationOnce((_url: string, init: RequestInit) => {
    return new Promise((_resolve, reject) => {
      // Simulate the AbortSignal triggering
      init.signal?.addEventListener("abort", () => {
        reject(new DOMException("The operation was aborted.", "AbortError"));
      });
      // Don't resolve — simulate a hung request
    });
  });

  await expect(client.search("test")).rejects.toThrow();
}, 35000);
```

- [ ] **Step 2: Run test to verify it fails (hangs/times out)**

Run: `npm test -- --testTimeout=35000`
Expected: Test hangs because no timeout is set on fetch

- [ ] **Step 3: Add timeout to all fetch calls**

Add a private helper at the top of `JinaClient` class, after the `apiKey` field:

```typescript
  private readonly timeoutMs = 30000;

  private fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    return fetch(url, { ...init, signal: controller.signal }).finally(() =>
      clearTimeout(timeout)
    );
  }
```

Then replace all three `fetch(` calls in `search`, `read`, and `segment` with `this.fetchWithTimeout(`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: All tests PASS. The timeout test now correctly aborts.

- [ ] **Step 5: Commit**

```bash
git add src/services/jina-client.ts tests/jina-client.test.ts
git commit -m "fix: add 30s timeout to all Jina API fetch calls"
```

---

### Task 3: Fix filename collision — add milliseconds

**Files:**
- Modify: `src/services/file-manager.ts:24-28`
- Test: `tests/file-manager.test.ts`

- [ ] **Step 1: Write failing test for sub-second uniqueness**

Add to `tests/file-manager.test.ts` inside `describe("generateFilename")`:

```typescript
it("generates unique filenames for same URL called rapidly", () => {
  const name1 = fm.generateFilename("https://example.com/page");
  const name2 = fm.generateFilename("https://example.com/page");
  expect(name1).not.toBe(name2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — both names are identical (same second)

- [ ] **Step 3: Add milliseconds to timestamp**

In `src/services/file-manager.ts`, replace the timestamp generation (lines 24-28) with:

```typescript
    const now = new Date();
    const pad = (n: number, len = 2) => String(n).padStart(len, "0");
    const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}${pad(now.getMilliseconds(), 3)}`;
```

Update the filename regex in the existing test `"creates filename from URL with timestamp prefix"` from:
```typescript
expect(name).toMatch(/^\d{8}_\d{6}_docs_python_org__3__tutorial__classes.md$/);
```
to:
```typescript
expect(name).toMatch(/^\d{8}_\d{9}_docs_python_org__3__tutorial__classes.md$/);
```

Also update `"handles URLs with no path"` regex:
```typescript
expect(name).toMatch(/^\d{8}_\d{9}_example_com.md$/);
```

And `"strips query parameters and fragments"` regex:
```typescript
expect(name).toMatch(/^\d{8}_\d{9}_example_com__page.md$/);
```

And the `savePage` test `"creates directory if not exists and saves content"` — this test checks `filePath` matches `example_com__test\.md$` which still works.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: All tests PASS — filenames now include milliseconds

- [ ] **Step 5: Commit**

```bash
git add src/services/file-manager.ts tests/file-manager.test.ts
git commit -m "fix: add milliseconds to filenames to prevent sub-second collisions"
```

---

### Task 4: Handle tilde-fenced code blocks in TOC generator

**Files:**
- Modify: `src/services/toc-generator.ts:9-11`
- Test: `tests/toc-generator.test.ts`

- [ ] **Step 1: Write failing test for tilde fences**

Add to `tests/toc-generator.test.ts`:

```typescript
it("ignores headings inside tilde-fenced code blocks", () => {
  const markdown = [
    "# Real Heading",
    "",
    "~~~",
    "# Fake heading in tilde block",
    "~~~",
    "",
    "## Another Real Heading",
  ].join("\n");

  expect(generateToc(markdown)).toBe(
    ["L1: # Real Heading", "L7: ## Another Real Heading"].join("\n")
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `# Fake heading in tilde block` appears in TOC

- [ ] **Step 3: Update code block detection to include tilde fences**

In `src/services/toc-generator.ts`, replace line 9:
```typescript
    if (line.startsWith("```")) {
```
with:
```typescript
    if (line.startsWith("```") || line.startsWith("~~~")) {
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/toc-generator.ts tests/toc-generator.test.ts
git commit -m "fix: handle tilde-fenced code blocks in TOC generator"
```

---

### Task 5: Remove dead `segment()` method and its tests

**Files:**
- Modify: `src/services/jina-client.ts` (remove `segment` method + `SegmentResult` interface)
- Modify: `tests/jina-client.test.ts` (remove `segment` describe block)

- [ ] **Step 1: Remove `SegmentResult` interface from jina-client.ts**

Delete lines 24-27 (the `SegmentResult` interface).

- [ ] **Step 2: Remove `segment()` method from jina-client.ts**

Delete the entire `segment` method (lines 106-127 approximately, after task 1 changes — the method starting with `async segment(`).

- [ ] **Step 3: Remove segment tests from jina-client.test.ts**

Delete the entire `describe("segment", ...)` block (including the malformed response test added in Task 1).

- [ ] **Step 4: Run tests to verify everything still passes**

Run: `npm test`
Expected: All remaining tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/jina-client.ts tests/jina-client.test.ts
git commit -m "refactor: remove unused segment() method and SegmentResult interface"
```

---

### Task 6: Remove redundant `?? undefined` in read tool

**Files:**
- Modify: `src/tools/read.ts:20-23`

- [ ] **Step 1: Simplify the options object**

In `src/tools/read.ts`, replace:
```typescript
        const { title, content } = await client.read(url, {
          target_selector: target_selector ?? undefined,
          remove_selector: remove_selector ?? undefined,
          max_tokens: max_tokens ?? undefined,
        });
```
with:
```typescript
        const { title, content } = await client.read(url, {
          target_selector,
          remove_selector,
          max_tokens,
        });
```

- [ ] **Step 2: Run tests to verify nothing breaks**

Run: `npm test`
Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add src/tools/read.ts
git commit -m "refactor: remove redundant ?? undefined coalescing"
```

---

### Task 7: Shorten tool descriptions

**Files:**
- Modify: `src/tools/search.ts:8`
- Modify: `src/tools/read.ts:10`

- [ ] **Step 1: Replace search tool description**

In `src/tools/search.ts`, replace the description string (line 8):
```typescript
    "Search the web and return lightweight results (title, URL, snippet) without embedding full page content in context. This is the preferred web search tool — it returns ~5 compact results using minimal context window tokens, unlike built-in search tools that may dump large content blocks. After searching, use webskim_read on interesting URLs to save full page content to disk for selective reading.",
```
with:
```typescript
    "Web search → compact results (title, URL, snippet). Preferred over built-in search — minimal token usage. Follow up with webskim_read to fetch full pages.",
```

- [ ] **Step 2: Replace read tool description**

In `src/tools/read.ts`, replace the description string (line 10):
```typescript
    "Fetch a web page or PDF, save it as markdown to disk, and return file path with table of contents and line numbers. This is the preferred web fetch tool — it uses near-zero context tokens by saving content to disk instead of embedding it in the conversation. Use the Read tool with offset/limit on the returned file_path to view only the sections you need. Supports CSS selectors for targeted extraction.",
```
with:
```typescript
    "Fetch URL/PDF → save as markdown to disk, return file path + TOC with line numbers. Near-zero context tokens. Use Read tool with offset/limit on the returned path to view specific sections.",
```

- [ ] **Step 3: Run tests + build to verify**

Run: `npm test && npm run build`
Expected: All PASS, build succeeds

- [ ] **Step 4: Commit**

```bash
git add src/tools/search.ts src/tools/read.ts
git commit -m "docs: shorten MCP tool descriptions to reduce system prompt tokens"
```

---

### Task 8: Add `.env.example`

**Files:**
- Create: `.env.example`

- [ ] **Step 1: Create `.env.example`**

```
# Get your free API key at https://jina.ai — 1M tokens included, no credit card required
JINA_API_KEY=jina_your_key_here
```

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m "docs: add .env.example with placeholder"
```

---

### Task 9: Add source URL metadata header to saved files

**Files:**
- Modify: `src/services/file-manager.ts:34-39`
- Test: `tests/file-manager.test.ts`

- [ ] **Step 1: Write failing test**

Update the existing test in `tests/file-manager.test.ts` inside `describe("savePage")`:

Replace the `"creates directory if not exists and saves content"` test with:

```typescript
it("saves content with source URL header", async () => {
  const filePath = await fm.savePage("# Hello\n\nContent", "https://example.com/test");

  expect(existsSync(filePath)).toBe(true);
  const saved = readFileSync(filePath, "utf-8");
  expect(saved).toContain("<!-- Source: https://example.com/test -->");
  expect(saved).toContain("# Hello\n\nContent");
  expect(filePath).toContain(TEST_DIR);
  expect(filePath).toMatch(/example_com__test\.md$/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — saved content does not contain `<!-- Source:` header

- [ ] **Step 3: Add URL header to savePage**

In `src/services/file-manager.ts`, modify `savePage`:

```typescript
  async savePage(content: string, url: string): Promise<string> {
    await mkdir(this.baseDir, { recursive: true });
    const filename = this.generateFilename(url);
    const filePath = join(this.baseDir, filename);
    const header = `<!-- Source: ${url} -->\n\n`;
    await writeFile(filePath, header + content, "utf-8");
    return filePath;
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/file-manager.ts tests/file-manager.test.ts
git commit -m "feat: add source URL metadata header to saved markdown files"
```

---

### Task 10: Final build and full test run

- [ ] **Step 1: Run full test suite**

Run: `npm test`
Expected: All tests PASS

- [ ] **Step 2: Build the project**

Run: `npm run build`
Expected: No TypeScript errors

- [ ] **Step 3: Verify version bump to 1.3.0**

Update `package.json` version from `"1.2.0"` to `"1.3.0"`.
Update `src/index.ts` version from `"1.2.0"` to `"1.3.0"`.

Run: `npm test && npm run build`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add package.json src/index.ts
git commit -m "chore: bump version to 1.3.0"
```
