import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { JinaClient } from "../services/jina-client.js";
import { FileManager } from "../services/file-manager.js";
import { generateToc } from "../services/toc-generator.js";

export function validateReadArgs(args: {
  inline?: boolean;
  head_lines?: number;
}): string | null {
  if (args.head_lines !== undefined && !args.inline) {
    return "head_lines requires inline: true";
  }
  return null;
}

export function formatFileResponse(params: {
  title: string;
  content: string;
  fullContent: string;
  filePath: string;
}): string {
  const { title, content, fullContent, filePath } = params;
  // Lines/TOC are computed from fullContent (with the Source header) so they
  // match offsets a caller would later pass to Read tool. The token estimate
  // uses pre-header content by design (see commit 9b45497) — do not unify.
  const toc = generateToc(fullContent);
  const totalLines = fullContent.split("\n").length;
  const estimatedTokens = Math.round(content.length / 4);
  return [
    `**${title}**`,
    `File: ${filePath}`,
    `Lines: ${totalLines} | ~${estimatedTokens} tokens (estimate)`,
    "",
    toc ? `**Table of Contents:**\n${toc}` : "(no headings found)",
    "",
    "Use Read tool on the file path above to view content. Use offset/limit to read specific sections.",
  ].join("\n");
}

export function formatInlineResponse(params: {
  title: string;
  fullContent: string;
  filePath: string;
  head_lines?: number;
}): string {
  const { title, fullContent, filePath, head_lines } = params;
  const lines = fullContent.split("\n");
  const totalLines = lines.length;
  const cap =
    head_lines !== undefined ? Math.min(head_lines, totalLines) : totalLines;
  const visible = lines.slice(0, cap).join("\n");

  if (cap >= totalLines) {
    return `**${title}**\n\n${visible}`;
  }
  return `**${title}**\n\n${visible}\n\n--- Showing ${cap}/${totalLines} lines. Full file: ${filePath}`;
}

export interface HandleReadArgs {
  url: string;
  max_tokens?: number;
  target_selector?: string;
  remove_selector?: string;
  include_images?: boolean;
  links?: "referenced" | "discarded" | "inline";
  inline?: boolean;
  head_lines?: number;
}

export interface HandleReadDeps {
  client: JinaClient;
  fileManager: FileManager;
}

export async function handleRead(
  args: HandleReadArgs,
  deps: HandleReadDeps
): Promise<{ isError?: boolean; content: { type: "text"; text: string }[] }> {
  const { client, fileManager } = deps;
  const inlineFlag = args.inline ?? false;

  const validationError = validateReadArgs({
    inline: inlineFlag,
    head_lines: args.head_lines,
  });
  if (validationError) {
    return {
      isError: true,
      content: [{ type: "text", text: `Validation error: ${validationError}` }],
    };
  }

  try {
    const { title, content } = await client.read(args.url, {
      target_selector: args.target_selector,
      remove_selector: args.remove_selector,
      max_tokens: args.max_tokens,
      include_images: args.include_images,
      links: args.links,
    });

    const { filePath, fullContent } = await fileManager.savePage(content, args.url);

    const text = inlineFlag
      ? formatInlineResponse({ title, fullContent, filePath, head_lines: args.head_lines })
      : formatFileResponse({ title, content, fullContent, filePath });

    return { content: [{ type: "text", text }] };
  } catch (error) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Failed to read URL: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
    };
  }
}

export function registerReadTool(server: McpServer, client: JinaClient, fileManager: FileManager) {
  server.tool(
    "webskim_read",
    "Fetch URL/PDF → save as markdown to disk. Default: return file path + TOC with line numbers (near-zero context tokens; use Read tool with offset/limit on the path). Set inline: true to also receive the markdown directly in the response — combine with head_lines: N to cap to the first N lines and avoid blowing context on large pages.",
    {
      url: z.string().url().describe("URL of web page or PDF to read"),
      max_tokens: z.number().positive().optional().describe("Truncate content to this many tokens (saves context window)"),
      target_selector: z.string().optional().describe("CSS selector — extract only this element from the page"),
      remove_selector: z.string().optional().describe("CSS selector — remove these elements before extraction"),
      include_images: z.boolean().optional().describe("Include images in the extracted content"),
      links: z.enum(["referenced", "discarded", "inline"]).optional().describe("How to handle links in the extracted content"),
      inline: z.boolean().optional().default(false).describe("Return markdown content directly in the response instead of file path + TOC. File is still saved to disk."),
      head_lines: z.number().int().positive().optional().describe("When inline=true, return only the first N lines (1-indexed, includes the Source header line). Requires inline=true."),
    },
    async (args) => handleRead(args, { client, fileManager })
  );
}
