# webskim — Design Document

## Goal

MCP server for AI agents that replaces WebSearch and WebFetch with Jina.ai APIs.
Key advantage: pages saved to disk so the agent controls how many tokens it reads.

## Architecture

```
AI agent (Claude Code, Cursor, etc.)
  |
  +-- webskim_search("query") -> snippets + URLs
  |     \-- Jina Search API (s.jina.ai)
  |
  +-- webskim_read("url", opts) -> saves to .ai_pages/, returns path + TOC
  |     +-- Jina Reader API (r.jina.ai) -> markdown
  |     \-- Jina Segmenter API -> TOC with line numbers
  |
  \-- Read(".ai_pages/20260220_143052_docs_python_org__tutorial.md", offset, limit)
        \-- built-in agent tool — agent reads as much as it needs
```

## Tools

### webskim_search

Searches the web, returns lightweight results.

**Parameters:**
- `query` (string, required) — search query
- `num_results` (number, default 5) — number of results (1-10)
- `site` (string, optional) — restrict to domain, e.g. `"python.org"`
- `country` (string, optional) — country code for localization

**Returns:** Array of `{ title, url, snippet }`.

### webskim_read

Reads a web page or PDF from URL, saves to disk, returns metadata.

**Parameters:**
- `url` (string, required) — URL of page or PDF
- `max_tokens` (number, optional) — truncate content to N tokens (via Segmenter)
- `target_selector` (string, optional) — CSS selector, extract only this fragment
- `remove_selector` (string, optional) — CSS selector, remove these elements

**Returns:**
- `file_path` — path to saved markdown file
- `title` — page title
- `total_lines` — line count
- `total_tokens` — token count (from Segmenter)
- `toc` — table of contents with line numbers, e.g.:
  ```
  L1: # Introduction
  L15: ## Installation
  L42: ## Quick Start
  L89: ## API Reference
  L156: ### Methods
  ```

## File Naming

Format: `YYYYMMDD_HHMMSS_domain_path.md`
Example: `20260220_143052_docs_python_org__tutorial.md`
Directory: `.ai_pages/` (hidden, gitignored)

## Project Structure

```
webskim/
  src/
    index.ts           # MCP server, tool registration, stdio transport
    tools/
      search.ts        # webskim_search tool
      read.ts          # webskim_read tool
    services/
      jina-client.ts   # HTTP client for Jina APIs (Reader, Search, Segmenter)
      file-manager.ts  # save to .ai_pages/, file naming
      toc-generator.ts # generate TOC with line numbers from markdown
  .ai_pages/           # saved pages (gitignored)
  package.json
  tsconfig.json
```

## Jina APIs Used

| API | Endpoint | Purpose |
|-----|----------|---------|
| Search | `POST https://s.jina.ai/` | Web search, returns results with snippets |
| Reader | `POST https://r.jina.ai/` | Read URL, returns clean markdown (handles HTML + PDF) |
| Segmenter | `POST https://api.jina.ai/v1/segment` | Token counting, chunking (free) |

## Key Decisions

- **Transport:** stdio (local, for Claude Code / Cursor / etc.)
- **Output format:** markdown only (optimal for LLM)
- **Token control:** max_tokens parameter uses Segmenter to truncate; CSS selectors for precision
- **PDF support:** automatic — Reader detects and converts PDFs to markdown
- **No page management tools** — user cleans up manually
- **Auth:** JINA_API_KEY passed via env in MCP config, validated at startup

## Error Handling

- Missing API key -> fail fast at startup with clear message
- Network/API errors -> `isError: true` with readable message (no crash)
- Unavailable URL -> return error, don't save file

## Rules

- Never `console.log` — only `console.error` (stdio transport corrupts JSON-RPC)
- `.ai_pages/` in `.gitignore`
- Thin tool handlers, business logic in services
- Use `zod` for parameter validation with `.describe()` on every field
