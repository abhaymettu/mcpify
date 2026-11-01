// Write safety on the real Reminders app: dry run, one-time confirm codes, scope, elicitation, and
// deletes that need their own flag. Works only in a list named mcpify-safety, created and removed here.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ElicitRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const LIST = "mcpify-safety";
const SCOPE = `lists[name="${LIST}"]`;
const [osaCmd, ...osaPre] = (process.env.MCPIFY_OSASCRIPT || "osascript").split(/\s+/);
function osa<T>(fn: string, args: unknown = {}): T {
  const script = `function run(argv){const app=Application("Reminders");const a=JSON.parse(argv[0]);const r=(${fn})(app,a);return JSON.stringify(r===undefined?null:r);}`;
  return JSON.parse(execFileSync(osaCmd, [...osaPre, "-l", "JavaScript", "-e", script, JSON.stringify(args)], { encoding: "utf8", timeout: 240_000 }));
}
const count = (name: string) => osa<number>(`(app,a)=>app.lists.byName("${LIST}").reminders.whose({name:a.n}).length`, { n: name });

async function connect(flags: string[], elicit?: (msg: string) => { action: "accept" | "decline"; content?: Record<string, unknown> }) {
  const client = new Client({ name: "mcpify-safety", version: "0" }, { capabilities: elicit ? { elicitation: {} } : {} });
  if (elicit) client.setRequestHandler(ElicitRequestSchema, async (req) => elicit(req.params.message));
  await client.connect(new StdioClientTransport({ command: process.execPath, args: ["src/cli.ts", "Reminders", ...flags], env: process.env as Record<string, string> }));
  const call = async (name: string, args: Record<string, unknown>) => {
    const res = await client.callTool({ name, arguments: args }, undefined, { timeout: 300_000 });
    return { isError: Boolean(res.isError), text: (res.content as { text: string }[])[0]?.text ?? "", data: (res.structuredContent as { result?: any })?.result };
  };
  return { client, call };
}

before(() => osa(`(app)=>{if(!app.lists.whose({name:"${LIST}"}).length)app.lists.push(app.List({name:"${LIST}"}))}`));
after(() => osa(`(app)=>{app.lists.whose({name:"${LIST}"})().forEach(l=>app.delete(l))}`));

describe("write safety (Reminders)", () => {
  test("read only by default: no write tools are offered", async () => {
    const { client } = await connect([]);
    const { tools } = await client.listTools();
    assert.ok(tools.length > 0 && tools.every((t) => t.annotations?.readOnlyHint === true));
    await client.close();
  });

  test("dry run plans the change and makes none", async () => {
    const { client, call } = await connect(["--writes", "--dry-run"]);
    const r = await call("create_reminder", { parent: SCOPE, properties: { name: "dry-run-item" } });
    assert.equal(r.data.dry_run, true);
    assert.equal(r.data.plan.properties.name, "dry-run-item");
    assert.equal(count("dry-run-item"), 0);
    await client.close();
  });

  test("token: a plan first, the change only with its code, and a code works once and only for its own arguments", async () => {
    const { client, call } = await connect(["--writes", "--confirm", "token", "--scope", SCOPE]);
    const args = { parent: SCOPE, properties: { name: "token-item" } };
    const plan = await call("create_reminder", args);
    assert.equal(plan.data.needs_confirmation, true);
    assert.equal(count("token-item"), 0, "nothing changes before confirmation");
    const swapped = await call("create_reminder", { ...args, properties: { name: "other-item" }, confirm: plan.data.confirm });
    assert.equal(swapped.isError, true, "a code does not carry over to other arguments");
    assert.equal(count("other-item"), 0);
    const done = await call("create_reminder", { ...args, confirm: plan.data.confirm });
    assert.equal(done.data.created, true);
    assert.equal(count("token-item"), 1);
    const again = await call("create_reminder", { ...args, confirm: plan.data.confirm });
    assert.equal(again.isError, true, "a code works once");
    assert.equal(count("token-item"), 1);
    await client.close();
  });

  test("scope: writes outside the allowed list are refused, by name or by id", async () => {
    const { client, call } = await connect(["--writes", "--confirm", "none", "--scope", SCOPE]);
    const atRoot = await call("create_reminder", { properties: { name: "root-item" } });
    assert.match(atRoot.text, /refused/);
    const lists = await call("list_lists", { fields: ["name"], limit: 500 });
    const other = lists.data.items.find((l: any) => l.name !== LIST);
    if (other) {
      const out = await call("create_reminder", { parent: other.ref, properties: { name: "elsewhere-item" } });
      assert.match(out.text, /outside the allowed scope/);
    }
    const byId = lists.data.items.find((l: any) => l.name === LIST);
    const ok = await call("create_reminder", { parent: byId.ref, properties: { name: "scoped-item" } });
    assert.equal(ok.data.created, true, "the scope list named by id is inside the scope");
    await client.close();
  });

  test("elicitation: a client that can ask the user gets asked, and a decline changes nothing", async () => {
    const asked: string[] = [];
    let answer: "accept" | "decline" = "decline";
    const { client, call } = await connect(["--writes", "--scope", SCOPE], (msg) => (asked.push(msg), answer === "accept" ? { action: "accept", content: { approve: true } } : { action: "decline" }));
    const no = await call("create_reminder", { parent: SCOPE, properties: { name: "elicit-item" } });
    assert.equal(no.isError, true);
    assert.equal(count("elicit-item"), 0);
    answer = "accept";
    const yes = await call("create_reminder", { parent: SCOPE, properties: { name: "elicit-item" } });
    assert.equal(yes.data.created, true);
    assert.equal(count("elicit-item"), 1);
    assert.equal(asked.length, 2);
    assert.match(asked[0], /elicit-item/, "the user sees what will change");
    await client.close();
  });

  test("deletes exist only with --allow-delete", async () => {
    const plain = await connect(["--writes", "--confirm", "none"]);
    assert.ok(!(await plain.client.listTools()).tools.some((t) => t.name.startsWith("delete_")));
    await plain.client.close();
    const { client, call } = await connect(["--writes", "--allow-delete", "--confirm", "none", "--scope", SCOPE]);
    const del = (await client.listTools()).tools.find((t) => t.name === "delete_reminder")!;
    assert.equal(del.annotations?.destructiveHint, true);
    const items = await call("list_reminders", { parent: SCOPE, where: { name: "token-item" } });
    const r = await call("delete_reminder", { ref: items.data.items[0].ref });
    assert.equal(r.data.deleted, true);
    assert.equal(count("token-item"), 0);
    await client.close();
  });
});
