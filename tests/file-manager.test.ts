import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { FileManager } from "../src/services/file-manager.js";
import { generateToc } from "../src/services/toc-generator.js";
import { readFileSync, existsSync, rmSync } from "node:fs";
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
      expect(name).toMatch(/^\d{8}_\d{9}_docs_python_org__3__tutorial__classes.md$/);
    });

    it("handles URLs with no path", () => {
      const name = fm.generateFilename("https://example.com");
      expect(name).toMatch(/^\d{8}_\d{9}_example_com.md$/);
    });

    it("strips query parameters and fragments", () => {
      const name = fm.generateFilename("https://example.com/page?q=test#section");
      expect(name).toMatch(/^\d{8}_\d{9}_example_com__page.md$/);
    });

    it("generates unique filenames for same URL called rapidly", () => {
      const name1 = fm.generateFilename("https://example.com/page");
      const name2 = fm.generateFilename("https://example.com/page");
      expect(name1).not.toBe(name2);
    });

    it("preserves __ slash separator convention (no underscore collapse)", () => {
      const name = fm.generateFilename("https://docs.python.org/3/tutorial/classes.html");
      expect(name).toMatch(/_docs_python_org__3__tutorial__classes\.md$/);
    });

    it("strips Windows-reserved characters from filename", () => {
      const name = fm.generateFilename("https://example.com/path/x:y*z");
      expect(name).not.toMatch(/[<>:"|?*\x00-\x1f]/);
      expect(name).toMatch(/_example_com__path__x_y_z\.md$/);
    });

    it("preserves Unicode characters in path", () => {
      const name = fm.generateFilename("https://example.com/主页");
      expect(name).toContain("example_com__主页");
    });

    it("caps slug length to 150 chars", () => {
      const longPath = "a".repeat(500);
      const name = fm.generateFilename(`https://example.com/${longPath}`);
      expect(name.length).toBeLessThanOrEqual(200);
    });

    it("does not throw on malformed percent-encoding in URL path", () => {
      expect(() => fm.generateFilename("https://example.com/%ZZ")).not.toThrow();
    });

    it("generates unique names when called 1500 times within same wall-clock ms (all _cNNNN format)", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-04-21T12:00:00.123Z"));
      try {
        const seen = new Set<string>();
        for (let i = 0; i < 1500; i++) {
          const name = fm.generateFilename("https://example.com");
          expect(name).toMatch(/^\d{8}_\d{9}(_c\d{4})?_/);
          seen.add(name);
        }
        expect(seen.size).toBe(1500);
      } finally {
        vi.useRealTimers();
      }
    });

    it("uses plain timestamp (no _cNNNN suffix) when calls span different ms", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-04-21T12:00:00.123Z"));
      try {
        const a = fm.generateFilename("https://example.com");
        vi.setSystemTime(new Date("2026-04-21T12:00:00.124Z"));
        const b = fm.generateFilename("https://example.com");
        expect(a).not.toMatch(/_c\d{4}_/);
        expect(b).not.toMatch(/_c\d{4}_/);
        expect(a).not.toBe(b);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("savePage", () => {
    it("saves content with source URL header", async () => {
      const { filePath } = await fm.savePage("# Hello\n\nContent", "https://example.com/test");

      expect(existsSync(filePath)).toBe(true);
      const saved = readFileSync(filePath, "utf-8");
      expect(saved).toContain("<!-- Source: https://example.com/test -->");
      expect(saved).toContain("# Hello\n\nContent");
      expect(filePath).toContain(TEST_DIR);
      expect(filePath).toMatch(/example_com__test\.md$/);
    });

    it("returns absolute path", async () => {
      const { filePath } = await fm.savePage("content", "https://example.com");
      expect(filePath).toMatch(/^\//);
    });

    it("returns fullContent equal to bytes written to disk", async () => {
      const { filePath, fullContent } = await fm.savePage("a\nb\nc", "https://example.com");
      const onDisk = readFileSync(filePath, "utf-8");
      expect(fullContent).toBe(onDisk);
    });

    it("TOC computed from fullContent aligns with lines on disk (header accounted for)", async () => {
      const { filePath, fullContent } = await fm.savePage("# H1\nTekst", "https://example.com");
      const toc = generateToc(fullContent);
      // File: L1 `<!-- Source: ... -->`, L2 empty, L3 `# H1`, L4 `Tekst`
      expect(toc).toBe("L3: # H1");
      const savedLines = readFileSync(filePath, "utf-8").split("\n");
      expect(savedLines[2]).toBe("# H1"); // index 2 == L3
    });
  });
});
