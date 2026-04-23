import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { JinaClient } from "../services/jina-client.js";
import { FileManager } from "../services/file-manager.js";
import { generateToc } from "../services/toc-generator.js";

export function registerReadTool(server: McpServer, client: JinaClient, fileManager: FileManager) {
  server.tool(
    "webskim_read",
    "Fetch URL/PDF → save as markdown to disk, return file path + TOC with line numbers. Near-zero context tokens. Use Read tool with offset/limit on the returned path to view specific sections.",
    {
      url: z.string().url().describe("URL of web page or PDF to read"),
      max_tokens: z.number().positive().optional().describe("Truncate content to this many tokens (saves context window)"),
      target_selector: z.string().optional().describe("CSS selector — extract only this element from the page"),
      remove_selector: z.string().optional().describe("CSS selector — remove these elements before extraction"),
    },
    async ({ url, max_tokens, target_selector, remove_selector }) => {
      try {
        // 1. Fetch page content via Jina Reader
        const { title, content } = await client.read(url, {
          target_selector,
          remove_selector,
          max_tokens,
        });

        // 2. Save to disk
        const { filePath, fullContent } = await fileManager.savePage(content, url);

        // 3. Generate TOC and count lines/estimate tokens
        const toc = generateToc(fullContent);
        const totalLines = fullContent.split("\n").length;
        // estimatedTokens uses `content` (not `fullContent`) so the fixed Source-URL
        // header doesn't inflate the estimate shown to the caller.
        const estimatedTokens = Math.round(content.length / 4);

        // 4. Return metadata
        const response = [
          `**${title}**`,
          `File: ${filePath}`,
          `Lines: ${totalLines} | ~${estimatedTokens} tokens (estimate)`,
          "",
          toc ? `**Table of Contents:**\n${toc}` : "(no headings found)",
          "",
          "Use Read tool on the file path above to view content. Use offset/limit to read specific sections.",
        ].join("\n");

        return {
          content: [{ type: "text" as const, text: response }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `Failed to read URL: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );
}
