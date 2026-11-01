import { createHmac, randomBytes } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { runJxa } from "./jxa.js";
const TOKEN_TTL_MS = 10 * 60_000;
const get = (o, dotted) => dotted.split(".").reduce((v, k) => (v && typeof v === "object" ? v[k] : undefined), o);
export function buildServer(adapter, safety = {}) {
    const server = new McpServer({ name: adapter.server, version: "0.2.0" });
    const key = randomBytes(32);
    const spent = new Set();
    const sign = (tool, args, exp) => `${exp.toString(36)}.${createHmac("sha256", key).update(JSON.stringify([tool, args, exp])).digest("base64url").slice(0, 16)}`;
    const text = (v) => ({ content: [{ type: "text", text: JSON.stringify(v, null, 2) }], structuredContent: { result: v } });
    const fail = (msg) => ({ isError: true, content: [{ type: "text", text: msg }] });
    // Parse every ref argument into a path the JXA resolver walks; check it points at the right class.
    function withPaths(tool, args) {
        const paths = {};
        for (const name of tool.refArgs ?? []) {
            const ref = get(args, name);
            if (ref === undefined || ref === null || ref === "")
                continue;
            if (typeof ref !== "string")
                throw new Error(`${name} must be a ref string`);
            if (!adapter.checkRef)
                throw new Error("this server takes no refs");
            const { path, cls } = adapter.checkRef(ref);
            if (name === "ref" && tool.refClass && cls !== tool.refClass)
                throw new Error(`${tool.name} needs a ref to a ${tool.refClass}, got a ${cls}`);
            if (name === "parent" && tool.elementOf && !tool.elementOf.parents.includes(cls))
                throw new Error(`a ${cls} cannot contain these; parent must be a ${tool.elementOf.parents.filter((p) => p !== "application").join(" or ")}`);
            paths[name] = path;
        }
        return { ...args, paths };
    }
    // Scope and target refs are compared in canonical form (selected by id), so a list named in --scope
    // matches the id-based refs that list_ tools return.
    const canon = async (ref) => (adapter.canonJxa && adapter.checkRef ? runJxa(adapter.app, adapter.canonJxa, { path: adapter.checkRef(ref).path }) : ref);
    let scopes;
    async function outOfScope(tool, args) {
        if (!safety.scope?.length)
            return;
        const refs = (tool.refArgs ?? []).map((n) => get(args, n)).filter((r) => typeof r === "string" && r !== "");
        if (!refs.length)
            return `${tool.name} has no target inside the allowed scope (${safety.scope.join(", ")})`;
        scopes ??= Promise.all(safety.scope.map(canon));
        const allowed = await scopes;
        for (const r of refs) {
            const c = await canon(r);
            if (!allowed.some((s) => c === s || c.startsWith(`${s}/`)))
                return `${r} is outside the allowed scope (${safety.scope.join(", ")})`;
        }
    }
    for (const tool of adapter.tools) {
        const confirmable = tool.writes && !safety.dryRun && (safety.confirm ?? "auto") !== "none";
        server.registerTool(tool.name, {
            description: tool.description + (tool.writes && safety.dryRun ? " (dry run: describes the change, makes none)" : confirmable ? " Asks for confirmation before changing anything." : ""),
            inputSchema: confirmable ? { ...tool.input, confirm: z.string().optional().describe("one-time code from a previous call's plan, to carry it out") } : tool.input,
            annotations: { readOnlyHint: !tool.writes, destructiveHint: Boolean(tool.destructive), idempotentHint: !tool.writes, openWorldHint: false },
        }, async (raw) => {
            try {
                const { confirm, ...args } = raw;
                const call = withPaths(tool, args);
                if (!tool.writes)
                    return text(await runJxa(adapter.app, tool.jxa, call));
                const scopeErr = await outOfScope(tool, args);
                if (scopeErr)
                    return fail(`refused: ${scopeErr}`);
                const plan = tool.preview ? await runJxa(adapter.app, tool.preview, call) : { action: tool.name, arguments: args };
                if (safety.dryRun)
                    return text({ dry_run: true, plan });
                let mode = safety.confirm ?? "auto";
                if (mode === "auto")
                    mode = server.server.getClientCapabilities()?.elicitation ? "elicit" : "token";
                if (mode === "elicit") {
                    const res = await server.server.elicitInput({
                        message: `${adapter.app}: allow this change?\n${JSON.stringify(plan, null, 2)}`,
                        requestedSchema: { type: "object", properties: { approve: { type: "boolean", title: "Approve" } }, required: ["approve"] },
                    });
                    if (res.action !== "accept" || res.content?.approve !== true)
                        return fail("not approved; nothing was changed");
                }
                else if (mode === "token") {
                    if (!confirm) {
                        const exp = Date.now() + TOKEN_TTL_MS;
                        return text({ needs_confirmation: true, plan, confirm: sign(tool.name, args, exp), note: "Nothing was changed. Check the plan, then call again with the same arguments and this confirm code." });
                    }
                    const exp = parseInt(confirm.split(".")[0], 36);
                    if (!(exp > Date.now()) || confirm !== sign(tool.name, args, exp))
                        return fail("confirm code does not match these arguments or has expired; call without confirm to get a new plan");
                    if (spent.has(confirm))
                        return fail("confirm code already used; call without confirm to get a new plan");
                    spent.add(confirm);
                }
                return text(await runJxa(adapter.app, tool.jxa, call, { writes: true }));
            }
            catch (e) {
                return fail(e.message);
            }
        });
    }
    return server;
}
export async function serveStdio(adapter, safety = {}) {
    await buildServer(adapter, safety).connect(new StdioServerTransport());
}
