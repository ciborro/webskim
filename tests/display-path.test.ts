import { describe, it, expect } from "vitest";
import { toDisplayPath } from "../src/services/display-path.js";

describe("toDisplayPath", () => {
  it("returns path relative to cwd when the file is under cwd", () => {
    expect(toDisplayPath("/home/u/proj/.ai_pages/x.md", "/home/u/proj")).toBe(
      ".ai_pages/x.md"
    );
  });

  it("keeps the absolute path when the file is outside cwd (e.g. shared volume)", () => {
    expect(toDisplayPath("/vol/shared/x.md", "/home/u/proj")).toBe(
      "/vol/shared/x.md"
    );
  });

  it("never leaks a home-prefixed absolute for the default cache location", () => {
    const cwd = "/Users/me/project";
    const out = toDisplayPath(`${cwd}/.ai_pages/2026_foo.md`, cwd);
    expect(out.startsWith("/")).toBe(false);
    expect(out).toBe(".ai_pages/2026_foo.md");
  });
});
