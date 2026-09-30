import { Hono } from "hono";
import { z } from "zod";
import type { NotesService } from "../notes/service.js";
import { handleNotesError } from "./errors.js";

const listQuerySchema = z.object({
  folder: z.string().min(1).optional(),
  q: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional().default(100),
});

const createSchema = z.object({
  name: z.string().min(1).max(2000),
  body: z.string(),
  folder: z.string().min(1).optional(),
});

const updateSchema = z
  .object({
    name: z.string().min(1).max(2000).optional(),
    body: z.string().optional(),
    folder: z.string().min(1).optional(),
  })
  .refine((v) => v.name !== undefined || v.body !== undefined || v.folder !== undefined, {
    message: "At least one of name, body, folder is required",
  });

export function noteRoutes(notes: NotesService): Hono {
  const app = new Hono();

  app.get("/v1/notes", async (c) => {
    try {
      const parsed = listQuerySchema.safeParse(c.req.query());
      if (!parsed.success) {
        return c.json(
          { error: "ValidationError", issues: parsed.error.flatten() },
          400,
        );
      }
      const items = await notes.listNotes(parsed.data);
      return c.json({ notes: items });
    } catch (err) {
      return handleNotesError(c, err);
    }
  });

  app.get("/v1/notes/:id", async (c) => {
    try {
      const id = c.req.param("id");
      const note = await notes.getNote(id);
      if (!note) return c.json({ error: "NotFound", message: "Note not found" }, 404);
      return c.json({ note });
    } catch (err) {
      return handleNotesError(c, err);
    }
  });

  app.post("/v1/notes", async (c) => {
    try {
      const body = await c.req.json().catch(() => null);
      const parsed = createSchema.safeParse(body);
      if (!parsed.success) {
        return c.json(
          { error: "ValidationError", issues: parsed.error.flatten() },
          400,
        );
      }
      const note = await notes.createNote(parsed.data);
      return c.json({ note }, 201);
    } catch (err) {
      return handleNotesError(c, err);
    }
  });

  app.patch("/v1/notes/:id", async (c) => {
    try {
      const id = c.req.param("id");
      const body = await c.req.json().catch(() => null);
      const parsed = updateSchema.safeParse(body);
      if (!parsed.success) {
        return c.json(
          { error: "ValidationError", issues: parsed.error.flatten() },
          400,
        );
      }
      const note = await notes.updateNote(id, parsed.data);
      if (!note) return c.json({ error: "NotFound", message: "Note not found" }, 404);
      return c.json({ note });
    } catch (err) {
      return handleNotesError(c, err);
    }
  });

  app.delete("/v1/notes/:id", async (c) => {
    try {
      const id = c.req.param("id");
      const result = await notes.deleteNote(id);
      if (!result.deleted) {
        return c.json({ error: "NotFound", message: "Note not found" }, 404);
      }
      return c.json({ ok: true, id: result.id, movedToRecentlyDeleted: true });
    } catch (err) {
      return handleNotesError(c, err);
    }
  });

  return app;
}
