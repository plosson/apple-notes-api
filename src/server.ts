import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import type { Config } from "./config.js";
import { createAuthMiddleware } from "./auth.js";
import { NotesService, type NotesApi } from "./notes/service.js";
import { healthRoutes } from "./routes/health.js";
import { folderRoutes } from "./routes/folders.js";
import { noteRoutes } from "./routes/notes.js";

export interface CreateAppOptions {
  /** Inject a mock/fake Notes backend for tests. */
  notes?: NotesApi;
  /** Disable request logging (useful in tests). */
  silent?: boolean;
}

export function createApp(config: Config, options: CreateAppOptions = {}): Hono {
  const app = new Hono();
  const notes = options.notes ?? new NotesService(config.osascriptTimeoutMs);
  const requireAuth = createAuthMiddleware(config);

  if (!options.silent) {
    app.use("*", logger());
  }
  app.use(
    "*",
    cors({
      origin: "*",
      allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
      allowHeaders: ["Authorization", "Content-Type"],
    }),
  );

  // Public health (no auth)
  app.route("/", healthRoutes(config));

  // Authenticated API
  app.use("/v1/*", requireAuth);
  app.route("/", folderRoutes(notes));
  app.route("/", noteRoutes(notes));

  app.notFound((c) =>
    c.json({ error: "NotFound", message: `No route ${c.req.method} ${c.req.path}` }, 404),
  );

  return app;
}
