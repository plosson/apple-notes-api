import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { JxaRunner, RunJxaOptions } from "./applescript.js";
import { NotesPlatformError, NotesScriptError, runJxa } from "./applescript.js";
import { NotesService } from "./service.js";

type Call = { script: string; options: RunJxaOptions };

function mockRunner(
  handler: (script: string, options: RunJxaOptions, calls: Call[]) => unknown,
): { run: JxaRunner; calls: Call[] } {
  const calls: Call[] = [];
  const run: JxaRunner = async <T = unknown>(script: string, options: RunJxaOptions) => {
    calls.push({ script, options });
    return handler(script, options, calls) as T;
  };
  return { run, calls };
}

describe("NotesService (mocked JXA runner)", () => {
  it("listFolders delegates to runner with timeout", async () => {
    const folders = [
      { id: "f1", name: "Notes", account: "iCloud" },
      { id: "f2", name: "Work", account: null },
    ];
    const { run, calls } = mockRunner(() => folders);
    const svc = new NotesService(12_000, run);

    const result = await svc.listFolders();
    assert.deepEqual(result, folders);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.timeoutMs, 12_000);
    assert.match(calls[0].script, /Application\("Notes"\)/);
  });

  it("listNotes passes folder, q, and limit as args", async () => {
    const { run, calls } = mockRunner(() => []);
    const svc = new NotesService(5000, run);

    await svc.listNotes({ folder: "Work", q: "grocery", limit: 25 });
    assert.deepEqual(calls[0].options.args, ["Work", "grocery", 25]);
  });

  it("listNotes defaults limit to 100 and null filters", async () => {
    const { run, calls } = mockRunner(() => []);
    const svc = new NotesService(5000, run);

    await svc.listNotes();
    assert.deepEqual(calls[0].options.args, [null, null, 100]);
  });

  it("getNote enriches bodyHtml into plaintext and markdown", async () => {
    const { run } = mockRunner(() => ({
      id: "n1",
      name: "Hello",
      folder: "Notes",
      created: "2026-01-01T00:00:00.000Z",
      modified: "2026-01-02T00:00:00.000Z",
      bodyHtml: "<div><b>Hi</b> world</div>",
    }));
    const svc = new NotesService(5000, run);

    const note = await svc.getNote("n1");
    assert.ok(note);
    assert.equal(note.id, "n1");
    assert.equal(note.bodyHtml, "<div><b>Hi</b> world</div>");
    assert.equal(note.body, "Hi world");
    assert.match(note.bodyMarkdown, /\*\*Hi\*\*/);
  });

  it("getNote returns null when runner returns null", async () => {
    const { run } = mockRunner(() => null);
    const svc = new NotesService(5000, run);
    assert.equal(await svc.getNote("missing"), null);
  });

  it("createNote converts plaintext body to HTML before calling runner", async () => {
    const { run, calls } = mockRunner((_script, options) => ({
      id: "n2",
      name: options.args?.[0],
      folder: options.args?.[2] ?? "Notes",
      created: null,
      modified: null,
      bodyHtml: options.args?.[1],
    }));
    const svc = new NotesService(5000, run);

    const note = await svc.createNote({
      name: "Title",
      body: "line1\n\nline2",
      folder: "Notes",
    });

    assert.equal(note.name, "Title");
    assert.equal(calls[0].options.args?.[0], "Title");
    assert.match(String(calls[0].options.args?.[1]), /<div>/);
    assert.equal(calls[0].options.args?.[2], "Notes");
    assert.match(note.body, /line1/);
  });

  it("createNote passes through HTML-looking body", async () => {
    const html = "<div><p>Already HTML</p></div>";
    const { run, calls } = mockRunner((_script, options) => ({
      id: "n3",
      name: "T",
      folder: null,
      created: null,
      modified: null,
      bodyHtml: options.args?.[1],
    }));
    const svc = new NotesService(5000, run);

    await svc.createNote({ name: "T", body: html });
    assert.equal(calls[0].options.args?.[1], html);
  });

  it("updateNote maps undefined body to null arg", async () => {
    const { run, calls } = mockRunner(() => ({
      id: "n1",
      name: "Renamed",
      folder: "Notes",
      created: null,
      modified: null,
      bodyHtml: "<div>x</div>",
    }));
    const svc = new NotesService(5000, run);

    const note = await svc.updateNote("n1", { name: "Renamed" });
    assert.ok(note);
    assert.deepEqual(calls[0].options.args, ["n1", "Renamed", null, null]);
    assert.equal(note.name, "Renamed");
  });

  it("updateNote returns null when note missing", async () => {
    const { run } = mockRunner(() => null);
    const svc = new NotesService(5000, run);
    assert.equal(await svc.updateNote("gone", { name: "x" }), null);
  });

  it("deleteNote returns runner result", async () => {
    const { run } = mockRunner(() => ({ deleted: true, id: "n1" }));
    const svc = new NotesService(5000, run);
    assert.deepEqual(await svc.deleteNote("n1"), { deleted: true, id: "n1" });
  });

  it("propagates NotesScriptError from runner", async () => {
    const { run } = mockRunner(() => {
      throw new NotesScriptError("Folder not found: Nope", "stderr");
    });
    const svc = new NotesService(5000, run);
    await assert.rejects(() => svc.listFolders(), (err: unknown) => {
      assert.ok(err instanceof NotesScriptError);
      assert.match(err.message, /Folder not found/);
      return true;
    });
  });
});

describe("runJxa platform guard", () => {
  it("throws NotesPlatformError on non-darwin", async () => {
    if (process.platform === "darwin") {
      // Still assert the type exists; skip platform throw on real Macs.
      assert.equal(typeof runJxa, "function");
      return;
    }
    await assert.rejects(
      () => runJxa("JSON.stringify(1);", { timeoutMs: 1000 }),
      (err: unknown) => {
        assert.ok(err instanceof NotesPlatformError);
        assert.match(err.message, /macOS|darwin/i);
        return true;
      },
    );
  });
});
