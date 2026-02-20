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
