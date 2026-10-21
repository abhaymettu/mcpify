import type { ZodRawShape } from "zod";

/** One MCP tool backed by a JXA function running inside the target app. */
export interface AppTool {
  name: string;
  description: string;
  input: ZodRawShape;
  /** Source of `(app, args) => result`, run inside osascript. */
  jxa: string;
  /** Marks tools that change the app's data. */
  writes: boolean;
}

export interface AppAdapter {
  /** Scripting name passed to `Application(...)`. */
  app: string;
  /** Server name reported over MCP. */
  server: string;
  tools: AppTool[];
}
