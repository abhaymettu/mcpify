#!/usr/bin/env node
import { readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { execFileSync } from "node:child_process";
import { notes } from "./apps/notes.js";
import { inspectApp } from "./sdef.js";
import { adapterFromDictionary, reachable } from "./generate.js";
import { serveStdio } from "./server.js";
import { APP_DIRS, findApp } from "./find.js";
const USAGE = `mcpify: turn a scriptable Mac app into an MCP server, generated from its scripting dictionary.

usage:
  mcpify <App> [options]     serve <App> over stdio (a name like Reminders, or a path to a .app)
  mcpify tools <App> [opts]  print the tools the server would offer, then exit
  mcpify inspect <App>       show what the app exposes to scripting
  mcpify apps                list scriptable apps on this Mac

options (read only unless --writes):
  --writes            add create_, update_ and command tools
  --allow-delete      also add delete_ tools and destructive commands (needs --writes)
  --dry-run           write tools describe the change and make none
  --confirm <mode>    auto (default: ask the user via MCP elicitation if the client can, else a one-time code),
                      elicit, token, or none
  --scope <ref>       writes only inside this ref (repeatable), e.g. --scope 'lists[name="Groceries"]'
  --depth <n>         deepest containment level to generate tools for (default 4)

Claude Code:  claude mcp add reminders -- npx -y github:abhaymettu/mcpify Reminders`;
async function load(target) {
    const path = findApp(target);
    const dict = await inspectApp(path);
    if (!dict.scriptable)
        throw new Error(`${path}: no scripting dictionary, so there is nothing to generate. Apps like this need the Accessibility API, which mcpify does not use.`);
    return { path, name: basename(path).replace(/\.app$/, ""), dict };
}
function parseFlags(argv) {
    const flags = { writes: false, allowDelete: false, dryRun: false, confirm: "auto", scope: [], depth: 4 };
    const rest = [];
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === "--writes")
            flags.writes = true;
        else if (a === "--allow-delete")
            flags.allowDelete = true;
        else if (a === "--dry-run")
            flags.dryRun = true;
        else if (a === "--confirm")
            flags.confirm = argv[++i];
        else if (a === "--scope")
            flags.scope.push(argv[++i]);
        else if (a === "--depth")
            flags.depth = Number(argv[++i]);
        else if (a.startsWith("--"))
            throw new Error(`unknown option ${a}`);
        else
            rest.push(a);
    }
    if (flags.allowDelete && !flags.writes)
        throw new Error("--allow-delete needs --writes");
    if (!["auto", "elicit", "token", "none"].includes(flags.confirm))
        throw new Error("--confirm takes auto, elicit, token or none");
    return { flags, rest };
}
async function main() {
    const { flags, rest } = parseFlags(process.argv.slice(2));
    const [cmd, target] = rest;
    const gen = { writes: flags.writes, allowDelete: flags.allowDelete, maxDepth: flags.depth };
    if (!cmd || cmd === "help" || cmd === "-h") {
        console.log(USAGE);
    }
    else if (cmd === "serve" && target === "notes") {
        // The hand-written Notes server from v0, kept as a reference point for the generated one.
        await serveStdio(notes, { confirm: "none" });
    }
    else if (cmd === "inspect" && target) {
        const { path, dict } = await load(target).catch((e) => (console.log(e.message), process.exit(0)));
        const classes = reachable(dict, flags.depth);
        console.log(`${path}\nsuites: ${dict.suites.join(", ")}`);
        for (const [name, c] of classes) {
            const props = c.cls.properties.filter((p) => !["class", "properties"].includes(p.name));
            console.log(`  ${"  ".repeat(c.depth - 1)}${c.cls.plural} (in ${c.parents.join(", ")})${c.idProp ? ` id: ${c.idProp.name}` : ""}`);
            console.log(`  ${"  ".repeat(c.depth)}${props.map((p) => p.name + (p.access === "r" ? "" : "*")).join(", ")}`);
        }
        const cmds = dict.commands.filter((c) => !/standard|text suite|type definitions/i.test(c.suite));
        if (cmds.length)
            console.log(`commands: ${cmds.map((c) => c.name).join(", ")}`);
        console.log("(* = writable)");
    }
    else if (cmd === "tools" && target) {
        const { name, dict } = await load(target);
        const a = adapterFromDictionary(name, dict, gen);
        for (const t of a.tools)
            console.log(`${t.destructive ? "D" : t.writes ? "W" : "R"}  ${t.name}`);
        console.log(`${a.tools.length} tools (R read, W write, D destructive)`);
    }
    else if (cmd === "apps") {
        for (const d of APP_DIRS) {
            let names = [];
            try {
                names = readdirSync(d).filter((f) => f.endsWith(".app"));
            }
            catch { }
            for (const f of names) {
                try {
                    execFileSync("/usr/bin/defaults", ["read", join(d, f, "Contents/Info"), "OSAScriptingDefinition"], { stdio: "ignore" });
                    console.log(join(d, f));
                }
                catch { }
            }
        }
    }
    else {
        const { name, dict } = await load(cmd === "serve" ? target : cmd);
        await serveStdio(adapterFromDictionary(name, dict, gen), { dryRun: flags.dryRun, confirm: flags.confirm, scope: flags.scope });
    }
}
main().catch((e) => {
    console.error(`mcpify: ${e.message}`);
    process.exit(1);
});
