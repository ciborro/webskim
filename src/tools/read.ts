import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { JinaClient } from "../services/jina-client.js";
import { FileManager } from "../services/file-manager.js";
import { generateToc } from "../services/toc-generator.js";

export function registerReadTool(server: McpServer, client: JinaClient, fileManager: FileManager) {
  server.tool(
    "jina_read",
    "Read a web page or PDF from URL, save as markdown to disk, and return file path with table of contents. Use the Read tool on the returned file_path to view content — you control how much to read via offset/limit.",
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
        });

        // 2. Optionally truncate by token count
        let finalContent = content;
        if (max_tokens) {
          const segResult = await client.segment(content);
          if (segResult.num_tokens > max_tokens) {
            // Use chunks to approximate token boundary
            let tokenCount = 0;
            const keptChunks: string[] = [];
            for (const chunk of segResult.chunks) {
              const chunkSegment = await client.segment(chunk);
              if (tokenCount + chunkSegment.num_tokens > max_tokens) break;
              tokenCount += chunkSegment.num_tokens;
              keptChunks.push(chunk);
            }
            finalContent = keptChunks.join("\n\n") + "\n\n[... truncated at ~" + max_tokens + " tokens]";
          }
        }

        // 3. Save to disk
        const filePath = await fileManager.savePage(finalContent, url);

        // 4. Generate TOC and count lines/tokens
        const toc = generateToc(finalContent);
        const totalLines = finalContent.split("\n").length;
        const segInfo = await client.segment(finalContent);

        // 5. Return metadata
        const response = [
          `**${title}**`,
          `File: ${filePath}`,
          `Lines: ${totalLines} | Tokens: ${segInfo.num_tokens}`,
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
