import { describe, it, expect, vi, beforeEach } from "vitest";
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
});
