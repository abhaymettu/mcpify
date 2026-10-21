import { execFile } from "node:child_process";

export interface SdefSummary {
  app: string;
  scriptable: boolean;
  suites: { name: string; commands: string[]; classes: { name: string; properties: string[]; elements: string[] }[] }[];
}

/** Read an app's scripting dictionary with `sdef` and summarise what an MCP adapter could reach. */
export function inspectApp(appPath: string): Promise<SdefSummary> {
  return new Promise((resolve, reject) => {
    execFile("sdef", [appPath], { maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        // sdef exits non-zero for apps with no dictionary.
        if (/no scripting|not scriptable|-192/i.test(stderr + err.message)) {
          return resolve({ app: appPath, scriptable: false, suites: [] });
        }
        return reject(new Error(stderr.trim() || err.message));
      }
      resolve({ app: appPath, scriptable: true, suites: parseSdef(stdout) });
    });
  });
}

const attr = (tag: string, name: string) => tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];

export function parseSdef(xml: string): SdefSummary["suites"] {
  const suites: SdefSummary["suites"] = [];
  for (const s of xml.matchAll(/<suite\b([^>]*)>([\s\S]*?)<\/suite>/g)) {
    const inner = s[2];
    const commands = [...inner.matchAll(/<command\b([^>]*)>/g)].map((m) => attr(m[1], "name")!).filter(Boolean);
    const classes = [...inner.matchAll(/<class(?:-extension)?\b([^>]*?)(\/>|>([\s\S]*?)<\/class(?:-extension)?>)/g)].map((m) => {
      const body = m[3] ?? "";
      return {
        name: attr(m[1], "name") ?? `extends ${attr(m[1], "extends")}`,
        properties: [...body.matchAll(/<property\b([^>]*)>/g)].map((p) => attr(p[1], "name")!).filter(Boolean),
        elements: [...body.matchAll(/<element\b([^>]*)>/g)].map((p) => attr(p[1], "type")!).filter(Boolean),
      };
    });
    suites.push({ name: attr(s[1], "name") ?? "?", commands, classes });
  }
  return suites;
}
