import { spawn } from "node:child_process";

export class NotesPlatformError extends Error {
  readonly code = "NOTES_PLATFORM" as const;
  constructor(message: string) {
    super(message);
    this.name = "NotesPlatformError";
  }
}

export class NotesScriptError extends Error {
  readonly code = "NOTES_SCRIPT" as const;
  readonly stderr: string;
  constructor(message: string, stderr = "") {
    super(message);
    this.name = "NotesScriptError";
    this.stderr = stderr;
  }
}

export interface RunJxaOptions {
  timeoutMs: number;
  /** Arguments injected as a JSON array into `__args` inside the script. */
  args?: unknown[];
}

/**
 * Run a JXA (JavaScript for Automation) script via `osascript -l JavaScript`.
 * Script source is delivered on stdin (avoids shell quoting / argv size issues).
 * Arguments are embedded via JSON.stringify (safe JS literal).
 */
export async function runJxa<T = unknown>(
  scriptBody: string,
  options: RunJxaOptions,
): Promise<T> {
  if (process.platform !== "darwin") {
    throw new NotesPlatformError(
      "Apple Notes API requires macOS (darwin). osascript / Notes.app are not available on this platform.",
    );
  }

  const argsLiteral = JSON.stringify(options.args ?? []);
  const fullScript = `
var __args = ${argsLiteral};
${scriptBody}
`;

  const { stdout, stderr, code, signal } = await execOsascript(
    fullScript,
    options.timeoutMs,
  );

  if (signal === "SIGKILL" || signal === "SIGTERM") {
    throw new NotesScriptError(
      `osascript timed out or was killed (signal ${signal}). Notes.app may be unresponsive.`,
      stderr,
    );
  }

  if (code !== 0) {
    const detail = (stderr || stdout || `exit code ${code}`).trim();
    throw new NotesScriptError(
      `Notes AppleScript/JXA failed: ${detail}`,
      stderr,
    );
  }

  const trimmed = stdout.trim();
  if (!trimmed) {
    return undefined as T;
  }

  try {
    return JSON.parse(trimmed) as T;
  } catch {
    // Some scripts may return a raw string; wrap as JSON string parse failure → return raw
    throw new NotesScriptError(
      `Failed to parse JXA JSON output: ${trimmed.slice(0, 200)}`,
      stderr,
    );
  }
}

function execOsascript(
  script: string,
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string; code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn("osascript", ["-l", "JavaScript", "-"], {
      stdio: ["pipe", "pipe", "pipe"],
      // Large notes / folder listings
      env: process.env,
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* ignore */
      }
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      // Cap memory if something goes sideways (64 MiB)
      if (stdout.length > 64 * 1024 * 1024) {
        try {
          child.kill("SIGKILL");
        } catch {
          /* ignore */
        }
      }
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });

    child.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout, stderr, code, signal });
    });

    child.stdin.write(script);
    child.stdin.end();
  });
}
