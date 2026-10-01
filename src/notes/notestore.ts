/**
 * Read-only access to Notes' own database, for what AppleScript does not
 * expose. Reading it needs Full Disk Access for the process running this
 * server; without it, every read here is unavailable and the API carries on
 * without the extra data.
 */

import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseChecklistBlob, type ChecklistItem } from "./checklist.js";

export const DEFAULT_NOTESTORE_PATH = join(
  homedir(),
  "Library/Group Containers/group.com.apple.notes/NoteStore.sqlite",
);

/** Runs one read-only query and returns sqlite3's output. */
export type SqliteRunner = (dbPath: string, sql: string, timeoutMs: number) => Promise<string>;

export const runSqlite: SqliteRunner = (dbPath, sql, timeoutMs) =>
  new Promise((resolve, reject) => {
    execFile(
      "/usr/bin/sqlite3",
      ["-readonly", dbPath, sql],
      { timeout: timeoutMs, maxBuffer: 256 * 1024 * 1024, encoding: "utf8" },
      (error, stdout, stderr) => {
        if (error) reject(new Error(String(stderr || error.message).trim()));
        else resolve(stdout);
      },
    );
  });

/** What the note API needs from the database; tests replace it. */
export interface ChecklistReader {
  /** Whether the database can be read at all (Full Disk Access). */
  available(): Promise<boolean>;
  /** A note's checklist items; [] when it has none; null when its state cannot be read. */
  checklist(noteId: string): Promise<ChecklistItem[] | null>;
}

/** `x-coredata://<store uuid>/ICNote/p<primary key>`, the id AppleScript gives a note. */
const NOTE_ID = /^x-coredata:\/\/([0-9A-Fa-f-]+)\/ICNote\/p(\d{1,18})$/;

export class NoteStore implements ChecklistReader {
  constructor(
    private readonly dbPath: string = DEFAULT_NOTESTORE_PATH,
    private readonly run: SqliteRunner = runSqlite,
    private readonly timeoutMs = 5000,
  ) {}

  async available(): Promise<boolean> {
    try {
      await this.run(this.dbPath, "SELECT 1;", this.timeoutMs);
      return true;
    } catch {
      return false;
    }
  }

  async checklist(noteId: string): Promise<ChecklistItem[] | null> {
    const match = NOTE_ID.exec(noteId);
    if (!match) return null;
    const [, storeUuid, pk] = match;
    let out: string;
    try {
      // pk is digits only (NOTE_ID), so it is safe in the query text.
      out = await this.run(
        this.dbPath,
        `SELECT (SELECT Z_UUID FROM Z_METADATA LIMIT 1), hex(ZDATA) FROM ZICNOTEDATA WHERE ZNOTE = ${pk} LIMIT 1;`,
        this.timeoutMs,
      );
    } catch (error) {
      console.warn(`[apple-notes-api] cannot read NoteStore (Full Disk Access?): ${(error as Error).message}`);
      return null;
    }
    const [uuid, hex] = out.trim().split("|");
    // A note from another store (or none at all) has no state here.
    if (!uuid || uuid.toLowerCase() !== storeUuid.toLowerCase() || !hex) return null;
    try {
      return parseChecklistBlob(Buffer.from(hex, "hex"));
    } catch (error) {
      console.warn(`[apple-notes-api] cannot decode note ${noteId}: ${(error as Error).message}`);
      return null;
    }
  }
}
