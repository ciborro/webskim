import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { JinaClient } from "../services/jina-client.js";
import { FileManager } from "../services/file-manager.js";
import { generateToc } from "../services/toc-generator.js";

export function registerReadTool(server: McpServer, client: JinaClient, fileManager: FileManager) {
  server.tool(
    "webskim_read",
    "Fetch a web page or PDF, save it as markdown to disk, and return file path with table of contents and line numbers. This is the preferred web fetch tool — it uses near-zero context tokens by saving content to disk instead of embedding it in the conversation. Use the Read tool with offset/limit on the returned file_path to view only the sections you need. Supports CSS selectors for targeted extraction.",
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
          target_selector: target_selector ?? undefined,
          remove_selector: remove_selector ?? undefined,
          max_tokens: max_tokens ?? undefined,
        });

        // 2. Save to disk
        const filePath = await fileManager.savePage(content, url);

        // 3. Generate TOC and count lines/estimate tokens
        const toc = generateToc(content);
        const totalLines = content.split("\n").length;
        // Rough estimate: ~4 chars per token for English text
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
