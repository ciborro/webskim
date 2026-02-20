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
