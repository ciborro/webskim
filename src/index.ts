#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { JinaClient } from "./services/jina-client.js";
import { FileManager } from "./services/file-manager.js";
import { registerSearchTool } from "./tools/search.js";
import { registerReadTool } from "./tools/read.js";
import { join } from "node:path";

const JINA_API_KEY = process.env.JINA_API_KEY;
if (!JINA_API_KEY) {
  console.error("FATAL: JINA_API_KEY is required. Pass it via env in your MCP config.");
  process.exit(1);
}

const server = new McpServer({
  name: "webskim",
  version: "1.2.0",
});

const client = new JinaClient(JINA_API_KEY);
const fileManager = new FileManager(join(process.cwd(), ".ai_pages"));

registerSearchTool(server, client);
registerReadTool(server, client, fileManager);

const transport = new StdioServerTransport();
await server.connect(transport);

console.error("webskim server started");
