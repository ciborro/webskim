# Phase 0 — Bugfixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix eight verified bugs (B1–B8) split across two patch releases: 1.3.1 (B1–B5, core correctness & DX) and 1.3.2 (B6–B8, behavior fix + packaging & config polish).

**Architecture:** Each bug is a small, self-contained change in an existing module. We use strict TDD: write a failing test that pins the bug, apply the smallest fix, verify green, commit. Zero new modules, zero new dependencies. Order matches the commit order in the spec so each commit is small and releasable.

**Tech Stack:** TypeScript + ESM, vitest, Node.js ≥ 18 (built-in `fetch`/`AbortController`), `@modelcontextprotocol/sdk`.

**Spec reference:** `docs/plans/2026-04-21-phase-0-bugfixes.md`

---

## File Structure

No new files are created. Modifications and test additions only:

**Source (modified):**
- `src/services/file-manager.ts` — B1 (savePage signature), B3 (filename sanitization), B4 (monotonic counter)
- `src/services/toc-generator.ts` — B2 (indented ATX regex)
- `src/services/jina-client.ts` — B5 (configurable timeout), B6 (country → body.gl)
- `src/tools/read.ts` — B1 (consume `fullContent` from savePage)
- `src/index.ts` — B8 (`WEBSKIM_CACHE_DIR` env var)
- `package.json` — B7 (`prepare` → `prepublishOnly`), version bumps
- `README.md` — B8 (document env var)

**Tests (modified/extended):**
- `tests/file-manager.test.ts` — update call sites (B1), add cases (B3, B4)
- `tests/toc-generator.test.ts` — add cases (B2)
- `tests/jina-client.test.ts` — tighten timeout test (B5), add gl body case (B6)

---

## Preflight

### Task 0: Baseline verification

**Files:** none

- [ ] **Step 1: Confirm clean working tree for source files we'll touch**

Run: `git status --short src tests package.json README.md`
Expected: empty output (no modifications in tracked source). It's OK if untracked docs/plans files exist — the phase-0 spec lives there.

- [ ] **Step 2: Run the full test suite to capture the baseline**

Run: `npm test`
Expected: all tests pass. Note the elapsed wall-clock time — it should currently be around 30s because of the B5 timeout test. We'll compare after Task 6.

- [ ] **Step 3: Confirm TypeScript builds**

Run: `npm run build`
Expected: exit code 0, `dist/` populated. No further action; do not commit.

---

## Release 1.3.1

### Task 1 (B1): Align TOC line numbers with saved file content

**Files:**
- Modify: `src/services/file-manager.ts:40-47` (savePage return type)
- Modify: `src/tools/read.ts:20-33` (consume fullContent)
- Modify: `tests/file-manager.test.ts:47,57` (destructure new return shape)
- Test: `tests/file-manager.test.ts` (new cases)

**Why the fix:** `FileManager.savePage` prepends a 2-line `<!-- Source: ... -->\n\n` header before writing, but `read.ts` currently computes the TOC from the pre-header `content`. Result: a heading on disk line 3 is reported as L1. Fix by returning the full written content and generating TOC from it.

- [ ] **Step 1: Add failing tests for post-header TOC alignment and total-lines agreement**

Append to `tests/file-manager.test.ts` inside the `describe("savePage", ...)` block (after the existing two `it` blocks):

```ts
it("returns fullContent equal to bytes written to disk", async () => {
  const { filePath, fullContent } = await fm.savePage("a\nb\nc", "https://example.com");
  const onDisk = readFileSync(filePath, "utf-8");
  expect(fullContent).toBe(onDisk);
});

it("TOC computed from fullContent aligns with lines on disk (header accounted for)", async () => {
  const { filePath, fullContent } = await fm.savePage("# H1\nTekst", "https://example.com");
  const toc = generateToc(fullContent);
  // File: L1 `<!-- Source: ... -->`, L2 empty, L3 `# H1`, L4 `Tekst`
  expect(toc).toBe("L3: # H1");
  const savedLines = readFileSync(filePath, "utf-8").split("\n");
  expect(savedLines[2]).toBe("# H1"); // index 2 == L3
});
```

Also add the `generateToc` import at the top of the file — insert directly below the existing `FileManager` import line:

```ts
import { generateToc } from "../src/services/toc-generator.js";
```

- [ ] **Step 2: Run the new tests and confirm they fail for the right reason**

Run: `npx vitest run tests/file-manager.test.ts`
Expected: FAIL. The first new test fails because `fullContent` is `undefined` (savePage currently returns a bare string). TypeScript will also flag `Property 'fullContent' does not exist on type 'string'` — that's the intended red.

- [ ] **Step 3: Change `savePage` to return both path and content**

Edit `src/services/file-manager.ts`, replace the current `savePage` method body (lines 40–47) with:

```ts
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

- [ ] **Step 4: Update the existing savePage call sites in tests**

In `tests/file-manager.test.ts`, change the two `savePage` call sites to destructure:

At (formerly) line 47:
```ts
const { filePath } = await fm.savePage("# Hello\n\nContent", "https://example.com/test");
```

At (formerly) line 57:
```ts
const { filePath } = await fm.savePage("content", "https://example.com");
```

- [ ] **Step 5: Update `read.ts` to consume `fullContent` for TOC and totalLines**

Edit `src/tools/read.ts`. Replace the lines that currently read (lines ~26–31):

```ts
// 2. Save to disk
const filePath = await fileManager.savePage(content, url);

// 3. Generate TOC and count lines/estimate tokens
const toc = generateToc(content);
const totalLines = content.split("\n").length;
```

with:

```ts
// 2. Save to disk
const { filePath, fullContent } = await fileManager.savePage(content, url);

// 3. Generate TOC and count lines/estimate tokens
const toc = generateToc(fullContent);
const totalLines = fullContent.split("\n").length;
```

The `estimatedTokens` line directly below keeps using `content.length / 4` — the header is boilerplate and should not inflate the token estimate.

- [ ] **Step 6: Run file-manager tests and the whole suite**

Run: `npx vitest run tests/file-manager.test.ts`
Expected: all PASS, including the two new ones.

Run: `npm run build`
Expected: exit 0 (confirms `read.ts` destructure compiles).

Run: `npm test`
Expected: full suite PASS.

- [ ] **Step 7: Commit**

```bash
git add src/services/file-manager.ts src/tools/read.ts tests/file-manager.test.ts
git commit -m "fix: align TOC line numbers with saved file content"
```

---

### Task 2 (B2): TOC picks up indented ATX headings

**Files:**
- Modify: `src/services/toc-generator.ts:14`
- Test: `tests/toc-generator.test.ts` (append cases)

**Why the fix:** CommonMark §4.2 allows 0–3 leading spaces before an ATX heading. Current regex `/^#{1,6}\s/` rejects them. 4+ spaces is a code block and must remain rejected.

- [ ] **Step 1: Add failing cases for 0–3 space indent and for the 4-space / tab negatives**

Append to `tests/toc-generator.test.ts` inside the `describe("generateToc", ...)` block:

```ts
it("matches headings with up to 3 spaces of indent and strips leading whitespace in output", () => {
  expect(generateToc("   ## H\ntext")).toBe("L1: ## H");
  expect(generateToc("  # H\ntext")).toBe("L1: # H");
  expect(generateToc(" ### H")).toBe("L1: ### H");
});

it("rejects 4-space indent (code block) and leading tab", () => {
  expect(generateToc("    ## H")).toBe("");
  expect(generateToc("\t## H")).toBe("");
});
```

- [ ] **Step 2: Run the new tests and confirm they fail**

Run: `npx vitest run tests/toc-generator.test.ts`
Expected: FAIL — `generateToc("   ## H\ntext")` returns `""`.

- [ ] **Step 3: Update the regex and trim leading whitespace in the output**

In `src/services/toc-generator.ts`, replace the current line 14–16 branch:

```ts
if (!inCodeBlock && /^#{1,6}\s/.test(line)) {
  entries.push(`L${i + 1}: ${line}`);
}
```

with:

```ts
if (!inCodeBlock && /^ {0,3}#{1,6}\s/.test(line)) {
  entries.push(`L${i + 1}: ${line.trimStart()}`);
}
```

Note: `trimStart()` only affects output formatting for indented headings. Non-indented headings already have no leading whitespace, so existing tests (which assert `"L1: # Introduction"` etc.) remain correct.

- [ ] **Step 4: Run toc-generator tests**

Run: `npx vitest run tests/toc-generator.test.ts`
Expected: all PASS (old four + two new).

- [ ] **Step 5: Run the whole suite for regressions**

Run: `npm test`
Expected: full PASS.

- [ ] **Step 6: Commit**

```bash
git add src/services/toc-generator.ts tests/toc-generator.test.ts
git commit -m "fix: TOC picks up indented ATX headings"
```

---

### Task 3 (B3): Sanitize filenames for Windows-reserved characters

**Files:**
- Modify: `src/services/file-manager.ts:12-23` (generateFilename pathname handling)
- Test: `tests/file-manager.test.ts` (append cases)

**Why the fix:** URLs legitimately contain `:`, `*`, `?`, `|`, `<`, `>`, `"` which are reserved on Windows NTFS. Without stripping them the file cannot be created. Order matters: sanitize Windows-reserved characters **before** replacing `/` with `__`, otherwise the `__` separator would be flattened by any subsequent underscore collapse. We deliberately do **not** collapse consecutive underscores — the `__` double-underscore is load-bearing (it marks original slashes in slugs).

- [ ] **Step 1: Add failing tests covering the preservation invariant, Windows-reserved stripping, Unicode passthrough, and length cap**

Append to `tests/file-manager.test.ts` inside `describe("generateFilename", ...)`:

```ts
it("preserves __ slash separator convention (no underscore collapse)", () => {
  const name = fm.generateFilename("https://docs.python.org/3/tutorial/classes.html");
  expect(name).toMatch(/_docs_python_org__3__tutorial__classes\.md$/);
});

it("strips Windows-reserved characters from filename", () => {
  const name = fm.generateFilename("https://example.com/path/x:y*z");
  expect(name).not.toMatch(/[<>:"|?*\x00-\x1f]/);
  expect(name).toMatch(/_example_com__path__x_y_z\.md$/);
});

it("preserves Unicode characters in path", () => {
  const name = fm.generateFilename("https://example.com/主页");
  expect(name).toContain("example_com__主页");
});

it("caps slug length to 150 chars", () => {
  const longPath = "a".repeat(500);
  const name = fm.generateFilename(`https://example.com/${longPath}`);
  expect(name.length).toBeLessThanOrEqual(200);
});
```

- [ ] **Step 2: Run the new cases and verify the Windows-reserved one fails**

Run: `npx vitest run tests/file-manager.test.ts`
Expected: FAIL on "strips Windows-reserved characters" and "caps slug length to 150 chars". The "preserves __ slash separator" case currently still passes (test exists to lock invariant). "preserves Unicode" likely already passes too, but keep both as regression guards.

- [ ] **Step 3: Apply the sanitization pipeline in `generateFilename`**

Edit `src/services/file-manager.ts`. Replace the current path-building block (lines 17–23):

```ts
let path = parsed.pathname
  .slice(1)  // remove leading /
  .replace(/\.[^.]+$/, "")  // strip file extension
  .replace(/\//g, "__");      // slashes to double underscores

// Remove trailing underscores
path = path.replace(/_+$/, "");
```

with:

```ts
let path = parsed.pathname
  .slice(1)                                 // remove leading /
  .replace(/\.[^.]+$/, "")                  // strip file extension
  .replace(/[<>:"|?*\x00-\x1f]/g, "_")      // Windows-reserved BEFORE slash replace
  .replace(/\//g, "__");                    // slashes → __ separator (preserved)

const MAX_SLUG = 150;
if (path.length > MAX_SLUG) path = path.slice(0, MAX_SLUG);
path = path.replace(/^_+|_+$/g, "");        // trim AFTER truncation
```

Do **not** add a `.replace(/_+/g, "_")` call — `__` is the slash separator and must survive.

- [ ] **Step 4: Re-run the file-manager tests**

Run: `npx vitest run tests/file-manager.test.ts`
Expected: all PASS, including the four new cases.

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: full PASS.

- [ ] **Step 6: Commit**

```bash
git add src/services/file-manager.ts tests/file-manager.test.ts
git commit -m "fix: sanitize filenames for Windows-reserved characters"
```

---

### Task 4 (B4): Avoid millisecond overflow via monotonic counter suffix

**Files:**
- Modify: `src/services/file-manager.ts` (generateFilename timestamp block, add `collisionCounter` field)
- Test: `tests/file-manager.test.ts` (append cases)

**Why the fix:** Current code detects collisions by parsing the last 3 chars as ms and adding 1. At 999+1 it produces `"1000"` (4 chars), breaking the 17-char timestamp invariant and allowing further collisions. Replace with an explicit monotonic counter suffix `_cNNN` that only appears on genuine same-ms collisions.

- [ ] **Step 1: Add failing tests using fake timers for determinism**

Append to `tests/file-manager.test.ts` inside `describe("generateFilename", ...)`. First add the `vi` import at the top of the file — extend the existing vitest import to:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
```

Then the new cases:

```ts
it("generates unique names when called 1500 times within same wall-clock ms", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-04-21T12:00:00.123Z"));
  try {
    const seen = new Set<string>();
    for (let i = 0; i < 1500; i++) {
      seen.add(fm.generateFilename("https://example.com"));
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
    const a = fm.generateFilename("https://example.com");
    vi.setSystemTime(new Date("2026-04-21T12:00:00.124Z"));
    const b = fm.generateFilename("https://example.com");
    expect(a).not.toMatch(/_c\d{3}_/);
    expect(b).not.toMatch(/_c\d{3}_/);
    expect(a).not.toBe(b);
  } finally {
    vi.useRealTimers();
  }
});
```

- [ ] **Step 2: Run the tests and confirm the 1500-iter case fails**

Run: `npx vitest run tests/file-manager.test.ts`
Expected: FAIL — current ms-increment arithmetic either produces duplicates or overflows past `\d{9}`. Set size will be well under 1500.

- [ ] **Step 3: Replace the timestamp/collision block with the monotonic counter**

Edit `src/services/file-manager.ts`. Add a new private field next to `lastTs`:

```ts
private collisionCounter = 0;
```

Replace the current timestamp block (approximately lines 25–34 of the current file — the whole `const now = new Date(); ... this.lastTs = ts;` chunk) with:

```ts
const now = new Date();
const pad = (n: number, len = 2) => String(n).padStart(len, "0");
const baseTs = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}${pad(now.getMilliseconds(), 3)}`;

let ts: string;
const lastBaseTs = this.lastTs.split("_c")[0];
if (baseTs <= lastBaseTs) {
  this.collisionCounter++;
  ts = `${baseTs}_c${this.collisionCounter.toString().padStart(3, "0")}`;
} else {
  this.collisionCounter = 0;
  ts = baseTs;
}
this.lastTs = ts;
```

Leave the `const slug = ...; return ...;` lines directly below unchanged.

- [ ] **Step 4: Re-run file-manager tests**

Run: `npx vitest run tests/file-manager.test.ts`
Expected: all PASS, including both new cases. The pre-existing "generates unique filenames for same URL called rapidly" case keeps passing (second call gets `_c001` suffix → distinct name).

Pay attention to the "creates filename from URL with timestamp prefix" case, which asserts `/^\d{8}_\d{9}_docs_python_org__3__tutorial__classes.md$/`. Because each `it` gets a fresh `FileManager` via `beforeEach`, its single `generateFilename` call hits the no-collision branch and matches the pattern. If this ever fails, the root cause is state leaking across tests — do not loosen the regex.

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: full PASS.

- [ ] **Step 6: Commit**

```bash
git add src/services/file-manager.ts tests/file-manager.test.ts
git commit -m "fix: avoid millisecond overflow via monotonic counter suffix"
```

---

### Task 5 (B5): Speed up timeout test via configurable client timeout

**Files:**
- Modify: `src/services/jina-client.ts` (constructor + field)
- Modify: `tests/jina-client.test.ts:79-89` (the `aborts request after timeout` case)

**Why the fix:** The timeout test currently waits the real 30s client timeout, padded to `35000` ms per-test. We keep the 30s production default but let tests inject a 50ms timeout and mock-abort the fetch immediately.

- [ ] **Step 1: Rewrite the existing timeout test to use a short-timeout client**

In `tests/jina-client.test.ts`, replace the current `"aborts request after timeout"` block (currently lines ~79–89, including the trailing `35000` timeout arg) with:

```ts
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
});
```

Note: no trailing `35000` vitest timeout — after the fix, the test must complete in well under 1s.

- [ ] **Step 2: Capture the pre-fix baseline (slow PASS, not FAIL)**

Important: vitest runs TypeScript through esbuild/vite-node without type-checking, and JavaScript silently ignores extra constructor arguments. So `new JinaClient("test-api-key", 50)` does **not** throw a TS error — the `50` is just dropped and the client uses its hard-coded 30s timeout. The test therefore *passes* before the fix, but slowly: it waits the full 30s for the real setTimeout→abort to fire.

This is a performance/DX fix, not a behavior fix — the red signal here is wall-clock time, not FAIL.

Run: `time npx vitest run tests/jina-client.test.ts`
Expected: all tests PASS; total elapsed ~30s (the timeout test dominates). Record the number — this is our "before" baseline. If it's under a few seconds, something else is off; investigate before proceeding.

- [ ] **Step 3: Make the client timeout configurable**

Edit `src/services/jina-client.ts`. Replace the class opening (lines 24–38 of the current file):

```ts
export class JinaClient {
  private apiKey: string;
  private readonly timeoutMs = 30000;

  private fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    return fetch(url, { ...init, signal: controller.signal }).finally(() =>
      clearTimeout(timeout)
    );
  }

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }
```

with:

```ts
export class JinaClient {
  private apiKey: string;
  private readonly timeoutMs: number;

  constructor(apiKey: string, timeoutMs: number = 30_000) {
    this.apiKey = apiKey;
    this.timeoutMs = timeoutMs;
  }

  private fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    return fetch(url, { ...init, signal: controller.signal }).finally(() =>
      clearTimeout(timeout)
    );
  }
```

- [ ] **Step 4: Re-run jina-client tests and confirm they're now fast**

Run: `time npx vitest run tests/jina-client.test.ts`
Expected: all PASS; total elapsed well under 1s. This is the green signal — behavior unchanged (tests still pass), but the 30s wall-clock disappeared.

- [ ] **Step 5: Confirm full suite elapsed time dropped**

Run: `time npm test`
Expected: full PASS. Wall-clock total should drop from ~30s (Preflight baseline) to well under 2s.

- [ ] **Step 6: Commit**

```bash
git add src/services/jina-client.ts tests/jina-client.test.ts
git commit -m "test: speed up timeout test via configurable client timeout"
```

---

### Task 6: Version bump to 1.3.1

**Files:**
- Modify: `package.json` (version), `src/index.ts:18` (McpServer version string)

- [ ] **Step 1: Bump version in package.json**

Edit `package.json`, change `"version": "1.3.0"` to `"version": "1.3.1"`.

- [ ] **Step 2: Bump version in `src/index.ts`**

Edit `src/index.ts`, change `version: "1.3.0",` to `version: "1.3.1",` in the `new McpServer({...})` call.

- [ ] **Step 3: Build and run tests to confirm nothing moved**

Run: `npm run build && npm test`
Expected: build exits 0; tests pass.

- [ ] **Step 4: Commit and tag**

```bash
git add package.json src/index.ts
git commit -m "chore: bump version to 1.3.1"
git tag v1.3.1
```

Stop here before publishing. Publication is a separate, user-gated action — do **not** run `npm publish` in this plan.

---

## Release 1.3.2

### Task 7 (B6): Pass `country` as `body.gl`, not `X-Locale` header

**Files:**
- Modify: `src/services/jina-client.ts:51-58` (search method body construction)
- Test: `tests/jina-client.test.ts` (append case)

**Why the fix:** `X-Locale` in Jina Reader controls the locale the browser engine renders with. Geo-filtering of search results is a body field `gl` (lowercase ISO code), per Jina meta-prompt v8. Current code sends the wrong thing and silently returns non-geo-filtered results.

- [ ] **Step 1: Add a failing test asserting body.gl and absence of X-Locale**

Append to the `describe("search", ...)` block in `tests/jina-client.test.ts` (after the existing search cases, before `describe("read", ...)`):

```ts
it("passes country as body.gl (lowercase), not X-Locale header", async () => {
  mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ data: [] }) });
  await client.search("test", { country: "PL" });
  const callArgs = mockFetch.mock.calls[0];
  expect(JSON.parse(callArgs[1].body)).toMatchObject({ q: "test", gl: "pl" });
  expect(callArgs[1].headers).not.toHaveProperty("X-Locale");
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run tests/jina-client.test.ts`
Expected: FAIL — parsed body has no `gl` property; `X-Locale: PL` is present.

- [ ] **Step 3: Move country from header to body**

Edit `src/services/jina-client.ts`. In the `search` method, delete the block (currently lines ~51–53):

```ts
if (options.country) {
  headers["X-Locale"] = options.country;
}
```

Then extend the body-building block (currently lines ~55–58) to include `gl`. Replace:

```ts
const body: Record<string, unknown> = { q: query };
if (options.num_results) {
  body.num = options.num_results;
}
```

with:

```ts
const body: Record<string, unknown> = { q: query };
if (options.num_results) {
  body.num = options.num_results;
}
if (options.country) {
  body.gl = options.country.toLowerCase();
}
```

- [ ] **Step 4: Re-run jina-client tests**

Run: `npx vitest run tests/jina-client.test.ts`
Expected: all PASS, including the new case.

The existing "calls s.jina.ai with correct headers and returns parsed results" case asserts `body: JSON.stringify({ q: "test query", num: 2 })` verbatim — since that call passes `{ num_results: 2 }` without a `country`, `body.gl` is not set, so the assertion still holds.

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: full PASS.

- [ ] **Step 6: Commit**

```bash
git add src/services/jina-client.ts tests/jina-client.test.ts
git commit -m "fix: pass country as body.gl not X-Locale header"
```

---

### Task 8 (B7): Replace `prepare` with `prepublishOnly`

**Files:**
- Modify: `package.json:11-12` (scripts block)

**Why the fix:** The `prepare` script runs on every consumer `npm install`, forcing them to compile our TypeScript. `prepublishOnly` runs only during `npm publish` (and `npm publish --dry-run`), which is what we actually want since we ship the pre-built `dist/` in the published tarball.

- [ ] **Step 1: Swap the script name**

Edit `package.json`. In the `"scripts"` object, replace:

```json
"prepare": "npm run build",
```

with:

```json
"prepublishOnly": "npm run build",
```

Leave the rest of the scripts block untouched.

- [ ] **Step 2: Static verification — both grep checks**

Run: `grep -E '"prepare"|"prepublishOnly"' package.json`
Expected: one line containing `"prepublishOnly": "npm run build"`. No `"prepare"` line.

- [ ] **Step 3: Positive verification — publish dry-run builds and packs `dist/`**

From a freshly-built state, clear `dist/` and confirm that `npm publish --dry-run` rebuilds it via the hook:

Run: `rm -rf dist && npm publish --dry-run 2>&1 | tail -40`
Expected: output shows `> npm run build` (hook fired), `tsc` produces `dist/`, and the tarball summary lists `dist/index.js`, `dist/services/*.js`, `dist/tools/*.js`.

- [ ] **Step 4: Negative verification — `npm pack --dry-run` does NOT fire the hook**

Run: `rm -rf dist && npm pack --dry-run 2>&1 | tail -40`
Expected: output shows the tarball summary but **no** `npm run build` line, and the tarball contains **no** `dist/*.js` entries (because we deleted `dist/` and `prepublishOnly` is not bound to `pack`). This proves the hook is scoped to publish only.

After verification, rebuild so later tasks have `dist/`:

Run: `npm run build`
Expected: exit 0, `dist/` recreated.

- [ ] **Step 5: Run tests for sanity**

Run: `npm test`
Expected: full PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json
git commit -m "chore: replace prepare with prepublishOnly"
```

---

### Task 9 (B8): Support `WEBSKIM_CACHE_DIR` env override

**Files:**
- Modify: `src/index.ts:22` (cache dir resolution)
- Modify: `README.md` (add Configuration section covering both env vars)

**Why the fix:** Some deployments need the page cache outside the current working directory (shared volume, read-only cwd, etc.). `JINA_API_KEY` is already an env var; follow the same pattern for cache location.

- [ ] **Step 1: Replace the hard-coded cache path**

Edit `src/index.ts`. Replace the current line:

```ts
const fileManager = new FileManager(join(process.cwd(), ".ai_pages"));
```

with:

```ts
const cacheDir = process.env.WEBSKIM_CACHE_DIR ?? join(process.cwd(), ".ai_pages");
const fileManager = new FileManager(cacheDir);
```

- [ ] **Step 2: Document the env var in the README**

Edit `README.md`. Find the line ending `Add \`.ai_pages/\` to your \`.gitignore\`.` (currently line 144). Directly after it, insert a new section:

```markdown

## Configuration

| Env var | Required | Default | Description |
|---------|----------|---------|-------------|
| `JINA_API_KEY` | yes | — | Jina AI API key. Get one at https://jina.ai. |
| `WEBSKIM_CACHE_DIR` | no | `<cwd>/.ai_pages` | Directory where `webskim_read` saves fetched pages. Created on demand. Useful for shared volumes or read-only CWDs. |
```

(Keep the existing `## Development` heading directly below the new section.)

- [ ] **Step 3: Build and run tests**

Run: `npm run build && npm test`
Expected: build exits 0; tests pass. There is no unit test for the env var — behavior is exercised manually in Step 4.

- [ ] **Step 4: Manual verification of the env override**

If `JINA_API_KEY` is not in your shell, skip to Step 5 and rely on the build check — but note "manual verification deferred" in the commit trailer.

**Part A — quick boot check (cross-platform, no GNU `timeout` needed).** On macOS the BSD userland does not ship `timeout(1)` (it's a GNU coreutils binary available as `gtimeout` after `brew install coreutils`). Instead, start the server in the background, sleep briefly, and kill it — this works on macOS, Linux, and WSL:

```bash
WEBSKIM_CACHE_DIR=/tmp/webskim-phase0-check \
JINA_API_KEY="$JINA_API_KEY" \
node dist/index.js </dev/null >/tmp/webskim-phase0-stderr 2>&1 &
PID=$!
sleep 1
kill "$PID" 2>/dev/null || true
wait "$PID" 2>/dev/null || true
head -5 /tmp/webskim-phase0-stderr
```

Expected: `head` prints the line `webskim server started`. No `ENOENT` or crash beforehand. No file is written yet under `/tmp/webskim-phase0-check` (no tool invocation). Clean up: `rm -f /tmp/webskim-phase0-stderr`.

**Part B — full round-trip (requires an MCP client).** Drive the server from an MCP client (e.g. Claude Code with the repo's local build registered as a local MCP server pointed at `dist/index.js`, with `WEBSKIM_CACHE_DIR=/tmp/webskim-phase0-check` in its env). Issue `webskim_read https://example.com` from the client. Then:

Run: `ls /tmp/webskim-phase0-check`
Expected: one `*.md` file matching the timestamp-slug pattern produced by `FileManager.generateFilename`.

Clean up: `rm -rf /tmp/webskim-phase0-check`

If only Part A is feasible in the current environment, that still proves the env var is read and the server boots against it; record "Part B deferred, driven via MCP client out-of-band" in the commit trailer.

- [ ] **Step 5: Commit**

```bash
git add src/index.ts README.md
git commit -m "feat: support WEBSKIM_CACHE_DIR env override"
```

---

### Task 10: Version bump to 1.3.2

**Files:**
- Modify: `package.json` (version), `src/index.ts` (McpServer version)

- [ ] **Step 1: Bump version in package.json**

Edit `package.json`, change `"version": "1.3.1"` to `"version": "1.3.2"`.

- [ ] **Step 2: Bump version in `src/index.ts`**

Edit `src/index.ts`, change `version: "1.3.1",` to `version: "1.3.2",`.

- [ ] **Step 3: Build and run tests**

Run: `npm run build && npm test`
Expected: build exits 0; tests pass.

- [ ] **Step 4: Commit and tag**

```bash
git add package.json src/index.ts
git commit -m "chore: bump version to 1.3.2"
git tag v1.3.2
```

Stop here before publishing — same rationale as 1.3.1.

---

## Out of scope (explicit non-goals)

- **B9 (code fence length in TOC):** deferred per spec — will be picked up only if a real user reports it. Do not touch `toc-generator.ts`'s fence toggle logic in this phase.
- **Phase 5 YAML frontmatter changes:** the B1 fix is intentionally aligned so it neither blocks nor conflicts with moving to frontmatter later (TOC will still be computed over the entire saved file).
- **New modules, refactors, abstractions:** none. Bug fixes only.

## Final suite verification

- [ ] **Step 1: After Task 10, run the full suite one more time**

Run: `npm test`
Expected: all tests PASS in well under 2s (confirming the B5 improvement survived through Task 10).

- [ ] **Step 2: Confirm commit history matches the intended order**

Run: `git log --oneline -12`
Expected (most recent first):

```
<sha> chore: bump version to 1.3.2
<sha> feat: support WEBSKIM_CACHE_DIR env override
<sha> chore: replace prepare with prepublishOnly
<sha> fix: pass country as body.gl not X-Locale header
<sha> chore: bump version to 1.3.1
<sha> test: speed up timeout test via configurable client timeout
<sha> fix: avoid millisecond overflow via monotonic counter suffix
<sha> fix: sanitize filenames for Windows-reserved characters
<sha> fix: TOC picks up indented ATX headings
<sha> fix: align TOC line numbers with saved file content
<sha> chore: bump version to 1.3.0      ← prior release (unchanged)
```

Two tags `v1.3.1` and `v1.3.2` should exist (`git tag --list 'v1.3.*'`).
