import { describe, it, expect, vi, beforeEach } from "vitest";
import { JinaClient } from "../src/services/jina-client.js";
import { handleSearch } from "../src/tools/search.js";

describe("handleSearch", () => {
  let client: JinaClient;

  beforeEach(() => {
    client = new JinaClient("test-key");
    vi.spyOn(client, "search").mockResolvedValue([
      { title: "Result 1", url: "https://a.com/x", snippet: "Snippet A" },
      { title: "Result 2", url: "https://b.com/y", snippet: "Snippet B" },
    ]);
  });

  it("default markdown is compact: '[i] title\\n   url\\n   snippet'", async () => {
    const result = await handleSearch({ query: "x" }, client);
    const text = result.content[0].text;

    expect(text).toContain("[1] Result 1");
    expect(text).toContain("https://a.com/x");
    expect(text).toContain("Snippet A");
    expect(text).toContain("[2] Result 2");
    expect(text).not.toContain("Found 2 results");
    expect(text).not.toContain("**Result 1**");
  });

  it("format='json' returns parseable JSON with i, title, url, snippet, host", async () => {
    const result = await handleSearch({ query: "x", format: "json" }, client);
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.results).toHaveLength(2);
    expect(parsed.results[0]).toEqual({
      i: 1,
      title: "Result 1",
      url: "https://a.com/x",
      snippet: "Snippet A",
      host: "a.com",
    });
  });

  it("returns 'No results found.' when empty", async () => {
    (client.search as ReturnType<typeof vi.spyOn>).mockResolvedValueOnce([]);
    const result = await handleSearch({ query: "nothing" }, client);
    expect(result.content[0].text).toBe("No results found.");
  });

  it("format='json' returns empty results array when no hits", async () => {
    (client.search as ReturnType<typeof vi.spyOn>).mockResolvedValueOnce([]);
    const result = await handleSearch({ query: "nothing", format: "json" }, client);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.results).toEqual([]);
  });
});
