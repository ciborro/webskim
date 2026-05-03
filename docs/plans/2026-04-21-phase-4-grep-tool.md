# Phase 4 — `webskim_grep` tool

**Status:** Pending
**Target release:** 1.6.0
**Dependencies:** Phase 0 (B3, B8 — sanitization + env-configurable cache dir)
**Estimate:** 2–3h

## Summary

Nowy trzeci tool: `webskim_grep`. Regex search w zapisanym pliku markdown. Po `webskim_read` agent dostaje TOC, ale często szuka konkretnego terminu (nazwa funkcji, wersja, quoted fragment) i nie wie, który heading to zawiera. Grep eliminuje „zgadnij sekcję → Read → może nie trafiłeś" iterację.

## Motywacja

[Augment team / SWE-bench](https://jxnl.co/writing/2025/09/11/why-grep-beat-embeddings-in-our-swe-bench-agent-lessons-from-augment/): persistent grep + iteracja agenta bije embeddings dla dokumentów małych-średnich. webskim cache'uje pliki ~5-20k tokenów — dokładnie ten reżim.

## Checklist

- [ ] `src/tools/grep.ts` — nowy plik
- [ ] Rejestracja w `src/index.ts`
- [ ] Path traversal security check
- [ ] Tests: match/no-match, context_lines, case_sensitive, path traversal blocked
- [ ] README update

## Open questions

1. **Osobny tool czy parametr `search_in` w `webskim_read`?** → Osobny tool. Różne trigger conditions (read = fetch nowej strony; grep = szukaj w już pobranej). Mental model prostszy.
2. **Streaming dla dużych plików?** → Nie na v1.6.0. webskim cap'uje via Jina `X-Token-Budget`, pliki są małe. Dodać streaming gdy pojawi się realny problem.
3. **Czy eksponować regex czy tylko substring?** → Regex. Agent sobie poradzi, a regex dodaje value (word boundaries, alternation). Default to case-insensitive.

## Tool spec

### Name: `webskim_grep`

### Description

```
Search for a regex pattern in a saved webskim page. Returns matching lines with
line numbers and surrounding context. USE AFTER webskim_read when you need to
find a specific term, API name, version number, or quoted fragment across a
page — faster and more precise than scanning the TOC and reading sections
blindly. For multiple independent patterns, call multiple times; for full-page
skim, use the TOC from webskim_read instead.
```

### Parameters

```ts
{
  file_path: z.string()
    .describe("Absolute path to a webskim-saved file (returned by webskim_read). Must be inside the webskim cache directory."),
  pattern: z.string()
    .describe("Regex pattern (ECMAScript flavor). Examples: 'API key', '\\bversion\\s+\\d+', '(install|setup)'."),
  case_sensitive: z.boolean().default(false)
    .describe("Default false (case-insensitive). Set true to match case exactly."),
  context_lines: z.number().min(0).max(10).default(2)
    .describe("Lines of context before/after each match. 0 for just the matching line."),
  max_matches: z.number().positive().max(200).default(50)
    .describe("Truncate output if too many matches. Warns when truncated."),
}
```

### Response format

```
Found 3 matches in /path/to/file.md:

L42:
    40: some context
    41: some context
  > 42: line with matching pattern
    43: some context
    44: some context

L127:
  > 127: another match
    128: following context

L340:
    338: preceding
    339: preceding
  > 340: third match
    341: following
    342: following
```

Gdy truncated (≥max_matches):
```
Found 50+ matches (truncated, increase max_matches to see more).
```

Gdy brak:
```
No matches for pattern "X" in /path/to/file.md.
```

## Implementation

```ts
// src/tools/grep.ts
import { z } from "zod";
import { readFile } from "node:fs/promises";
import { resolve, relative } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function registerGrepTool(server: McpServer, cacheDir: string) {
  const absoluteCacheDir = resolve(cacheDir);

  server.tool(
    "webskim_grep",
    /* description above */,
    {
      file_path: z.string(),
      pattern: z.string(),
      case_sensitive: z.boolean().default(false),
      context_lines: z.number().min(0).max(10).default(2),
      max_matches: z.number().positive().max(200).default(50),
    },
    async ({ file_path, pattern, case_sensitive, context_lines, max_matches }) => {
      try {
        // Security: path must be inside cacheDir
        const absPath = resolve(file_path);
        const rel = relative(absoluteCacheDir, absPath);
        if (rel.startsWith("..") || rel.startsWith("/")) {
          return errorResponse(`Path ${file_path} is outside cache directory`);
        }

        let regex: RegExp;
        try {
          regex = new RegExp(pattern, case_sensitive ? "" : "i");
        } catch (e) {
          return errorResponse(`Invalid regex: ${(e as Error).message}`);
        }

        const content = await readFile(absPath, "utf-8");
        const lines = content.split("\n");

        const matches: Array<{ lineNo: number; context: string[] }> = [];
        for (let i = 0; i < lines.length; i++) {
          if (regex.test(lines[i])) {
            const start = Math.max(0, i - context_lines);
            const end = Math.min(lines.length, i + context_lines + 1);
            const contextLines = lines.slice(start, end).map((line, idx) => {
              const lineNum = start + idx + 1;
              const marker = (lineNum === i + 1) ? ">" : " ";
              return `  ${marker} ${lineNum}: ${line}`;
            });
            matches.push({ lineNo: i + 1, context: contextLines });
            if (matches.length >= max_matches) break;
          }
        }

        if (matches.length === 0) {
          return textResponse(`No matches for pattern "${pattern}" in ${file_path}.`);
        }

        const truncated = matches.length >= max_matches
          ? `\n\n(truncated at ${max_matches} matches, increase max_matches to see more)`
          : "";

        const body = matches
          .map(m => `L${m.lineNo}:\n${m.context.join("\n")}`)
          .join("\n\n");

        return textResponse(
          `Found ${matches.length}${truncated ? "+" : ""} matches in ${file_path}:\n\n${body}${truncated}`
        );
      } catch (error) {
        return errorResponse(`Grep failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  );
}

// helpers
function textResponse(text: string) {
  return { content: [{ type: "text" as const, text }] };
}
function errorResponse(text: string) {
  return { isError: true, content: [{ type: "text" as const, text }] };
}
```

### Rejestracja w `src/index.ts`

```ts
import { registerGrepTool } from "./tools/grep.js";
// ...
registerGrepTool(server, cacheDir);
```

## Security

Path traversal: użyć `resolve` + `relative` i odrzucać paths wychodzące poza `cacheDir`. Testy muszą to pokryć.

Regex DoS: cap'ować `max_matches` (done via param).

Duże pliki: nie stream, cały w pamięci. webskim cap'uje Jina na `max_tokens` — pliki są małe. Dodać assertion: jeśli plik >10MB, odrzucić z sugestią użycia `max_tokens` przy fetchu.

```ts
const stat = await import("node:fs/promises").then(m => m.stat(absPath));
if (stat.size > 10 * 1024 * 1024) {
  return errorResponse(`File too large for grep (${stat.size} bytes). Use max_tokens when reading.`);
}
```

## Tests

```ts
// tests/grep.test.ts

describe("webskim_grep", () => {
  const TEST_DIR = join(process.cwd(), ".ai_pages_test");

  beforeEach(async () => {
    await mkdir(TEST_DIR, { recursive: true });
    await writeFile(
      join(TEST_DIR, "sample.md"),
      ["# Title", "Some text", "API key info", "more text", "Another API mention", "end"].join("\n"),
      "utf-8"
    );
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true });
  });

  it("finds matching lines with context", async () => {
    // Call the handler directly (extract for testability, or mock MCP server)
    const result = await grepHandler({ file_path: join(TEST_DIR, "sample.md"), pattern: "API", context_lines: 1, max_matches: 50, case_sensitive: false });
    expect(result.content[0].text).toContain("L3");
    expect(result.content[0].text).toContain("L5");
  });

  it("returns 'no matches' when pattern absent", async () => { /* ... */ });

  it("respects case_sensitive flag", async () => { /* ... */ });

  it("blocks path traversal", async () => {
    const result = await grepHandler({ file_path: "/etc/passwd", pattern: "root" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("outside cache directory");
  });

  it("truncates at max_matches", async () => { /* ... */ });

  it("handles invalid regex gracefully", async () => {
    const result = await grepHandler({ file_path: join(TEST_DIR, "sample.md"), pattern: "[unclosed" });
    expect(result.isError).toBe(true);
  });
});
```

## Acceptance

- Wszystkie testy zielone.
- Ręczny test: po `webskim_read` wywołać `webskim_grep` z realnym patternem, zweryfikować line numbers matchują plik.
- README dostaje trzeci wpis w tabeli Tools.
- Tool description provokuje Claude do używania grep zamiast „Read all sections".

## Commit plan

1. `feat: add webskim_grep tool for regex search in saved pages`
2. `test: add path traversal and regex DoS coverage for grep`
3. `docs: document webskim_grep in README`

Release: 1.6.0.
