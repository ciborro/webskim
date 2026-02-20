# webskim

## Web Research

Always use Jina MCP tools as the primary choice for all web operations:

- **`jina_search`** instead of `WebSearch` — returns lightweight snippets (title, URL, description)
- **`jina_read`** instead of `WebFetch` — saves page to disk as markdown, returns file path + TOC with line numbers

Use `WebSearch` and `WebFetch` only as fallback when Jina MCP tools are unavailable or fail.

### Workflow

1. `jina_search("query")` → get URLs and snippets
2. `jina_read("url")` → page saved to `.ai_pages/`, get file path + TOC
3. `Read(file_path, offset, limit)` → read only the section you need

### Why This Order?

- jina_search returns ~5 lightweight results vs WebSearch dumping full content
- jina_read saves to disk (~0 context tokens) vs WebFetch embedding entire page in context
- Reading from disk with offset/limit = surgical precision, minimal token usage
