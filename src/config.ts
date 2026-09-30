import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function readPackageVersion(): string {
  try {
    const raw = readFileSync(join(__dirname, "..", "package.json"), "utf8");
    const pkg = JSON.parse(raw) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function envBool(name: string): boolean {
  const v = process.env[name];
  return v === "1" || v === "true" || v === "yes";
}

export interface Config {
  host: string;
  port: number;
  apiKey: string | null;
  allowInsecure: boolean;
  osascriptTimeoutMs: number;
  version: string;
  platform: NodeJS.Platform;
  isDarwin: boolean;
}

export function loadConfig(): Config {
  const allowInsecure = envBool("NOTES_API_ALLOW_INSECURE");
  const apiKey = process.env.NOTES_API_KEY?.trim() || null;
  const host = process.env.NOTES_API_HOST?.trim() || "127.0.0.1";
  const port = Number(process.env.NOTES_API_PORT || "8787");
  const osascriptTimeoutMs = Number(
    process.env.NOTES_API_OSASCRIPT_TIMEOUT_MS || "30000",
  );

  if (!Number.isFinite(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid NOTES_API_PORT: ${process.env.NOTES_API_PORT}`);
  }
  if (!Number.isFinite(osascriptTimeoutMs) || osascriptTimeoutMs < 1000) {
    throw new Error(
      `Invalid NOTES_API_OSASCRIPT_TIMEOUT_MS: ${process.env.NOTES_API_OSASCRIPT_TIMEOUT_MS}`,
    );
  }

  if (!apiKey && !allowInsecure) {
    throw new Error(
      "NOTES_API_KEY is required. Set NOTES_API_ALLOW_INSECURE=1 only for local development without auth.",
    );
  }

  if (allowInsecure && !apiKey) {
    console.warn(
      "[apple-notes-api] WARNING: running without NOTES_API_KEY (NOTES_API_ALLOW_INSECURE=1). Do not expose this process.",
    );
  }

  return {
    host,
    port,
    apiKey,
    allowInsecure,
    osascriptTimeoutMs,
    version: readPackageVersion(),
    platform: process.platform,
    isDarwin: process.platform === "darwin",
  };
}
