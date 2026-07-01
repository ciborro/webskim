import { describe, it, expect, vi, beforeEach } from "vitest";
import { join } from "node:path";
import { z } from "zod";
import { JinaClient } from "../src/services/jina-client.js";
import { FileManager } from "../src/services/file-manager.js";
import { handleRead, readToolSchema } from "../src/tools/read.js";

describe("readToolSchema", () => {
  it("readToolSchema applies defaults: include_images=false, links='referenced', inline=false", () => {
    const schema = z.object(readToolSchema);
    const parsed = schema.parse({ url: "https://example.com" });
    expect(parsed.include_images).toBe(false);
    expect(parsed.links).toBe("referenced");
    expect(parsed.inline).toBe(false);
  });
});

describe("handleRead", () => {
  let client: JinaClient;
  let fileManager: FileManager;

  beforeEach(() => {
    client = new JinaClient("test-key");
    vi.spyOn(client, "read").mockResolvedValue({ title: "T", content: "C" });

    fileManager = new FileManager("/tmp/.ai_pages");
    vi.spyOn(fileManager, "savePage").mockResolvedValue({
      filePath: "/tmp/.ai_pages/x.md",
      fullContent: "# Source: https://x\n\nC",
    });
  });

  it("forwards include_images, links, target_selector, remove_selector to client.read", async () => {
    const spy = client.read as ReturnType<typeof vi.spyOn>;
    await handleRead(
      {
        url: "https://example.com",
        include_images: true,
        links: "discarded",
        target_selector: "article",
        remove_selector: ".chrome",
      },
      { client, fileManager }
    );

    expect(spy).toHaveBeenCalledWith("https://example.com", {
      target_selector: "article",
      remove_selector: ".chrome",
      max_tokens: undefined,
      include_images: true,
      links: "discarded",
    });
  });

  it("relativizes a cache path under cwd in the output (no absolute leak)", async () => {
    const abs = join(process.cwd(), ".ai_pages", "20260629_120000000_example_com.md");
    vi.spyOn(fileManager, "savePage").mockResolvedValue({
      filePath: abs,
      fullContent: "<!-- Source: https://example.com -->\n\nC",
    });

    const result = await handleRead({ url: "https://example.com" }, { client, fileManager });
    const text = result.content[0].text;

    expect(text).toContain("File: .ai_pages/20260629_120000000_example_com.md");
    expect(text).not.toContain(abs);
  });

  it("keeps an absolute cache path when it is outside cwd", async () => {
    const abs = "/vol/shared/.ai_pages/20260629_120000000_example_com.md";
    vi.spyOn(fileManager, "savePage").mockResolvedValue({
      filePath: abs,
      fullContent: "<!-- Source: https://example.com -->\n\nC",
    });

    const result = await handleRead({ url: "https://example.com" }, { client, fileManager });
    expect(result.content[0].text).toContain(`File: ${abs}`);
  });

  it("appends a stripper hint when content is short and default remove_selector was active", async () => {
    vi.spyOn(client, "read").mockResolvedValue({ title: "T", content: "tiny" });
    const result = await handleRead({ url: "https://example.com" }, { client, fileManager });
    expect(result.content[0].text).toContain("remove_selector: ''");
  });

  it("no stripper hint when caller set remove_selector explicitly", async () => {
    vi.spyOn(client, "read").mockResolvedValue({ title: "T", content: "tiny" });
    const result = await handleRead(
      { url: "https://example.com", remove_selector: ".x" },
      { client, fileManager }
    );
    expect(result.content[0].text).not.toContain("remove_selector: ''");
  });

  it("no stripper hint when content is long", async () => {
    vi.spyOn(client, "read").mockResolvedValue({ title: "T", content: "x".repeat(600) });
    const result = await handleRead({ url: "https://example.com" }, { client, fileManager });
    expect(result.content[0].text).not.toContain("remove_selector: ''");
  });

  it("no stripper hint when short content is explained by max_tokens", async () => {
    vi.spyOn(client, "read").mockResolvedValue({ title: "T", content: "tiny" });
    const result = await handleRead(
      { url: "https://example.com", max_tokens: 100 },
      { client, fileManager }
    );
    expect(result.content[0].text).not.toContain("remove_selector: ''");
  });

  it("no stripper hint when short content is explained by target_selector", async () => {
    vi.spyOn(client, "read").mockResolvedValue({ title: "T", content: "tiny" });
    const result = await handleRead(
      { url: "https://example.com", target_selector: "article" },
      { client, fileManager }
    );
    expect(result.content[0].text).not.toContain("remove_selector: ''");
  });
});
