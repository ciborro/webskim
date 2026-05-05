import { describe, it, expect, vi } from "vitest";
import {
  formatFileResponse,
  formatInlineResponse,
  validateReadArgs,
  registerReadTool,
} from "../src/tools/read.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { JinaClient } from "../src/services/jina-client.js";
import type { FileManager } from "../src/services/file-manager.js";

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

  it("returns error string when head_lines is given and inline is undefined", () => {
    expect(validateReadArgs({ head_lines: 50 })).toBe(
      "head_lines requires inline: true"
    );
  });
});

// 10-line fullContent shared across formatter tests:
//   L1 = Source header, L2 = blank, L3..L10 = body.
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
// Pre-header content Jina returned (used for token estimate in file mode).
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

describe("formatFileResponse", () => {
  it("returns existing format with TOC and metadata", () => {
    const out = formatFileResponse({ title, content, fullContent, filePath });
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
});

describe("formatInlineResponse", () => {
  it("truncated: head_lines=3 returns first 3 lines + footer", () => {
    const out = formatInlineResponse({
      title,
      fullContent,
      filePath,
      head_lines: 3,
    });
    expect(out.startsWith("**Example**\n\n")).toBe(true);
    const expectedSlice = "<!-- Source: https://example.com -->\n\n# Title";
    expect(out).toContain(expectedSlice);
    expect(out).toContain("--- Showing lines 1-3 of 10.");
    expect(out).toContain("For more: increase head_lines, or call again with inline:false");
    expect(out).toMatch(/Read tool with offset\/limit also works on file: .+example_com\.md/);
    // Body line 4 ("para 1") must NOT appear (it's after the cut).
    expect(out).not.toContain("para 1");
  });

  it("full (no head_lines): returns title + entire fullContent, no footer", () => {
    const out = formatInlineResponse({ title, fullContent, filePath });
    expect(out).toBe(`**Example**\n\n${fullContent}`);
    expect(out).not.toMatch(/Showing \d+\/\d+ lines/);
    expect(out).not.toContain("File:"); // path intentionally omitted in full mode
  });

  it("unbounded: head_lines >= totalLines is treated as full (no footer)", () => {
    const out = formatInlineResponse({
      title,
      fullContent,
      filePath,
      head_lines: 999,
    });
    expect(out).toBe(`**Example**\n\n${fullContent}`);
    expect(out).not.toMatch(/Showing \d+\/\d+ lines/);
  });

  it("head_lines exactly equal to totalLines emits no footer", () => {
    const out = formatInlineResponse({
      title,
      fullContent,
      filePath,
      head_lines: 10,
    });
    expect(out).toBe(`**Example**\n\n${fullContent}`);
    expect(out).not.toMatch(/Showing \d+\/\d+ lines/);
  });
});

it("truncation footer hints at next-step options", () => {
  const fullContent = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`).join("\n");
  const result = formatInlineResponse({
    title: "T",
    fullContent,
    filePath: "/tmp/p.md",
    head_lines: 10,
  });

  expect(result).toContain("--- Showing lines 1-10 of 100");
  expect(result).toContain("inline:false");
  expect(result).toContain("Read tool");
  expect(result).toContain("offset");
  expect(result).toContain("/tmp/p.md");
});

it("no footer when content fits within head_lines", () => {
  const result = formatInlineResponse({
    title: "T",
    fullContent: "line 1\nline 2",
    filePath: "/tmp/p.md",
    head_lines: 10,
  });
  expect(result).not.toContain("Showing lines");
});

// Integration: register the tool against a fake McpServer that captures the
// handler, then invoke the captured handler directly. Exercises the wiring
// (envelope shape, dispatch) without booting MCP transport. Closes the gap
// between the pure helpers above and the actual MCP contract clients see.
describe("registerReadTool handler", () => {
  type Handler = (args: Record<string, unknown>) => Promise<unknown>;

  function captureHandler(client: JinaClient, fm: FileManager): Handler {
    let captured: Handler | undefined;
    const fakeServer = {
      tool: (
        _name: string,
        _description: string,
        _schema: unknown,
        handler: Handler
      ) => {
        captured = handler;
      },
    } as unknown as McpServer;
    registerReadTool(fakeServer, client, fm);
    if (!captured) throw new Error("handler was not registered");
    return captured;
  }

  it("emits isError envelope when head_lines is given without inline", async () => {
    const handler = captureHandler({} as JinaClient, {} as FileManager);
    const result = (await handler({
      url: "https://example.com",
      head_lines: 50,
    })) as { isError?: boolean; content: Array<{ type: string; text: string }> };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe(
      "Validation error: head_lines requires inline: true"
    );
  });

  it("returns formatted file-mode envelope on success", async () => {
    const fakeClient = {
      read: vi.fn().mockResolvedValue({ title: "Example", content }),
    } as unknown as JinaClient;
    const fakeFm = {
      savePage: vi.fn().mockResolvedValue({ filePath, fullContent }),
    } as unknown as FileManager;

    const handler = captureHandler(fakeClient, fakeFm);
    const result = (await handler({ url: "https://example.com" })) as {
      isError?: boolean;
      content: Array<{ type: string; text: string }>;
    };

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("**Example**");
    expect(result.content[0].text).toContain(`File: ${filePath}`);
    expect(result.content[0].text).toContain("**Table of Contents:**");
  });
});
