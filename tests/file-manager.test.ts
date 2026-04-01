import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { FileManager } from "../src/services/file-manager.js";
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
