import { Hono } from "hono";
import type { NotesApi } from "../notes/service.js";
import { handleNotesError } from "./errors.js";

export function folderRoutes(notes: NotesApi): Hono {
  const app = new Hono();

  app.get("/v1/folders", async (c) => {
    try {
      const folders = await notes.listFolders();
      return c.json({ folders });
    } catch (err) {
      return handleNotesError(c, err);
    }
  });

  return app;
}
