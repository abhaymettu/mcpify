import { execFile } from "node:child_process";

/** Apple's own default Apple Event timeout is 120 s; match it. Override with MCPIFY_TIMEOUT_MS. */
function defaultTimeoutMs(): number {
  const v = Number(process.env.MCPIFY_TIMEOUT_MS);
  return Number.isFinite(v) && v > 0 ? v : 120_000;
}

export class JxaError extends Error {
  readonly stderr: string;
  constructor(message: string, stderr: string) {
    super(message);
    this.stderr = stderr;
    this.name = "JxaError";
  }
}

/**
 * Run a JXA function against a scriptable Mac app.
 *
 * `fnSource` is the source of `(app, args) => result`. Arguments travel as a JSON
 * argv string, never spliced into the script, so user text cannot inject code.
 * The result must be JSON-serialisable.
 */
export function runJxa<T>(
  appName: string,
  fnSource: string,
  args: unknown,
  { timeoutMs = defaultTimeoutMs(), writes = false }: { timeoutMs?: number; writes?: boolean } = {},
): Promise<T> {
  const script = `function run(argv) {
  const app = Application(${JSON.stringify(appName)});
  const args = JSON.parse(argv[0]);
  const out = (${fnSource})(app, args);
  return JSON.stringify(out === undefined ? null : out);
}`;
  // MCPIFY_OSASCRIPT runs osascript through a wrapper that holds the macOS Automation grants, e.g. "my-helper osascript".
  const [cmd, ...pre] = (process.env.MCPIFY_OSASCRIPT || "osascript").split(/\s+/);
  return new Promise((resolve, reject) => {
    execFile(
      cmd,
      [...pre, "-l", "JavaScript", "-e", script, JSON.stringify(args ?? {})],
      { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          if ((err as { killed?: boolean }).killed) {
            // The Apple Event stays queued inside the app, so a timed-out write can still land later.
            const tail = writes
              ? " The change may still be applied once it catches up; read it back before retrying."
              : " It may be busy (syncing or reading its store); try again.";
            return reject(new JxaError(`${appName} did not answer within ${Math.round(timeoutMs / 1000)} s.${tail}`, stderr));
          }
          // err.message embeds the whole command line (the script); never surface it.
          const detail = stderr.trim() || `osascript exited with code ${(err as { code?: unknown }).code}`;
          const m = detail.match(/execution error: (?:Error: )?(.*?)(?: \(-?\d+\))?$/m);
          return reject(new JxaError((m ? m[1] : detail).replace(/^(Error: )+/, ""), stderr));
        }
        try {
          resolve(JSON.parse(stdout) as T);
        } catch {
          reject(new JxaError(`unparseable osascript output: ${stdout.slice(0, 200)}`, stderr));
        }
      },
    );
  });
}
