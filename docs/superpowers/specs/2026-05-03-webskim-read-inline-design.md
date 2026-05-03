# webskim_read — inline mode

**Date:** 2026-05-03
**Target release:** 1.4.0 (minor — additive, no breaking changes)
**Prerequisite release to close first:** 1.3.2 (tag missing — see "Release coordination" below)
**Status:** Approved (brainstorm), pending implementation plan

## Summary

Add an `inline` mode to the `webskim_read` MCP tool that returns fetched markdown directly to the model in the tool response, optionally truncated to the first N lines (`head_lines`). The default behavior — save to disk and return file path + TOC — is preserved exactly. The new mode collapses the round-trip `webskim_read` → `Read(file, offset, limit)` into a single call when the page is small or only the top of the page is needed.

## Motivation

Today every `webskim_read` requires a follow-up `Read` tool call to view content. For short pages or "just give me the top" lookups this is two round-trips for no benefit. Existing parameters (`max_tokens`) tune what Jina Reader returns; they don't change how the result is delivered. We need a delivery-mode switch.

## Decisions (from brainstorm)

| # | Question | Choice | Rationale |
|---|---|---|---|
| 1 | Save to disk in inline mode? | **Yes, always save** | Cheap deterministic fallback; if `head_lines` truncates, the model still has the file path to read more. |
| 2 | Cutoff unit | **Lines** (`head_lines`) | Deterministic, ecosystem-aligned (`head -n`, `Read offset/limit`); pairs cleanly with line-aware follow-up reads. Token budget is already covered by `max_tokens`. |
| 3 | API shape | **Two params: `inline: boolean`, `head_lines?: number`** | Each param has one job. Supports both "small page, give me everything inline" and "show me top N, rest stays on disk". |
| 4 | Output format | **Adaptive** — title + content + footer when truncated; title + content only when full | TOC and token estimates are noise once the content is in hand. Footer communicates the cut and points to the file. |
| 5 | Validation: `head_lines` with `inline=false`? | **Zod refine error** | `inline` is the explicit mode switch; `head_lines` modifies it. Mismatch = surface the user error early. |

## API surface

`src/tools/read.ts` Zod schema:

```ts
{
  url: z.string().url().describe("URL of web page or PDF to read"),
  max_tokens: z.number().positive().optional().describe(
    "Truncate content to this many tokens (saves context window)"
  ),
  target_selector: z.string().optional().describe(
    "CSS selector — extract only this element from the page"
  ),
  remove_selector: z.string().optional().describe(
    "CSS selector — remove these elements before extraction"
  ),
  inline: z.boolean().optional().default(false).describe(
    "Return markdown content directly in the response instead of file path + TOC. File is still saved to disk."
  ),
  head_lines: z.number().int().positive().optional().describe(
    "When inline=true, return only the first N lines (1-indexed, includes the Source header line). Requires inline=true."
  ),
}
.refine(
  (args) => args.head_lines === undefined || args.inline === true,
  { message: "head_lines requires inline: true", path: ["head_lines"] }
)
```

Notes:
- `inline` defaults to `false` → existing callers see no behavioral change.
- `head_lines` is 1-indexed line count, applied to `fullContent` (including the `<!-- Source: ... -->` header line and the blank line after it). This keeps line numbers consistent with the on-disk file and with `Read tool` line numbering — same convention as B1 from Phase 0.

## Output format

### Mode 1 — file (default, `inline=false`)

Identical to current behavior. No changes.

```
**<title>**
File: <path>
Lines: <n> | ~<m> tokens (estimate)

**Table of Contents:**
<toc>

Use Read tool on the file path above to view content. Use offset/limit to read specific sections.
```

### Mode 2 — inline + truncated (`inline=true`, `head_lines < totalLines`)

```
**<title>**

<lines 1..head_lines of fullContent>

--- Showing <head_lines>/<totalLines> lines. Full file: <path>
```

### Mode 3 — inline + full (`inline=true`, `head_lines` undefined or `head_lines >= totalLines`)

```
**<title>**

<fullContent>
```

No TOC, no token estimate, no line count, no path — content is in hand. The path is intentionally omitted in Mode 3 because the caller has the entire payload; if they need the path later, they can re-call.

## Implementation locus

All changes confined to `src/tools/read.ts`. The flow becomes:

1. Fetch via `client.read(url, …)` — unchanged.
2. `fileManager.savePage(content, url)` — unchanged. Always runs, regardless of mode.
3. Branch on `inline`:
   - `false` → existing TOC/metadata response (unchanged).
   - `true` → split `fullContent` by `\n`, slice to `head_lines` if defined, format per Mode 2 or Mode 3 above.
4. Error envelope unchanged.

No changes to `FileManager`, `JinaClient`, `toc-generator`, or `index.ts`.

### Tool description string update

The current second argument to `server.tool("webskim_read", …)` reads:

> Fetch URL/PDF → save as markdown to disk, return file path + TOC with line numbers. Near-zero context tokens. Use Read tool with offset/limit on the returned path to view specific sections.

Update to mention the inline alternative so the model picks the right mode. Proposed:

> Fetch URL/PDF → save as markdown to disk. Default: return file path + TOC with line numbers (near-zero context tokens; use Read tool with offset/limit on the path). Set `inline: true` to also receive the markdown directly in the response — combine with `head_lines: N` to cap to the first N lines and avoid blowing context on large pages.

## Tests

New file `tests/read-inline.test.ts` — `describe("webskim_read inline mode", …)` with these cases (`JinaClient` and `FileManager` mocked at the constructor seam, same pattern as the read tool would use; if there is no precedent in the suite for this, fall back to invoking the registered tool handler directly with stubbed dependencies):

1. **`inline=true` + `head_lines=3` truncates and emits footer.** Stub a 10-line `fullContent`. Assert response text starts with `**<title>**`, contains exactly the first 3 lines from `fullContent`, and ends with `--- Showing 3/10 lines. Full file: <path>`.
2. **`inline=true` without `head_lines` returns full content, no footer.** Assert response contains all 10 lines and does NOT match `/Showing \d+\/\d+ lines/`.
3. **`inline=true` + `head_lines >= totalLines` is treated as unbounded.** With 10-line content and `head_lines=999`, assert no footer (same as case 2).
4. **`inline=false` + `head_lines=10` is rejected by schema.** Asserts the Zod refine error is surfaced (`message: "head_lines requires inline: true"`). The exact failure path depends on how MCP errors are surfaced — accept either an `isError: true` content or a thrown validation error, whichever the SDK delivers.
5. **`inline=false` (default) — regression guard.** Asserts existing response shape: contains `File: <path>`, `Lines: <n>`, `Table of Contents:`, and the closing instruction line. Confirms the default branch is untouched.

Coverage target: schema validation (one path), both inline branches (truncated + full), unbounded `head_lines` edge, and the existing-behavior regression. Five tests total.

## Edge cases & explicit non-goals

- **`head_lines=0`**: rejected by `z.number().int().positive()` — positive means ≥1. No special-casing needed.
- **Empty content from Jina**: `fullContent` is just the 2-line header. `head_lines=5` with `totalLines=2` → Mode 3 (full content, no footer). Consistent with the rule.
- **Very large pages with `inline=true` and no `head_lines`**: caller's responsibility. We do not auto-cap. The `max_tokens` param already exists for upstream truncation.
- **Line numbering for the caller**: the inline output is raw markdown without line numbers. The footer's `Showing N/Total` is the only counter. If the caller wants numbered lines, they `Read` the file path.
- **TOC in inline mode**: explicitly not emitted. TOC's value is "pick a section to read"; once content is inline, that decision is moot.
- **Phase 5 frontmatter compatibility**: when (later) the saved file gains YAML frontmatter, `head_lines` will count those lines too — same rule as today's `<!-- Source -->` header. No change required to this feature.

## Release coordination

Phase 0 left an unfinished tail: commits for B6/B7/B8 (the 1.3.2 release content) are on `master`-track, but `package.json` still reads `1.3.1` and tag `v1.3.2` is missing. **Close 1.3.2 first** (single bump-and-tag commit per Phase 0 plan Task 10), then start 1.4.0 work. Otherwise the 1.4.0 release blurs the line between two unrelated changesets in the published version history.

Order:
1. `chore: bump version to 1.3.2` + `git tag v1.3.2` (closes Phase 0).
2. `feat: add inline mode with head_lines to webskim_read` (this design).
3. `chore: bump version to 1.4.0` + `git tag v1.4.0`.

## Out of scope

- Token-based head cutoff (`head_tokens`) — `max_tokens` already covers upstream truncation; mixing units adds API surface for marginal gain.
- Auto-inline heuristic (e.g., "if content < 500 lines, inline by default"). Explicit beats magic; caller decides.
- Streaming/chunked output. MCP tool responses are single payloads in this server; out of scope.
- Changes to `FileManager` or `toc-generator`. None needed.
