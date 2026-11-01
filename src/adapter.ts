import type { ZodRawShape } from "zod";
import type { RefPath } from "./ref.ts";

/** One MCP tool backed by a JXA function running inside the target app. */
export interface AppTool {
  name: string;
  description: string;
  input: ZodRawShape;
  /** Source of `(app, args) => result`, run inside osascript. */
  jxa: string;
  /** Marks tools that change the app's data. */
  writes: boolean;
  /** Deletes or otherwise loses data (delete_*, empty trash, send...). */
  destructive?: boolean;
  /** Source of `(app, args) => plan`, run before a write to show what it would change. Must not write. */
  preview?: string;
  /** Arguments holding refs ("ref", "parent", "properties.container"...), parsed into args.paths before the call. */
  refArgs?: string[];
  /** The class a `ref` argument must point at. */
  refClass?: string;
  /** For list_ and create_: the element collection, and which classes may contain it (a `parent` ref must point at one). */
  elementOf?: { plural: string; parents: string[] };
}

export interface AppAdapter {
  /** Scripting name passed to `Application(...)`. */
  app: string;
  /** Server name reported over MCP. */
  server: string;
  tools: AppTool[];
  /** Parse and check a ref against the dictionary; returns the path and the class it points at. */
  checkRef?: (ref: string) => { path: RefPath; cls: string };
  /** Source of `(app, {path}) => ref` returning the ref with every step selected by id where possible. */
  canonJxa?: string;
}
