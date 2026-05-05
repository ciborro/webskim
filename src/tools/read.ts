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

  const footer = [
    `--- Showing lines 1-${cap} of ${totalLines}.`,
    `For more: increase head_lines, or call again with inline:false to get TOC + file path.`,
    `Read tool with offset/limit also works on file: ${filePath}`,
  ].join("\n");

  return `**${title}**\n\n${visible}\n\n${footer}`;
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

export const readToolSchema = {
  url: z.string().url().describe("URL of web page or PDF to read"),
  max_tokens: z.number().positive().optional().describe("Truncate content to this many tokens (saves context window)"),
  target_selector: z.string().optional().describe("CSS selector — extract only this element from the page"),
  remove_selector: z.string().optional().describe("CSS selector — remove these elements before extraction. Empty string '' opts out of the default chrome stripper."),
  inline: z.boolean().optional().default(false).describe("Return markdown content directly in the response instead of file path + TOC. File is still saved to disk."),
  head_lines: z.number().int().positive().optional().describe("When inline=true, return only the first N lines (1-indexed, includes the Source header line). Requires inline=true."),
  include_images: z.boolean().optional().default(false).describe(
    "Keep <img> tags in markdown. Default false saves ~30-70% tokens on news/blog pages."
  ),
  links: z.enum(["referenced", "discarded", "inline"]).optional().default("referenced").describe(
    "How to render links. 'referenced' (default) = footer with [text][N]. 'discarded' = plain text only. 'inline' = full markdown links."
  ),
} as const;

export function registerReadTool(server: McpServer, client: JinaClient, fileManager: FileManager) {
  server.tool(
    "webskim_read",
    "Fetch URL/PDF → save as markdown to disk. Default: file path + TOC (near-zero context). Set inline:true + head_lines:N to receive markdown directly. Defaults are LLM-friendly: images stripped (include_images:true to keep), links rendered as footer references (links:'inline' to keep inline), site chrome (nav/footer/aside/ads) removed (override via remove_selector).",
    readToolSchema,
    async (args) => handleRead(args, { client, fileManager })
  );
}
