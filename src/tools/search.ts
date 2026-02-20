import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { JinaClient } from "../services/jina-client.js";

export function registerSearchTool(server: McpServer, client: JinaClient) {
  server.tool(
    "jina_search",
    "Search the web using Jina Search API. Returns lightweight results (title, URL, snippet) without full page content. Use jina_read on interesting URLs to get full content saved to disk.",
    {
      query: z.string().describe("Search query"),
      num_results: z.number().min(1).max(10).default(5).describe("Number of results (1-10, default 5)"),
      site: z.string().optional().describe("Restrict search to this domain, e.g. 'python.org'"),
      country: z.string().optional().describe("Country code for localized results, e.g. 'US', 'PL'"),
    },
    async ({ query, num_results, site, country }) => {
      try {
        const results = await client.search(query, {
          num_results,
          site: site ?? undefined,
          country: country ?? undefined,
        });

        const formatted = results
          .map((r, i) => `${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.snippet}`)
          .join("\n\n");

        return {
          content: [
            {
              type: "text" as const,
              text: results.length > 0
                ? `Found ${results.length} results:\n\n${formatted}`
                : "No results found.",
            },
          ],
        };
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `Search failed: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );
}
