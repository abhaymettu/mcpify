import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { execFileSync } from "node:child_process";
export const APP_DIRS = ["/Applications", "/System/Applications", "/System/Applications/Utilities", "/System/Library/CoreServices", join(homedir(), "Applications")];
export function findApp(name) {
    if (name.endsWith(".app") && existsSync(name))
        return name;
    const want = name.toLowerCase().replace(/\.app$/, "");
    for (const d of APP_DIRS) {
        try {
            const hit = readdirSync(d).find((f) => f.toLowerCase() === `${want}.app`);
            if (hit)
                return join(d, hit);
        }
        catch { }
    }
    try {
        const found = execFileSync("mdfind", [`kMDItemContentType == "com.apple.application-bundle" && kMDItemFSName == "${want.replace(/"/g, "")}.app"c`], { encoding: "utf8" }).split("\n").filter(Boolean);
        if (found[0])
            return found[0];
    }
    catch { }
    throw new Error(`no app named ${name} (try a full path, or mcpify apps)`);
}
