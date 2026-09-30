import { serve } from "@hono/node-server";
import { loadConfig } from "./config.js";
import { createApp } from "./server.js";

function main(): void {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    console.error(`[apple-notes-api] ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }

  if (!config.isDarwin) {
    console.warn(
      `[apple-notes-api] platform=${config.platform}: /health works, but Notes routes require macOS.`,
    );
  }

  const app = createApp(config);

  console.log(
    `[apple-notes-api] v${config.version} listening on http://${config.host}:${config.port}`,
  );
  console.log(
    `[apple-notes-api] auth=${config.apiKey ? "Bearer NOTES_API_KEY" : "INSECURE (no key)"}`,
  );

  serve({
    fetch: app.fetch,
    hostname: config.host,
    port: config.port,
  });
}

main();
