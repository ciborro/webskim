# webskim

Context-efficient web search and reading for AI agents. MCP server powered by [Jina AI](https://jina.ai).

Built-in `WebFetch` dumps entire pages into context. One page = thousands of tokens gone.

**webskim** saves pages to disk and returns a table of contents. Your agent reads only what it needs.

## Prerequisites

webskim uses [Jina AI](https://jina.ai) APIs under the hood — you need a **Jina API key** to use it.

> **[Get your free API key at jina.ai](https://jina.ai)** — 1M tokens included, no credit card required.

## Quick Start

**Claude Code** — add to `.mcp.json` in your project:

```json
{
  "mcpServers": {
    "webskim": {
      "command": "npx",
      "args": ["-y", "webskim"],
      "env": { "JINA_API_KEY": "jina_..." }
    }
  }
}
```

> **Tip:** Keep your key in a `.env` file instead of hardcoding it in `.mcp.json`:
>
> ```bash
> # .env (gitignored)
> JINA_API_KEY=jina_...
> ```
>
> ```json
> "env": { "JINA_API_KEY": "${JINA_API_KEY}" }
> ```
>
> Then launch Claude Code with the env loaded:
>
> ```bash
> alias c='set -a; source .env 2>/dev/null; set +a; claude'
> ```

**Claude Desktop** — add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "webskim": {
      "command": "npx",
      "args": ["-y", "webskim"],
      "env": { "JINA_API_KEY": "jina_..." }
    }
  }
}
```

**Cursor / Windsurf / other MCP clients** — same pattern, point at `npx -y webskim` with `JINA_API_KEY` in env.

## How It Works

```
Agent: jina_search("react server components")
  → 5 results: title, URL, snippet (minimal tokens)

Agent: jina_read("https://react.dev/reference/rsc/server-components")
  → Saved: .ai_pages/20260220_143052_react_dev__reference__rsc.md
  → Lines: 342 | ~2800 tokens
  → Table of Contents:
      L1:   # Server Components
      L18:  ## Reference
      L45:  ## Usage
      L89:  ### Fetching data
      L156: ### Streaming

Agent: Read(".ai_pages/..._rsc.md", offset=89, limit=67)
  → reads only the section it needs
```

No full pages in context. No wasted tokens. The agent decides what to read.

## Tools

| Tool | What it does |
|------|-------------|
| `jina_search` | Web search → titles, URLs, snippets |
| `jina_read` | Fetch URL/PDF → save as markdown, return TOC |

### jina_search

| Param | Description |
|-------|-------------|
| `query` | Search query |
| `num_results` | 1–10 (default 5) |
| `site` | Restrict to domain, e.g. `"python.org"` |
| `country` | Locale code, e.g. `"US"`, `"PL"` |

### jina_read

| Param | Description |
|-------|-------------|
| `url` | Page or PDF URL |
| `max_tokens` | Server-side truncation (saves context) |
| `target_selector` | CSS — extract only this element |
| `remove_selector` | CSS — remove elements before extraction |

## Why webskim?

**Context efficiency** — pages saved to `.ai_pages/` on disk, not dumped into context. Agent reads sections via offset/limit.

**Tiny footprint** — ~190 tokens per tool definition in system prompt. Minimal overhead vs. built-in alternatives.

**Smart search** — returns snippets, not full pages. Agent picks which URLs are worth reading.

**PDF support** — Jina Reader handles PDFs natively. Same API, same workflow.

**Server-side token budget** — `max_tokens` truncates on the server before content reaches your agent.

**CSS selectors** — `target_selector` / `remove_selector` extract exactly the part of the page you need.

**Clean markdown** — no HTML soup, no boilerplate, just readable content.

**Fast and cheap** — search ~2.5s, read ~8s. Jina API costs $0.02/1M tokens.

## Make It the Default

Add this to your project's `CLAUDE.md` so your agent always prefers webskim over built-in tools:

```markdown
## Web Research

Always use Jina MCP tools for web operations:
- `jina_search` instead of `WebSearch`
- `jina_read` instead of `WebFetch`

Workflow: search → read URL to disk → Read file with offset/limit.
WebSearch/WebFetch are fallback only.
```

Add `.ai_pages/` to your `.gitignore`.

## Development

```bash
git clone <repo-url> && cd webskim
npm install && npm run build
npm test
```

## License

MIT
