import { htmlToMarkdown, htmlToPlaintext, plaintextToHtml } from "./html.js";
import { annotateMarkdown, type ChecklistItem } from "./checklist.js";
import type { ChecklistReader } from "./notestore.js";
import {
  NotesPlatformError,
  NotesScriptError,
  runJxa,
  type JxaRunner,
} from "./applescript.js";

export { NotesPlatformError, NotesScriptError };

export interface NoteMeta {
  id: string;
  name: string;
  folder: string | null;
  created: string | null;
  modified: string | null;
}

export interface NoteDetail extends NoteMeta {
  body: string;
  bodyHtml: string;
  bodyMarkdown: string;
  /**
   * The note's checklist items with their ticked state, read from Notes'
   * database. [] when it has none; null when the state was not read
   * (create and update) or cannot be (no Full Disk Access).
   */
  checklist: ChecklistItem[] | null;
}

export interface FolderInfo {
  id: string;
  name: string;
  account: string | null;
}

export interface ListNotesQuery {
  folder?: string;
  q?: string;
  limit?: number;
}

export interface CreateNoteInput {
  name: string;
  body: string;
  folder?: string;
}

export interface UpdateNoteInput {
  name?: string;
  body?: string;
  folder?: string;
}

/** Structural API used by routes (allows fakes in tests). */
export interface NotesApi {
  listFolders(): Promise<FolderInfo[]>;
  listNotes(query?: ListNotesQuery): Promise<NoteMeta[]>;
  getNote(id: string): Promise<NoteDetail | null>;
  createNote(input: CreateNoteInput): Promise<NoteDetail>;
  updateNote(id: string, input: UpdateNoteInput): Promise<NoteDetail | null>;
  deleteNote(id: string): Promise<{ deleted: boolean; id: string }>;
}

export class NotesService implements NotesApi {
  private readonly run: JxaRunner;

  constructor(
    private readonly timeoutMs: number,
    run: JxaRunner = runJxa,
    private readonly checklists?: ChecklistReader,
  ) {
    this.run = run;
  }

  async listFolders(): Promise<FolderInfo[]> {
    return this.run<FolderInfo[]>(
      `
      var Notes = Application("Notes");
      var out = [];
      var folders = Notes.folders();
      for (var i = 0; i < folders.length; i++) {
        var f = folders[i];
        var accountName = null;
        try {
          var c = f.container();
          if (c && c.name) accountName = String(c.name());
        } catch (e) {}
        out.push({
          id: String(f.id()),
          name: String(f.name()),
          account: accountName
        });
      }
      JSON.stringify(out);
      `,
      { timeoutMs: this.timeoutMs },
    );
  }

  async listNotes(query: ListNotesQuery = {}): Promise<NoteMeta[]> {
    const limit = query.limit ?? 100;
    return this.run<NoteMeta[]>(LIST_NOTES_JXA, {
      timeoutMs: this.timeoutMs,
      args: [query.folder ?? null, query.q ?? null, limit],
    });
  }

  async getNote(id: string): Promise<NoteDetail | null> {
    const [raw, checklist] = await Promise.all([
      this.run<{
        id: string;
        name: string;
        folder: string | null;
        created: string | null;
        modified: string | null;
        bodyHtml: string;
      } | null>(GET_NOTE_JXA, { timeoutMs: this.timeoutMs, args: [id] }),
      this.checklists ? this.checklists.checklist(id).catch(() => null) : Promise.resolve(null),
    ]);

    if (!raw) return null;
    return enrich(raw, checklist);
  }

  async createNote(input: CreateNoteInput): Promise<NoteDetail> {
    const bodyHtml = looksLikeHtml(input.body)
      ? input.body
      : plaintextToHtml(input.body);

    const created = await this.run<{
      id: string;
      name: string;
      folder: string | null;
      created: string | null;
      modified: string | null;
      bodyHtml: string;
    }>(CREATE_NOTE_JXA, {
      timeoutMs: this.timeoutMs,
      args: [input.name, bodyHtml, input.folder ?? null],
    });

    return enrich(created);
  }

  async updateNote(
    id: string,
    input: UpdateNoteInput,
  ): Promise<NoteDetail | null> {
    const bodyHtml =
      input.body === undefined
        ? null
        : looksLikeHtml(input.body)
          ? input.body
          : plaintextToHtml(input.body);

    const updated = await this.run<{
      id: string;
      name: string;
      folder: string | null;
      created: string | null;
      modified: string | null;
      bodyHtml: string;
    } | null>(UPDATE_NOTE_JXA, {
      timeoutMs: this.timeoutMs,
      args: [id, input.name ?? null, bodyHtml, input.folder ?? null],
    });

    if (!updated) return null;
    return enrich(updated);
  }

  async deleteNote(id: string): Promise<{ deleted: boolean; id: string }> {
    return this.run<{ deleted: boolean; id: string }>(DELETE_NOTE_JXA, {
      timeoutMs: this.timeoutMs,
      args: [id],
    });
  }
}

function enrich(raw: {
  id: string;
  name: string;
  folder: string | null;
  created: string | null;
  modified: string | null;
  bodyHtml: string;
}, checklist: ChecklistItem[] | null = null): NoteDetail {
  const bodyHtml = raw.bodyHtml ?? "";
  const markdown = htmlToMarkdown(bodyHtml);
  return {
    id: raw.id,
    name: raw.name,
    folder: raw.folder,
    created: raw.created,
    modified: raw.modified,
    bodyHtml,
    body: htmlToPlaintext(bodyHtml),
    bodyMarkdown: checklist?.length ? annotateMarkdown(markdown, checklist) : markdown,
    checklist,
  };
}

function looksLikeHtml(s: string): boolean {
  return /<[a-z][\s\S]*>/i.test(s);
}

const LIST_NOTES_JXA = `
function iso(d) {
  try { return d ? new Date(d).toISOString() : null; } catch (e) { return null; }
}
var folderFilter = __args[0];
var q = __args[1];
var limit = __args[2];
var Notes = Application("Notes");
var notes = null;

if (folderFilter) {
  var folders = Notes.folders.whose({ name: folderFilter })();
  if (!folders.length) {
    notes = [];
  } else {
    notes = folders[0].notes();
  }
} else {
  notes = Notes.notes();
}

var out = [];
var qLower = q ? String(q).toLowerCase() : null;
for (var i = 0; i < notes.length; i++) {
  if (out.length >= limit) break;
  var n = notes[i];
  var name = "";
  try { name = String(n.name()); } catch (e) { continue; }
  if (qLower) {
    var hay = name.toLowerCase();
    var bodySnippet = "";
    try { bodySnippet = String(n.plaintext()).toLowerCase(); } catch (e2) {
      try { bodySnippet = String(n.body()).toLowerCase(); } catch (e3) {}
    }
    if (hay.indexOf(qLower) === -1 && bodySnippet.indexOf(qLower) === -1) continue;
  }
  var folderName = null;
  try {
    var container = n.container();
    if (container && container.name) folderName = String(container.name());
  } catch (e) {}
  var created = null, modified = null;
  try { created = iso(n.creationDate()); } catch (e) {}
  try { modified = iso(n.modificationDate()); } catch (e) {}
  out.push({
    id: String(n.id()),
    name: name,
    folder: folderName,
    created: created,
    modified: modified
  });
}
JSON.stringify(out);
`;

const GET_NOTE_JXA = `
function iso(d) {
  try { return d ? new Date(d).toISOString() : null; } catch (e) { return null; }
}
var id = __args[0];
var Notes = Application("Notes");
var matches = Notes.notes.whose({ id: id })();
if (!matches.length) {
  JSON.stringify(null);
} else {
  var n = matches[0];
  var folderName = null;
  try {
    var container = n.container();
    if (container && container.name) folderName = String(container.name());
  } catch (e) {}
  var bodyHtml = "";
  try { bodyHtml = String(n.body()); } catch (e) {
    try { bodyHtml = String(n.plaintext()); } catch (e2) { bodyHtml = ""; }
  }
  var created = null, modified = null;
  try { created = iso(n.creationDate()); } catch (e) {}
  try { modified = iso(n.modificationDate()); } catch (e) {}
  JSON.stringify({
    id: String(n.id()),
    name: String(n.name()),
    folder: folderName,
    created: created,
    modified: modified,
    bodyHtml: bodyHtml
  });
}
`;

const CREATE_NOTE_JXA = `
function iso(d) {
  try { return d ? new Date(d).toISOString() : null; } catch (e) { return null; }
}
var name = __args[0];
var bodyHtml = __args[1];
var folderName = __args[2];
var Notes = Application("Notes");
var target = null;
if (folderName) {
  var folders = Notes.folders.whose({ name: folderName })();
  if (!folders.length) {
    throw new Error("Folder not found: " + folderName);
  }
  target = folders[0];
} else {
  var defaults = Notes.folders.whose({ name: "Notes" })();
  if (defaults.length) {
    target = defaults[0];
  } else {
    var all = Notes.folders();
    if (!all.length) throw new Error("No Notes folders available");
    target = all[0];
  }
}
var n = Notes.Note({ name: name, body: bodyHtml });
target.notes.push(n);
var id = String(n.id());
var matches = Notes.notes.whose({ id: id })();
var note = matches.length ? matches[0] : n;
var folderOut = null;
try {
  var container = note.container();
  if (container && container.name) folderOut = String(container.name());
} catch (e) {}
var created = null, modified = null;
try { created = iso(note.creationDate()); } catch (e) {}
try { modified = iso(note.modificationDate()); } catch (e) {}
var outBody = "";
try { outBody = String(note.body()); } catch (e) { outBody = bodyHtml; }
JSON.stringify({
  id: id,
  name: String(note.name()),
  folder: folderOut,
  created: created,
  modified: modified,
  bodyHtml: outBody
});
`;

const UPDATE_NOTE_JXA = `
function iso(d) {
  try { return d ? new Date(d).toISOString() : null; } catch (e) { return null; }
}
var id = __args[0];
var newName = __args[1];
var newBody = __args[2];
var newFolder = __args[3];
var Notes = Application("Notes");
var matches = Notes.notes.whose({ id: id })();
if (!matches.length) {
  JSON.stringify(null);
} else {
  var n = matches[0];
  if (newName !== null) {
    n.name = newName;
  }
  if (newBody !== null) {
    n.body = newBody;
  }
  if (newFolder !== null) {
    var folders = Notes.folders.whose({ name: newFolder })();
    if (!folders.length) throw new Error("Folder not found: " + newFolder);
    Notes.move(n, { to: folders[0] });
  }
  var folderName = null;
  try {
    var container = n.container();
    if (container && container.name) folderName = String(container.name());
  } catch (e) {}
  var bodyHtml = "";
  try { bodyHtml = String(n.body()); } catch (e) {}
  var created = null, modified = null;
  try { created = iso(n.creationDate()); } catch (e) {}
  try { modified = iso(n.modificationDate()); } catch (e) {}
  JSON.stringify({
    id: String(n.id()),
    name: String(n.name()),
    folder: folderName,
    created: created,
    modified: modified,
    bodyHtml: bodyHtml
  });
}
`;

const DELETE_NOTE_JXA = `
var id = __args[0];
var Notes = Application("Notes");
var matches = Notes.notes.whose({ id: id })();
if (!matches.length) {
  JSON.stringify({ deleted: false, id: id });
} else {
  Notes.delete(matches[0]);
  JSON.stringify({ deleted: true, id: id });
}
`;
