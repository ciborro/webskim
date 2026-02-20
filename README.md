# jina-mcp

MCP server that gives your AI agent **web search and page reading** — without blowing up the context window.

## The Problem

Built-in `WebFetch` dumps entire HTML pages into your context. One page = thousands of tokens gone. Search results are even worse. Your agent runs out of context doing basic research.

## The Solution

jina-mcp saves fetched pages to disk as clean markdown. The agent gets back a **table of contents with line numbers** and decides what to actually read. Search returns just titles and snippets — lightweight by default.

```
Agent: jina_search("react server components tutorial")
  → 5 results with titles, URLs, snippets (minimal tokens)

Agent: jina_read("https://react.dev/reference/rsc/server-components")
  → File: .ai_pages/20260220_143052_react_dev__reference__rsc.md
  → Lines: 342 | ~2800 tokens
  → Table of Contents:
      L1:  # Server Components
      L18: ## Reference
      L45: ## Usage
      L89: ### Fetching data
      L156: ### Streaming

Agent: Read(".ai_pages/20260220_..._rsc.md", offset=89, limit=67)
  → reads only the section it needs
```

## Tools

| Tool | What it does |
|------|-------------|
| `jina_search` | Web search → titles, URLs, snippets |
| `jina_read` | Fetch URL/PDF → save markdown to disk, return TOC |

**jina_search** params: `query`, `num_results` (1-10), `site` (domain filter), `country`

**jina_read** params: `url`, `max_tokens` (server-side truncation), `target_selector` / `remove_selector` (CSS)

## Setup

```bash
# 1. Clone and build
git clone <repo-url> && cd jina
npm install && npm run build

# 2. Add your Jina API key
echo "JINA_API_KEY=your_key_here" > .env
```

Get a free API key (10M tokens) at [jina.ai](https://jina.ai).

**Claude Code** — add to your project's `.mcp.json`:

```json
{
  "mcpServers": {
    "jina": {
      "command": "node",
      "args": ["dist/index.js"],
      "cwd": "/path/to/jina"
    }
  }
}
```

**Claude Desktop** — add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "jina": {
      "command": "node",
      "args": ["/path/to/jina/dist/index.js"],
      "env": { "JINA_API_KEY": "your_key_here" }
    }
  }
}
```

## Why Jina?

- **Clean markdown** — no HTML soup, no boilerplate, just content
- **PDFs too** — Reader handles PDFs natively, same API
- **Token budget** — `max_tokens` truncates server-side before content reaches your agent
- **CSS selectors** — extract exactly the part of the page you need
- **Fast** — search ~2.5s, read ~8s average
- **Cheap** — $0.02/1M tokens, segmenter is free

## License

MIT
