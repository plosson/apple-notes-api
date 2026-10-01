import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { gzipSync } from "node:zlib";
import { NoteStore, type SqliteRunner } from "./notestore.js";

const UUID = "0A1B2C3D-4E5F-6071-8293-A4B5C6D7E8F9";
const ID = `x-coredata://${UUID}/ICNote/p42`;

// "milk" as one ticked checklist item, gzipped as Notes stores it.
const BLOB = gzipSync(Buffer.from([
  0x12, 0x18, 0x1a, 0x16, 0x12, 0x04, 0x6d, 0x69, 0x6c, 0x6b, 0x2a, 0x0e, 0x08, 0x04, 0x12, 0x0a,
  0x08, 0x67, 0x2a, 0x06, 0x0a, 0x02, 0x01, 0x02, 0x10, 0x01,
]));
const HEX = BLOB.toString("hex").toUpperCase();

function fakeRunner(answer: (sql: string) => string): { run: SqliteRunner; queries: string[] } {
  const queries: string[] = [];
  return {
    queries,
    run: async (_db, sql) => {
      queries.push(sql);
      return answer(sql);
    },
  };
}

describe("NoteStore.checklist", () => {
  it("reads a note's items when the id belongs to this database", async () => {
    const { run, queries } = fakeRunner(() => `${UUID}|${HEX}\n`);
    assert.deepEqual(await new NoteStore("/db", run).checklist(ID), [{ text: "milk", done: true }]);
    assert.match(queries[0], /WHERE ZNOTE = 42 /);
  });

  it("matches the store UUID without regard to case", async () => {
    const { run } = fakeRunner(() => `${UUID.toLowerCase()}|${HEX}`);
    assert.deepEqual(await new NoteStore("/db", run).checklist(ID), [{ text: "milk", done: true }]);
  });

  it("ids that are not a Notes id never reach the database, injection attempts included", async () => {
    const { run, queries } = fakeRunner(() => `${UUID}|${HEX}`);
    const store = new NoteStore("/db", run);
    for (const id of [
      "",
      "note-1",
      `x-coredata://${UUID}/ICNote/p42; DROP TABLE ZICNOTEDATA`,
      `x-coredata://${UUID}/ICNote/p42 OR 1=1`,
      `x-coredata://${UUID}/ICNote/p`,
      `x-coredata://${UUID}/ICFolder/p42`,
      `x-coredata://${UUID}/ICNote/p42/extra`,
      `x-coredata://${UUID}'--/ICNote/p42`,
      `x-coredata://${UUID}/ICNote/p1234567890123456789`,
    ]) {
      assert.equal(await store.checklist(id), null, id);
    }
    assert.equal(queries.length, 0);
  });

  it("a note from another store (another Mac's id) has no state here", async () => {
    const { run } = fakeRunner(() => `FFFFFFFF-0000-0000-0000-000000000000|${HEX}`);
    assert.equal(await new NoteStore("/db", run).checklist(ID), null);
  });

  it("a note with no content row, or empty content, has no state", async () => {
    for (const out of ["", `${UUID}|`, `${UUID}|\n`]) {
      const { run } = fakeRunner(() => out);
      assert.equal(await new NoteStore("/db", run).checklist(ID), null, JSON.stringify(out));
    }
  });

  it("content that cannot be decoded (locked note) is null, not an error", async () => {
    const { run } = fakeRunner(() => `${UUID}|0102030405060708`);
    assert.equal(await new NoteStore("/db", run).checklist(ID), null);
  });

  it("a database that cannot be opened (no Full Disk Access) is null, and not available", async () => {
    const run: SqliteRunner = async () => {
      throw new Error("Error: unable to open database file");
    };
    const store = new NoteStore("/db", run);
    assert.equal(await store.checklist(ID), null);
    assert.equal(await store.available(), false);
  });

  it("available is true when the database answers", async () => {
    const { run } = fakeRunner(() => "1\n");
    assert.equal(await new NoteStore("/db", run).available(), true);
  });
});

// Against a real SQLite file, through the real sqlite3 command.
const SQLITE = "/usr/bin/sqlite3";
describe("NoteStore with sqlite3", { skip: !existsSync(SQLITE) && "no /usr/bin/sqlite3" }, () => {
  it("reads the checklist from a database shaped like NoteStore.sqlite, read-only", async () => {
    const dir = mkdtempSync(join(tmpdir(), "notestore-"));
    try {
      const db = join(dir, "NoteStore.sqlite");
      execFileSync(SQLITE, [db, [
        "CREATE TABLE Z_METADATA (Z_VERSION INTEGER, Z_UUID VARCHAR(255), Z_PLIST BLOB);",
        `INSERT INTO Z_METADATA VALUES (1, '${UUID}', NULL);`,
        "CREATE TABLE ZICNOTEDATA (Z_PK INTEGER PRIMARY KEY, ZNOTE INTEGER, ZDATA BLOB);",
        `INSERT INTO ZICNOTEDATA VALUES (1, 42, X'${HEX}');`,
        "INSERT INTO ZICNOTEDATA VALUES (2, 43, NULL);",
      ].join("\n")]);
      const store = new NoteStore(db);
      assert.equal(await store.available(), true);
      assert.deepEqual(await store.checklist(ID), [{ text: "milk", done: true }]);
      assert.equal(await store.checklist(`x-coredata://${UUID}/ICNote/p43`), null);
      assert.equal(await store.checklist(`x-coredata://${UUID}/ICNote/p44`), null);
      assert.equal(await new NoteStore(join(dir, "missing.sqlite")).available(), false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
