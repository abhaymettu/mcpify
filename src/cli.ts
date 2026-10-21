#!/usr/bin/env node
import { notes } from "./apps/notes.ts";
import type { AppAdapter } from "./adapter.ts";
import { inspectApp } from "./sdef.ts";
import { serveStdio } from "./server.ts";

const adapters: Record<string, AppAdapter> = { notes };
const [cmd, target] = process.argv.slice(2);

if (cmd === "serve" && target && adapters[target]) {
  await serveStdio(adapters[target]);
} else if (cmd === "inspect" && target) {
  const s = await inspectApp(target);
  if (!s.scriptable) {
    console.log(`${target}: no scripting dictionary. An adapter would need the Accessibility API (not in v0).`);
  } else {
    for (const suite of s.suites) {
      console.log(`## ${suite.name}`);
      if (suite.commands.length) console.log(`  commands: ${suite.commands.join(", ")}`);
      for (const c of suite.classes) {
        console.log(`  class ${c.name}: ${c.properties.join(", ") || "(no properties)"}`);
        if (c.elements.length) console.log(`    contains: ${c.elements.join(", ")}`);
      }
    }
  }
} else {
  console.error(`usage:
  mcpify serve <app>      run an MCP server over stdio (apps: ${Object.keys(adapters).join(", ")})
  mcpify inspect <path>   show what a Mac app exposes to scripting, e.g. /System/Applications/Notes.app`);
  process.exit(2);
}
