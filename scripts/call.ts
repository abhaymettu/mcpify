// Call tools on a generated server from the shell: node scripts/call.ts "<mcpify args>" tool '{"json":1}' [tool '{...}' ...]
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const [argstr, ...calls] = process.argv.slice(2);
const client = new Client({ name: "mcpify-call", version: "0" });
await client.connect(new StdioClientTransport({ command: process.execPath, args: ["src/cli.ts", ...JSON.parse(argstr)], env: process.env as Record<string, string> }));
let last: any = null;
for (let i = 0; i < calls.length; i += 2) {
  // "$last.path.to.value" in an argument is replaced from the previous result.
  const args = JSON.parse(calls[i + 1] ?? "{}", (_k, v) => (typeof v === "string" && v.startsWith("$last.") ? v.slice(6).split(".").reduce((o: any, k) => o?.[k], last) : v));
  const t0 = Date.now();
  const res = await client.callTool({ name: calls[i], arguments: args }, undefined, { timeout: 180_000 });
  last = (res.structuredContent as any)?.result;
  console.log(`--- ${calls[i]} ${JSON.stringify(args)} (${Date.now() - t0} ms)${res.isError ? " ERROR" : ""}\n${(res.content as any)[0].text}`);
}
await client.close();
