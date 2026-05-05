import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { JinaClient } from "../services/jina-client.js";

export interface HandleSearchArgs {
  query: string;
  num_results?: number;
  site?: string;
  country?: string;
  format?: "markdown" | "json";
}

function hostFromUrl(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

export async function handleSearch(
  args: HandleSearchArgs,
  client: JinaClient
): Promise<{ isError?: boolean; content: { type: "text"; text: string }[] }> {
  try {
    const results = await client.search(args.query, {
      num_results: args.num_results,
      site: args.site,
      country: args.country,
    });

    if (args.format === "json") {
      const payload = {
        results: results.map((r, i) => ({
          i: i + 1,
          title: r.title,
          url: r.url,
          snippet: r.snippet,
          host: hostFromUrl(r.url),
        })),
      };
      return { content: [{ type: "text", text: JSON.stringify(payload) }] };
    }

    if (results.length === 0) {
      return { content: [{ type: "text", text: "No results found." }] };
    }

    const formatted = results
      .map((r, i) => `[${i + 1}] ${r.title}\n   ${r.url}\n   ${r.snippet}`)
      .join("\n\n");

    return { content: [{ type: "text", text: formatted }] };
  } catch (error) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Search failed: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
    };
  }
}

export function registerSearchTool(server: McpServer, client: JinaClient) {
  server.tool(
    "webskim_search",
    "Web search → compact results (title, URL, snippet). Set format:'json' for structured output (preferred for weak models). Follow up with webskim_read to fetch full pages.",
    {
      query: z.string().describe("Search query"),
      num_results: z.number().min(1).max(10).default(5).describe("Number of results (1-10, default 5)"),
      site: z.string().optional().describe("Restrict search to this domain, e.g. 'python.org'"),
      country: z.string().optional().describe("Country code for localized results, e.g. 'US', 'PL'"),
      format: z
        .enum(["markdown", "json"])
        .optional()
        .default("markdown")
        .describe("Output format. 'markdown' (default) = compact text. 'json' = structured {results:[{i,title,url,snippet,host}]} — preferred for weak models."),
    },
    async (args) => handleSearch(args, client)
  );
}
