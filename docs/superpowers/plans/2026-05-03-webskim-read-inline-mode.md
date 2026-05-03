# webskim_read Inline Mode + 1.3.2 Release Close — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the dangling 1.3.2 release (Phase 0 leftover), then ship the inline-mode feature for `webskim_read` as 1.4.0 — adds `inline` and `head_lines` params so the tool can return markdown directly to the model with optional head-style truncation, default behavior unchanged.

**Architecture:** Two sequential mini-releases on the current branch. 1.3.2 is a pure version bump. 1.4.0 extracts a pure `formatReadResponse()` helper inside `src/tools/read.ts` (testable in isolation), adds a `validateReadArgs()` helper for cross-field validation (returns an error string or `null`, used by the handler to short-circuit with `isError: true`), and wires both into the existing `registerReadTool` handler. No new modules, no changes to `FileManager` / `JinaClient` / `toc-generator`.

**Tech Stack:** TypeScript + ESM, vitest, `zod ^4.3.6`, `@modelcontextprotocol/sdk ^1.26.0`.

**Spec reference:** `docs/superpowers/specs/2026-05-03-webskim-read-inline-design.md`

---

## File Structure

**Source — modified:**
- `src/tools/read.ts` — add `inline` + `head_lines` to the Zod shape, update tool description string, add and export `formatReadResponse()` and `validateReadArgs()`, branch the handler on the new params.
- `src/index.ts` — bump `version` string twice (1.3.1 → 1.3.2, then 1.3.2 → 1.4.0).
- `package.json` — bump `version` twice (same two transitions).

**Tests — created:**
- `tests/read-inline.test.ts` — five cases as specified (truncated inline, full inline, unbounded `head_lines`, validation error, file-mode regression).

**Tests — unchanged:** `tests/file-manager.test.ts`, `tests/jina-client.test.ts`, `tests/toc-generator.test.ts` — no behavior reaches them.

---

## Preflight

### Task 0: Baseline verification

**Files:** none

- [ ] **Step 1: Confirm clean working tree for files we'll touch**

Run: `git status --short src tests package.json`
Expected: empty output. Untracked `docs/...` files (specs/plans) are fine — we don't touch them.

- [ ] **Step 2: Run the full test suite to capture the baseline**

Run: `npm test`
Expected: all tests PASS, total elapsed under 2s (B5 fix is in place).

- [ ] **Step 3: Confirm TypeScript builds clean**

Run: `npm run build`
Expected: exit 0, `dist/` populated. Do not commit `dist/`.

- [ ] **Step 4: Confirm we are on `feature/phase-0-bugfixes` and the v1.3.1 tag exists**

Run: `git branch --show-current && git tag --list 'v1.3.*'`
Expected: branch `feature/phase-0-bugfixes`; tag list contains `v1.3.1` and **does not** contain `v1.3.2`.

---

## Release 1.3.2 (Phase 0 close)

### Task 1: Bump versions to 1.3.2

**Files:**
- Modify: `package.json` (version field, line 3)
- Modify: `src/index.ts:18` (`McpServer` version arg)

**Why:** Phase 0 commits B6/B7/B8 (the 1.3.2 content) are already on the branch, but the version string never moved off `1.3.1` and the `v1.3.2` tag is missing. Closing this single bump-and-tag commit before starting 1.4.0 keeps release history coherent.

- [ ] **Step 1: Edit `package.json` version**

Open `package.json` and change line 3 from:

```json
  "version": "1.3.1",
```

to:

```json
  "version": "1.3.2",
```

- [ ] **Step 2: Edit `src/index.ts` McpServer version**

Open `src/index.ts` and change line 18 from:

```ts
  version: "1.3.1",
```

to:

```ts
  version: "1.3.2",
```

- [ ] **Step 3: Build and run tests**

Run: `npm run build && npm test`
Expected: build exit 0; tests PASS (no behavior change — version strings are not asserted in any current test).

- [ ] **Step 4: Commit and tag**

```bash
git add package.json src/index.ts
git commit -m "chore: bump version to 1.3.2"
git tag v1.3.2
```

- [ ] **Step 5: Verify tag exists**

Run: `git tag --list 'v1.3.*'`
Expected: list contains both `v1.3.1` and `v1.3.2`.

---

## Release 1.4.0 (inline mode)

### Task 2: Add failing tests for `formatReadResponse` and `validateReadArgs`

**Files:**
- Create: `tests/read-inline.test.ts`

**Why:** TDD. We pin behavior before writing the implementation. `formatReadResponse` is a pure function — string in, string out — so we can test its three output modes deterministically. `validateReadArgs` is the same: `{inline, head_lines}` in, `string | null` out. No mocks needed.

- [ ] **Step 1: Create `tests/read-inline.test.ts` with all five cases**

Create the file with this exact content:

```ts
import { describe, it, expect } from "vitest";
import { formatReadResponse, validateReadArgs } from "../src/tools/read.js";

describe("validateReadArgs", () => {
  it("returns null when inline=false and head_lines is undefined (default file mode)", () => {
    expect(validateReadArgs({ inline: false })).toBeNull();
  });

  it("returns null when inline=true with no head_lines", () => {
    expect(validateReadArgs({ inline: true })).toBeNull();
  });

  it("returns null when inline=true with head_lines", () => {
    expect(validateReadArgs({ inline: true, head_lines: 50 })).toBeNull();
  });

  it("returns error string when head_lines is given but inline is false", () => {
    expect(validateReadArgs({ inline: false, head_lines: 50 })).toBe(
      "head_lines requires inline: true"
    );
  });
});

describe("formatReadResponse", () => {
  // 10-line fullContent: line 1 is the Source header, line 2 is blank, lines 3..10 are body.
  const fullContent =
    "<!-- Source: https://example.com -->\n" +
    "\n" +
    "# Title\n" +
    "para 1\n" +
    "## Sub\n" +
    "para 2\n" +
    "para 3\n" +
    "para 4\n" +
    "para 5\n" +
    "para 6";
  // The pre-header content Jina returned (used for token estimate in file mode).
  const content =
    "# Title\n" +
    "para 1\n" +
    "## Sub\n" +
    "para 2\n" +
    "para 3\n" +
    "para 4\n" +
    "para 5\n" +
    "para 6";
  const filePath = "/tmp/.ai_pages/20260503_120000123_example_com.md";
  const title = "Example";

  it("file mode (inline=false): returns existing format with TOC and metadata", () => {
    const out = formatReadResponse({
      title,
      content,
      fullContent,
      filePath,
      inline: false,
    });
    expect(out).toContain("**Example**");
    expect(out).toContain(`File: ${filePath}`);
    expect(out).toMatch(/Lines: 10 \| ~\d+ tokens \(estimate\)/);
    expect(out).toContain("**Table of Contents:**");
    expect(out).toContain("L3: # Title");
    expect(out).toContain("L5: ## Sub");
    expect(out).toContain(
      "Use Read tool on the file path above to view content."
    );
  });

  it("inline truncated: head_lines=3 returns first 3 lines + footer", () => {
    const out = formatReadResponse({
      title,
      content,
      fullContent,
      filePath,
      inline: true,
      head_lines: 3,
    });
    // Must start with title and contain the first 3 lines verbatim, in order.
    expect(out.startsWith("**Example**\n\n")).toBe(true);
    const expectedSlice =
      "<!-- Source: https://example.com -->\n\n# Title";
    expect(out).toContain(expectedSlice);
    // Must end with footer pointing at the file.
    expect(out.trimEnd()).toMatch(
      /--- Showing 3\/10 lines\. Full file: .+example_com\.md$/
    );
    // Body line 4 ("para 1") must NOT appear (it's after the cut).
    expect(out).not.toContain("para 1");
  });

  it("inline full (no head_lines): returns title + entire fullContent, no footer", () => {
    const out = formatReadResponse({
      title,
      content,
      fullContent,
      filePath,
      inline: true,
    });
    expect(out).toBe(`**Example**\n\n${fullContent}`);
    expect(out).not.toMatch(/Showing \d+\/\d+ lines/);
    expect(out).not.toContain("File:"); // path is intentionally omitted in Mode 3
  });

  it("inline unbounded: head_lines >= totalLines is treated as full (no footer)", () => {
    const out = formatReadResponse({
      title,
      content,
      fullContent,
      filePath,
      inline: true,
      head_lines: 999,
    });
    expect(out).toBe(`**Example**\n\n${fullContent}`);
    expect(out).not.toMatch(/Showing \d+\/\d+ lines/);
  });

  it("inline truncated: head_lines exactly equal to totalLines emits no footer", () => {
    const out = formatReadResponse({
      title,
      content,
      fullContent,
      filePath,
      inline: true,
      head_lines: 10,
    });
    expect(out).toBe(`**Example**\n\n${fullContent}`);
    expect(out).not.toMatch(/Showing \d+\/\d+ lines/);
  });
});
```

Note: this is nine total `it` blocks (four `validateReadArgs` + five `formatReadResponse`). The spec called for five user-facing cases; the validation cases split out from one because the helper is now a pure function with multiple branches worth pinning, and we add one extra boundary test on `formatReadResponse` (`head_lines === totalLines`) because the `>=` rule is the most error-prone branch and a one-line test pins it cheaply.

- [ ] **Step 2: Run the new tests and confirm they fail at import time**

Run: `npx vitest run tests/read-inline.test.ts`
Expected: FAIL. The import `from "../src/tools/read.js"` will not find the named exports `formatReadResponse` and `validateReadArgs`. TypeScript/vitest reports a missing-export error before any `it` body runs. That's the intended red.

If the suite somehow reports only "no tests found" instead of an import error, double-check the file path and that vitest is picking up the new file. The suite globs `tests/**/*.test.ts` by default with vitest 4.

---

### Task 3: Implement `formatReadResponse` and `validateReadArgs` in `src/tools/read.ts`

**Files:**
- Modify: `src/tools/read.ts` (add two exported helpers above `registerReadTool`)

**Why:** Pure helpers carry the new logic and are independently testable. The handler stays a thin orchestrator (fetch → save → validate → format).

- [ ] **Step 1: Replace the entire contents of `src/tools/read.ts` with the implementation that adds the helpers**

This step touches the helpers only — wiring the handler to use them happens in Task 4. The helpers must exist and be exported first so the Task 2 tests turn green before we touch the handler.

Open `src/tools/read.ts`. After the existing imports and **before** `export function registerReadTool(...)`, insert these two exports:

```ts
export function validateReadArgs(args: {
  inline?: boolean;
  head_lines?: number;
}): string | null {
  if (args.head_lines !== undefined && !args.inline) {
    return "head_lines requires inline: true";
  }
  return null;
}

export function formatReadResponse(params: {
  title: string;
  content: string;
  fullContent: string;
  filePath: string;
  inline: boolean;
  head_lines?: number;
}): string {
  const { title, content, fullContent, filePath, inline, head_lines } = params;

  if (!inline) {
    const toc = generateToc(fullContent);
    const totalLines = fullContent.split("\n").length;
    const estimatedTokens = Math.round(content.length / 4);
    return [
      `**${title}**`,
      `File: ${filePath}`,
      `Lines: ${totalLines} | ~${estimatedTokens} tokens (estimate)`,
      "",
      toc ? `**Table of Contents:**\n${toc}` : "(no headings found)",
      "",
      "Use Read tool on the file path above to view content. Use offset/limit to read specific sections.",
    ].join("\n");
  }

  // inline mode
  const lines = fullContent.split("\n");
  const totalLines = lines.length;
  const cap =
    head_lines !== undefined ? Math.min(head_lines, totalLines) : totalLines;
  const visible = lines.slice(0, cap).join("\n");

  if (cap >= totalLines) {
    return `**${title}**\n\n${visible}`;
  }
  return `**${title}**\n\n${visible}\n\n--- Showing ${cap}/${totalLines} lines. Full file: ${filePath}`;
}
```

Leave `registerReadTool(...)` exactly as it is for now — Task 4 rewires it. We're adding code, not touching the working handler yet.

- [ ] **Step 2: Run the new tests and confirm they pass**

Run: `npx vitest run tests/read-inline.test.ts`
Expected: all nine PASS.

- [ ] **Step 3: Run the full suite — no regressions**

Run: `npm test`
Expected: full suite PASS in well under 2s.

- [ ] **Step 4: Confirm TypeScript compiles**

Run: `npm run build`
Expected: exit 0.

---

### Task 4: Wire helpers into the `registerReadTool` handler + extend schema + update tool description

**Files:**
- Modify: `src/tools/read.ts:7-63` (the entire `registerReadTool` body — schema, description string, handler)

**Why:** Now that the helpers are in place and tested, swap the inline formatting and validation into the actual MCP tool. The handler becomes a thin orchestrator. We also extend the Zod shape and refresh the human-readable tool description so the model picks the right mode.

- [ ] **Step 1: Replace the `registerReadTool` body**

Open `src/tools/read.ts` and replace the existing `registerReadTool(...)` function (lines 7–63 of the current file) with:

```ts
export function registerReadTool(server: McpServer, client: JinaClient, fileManager: FileManager) {
  server.tool(
    "webskim_read",
    "Fetch URL/PDF → save as markdown to disk. Default: return file path + TOC with line numbers (near-zero context tokens; use Read tool with offset/limit on the path). Set inline: true to also receive the markdown directly in the response — combine with head_lines: N to cap to the first N lines and avoid blowing context on large pages.",
    {
      url: z.string().url().describe("URL of web page or PDF to read"),
      max_tokens: z.number().positive().optional().describe("Truncate content to this many tokens (saves context window)"),
      target_selector: z.string().optional().describe("CSS selector — extract only this element from the page"),
      remove_selector: z.string().optional().describe("CSS selector — remove these elements before extraction"),
      inline: z.boolean().optional().default(false).describe("Return markdown content directly in the response instead of file path + TOC. File is still saved to disk."),
      head_lines: z.number().int().positive().optional().describe("When inline=true, return only the first N lines (1-indexed, includes the Source header line). Requires inline=true."),
    },
    async ({ url, max_tokens, target_selector, remove_selector, inline, head_lines }) => {
      // Cross-field validation that Zod rawShape can't express.
      const validationError = validateReadArgs({ inline, head_lines });
      if (validationError) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: `Validation error: ${validationError}` }],
        };
      }

      try {
        // 1. Fetch page content via Jina Reader
        const { title, content } = await client.read(url, {
          target_selector,
          remove_selector,
          max_tokens,
        });

        // 2. Save to disk (unconditional — see spec decision Q1)
        const { filePath, fullContent } = await fileManager.savePage(content, url);

        // 3. Format response
        const text = formatReadResponse({
          title,
          content,
          fullContent,
          filePath,
          inline,
          head_lines,
        });

        return {
          content: [{ type: "text" as const, text }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `Failed to read URL: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );
}
```

Watch-outs:
- `inline` arrives at the handler typed as `boolean` (not `boolean | undefined`) because of `.default(false)` — Zod fills it in. Pass it straight through.
- The destructure includes `head_lines` (snake_case to match the schema field) — keep this name end-to-end. The spec uses `head_lines`; helpers use `head_lines`; tests assert `head_lines`. Do not camelCase it.
- The unused-import check should still be happy: `generateToc` is now used inside `formatReadResponse` (in the same file), not in the handler. Keep the existing `import { generateToc } from "../services/toc-generator.js";` line at the top.

- [ ] **Step 2: Run the full test suite**

Run: `npm test`
Expected: all tests PASS, including the nine new `read-inline` cases.

- [ ] **Step 3: Confirm TypeScript build**

Run: `npm run build`
Expected: exit 0. If TS complains about the handler's `args` type (e.g., that `inline` is possibly undefined), it means the SDK didn't apply `.default()` at the type level — fall back to `inline ?? false` in the body and call `validateReadArgs({ inline: inline ?? false, head_lines })` and `formatReadResponse({ ..., inline: inline ?? false })`. Re-run build to confirm green.

- [ ] **Step 4: Manual smoke check that the server still boots**

This is the same boot pattern used in Phase 0 Task 9 (works on macOS without GNU `timeout`):

```bash
JINA_API_KEY="${JINA_API_KEY:-dummy-for-boot-check}" \
node dist/index.js </dev/null >/tmp/webskim-1.4.0-stderr 2>&1 &
PID=$!
sleep 1
kill "$PID" 2>/dev/null || true
wait "$PID" 2>/dev/null || true
head -5 /tmp/webskim-1.4.0-stderr
rm -f /tmp/webskim-1.4.0-stderr
```

Expected: `head` prints `webskim server started`. No `ENOENT`, no schema-build crash from the new params (the schema is built at server-construction time, so a malformed shape would crash here before printing the start line).

If `JINA_API_KEY` is not set, the dummy value is fine — the server only validates env presence, not key validity, at boot time. We're not making real Jina calls here.

- [ ] **Step 5: Commit**

```bash
git add src/tools/read.ts tests/read-inline.test.ts
git commit -m "feat: add inline mode with head_lines to webskim_read"
```

---

### Task 5: Bump versions to 1.4.0

**Files:**
- Modify: `package.json` (version)
- Modify: `src/index.ts:18` (McpServer version)

- [ ] **Step 1: Edit `package.json` version**

Change line 3 from `"version": "1.3.2",` to `"version": "1.4.0",`.

- [ ] **Step 2: Edit `src/index.ts` McpServer version**

Change line 18 from `version: "1.3.2",` to `version: "1.4.0",`.

- [ ] **Step 3: Build and run tests**

Run: `npm run build && npm test`
Expected: build exit 0; tests PASS.

- [ ] **Step 4: Commit and tag**

```bash
git add package.json src/index.ts
git commit -m "chore: bump version to 1.4.0"
git tag v1.4.0
```

Stop here before publishing. Publication is a separate, user-gated action — do **not** run `npm publish` in this plan.

---

## Final verification

- [ ] **Step 1: Confirm tag list and commit history**

Run: `git tag --list 'v1.3.*' 'v1.4.*' && git log --oneline -10`
Expected (most recent first):

```
<sha> chore: bump version to 1.4.0
<sha> feat: add inline mode with head_lines to webskim_read
<sha> chore: bump version to 1.3.2
<sha> docs: spec for webskim_read inline mode (1.4.0)
<sha> feat: support WEBSKIM_CACHE_DIR env override
<sha> chore: replace prepare with prepublishOnly
<sha> fix: pass country as body.gl not X-Locale header
<sha> chore: bump version to 1.3.1
<sha> test: speed up timeout test via configurable client timeout
<sha> fix: avoid millisecond overflow via monotonic counter suffix
```

Tags `v1.3.1`, `v1.3.2`, and `v1.4.0` should all exist.

- [ ] **Step 2: Final test run**

Run: `npm test`
Expected: all tests PASS (existing + the nine new `read-inline` cases) in well under 2s.

---

## Out of scope (explicit non-goals)

- **Token-based head cutoff (`head_tokens`):** spec rejected. `max_tokens` already covers upstream truncation; mixing units adds API surface for marginal gain.
- **Auto-inline heuristic:** explicit caller decision only.
- **Refactoring `registerReadTool` further** (e.g., extracting an inner builder, splitting into multiple files): out of scope. The two helper extractions are the entire structural change in this plan.
- **Tests for the existing search tool** or other modules: not blocking and not in scope.
- **`npm publish`** for either release: user-gated, not part of this plan.
