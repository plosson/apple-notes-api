import { Hono } from "hono";
import type { Config } from "../config.js";
import type { ChecklistReader } from "../notes/notestore.js";

export function healthRoutes(config: Config, checklists?: ChecklistReader): Hono {
  const app = new Hono();
  app.get("/health", async (c) =>
    c.json({
      ok: true,
      version: config.version,
      platform: config.platform,
      // Whether notes come with their checklist state (Full Disk Access granted).
      checklistState: checklists ? await checklists.available() : false,
    }),
  );
  return app;
}
