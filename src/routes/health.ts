import { Hono } from "hono";
import type { Config } from "../config.js";

export function healthRoutes(config: Config): Hono {
  const app = new Hono();
  app.get("/health", (c) =>
    c.json({
      ok: true,
      version: config.version,
      platform: config.platform,
    }),
  );
  return app;
}
