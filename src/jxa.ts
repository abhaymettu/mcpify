import { execFile } from "node:child_process";

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
  timeoutMs = 60_000,
): Promise<T> {
  const script = `function run(argv) {
  const app = Application(${JSON.stringify(appName)});
  const args = JSON.parse(argv[0]);
  const out = (${fnSource})(app, args);
  return JSON.stringify(out === undefined ? null : out);
}`;
  return new Promise((resolve, reject) => {
    execFile(
      "osascript",
      ["-l", "JavaScript", "-e", script, JSON.stringify(args ?? {})],
      { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          const detail = stderr.trim() || err.message;
          const m = detail.match(/execution error: (?:Error: )?(.*?)(?: \(-?\d+\))?$/m);
          return reject(new JxaError(m ? m[1] : detail, stderr));
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
