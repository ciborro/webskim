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

  it("returns error string when head_lines is given and inline is undefined", () => {
    expect(validateReadArgs({ head_lines: 50 })).toBe(
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
