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

      expect(mockFetch).toHaveBeenCalledWith("https://s.jina.ai/", expect.objectContaining({
        method: "POST",
        headers: {
          Authorization: "Bearer test-api-key",
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-Return-Format": "markdown",
        },
        body: JSON.stringify({ q: "test query", num: 2 }),
      }));
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

    it("throws descriptive error when response has no data field", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [] }),
      });

      await expect(client.search("test")).rejects.toThrow(
        "Unexpected Jina Search API response"
      );
    });

    it("aborts request after timeout", async () => {
      const fastClient = new JinaClient("test-api-key", 50);
      mockFetch.mockImplementationOnce((_url: string, init: RequestInit) => {
        return new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            reject(new DOMException("The operation was aborted.", "AbortError"));
          });
        });
      });
      await expect(fastClient.search("test")).rejects.toThrow();
    });

    it("passes country as body.gl (lowercase), not X-Locale header", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ data: [] }) });
      await client.search("test", { country: "PL" });
      const callArgs = mockFetch.mock.calls[0];
      expect(JSON.parse(callArgs[1].body)).toMatchObject({ q: "test", gl: "pl" });
      expect(callArgs[1].headers).not.toHaveProperty("X-Locale");
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

      expect(mockFetch).toHaveBeenCalledWith("https://r.jina.ai/", expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer test-api-key",
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-Return-Format": "markdown",
        }),
        body: JSON.stringify({ url: "https://example.com" }),
      }));
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

    it("throws descriptive error when response has no data field", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: "something" }),
      });

      await expect(client.read("https://example.com")).rejects.toThrow(
        "Unexpected Jina Reader API response"
      );
    });
  });

  describe("read defaults (Sprint 1)", () => {
    it("sets X-Retain-Images: none and X-Md-Link-Style: referenced by default", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { title: "T", content: "C" } }),
      });

      await client.read("https://example.com/a");

      const headers = mockFetch.mock.calls[0][1].headers;
      expect(headers["X-Retain-Images"]).toBe("none");
      expect(headers["X-Md-Link-Style"]).toBe("referenced");
    });

    it("sets X-Retain-Images: all when include_images=true", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { title: "T", content: "C" } }),
      });

      await client.read("https://example.com/a", { include_images: true });

      expect(mockFetch.mock.calls[0][1].headers["X-Retain-Images"]).toBe("all");
    });

    it("sets X-Md-Link-Style: discarded when links=discarded", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { title: "T", content: "C" } }),
      });
      await client.read("https://example.com/a", { links: "discarded" });
      expect(mockFetch.mock.calls[0][1].headers["X-Md-Link-Style"]).toBe("discarded");
    });

    it("omits X-Md-Link-Style when links=inline", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { title: "T", content: "C" } }),
      });
      await client.read("https://example.com/a", { links: "inline" });
      expect(mockFetch.mock.calls[0][1].headers).not.toHaveProperty("X-Md-Link-Style");
    });
  });

  describe("default remove selector (Sprint 1)", () => {
    it("uses default X-Remove-Selector when none provided", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { title: "T", content: "C" } }),
      });
      await client.read("https://example.com/a");

      const v = mockFetch.mock.calls[0][1].headers["X-Remove-Selector"];
      expect(v).toContain("nav");
      expect(v).toContain("footer");
      expect(v).toContain("aside");
      expect(v).toContain("[role=banner]");
      expect(v).toContain('[class*="newsletter"]');
    });

    it("respects user-provided remove_selector (override default)", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { title: "T", content: "C" } }),
      });
      await client.read("https://example.com/a", { remove_selector: ".only-this" });
      expect(mockFetch.mock.calls[0][1].headers["X-Remove-Selector"]).toBe(".only-this");
    });

    it("treats remove_selector='' (empty string) as escape hatch — omits header entirely", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { title: "T", content: "C" } }),
      });
      await client.read("https://example.com/a", { remove_selector: "" });
      expect(mockFetch.mock.calls[0][1].headers).not.toHaveProperty("X-Remove-Selector");
    });
  });
});
