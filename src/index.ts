#!/usr/bin/env node
import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { JinaClient } from "./services/jina-client.js";
import { FileManager } from "./services/file-manager.js";
import { registerSearchTool } from "./tools/search.js";
import { registerReadTool } from "./tools/read.js";
import { join } from "node:path";

const require = createRequire(import.meta.url);
// dist/index.js lives one level below package root, so ../package.json
// resolves to this package's manifest both in dev and when installed via npx.
const { version } = require("../package.json") as { version: string };

const JINA_API_KEY = process.env.JINA_API_KEY;
if (!JINA_API_KEY) {
  console.error("FATAL: JINA_API_KEY is required. Pass it via env in your MCP config.");
  process.exit(1);
}

const server = new McpServer({
  name: "webskim",
  version,
});

const client = new JinaClient(JINA_API_KEY);
const cacheDir = process.env.WEBSKIM_CACHE_DIR ?? join(process.cwd(), ".ai_pages");
const fileManager = new FileManager(cacheDir);

registerSearchTool(server, client);
registerReadTool(server, client, fileManager);

const transport = new StdioServerTransport();
await server.connect(transport);

console.error("webskim server started");
