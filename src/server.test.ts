import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Config } from "./config.js";
import { createApp } from "./server.js";
import type {
  CreateNoteInput,
  FolderInfo,
  ListNotesQuery,
  NoteDetail,
  NoteMeta,
  NotesApi,
  UpdateNoteInput,
} from "./notes/service.js";
import { NotesPlatformError, NotesScriptError } from "./notes/service.js";
import type { ChecklistReader } from "./notes/notestore.js";

async function json<T = Record<string, unknown>>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    host: "127.0.0.1",
    port: 8787,
    apiKey: "test-secret-key",
    allowInsecure: false,
    osascriptTimeoutMs: 5000,
    noteStorePath: "/nonexistent/NoteStore.sqlite",
    version: "1.0.0-test",
    platform: "linux",
    isDarwin: false,
    ...overrides,
  };
}

function sampleNote(overrides: Partial<NoteDetail> = {}): NoteDetail {
  return {
    id: "note-1",
    name: "Sample",
    folder: "Notes",
    created: "2026-01-01T00:00:00.000Z",
    modified: "2026-01-02T00:00:00.000Z",
    body: "Hello",
    bodyHtml: "<div>Hello</div>",
    bodyMarkdown: "Hello",
    checklist: null,
    ...overrides,
  };
}

class FakeNotes implements NotesApi {
  folders: FolderInfo[] = [
    { id: "f1", name: "Notes", account: "iCloud" },
  ];
  notes = new Map<string, NoteDetail>([["note-1", sampleNote()]]);
  failWith: Error | null = null;

  private maybeFail(): void {
    if (this.failWith) throw this.failWith;
  }

  async listFolders(): Promise<FolderInfo[]> {
    this.maybeFail();
    return this.folders;
  }

  async listNotes(query: ListNotesQuery = {}): Promise<NoteMeta[]> {
    this.maybeFail();
    let items = [...this.notes.values()];
    if (query.folder) {
      items = items.filter((n) => n.folder === query.folder);
    }
    if (query.q) {
      const q = query.q.toLowerCase();
      items = items.filter(
        (n) =>
          n.name.toLowerCase().includes(q) ||
          n.body.toLowerCase().includes(q),
      );
    }
    const limit = query.limit ?? 100;
    return items.slice(0, limit).map(({ body: _b, bodyHtml: _h, bodyMarkdown: _m, ...meta }) => meta);
  }

  async getNote(id: string): Promise<NoteDetail | null> {
    this.maybeFail();
    return this.notes.get(id) ?? null;
  }

  async createNote(input: CreateNoteInput): Promise<NoteDetail> {
    this.maybeFail();
    const note = sampleNote({
      id: `note-${this.notes.size + 1}`,
      name: input.name,
      body: input.body,
      bodyHtml: `<div>${input.body}</div>`,
      bodyMarkdown: input.body,
      folder: input.folder ?? "Notes",
    });
    this.notes.set(note.id, note);
    return note;
  }

  async updateNote(
    id: string,
    input: UpdateNoteInput,
  ): Promise<NoteDetail | null> {
    this.maybeFail();
    const existing = this.notes.get(id);
    if (!existing) return null;
    const updated = sampleNote({
      ...existing,
      name: input.name ?? existing.name,
      body: input.body ?? existing.body,
      bodyHtml: input.body ? `<div>${input.body}</div>` : existing.bodyHtml,
      bodyMarkdown: input.body ?? existing.bodyMarkdown,
      folder: input.folder ?? existing.folder,
    });
    this.notes.set(id, updated);
    return updated;
  }

  async deleteNote(id: string): Promise<{ deleted: boolean; id: string }> {
    this.maybeFail();
    const deleted = this.notes.delete(id);
    return { deleted, id };
  }
}

function auth(config: Config): Record<string, string> {
  return { Authorization: `Bearer ${config.apiKey}` };
}

describe("GET /health", () => {
  it("returns 200 without auth", async () => {
    const config = testConfig();
    const app = createApp(config, { notes: new FakeNotes(), silent: true });
    const res = await app.request("/health");
    assert.equal(res.status, 200);
    const body = await json<{ ok: boolean; version: string; platform: string }>(res);
    assert.equal(body.ok, true);
    assert.equal(body.version, "1.0.0-test");
    assert.equal(body.platform, "linux");
  });
});

describe("GET /health checklistState", () => {
  const reader = (available: boolean): ChecklistReader => ({
    available: async () => available,
    checklist: async () => null,
  });

  it("is true when Notes' database can be read", async () => {
    const app = createApp(testConfig(), { notes: new FakeNotes(), checklists: reader(true), silent: true });
    const body = await json<{ checklistState: boolean }>(await app.request("/health"));
    assert.equal(body.checklistState, true);
  });

  it("is false without Full Disk Access", async () => {
    const app = createApp(testConfig(), { notes: new FakeNotes(), checklists: reader(false), silent: true });
    const body = await json<{ checklistState: boolean }>(await app.request("/health"));
    assert.equal(body.checklistState, false);
  });

  it("is false with the default reader on a database that does not exist", async () => {
    const app = createApp(testConfig(), { notes: new FakeNotes(), silent: true });
    const body = await json<{ checklistState: boolean }>(await app.request("/health"));
    assert.equal(body.checklistState, false);
  });
});

describe("GET /v1/notes/:id checklist", () => {
  it("returns the checklist field as the service gives it", async () => {
    const config = testConfig();
    const fake = new FakeNotes();
    fake.notes.set("note-1", sampleNote({ checklist: [{ text: "milk", done: true }] }));
    const app = createApp(config, { notes: fake, silent: true });
    const res = await app.request("/v1/notes/note-1", { headers: auth(config) });
    const body = await json<{ note: NoteDetail }>(res);
    assert.deepEqual(body.note.checklist, [{ text: "milk", done: true }]);
  });
});

describe("auth on /v1/*", () => {
  it("returns 401 without Authorization", async () => {
    const config = testConfig();
    const app = createApp(config, { notes: new FakeNotes(), silent: true });
    const res = await app.request("/v1/folders");
    assert.equal(res.status, 401);
    const body = await json<{ error: string }>(res);
    assert.equal(body.error, "Unauthorized");
  });

  it("returns 401 with wrong Bearer token", async () => {
    const config = testConfig();
    const app = createApp(config, { notes: new FakeNotes(), silent: true });
    const res = await app.request("/v1/folders", {
      headers: { Authorization: "Bearer wrong-key" },
    });
    assert.equal(res.status, 401);
  });

  it("allows /v1 when apiKey is null (insecure mode)", async () => {
    const config = testConfig({ apiKey: null, allowInsecure: true });
    const app = createApp(config, { notes: new FakeNotes(), silent: true });
    const res = await app.request("/v1/folders");
    assert.equal(res.status, 200);
  });
});

describe("CRUD routes via mocked NotesApi", () => {
  it("GET /v1/folders", async () => {
    const config = testConfig();
    const fake = new FakeNotes();
    const app = createApp(config, { notes: fake, silent: true });
    const res = await app.request("/v1/folders", { headers: auth(config) });
    assert.equal(res.status, 200);
    const body = await json<{ folders: FolderInfo[] }>(res);
    assert.deepEqual(body.folders, fake.folders);
  });

  it("GET /v1/notes lists metadata", async () => {
    const config = testConfig();
    const app = createApp(config, { notes: new FakeNotes(), silent: true });
    const res = await app.request("/v1/notes?limit=10", {
      headers: auth(config),
    });
    assert.equal(res.status, 200);
    const body = await json<{ notes: Array<{ id: string; body?: string }> }>(res);
    assert.equal(body.notes.length, 1);
    assert.equal(body.notes[0].id, "note-1");
    assert.equal(body.notes[0].body, undefined);
  });

  it("GET /v1/notes/:id returns note or 404", async () => {
    const config = testConfig();
    const app = createApp(config, { notes: new FakeNotes(), silent: true });

    const ok = await app.request("/v1/notes/note-1", { headers: auth(config) });
    assert.equal(ok.status, 200);
    assert.equal((await json<{ note: { name: string } }>(ok)).note.name, "Sample");

    const missing = await app.request("/v1/notes/nope", {
      headers: auth(config),
    });
    assert.equal(missing.status, 404);
    assert.equal((await json<{ error: string }>(missing)).error, "NotFound");
  });

  it("POST /v1/notes creates a note", async () => {
    const config = testConfig();
    const fake = new FakeNotes();
    const app = createApp(config, { notes: fake, silent: true });
    const res = await app.request("/v1/notes", {
      method: "POST",
      headers: { ...auth(config), "Content-Type": "application/json" },
      body: JSON.stringify({ name: "New", body: "Content", folder: "Notes" }),
    });
    assert.equal(res.status, 201);
    const body = await json<{ note: { name: string } }>(res);
    assert.equal(body.note.name, "New");
    assert.equal(fake.notes.size, 2);
  });

  it("POST /v1/notes validates body", async () => {
    const config = testConfig();
    const app = createApp(config, { notes: new FakeNotes(), silent: true });
    const res = await app.request("/v1/notes", {
      method: "POST",
      headers: { ...auth(config), "Content-Type": "application/json" },
      body: JSON.stringify({ body: "missing name" }),
    });
    assert.equal(res.status, 400);
    assert.equal((await json<{ error: string }>(res)).error, "ValidationError");
  });

  it("PATCH /v1/notes/:id updates a note", async () => {
    const config = testConfig();
    const app = createApp(config, { notes: new FakeNotes(), silent: true });
    const res = await app.request("/v1/notes/note-1", {
      method: "PATCH",
      headers: { ...auth(config), "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Renamed" }),
    });
    assert.equal(res.status, 200);
    assert.equal((await json<{ note: { name: string } }>(res)).note.name, "Renamed");
  });

  it("DELETE /v1/notes/:id deletes or 404", async () => {
    const config = testConfig();
    const fake = new FakeNotes();
    const app = createApp(config, { notes: fake, silent: true });

    const ok = await app.request("/v1/notes/note-1", {
      method: "DELETE",
      headers: auth(config),
    });
    assert.equal(ok.status, 200);
    const body = await json<{ ok: boolean; id: string }>(ok);
    assert.equal(body.ok, true);
    assert.equal(body.id, "note-1");
    assert.equal(fake.notes.size, 0);

    const missing = await app.request("/v1/notes/note-1", {
      method: "DELETE",
      headers: auth(config),
    });
    assert.equal(missing.status, 404);
  });

  it("maps NotesPlatformError to 501", async () => {
    const config = testConfig();
    const fake = new FakeNotes();
    fake.failWith = new NotesPlatformError("not darwin");
    const app = createApp(config, { notes: fake, silent: true });
    const res = await app.request("/v1/folders", { headers: auth(config) });
    assert.equal(res.status, 501);
    assert.equal((await json<{ error: string }>(res)).error, "PlatformUnsupported");
  });

  it("maps NotesScriptError folder-not-found to 404", async () => {
    const config = testConfig();
    const fake = new FakeNotes();
    fake.failWith = new NotesScriptError("Folder not found: Missing");
    const app = createApp(config, { notes: fake, silent: true });
    const res = await app.request("/v1/notes", {
      method: "POST",
      headers: { ...auth(config), "Content-Type": "application/json" },
      body: JSON.stringify({ name: "x", body: "y", folder: "Missing" }),
    });
    assert.equal(res.status, 404);
  });

  it("unknown route returns 404 JSON", async () => {
    const config = testConfig();
    const app = createApp(config, { notes: new FakeNotes(), silent: true });
    const res = await app.request("/v1/nope", { headers: auth(config) });
    assert.equal(res.status, 404);
    assert.equal((await json<{ error: string }>(res)).error, "NotFound");
  });
});
