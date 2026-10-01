/**
 * Checklist state from a note's stored content.
 *
 * AppleScript's `body` turns a checklist into a plain list: which items are
 * ticked is not in it. Notes keeps that in the note's content record, a
 * compressed (gzip or zlib) protobuf in NoteStore.sqlite (ZICNOTEDATA.ZDATA):
 *
 *   document → 2 (version) → 3 (note)
 *     → 2  text: the note's plain text, lines separated by "\n"
 *     → 5  attribute runs (repeated), in text order
 *          → 1 length, in UTF-16 code units
 *          → 2 paragraph style → 1 style type (103 = checklist)
 *                              → 5 checklist → 2 done (0 or 1)
 *
 * The layout follows sweetrb/apple-notes-mcp (MIT), which documents it.
 */

import { unzipSync } from "node:zlib";

export interface ChecklistItem {
  text: string;
  done: boolean;
}

const CHECKLIST_STYLE = 103;

type Field = { field: number; varint?: number; bytes?: Uint8Array };

/** One protobuf message's fields; malformed input throws. Fixed-width fields are skipped. */
export function decodeMessage(buf: Uint8Array): Field[] {
  const fields: Field[] = [];
  let pos = 0;

  const varint = (): number => {
    let result = 0;
    let scale = 1;
    for (let i = 0; i < 10; i++) {
      if (pos >= buf.length) throw new Error("truncated varint");
      const byte = buf[pos++];
      result += (byte & 0x7f) * scale;
      if ((byte & 0x80) === 0) return result;
      scale *= 128;
    }
    throw new Error("varint too long");
  };

  while (pos < buf.length) {
    const tag = varint();
    const field = Math.floor(tag / 8);
    const wire = tag % 8;
    if (field === 0) throw new Error("field number 0");
    if (wire === 0) {
      fields.push({ field, varint: varint() });
    } else if (wire === 2) {
      const length = varint();
      if (pos + length > buf.length) throw new Error("truncated field");
      fields.push({ field, bytes: buf.subarray(pos, pos + length) });
      pos += length;
    } else if (wire === 1 || wire === 5) {
      pos += wire === 1 ? 8 : 4;
      if (pos > buf.length) throw new Error("truncated field");
    } else {
      throw new Error(`unsupported wire type ${wire}`);
    }
  }
  return fields;
}

function first(fields: Field[], n: number): Field | undefined {
  return fields.find((f) => f.field === n);
}

function child(fields: Field[] | undefined, n: number): Field[] | undefined {
  const bytes = fields && first(fields, n)?.bytes;
  return bytes ? decodeMessage(bytes) : undefined;
}

/**
 * The start of the line a run styles: the line of its first character that is
 * not a newline. Notes stores a checklist run either as "Item\n" or, for an
 * item appended on recent macOS, as "\nItem"; a run of newlines only belongs
 * to the line it ends.
 */
function lineStartOfRun(text: string, start: number, length: number): number {
  const end = start + length;
  let at = start;
  while (at < end && text[at] === "\n") at++;
  if (at === end) at = start;
  return at === 0 ? 0 : text.lastIndexOf("\n", at - 1) + 1;
}

/** The checklist items of a note's decompressed content, in order; [] when it has none. */
export function parseChecklist(content: Uint8Array): ChecklistItem[] {
  const note = child(child(decodeMessage(content), 2), 3);
  if (!note) throw new Error("no note in content");
  const textBytes = first(note, 2)?.bytes;
  if (!textBytes) return [];
  // A leading U+FEFF is note text, not a byte-order mark: keep it, or every offset shifts.
  const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(textBytes);

  const items: ChecklistItem[] = [];
  const seen = new Set<number>();
  let pos = 0;
  for (const run of note.filter((f) => f.field === 5)) {
    const fields = run.bytes ? decodeMessage(run.bytes) : [];
    const length = first(fields, 1)?.varint ?? 0;
    const style = child(fields, 2);
    if (style && first(style, 1)?.varint === CHECKLIST_STYLE && pos < text.length) {
      const lineStart = lineStartOfRun(text, pos, length);
      if (!seen.has(lineStart)) {
        seen.add(lineStart);
        const lineEnd = text.indexOf("\n", lineStart);
        const done = first(child(style, 5) ?? [], 2)?.varint === 1;
        items.push({ text: text.slice(lineStart, lineEnd === -1 ? undefined : lineEnd), done });
      }
    }
    pos += length;
  }
  return items;
}

/** `parseChecklist` over the blob as the database stores it: gzip, or zlib on some notes. */
export function parseChecklistBlob(blob: Uint8Array): ChecklistItem[] {
  return parseChecklist(unzipSync(blob));
}

/**
 * Marks the checklist lines of a Markdown body: "- milk" becomes "- [x] milk".
 * Items are matched to bullet lines by text, in order; an item with no
 * matching line is skipped, and other lines are left alone.
 */
export function annotateMarkdown(markdown: string, items: ChecklistItem[]): string {
  let next = 0;
  return markdown
    .split("\n")
    .map((line) => {
      const bullet = /^(\s*)- (.*)$/.exec(line);
      if (!bullet || next >= items.length) return line;
      const text = bullet[2].trim();
      const at = items.findIndex((item, i) => i >= next && item.text.trim() === text);
      if (at === -1) return line;
      next = at + 1;
      return `${bullet[1]}- [${items[at].done ? "x" : " "}] ${bullet[2]}`;
    })
    .join("\n");
}
