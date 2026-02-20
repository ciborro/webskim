# webskim — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build an MCP server that replaces WebSearch/WebFetch with Jina.ai APIs, saving pages to disk so the agent controls token consumption.

**Architecture:** Two MCP tools (webskim_search, webskim_read) backed by three Jina APIs (Search, Reader, Segmenter). Reader saves pages to `.ai_pages/` as markdown files; agent uses built-in `Read` tool to browse them selectively. Segmenter generates TOC with line numbers so agent knows where to look.

**Tech Stack:** TypeScript, @modelcontextprotocol/sdk, zod, vitest

**Design doc:** `docs/plans/2026-02-20-jina-mcp-server-design.md`

---

### Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`

**Step 1: Initialize project and install dependencies**

```bash
cd /home/ciborro/dev/jina
npm init -y
npm install @modelcontextprotocol/sdk zod
npm install -D typescript @types/node vitest
```

**Step 2: Configure package.json**

Edit `package.json` to set:
```json
{
  "type": "module",
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "tsc --watch",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "bin": {
    "webskim": "dist/index.js"
  }
}
```

**Step 3: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true
  },
  "include": ["src/**/*"]
}
```

**Step 4: Create .gitignore**

```
node_modules/
dist/
.ai_pages/
.env
```

**Step 5: Create source directories**

```bash
mkdir -p src/tools src/services tests
```

**Step 6: Initialize git and commit**

```bash
git init
git add package.json package-lock.json tsconfig.json .gitignore
git commit -m "chore: project scaffolding with MCP SDK, zod"
```

---

### Task 2: Jina Client Service

**Files:**
- Create: `src/services/jina-client.ts`
- Create: `tests/jina-client.test.ts`

**Step 1: Write the failing tests**

```typescript
// tests/jina-client.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { JinaClient } from "../src/services/jina-client.js";

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("JinaClient", () => {
  let client: JinaClient;

  beforeEach(() => {
    client = new JinaClient("test-api-key");
    mockFetch.mockReset();
  });

  describe("search", () => {
    it("calls s.jina.ai with correct headers and returns parsed results", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [
            { title: "Result 1", url: "https://example.com", description: "Snippet 1" },
            { title: "Result 2", url: "https://example.org", description: "Snippet 2" },
          ],
        }),
      });

      const results = await client.search("test query", { num_results: 2 });

      expect(mockFetch).toHaveBeenCalledWith("https://s.jina.ai/", {
        method: "POST",
        headers: {
          Authorization: "Bearer test-api-key",
          Accept: "application/json",
          "X-Return-Format": "markdown",
        },
        body: JSON.stringify({ q: "test query", num: 2 }),
      });
      expect(results).toEqual([
        { title: "Result 1", url: "https://example.com", snippet: "Snippet 1" },
        { title: "Result 2", url: "https://example.org", snippet: "Snippet 2" },
      ]);
    });

    it("passes site filter as X-Site header", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [] }),
      });

      await client.search("test", { site: "python.org" });

      const callArgs = mockFetch.mock.calls[0];
      expect(callArgs[1].headers["X-Site"]).toBe("python.org");
    });

    it("throws on API error", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: "Too Many Requests",
      });

      await expect(client.search("test")).rejects.toThrow("Jina Search API error: 429 Too Many Requests");
    });
  });

  describe("read", () => {
    it("calls r.jina.ai and returns markdown content with title", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            title: "Example Page",
            content: "# Hello\n\nWorld",
          },
        }),
      });

      const result = await client.read("https://example.com");

      expect(mockFetch).toHaveBeenCalledWith("https://r.jina.ai/", {
        method: "POST",
        headers: {
          Authorization: "Bearer test-api-key",
          Accept: "application/json",
          "X-Return-Format": "markdown",
        },
        body: JSON.stringify({ url: "https://example.com" }),
      });
      expect(result).toEqual({ title: "Example Page", content: "# Hello\n\nWorld" });
    });

    it("passes CSS selectors as headers", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { title: "T", content: "C" } }),
      });

      await client.read("https://example.com", {
        target_selector: "main",
        remove_selector: "nav,.ads",
      });

      const callArgs = mockFetch.mock.calls[0];
      expect(callArgs[1].headers["X-Target-Selector"]).toBe("main");
      expect(callArgs[1].headers["X-Remove-Selector"]).toBe("nav,.ads");
    });
  });

  describe("segment", () => {
    it("calls segmenter API and returns token count and chunks", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          num_tokens: 150,
          chunks: ["First chunk.", "Second chunk."],
        }),
      });

      const result = await client.segment("Some long text here");

      expect(mockFetch).toHaveBeenCalledWith("https://api.jina.ai/v1/segment", {
        method: "POST",
        headers: {
          Authorization: "Bearer test-api-key",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          content: "Some long text here",
          tokenizer: "cl100k_base",
          return_tokens: false,
          return_chunks: true,
        }),
      });
      expect(result).toEqual({ num_tokens: 150, chunks: ["First chunk.", "Second chunk."] });
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/jina-client.test.ts`
Expected: FAIL — cannot import JinaClient

**Step 3: Implement JinaClient**

```typescript
// src/services/jina-client.ts

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface SearchOptions {
  num_results?: number;
  site?: string;
  country?: string;
}

export interface ReadOptions {
  target_selector?: string;
  remove_selector?: string;
}

export interface ReadResult {
  title: string;
  content: string;
}

export interface SegmentResult {
  num_tokens: number;
  chunks: string[];
}

export class JinaClient {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: "application/json",
      "X-Return-Format": "markdown",
    };

    if (options.site) {
      headers["X-Site"] = options.site;
    }
    if (options.country) {
      headers["X-Locale"] = options.country;
    }

    const body: Record<string, unknown> = { q: query };
    if (options.num_results) {
      body.num = options.num_results;
    }

    const response = await fetch("https://s.jina.ai/", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Jina Search API error: ${response.status} ${response.statusText}`);
    }

    const json = await response.json();
    return json.data.map((item: { title: string; url: string; description: string }) => ({
      title: item.title,
      url: item.url,
      snippet: item.description,
    }));
  }

  async read(url: string, options: ReadOptions = {}): Promise<ReadResult> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: "application/json",
      "X-Return-Format": "markdown",
    };

    if (options.target_selector) {
      headers["X-Target-Selector"] = options.target_selector;
    }
    if (options.remove_selector) {
      headers["X-Remove-Selector"] = options.remove_selector;
    }

    const response = await fetch("https://r.jina.ai/", {
      method: "POST",
      headers,
      body: JSON.stringify({ url }),
    });

    if (!response.ok) {
      throw new Error(`Jina Reader API error: ${response.status} ${response.statusText}`);
    }

    const json = await response.json();
    return { title: json.data.title, content: json.data.content };
  }

  async segment(content: string): Promise<SegmentResult> {
    const response = await fetch("https://api.jina.ai/v1/segment", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        content,
        tokenizer: "cl100k_base",
        return_tokens: false,
        return_chunks: true,
      }),
    });

    if (!response.ok) {
      throw new Error(`Jina Segmenter API error: ${response.status} ${response.statusText}`);
    }

    const json = await response.json();
    return { num_tokens: json.num_tokens, chunks: json.chunks };
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/jina-client.test.ts`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add src/services/jina-client.ts tests/jina-client.test.ts
git commit -m "feat: add JinaClient service for Search, Reader, and Segmenter APIs"
```

---

### Task 3: TOC Generator Service

**Files:**
- Create: `src/services/toc-generator.ts`
- Create: `tests/toc-generator.test.ts`

**Step 1: Write the failing tests**

```typescript
// tests/toc-generator.test.ts
import { describe, it, expect } from "vitest";
import { generateToc } from "../src/services/toc-generator.js";

describe("generateToc", () => {
  it("extracts headings with line numbers", () => {
    const markdown = [
      "# Introduction",
      "",
      "Some text here.",
      "",
      "## Installation",
      "",
      "More text.",
      "",
      "## Quick Start",
      "",
      "Even more text.",
      "",
      "### Step 1",
    ].join("\n");

    expect(generateToc(markdown)).toBe(
      [
        "L1: # Introduction",
        "L5: ## Installation",
        "L9: ## Quick Start",
        "L13: ### Step 1",
      ].join("\n")
    );
  });

  it("returns empty string for markdown without headings", () => {
    expect(generateToc("Just plain text\nwithout headings.")).toBe("");
  });

  it("ignores headings inside code blocks", () => {
    const markdown = [
      "# Real Heading",
      "",
      "```",
      "# This is a comment, not a heading",
      "```",
      "",
      "## Another Real Heading",
    ].join("\n");

    expect(generateToc(markdown)).toBe(
      [
        "L1: # Real Heading",
        "L7: ## Another Real Heading",
      ].join("\n")
    );
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/toc-generator.test.ts`
Expected: FAIL — cannot import generateToc

**Step 3: Implement generateToc**

```typescript
// src/services/toc-generator.ts

export function generateToc(markdown: string): string {
  const lines = markdown.split("\n");
  const entries: string[] = [];
  let inCodeBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith("```")) {
      inCodeBlock = !inCodeBlock;
      continue;
    }

    if (!inCodeBlock && /^#{1,6}\s/.test(line)) {
      entries.push(`L${i + 1}: ${line}`);
    }
  }

  return entries.join("\n");
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/toc-generator.test.ts`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add src/services/toc-generator.ts tests/toc-generator.test.ts
git commit -m "feat: add TOC generator for markdown with line numbers"
```

---

### Task 4: File Manager Service

**Files:**
- Create: `src/services/file-manager.ts`
- Create: `tests/file-manager.test.ts`

**Step 1: Write the failing tests**

```typescript
// tests/file-manager.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { FileManager } from "../src/services/file-manager.js";
import { readFileSync, existsSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const TEST_DIR = join(process.cwd(), ".ai_pages_test");

describe("FileManager", () => {
  let fm: FileManager;

  beforeEach(() => {
    fm = new FileManager(TEST_DIR);
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
  });

  describe("generateFilename", () => {
    it("creates filename from URL with timestamp prefix", () => {
      const name = fm.generateFilename("https://docs.python.org/3/tutorial/classes.html");
      // Format: YYYYMMDD_HHMMSS_domain_path.md
      expect(name).toMatch(/^\d{8}_\d{6}_docs_python_org__3__tutorial__classes.md$/);
    });

    it("handles URLs with no path", () => {
      const name = fm.generateFilename("https://example.com");
      expect(name).toMatch(/^\d{8}_\d{6}_example_com.md$/);
    });

    it("strips query parameters and fragments", () => {
      const name = fm.generateFilename("https://example.com/page?q=test#section");
      expect(name).toMatch(/^\d{8}_\d{6}_example_com__page.md$/);
    });
  });

  describe("savePage", () => {
    it("creates directory if not exists and saves content", async () => {
      const filePath = await fm.savePage("# Hello\n\nContent", "https://example.com/test");

      expect(existsSync(filePath)).toBe(true);
      expect(readFileSync(filePath, "utf-8")).toBe("# Hello\n\nContent");
      expect(filePath).toContain(TEST_DIR);
      expect(filePath).toMatch(/example_com__test\.md$/);
    });

    it("returns absolute path", async () => {
      const filePath = await fm.savePage("content", "https://example.com");
      expect(filePath).toMatch(/^\//);
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/file-manager.test.ts`
Expected: FAIL — cannot import FileManager

**Step 3: Implement FileManager**

```typescript
// src/services/file-manager.ts
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export class FileManager {
  private baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
  }

  generateFilename(url: string): string {
    const parsed = new URL(url);
    const domain = parsed.hostname.replace(/\./g, "_");
    const path = parsed.pathname
      .replace(/\.[^.]+$/, "")  // strip file extension
      .replace(/\//g, "__")      // slashes to double underscores
      .replace(/[^a-zA-Z0-9_-]/g, ""); // strip special chars

    const now = new Date();
    const ts = now.toISOString()
      .replace(/[-:T]/g, "")
      .slice(0, 15)             // YYYYMMDDHHMMSS + extra digit
      .replace(/^(\d{8})(\d{6}).*/, "$1_$2");

    const slug = path ? `${domain}_${path}` : domain;
    return `${ts}_${slug}.md`;
  }

  async savePage(content: string, url: string): Promise<string> {
    await mkdir(this.baseDir, { recursive: true });
    const filename = this.generateFilename(url);
    const filePath = join(this.baseDir, filename);
    await writeFile(filePath, content, "utf-8");
    return filePath;
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/file-manager.test.ts`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add src/services/file-manager.ts tests/file-manager.test.ts
git commit -m "feat: add FileManager for saving pages to .ai_pages/"
```

---

### Task 5: webskim_search Tool

**Files:**
- Create: `src/tools/search.ts`

**Step 1: Implement webskim_search tool registration**

```typescript
// src/tools/search.ts
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { JinaClient } from "../services/jina-client.js";

export function registerSearchTool(server: McpServer, client: JinaClient) {
  server.tool(
    "webskim_search",
    "Search the web using Jina Search API. Returns lightweight results (title, URL, snippet) without full page content. Use webskim_read on interesting URLs to get full content saved to disk.",
    {
      query: z.string().describe("Search query"),
      num_results: z.number().min(1).max(10).default(5).describe("Number of results (1-10, default 5)"),
      site: z.string().optional().describe("Restrict search to this domain, e.g. 'python.org'"),
      country: z.string().optional().describe("Country code for localized results, e.g. 'US', 'PL'"),
    },
    async ({ query, num_results, site, country }) => {
      try {
        const results = await client.search(query, {
          num_results,
          site: site ?? undefined,
          country: country ?? undefined,
        });

        const formatted = results
          .map((r, i) => `${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.snippet}`)
          .join("\n\n");

        return {
          content: [
            {
              type: "text" as const,
              text: results.length > 0
                ? `Found ${results.length} results:\n\n${formatted}`
                : "No results found.",
            },
          ],
        };
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `Search failed: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );
}
```

**Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add src/tools/search.ts
git commit -m "feat: add webskim_search MCP tool"
```

---

### Task 6: webskim_read Tool

**Files:**
- Create: `src/tools/read.ts`

**Step 1: Implement webskim_read tool registration**

```typescript
// src/tools/read.ts
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { JinaClient } from "../services/jina-client.js";
import { FileManager } from "../services/file-manager.js";
import { generateToc } from "../services/toc-generator.js";

export function registerReadTool(server: McpServer, client: JinaClient, fileManager: FileManager) {
  server.tool(
    "webskim_read",
    "Read a web page or PDF from URL, save as markdown to disk, and return file path with table of contents. Use the Read tool on the returned file_path to view content — you control how much to read via offset/limit.",
    {
      url: z.string().url().describe("URL of web page or PDF to read"),
      max_tokens: z.number().positive().optional().describe("Truncate content to this many tokens (saves context window)"),
      target_selector: z.string().optional().describe("CSS selector — extract only this element from the page"),
      remove_selector: z.string().optional().describe("CSS selector — remove these elements before extraction"),
    },
    async ({ url, max_tokens, target_selector, remove_selector }) => {
      try {
        // 1. Fetch page content via Jina Reader
        const { title, content } = await client.read(url, {
          target_selector: target_selector ?? undefined,
          remove_selector: remove_selector ?? undefined,
        });

        // 2. Optionally truncate by token count
        let finalContent = content;
        if (max_tokens) {
          const segResult = await client.segment(content);
          if (segResult.num_tokens > max_tokens) {
            // Re-segment to find truncation point
            // Use chunks to approximate token boundary
            let tokenCount = 0;
            const keptChunks: string[] = [];
            for (const chunk of segResult.chunks) {
              const chunkSegment = await client.segment(chunk);
              if (tokenCount + chunkSegment.num_tokens > max_tokens) break;
              tokenCount += chunkSegment.num_tokens;
              keptChunks.push(chunk);
            }
            finalContent = keptChunks.join("\n\n") + "\n\n[... truncated at ~" + max_tokens + " tokens]";
          }
        }

        // 3. Save to disk
        const filePath = await fileManager.savePage(finalContent, url);

        // 4. Generate TOC and count lines/tokens
        const toc = generateToc(finalContent);
        const totalLines = finalContent.split("\n").length;
        const segInfo = await client.segment(finalContent);

        // 5. Return metadata
        const response = [
          `**${title}**`,
          `File: ${filePath}`,
          `Lines: ${totalLines} | Tokens: ${segInfo.num_tokens}`,
          "",
          toc ? `**Table of Contents:**\n${toc}` : "(no headings found)",
          "",
          "Use Read tool on the file path above to view content. Use offset/limit to read specific sections.",
        ].join("\n");

        return {
          content: [{ type: "text" as const, text: response }],
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

**Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add src/tools/read.ts
git commit -m "feat: add webskim_read MCP tool with disk save and TOC"
```

---

### Task 7: MCP Server Entry Point

**Files:**
- Create: `src/index.ts`

**Step 1: Implement the server entry point**

```typescript
#!/usr/bin/env node
// src/index.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { JinaClient } from "./services/jina-client.js";
import { FileManager } from "./services/file-manager.js";
import { registerSearchTool } from "./tools/search.js";
import { registerReadTool } from "./tools/read.js";
import { join } from "node:path";

const JINA_API_KEY = process.env.JINA_API_KEY;
if (!JINA_API_KEY) {
  console.error("FATAL: JINA_API_KEY is required. Pass it via env in your MCP config.");
  process.exit(1);
}

const server = new McpServer({
  name: "webskim",
  version: "1.1.0",
});

const client = new JinaClient(JINA_API_KEY);
const fileManager = new FileManager(join(process.cwd(), ".ai_pages"));

registerSearchTool(server, client);
registerReadTool(server, client, fileManager);

const transport = new StdioServerTransport();
await server.connect(transport);

console.error("webskim server started");
```

**Step 2: Build the project**

Run: `npm run build`
Expected: No errors, `dist/` directory created with compiled JS files

**Step 3: Verify the shebang and executable**

```bash
chmod +x dist/index.js
```

**Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat: add MCP server entry point with stdio transport"
```

---

### Task 8: Integration Test

**Files:** (no new files — manual testing)

**Step 1: Build and run a basic smoke test**

```bash
npm run build
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}}}' | node dist/index.js
```

Expected: JSON-RPC response with server capabilities including the two tools.

**Step 2: Test listing tools**

```bash
echo -e '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}}}\n{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' | node dist/index.js
```

Expected: Response listing `webskim_search` and `webskim_read` tools with their schemas.

**Step 3: Configure in Claude Code**

Add to project `.mcp.json`:

```json
{
  "mcpServers": {
    "webskim": {
      "command": "npx",
      "args": ["-y", "webskim"],
      "env": {
        "JINA_API_KEY": "jina_..."
      }
    }
  }
}
```

**Step 4: Test in Claude Code**

Start a new Claude Code session and verify:
1. `webskim_search` appears in tool list
2. `webskim_read` appears in tool list
3. Search returns results
4. Read saves file and returns TOC

**Step 5: Final commit**

```bash
git add -A
git commit -m "chore: complete webskim server v1.1.0"
```
