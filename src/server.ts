import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { AppAdapter } from "./adapter.ts";
import { runJxa } from "./jxa.ts";

export function buildServer(adapter: AppAdapter): McpServer {
  const server = new McpServer({ name: adapter.server, version: "0.1.0" });
  for (const tool of adapter.tools) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.input,
        annotations: { readOnlyHint: !tool.writes, destructiveHint: false },
      },
      async (args) => {
        try {
          const result = await runJxa(adapter.app, tool.jxa, args, { writes: tool.writes });
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
            structuredContent: { result },
          };
        } catch (e) {
          return { isError: true, content: [{ type: "text", text: (e as Error).message }] };
        }
      },
    );
  }
  return server;
}

export async function serveStdio(adapter: AppAdapter): Promise<void> {
  await buildServer(adapter).connect(new StdioServerTransport());
}
