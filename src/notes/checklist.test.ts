import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deflateSync, gzipSync } from "node:zlib";
import { annotateMarkdown, decodeMessage, parseChecklist, parseChecklistBlob } from "./checklist.js";

// A minimal protobuf writer, enough to build note content as Notes stores it.
function varint(n: number): number[] {
  const out: number[] = [];
  while (n > 127) {
    out.push((n % 128) | 0x80);
    n = Math.floor(n / 128);
  }
  out.push(n);
  return out;
}
const vfield = (field: number, value: number) => [...varint(field * 8), ...varint(value)];
const bfield = (field: number, bytes: number[] | Uint8Array) => [...varint(field * 8 + 2), ...varint(bytes.length), ...bytes];

type Run = { length: number; checklist?: boolean; done?: boolean | "missing" };

/** Note content: document → 2 → 3 → { 2: text, 5: runs }. Run lengths are UTF-16 units. */
function content(text: string, runs: Run[], extra: number[] = []): Uint8Array {
  const runBytes = runs.map((r) => {
    const style = r.checklist
      ? [...vfield(1, 103), ...bfield(5, [...bfield(1, [1, 2, 3]), ...(r.done === "missing" ? [] : vfield(2, r.done ? 1 : 0))])]
      : vfield(1, 0);
    return bfield(5, [...vfield(1, r.length), ...bfield(2, style)]);
  });
  const note = [...bfield(2, [...new TextEncoder().encode(text)]), ...runBytes.flat(), ...extra];
  return new Uint8Array(bfield(2, bfield(3, note)));
}

describe("parseChecklist", () => {
  it("reads items and their ticked state, in order, ignoring other lines", () => {
    const text = "Groceries\nmilk\neggs\nend";
    const items = parseChecklist(content(text, [
      { length: 10 },
      { length: 5, checklist: true, done: true },
      { length: 5, checklist: true, done: false },
      { length: 3 },
    ]));
    assert.deepEqual(items, [{ text: "milk", done: true }, { text: "eggs", done: false }]);
  });

  it("a note without checklists gives [], not null", () => {
    assert.deepEqual(parseChecklist(content("Just text", [{ length: 9 }])), []);
  });

  it("an empty note gives []", () => {
    assert.deepEqual(parseChecklist(content("", [])), []);
  });

  it("a run that starts on the previous newline ('\\nItem') styles its own line, not the one before", () => {
    const text = "Title\nItem";
    const items = parseChecklist(content(text, [{ length: 5 }, { length: 5, checklist: true, done: true }]));
    assert.deepEqual(items, [{ text: "Item", done: true }]);
  });

  it("a line split into several runs (bold in the middle) is one item", () => {
    const text = "a bold item\nnext\n";
    const items = parseChecklist(content(text, [
      { length: 2, checklist: true, done: true },
      { length: 4, checklist: true, done: true },
      { length: 6, checklist: true, done: true },
      { length: 5, checklist: true, done: false },
    ]));
    assert.deepEqual(items, [{ text: "a bold item", done: true }, { text: "next", done: false }]);
  });

  it("a run of newlines only belongs to the line it ends", () => {
    const text = "one\ntwo\n";
    const items = parseChecklist(content(text, [
      { length: 3, checklist: true, done: false },
      { length: 1, checklist: true, done: false },
      { length: 4, checklist: true, done: true },
    ]));
    assert.deepEqual(items, [{ text: "one", done: false }, { text: "two", done: true }]);
  });

  it("offsets count UTF-16 units, so emoji and accents before an item do not shift it", () => {
    const text = "🛒 Courses é\ncafé ☕\nthé";
    const items = parseChecklist(content(text, [
      { length: "🛒 Courses é\n".length },
      { length: "café ☕\n".length, checklist: true, done: true },
      { length: "thé".length, checklist: true, done: false },
    ]));
    assert.deepEqual(items, [{ text: "café ☕", done: true }, { text: "thé", done: false }]);
  });

  it("a leading U+FEFF is kept as text, so offsets after it stay right", () => {
    // Dropping the U+FEFF would shift the checklist run onto the next line, "c".
    const text = "\uFEFFa\nb\nc";
    const items = parseChecklist(content(text, [{ length: 3 }, { length: 2, checklist: true, done: true }, { length: 1 }]));
    assert.deepEqual(items, [{ text: "b", done: true }]);
  });

  it("empty checklist rows are real items", () => {
    const items = parseChecklist(content("a\n\nb", [
      { length: 2, checklist: true, done: false },
      { length: 1, checklist: true, done: true },
      { length: 1, checklist: true, done: false },
    ]));
    assert.deepEqual(items.map((i) => i.text), ["a", "", "b"]);
  });

  it("a checklist without a done field is not ticked", () => {
    assert.deepEqual(parseChecklist(content("x", [{ length: 1, checklist: true, done: "missing" }])), [{ text: "x", done: false }]);
  });

  it("runs that claim more text than there is do not crash or invent items", () => {
    const items = parseChecklist(content("ab", [{ length: 1000, checklist: true, done: true }, { length: 5, checklist: true }]));
    assert.deepEqual(items, [{ text: "ab", done: true }]);
  });

  it("fixed-width and unknown fields around the runs are skipped", () => {
    const fixed = [...varint(9 * 8 + 5), 1, 2, 3, 4, ...varint(10 * 8 + 1), 1, 2, 3, 4, 5, 6, 7, 8];
    const items = parseChecklist(content("x", [{ length: 1, checklist: true, done: true }], fixed));
    assert.deepEqual(items, [{ text: "x", done: true }]);
  });

  it("content without a note throws instead of answering []", () => {
    assert.throws(() => parseChecklist(new Uint8Array(vfield(1, 5))));
  });

  it("truncated or garbage content throws", () => {
    const good = content("x", [{ length: 1, checklist: true, done: true }]);
    assert.throws(() => parseChecklist(good.subarray(0, good.length - 3)));
    assert.throws(() => decodeMessage(new Uint8Array([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff])));
    assert.throws(() => decodeMessage(new Uint8Array([0x0b]))); // wire type 3
    assert.throws(() => decodeMessage(new Uint8Array([0x00, 0x01]))); // field 0
  });
});

describe("parseChecklistBlob", () => {
  const raw = content("milk", [{ length: 4, checklist: true, done: true }]);

  it("reads gzip and zlib blobs alike (Notes stores both)", () => {
    assert.deepEqual(parseChecklistBlob(gzipSync(raw)), [{ text: "milk", done: true }]);
    assert.deepEqual(parseChecklistBlob(deflateSync(raw)), [{ text: "milk", done: true }]);
  });

  it("an uncompressed or encrypted blob throws", () => {
    assert.throws(() => parseChecklistBlob(raw));
    assert.throws(() => parseChecklistBlob(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])));
  });
});

describe("annotateMarkdown", () => {
  it("marks matching bullet lines with their state", () => {
    const md = "# Groceries\n\n- milk\n- eggs\n\nnotes";
    assert.equal(
      annotateMarkdown(md, [{ text: "milk", done: true }, { text: "eggs", done: false }]),
      "# Groceries\n\n- [x] milk\n- [ ] eggs\n\nnotes",
    );
  });

  it("duplicate texts are matched in order", () => {
    const md = "- buy\n- buy";
    assert.equal(annotateMarkdown(md, [{ text: "buy", done: false }, { text: "buy", done: true }]), "- [ ] buy\n- [x] buy");
  });

  it("a plain bullet list with the same text before the checklist is not touched by a later item", () => {
    const md = "- other\n- milk";
    assert.equal(annotateMarkdown(md, [{ text: "milk", done: true }]), "- other\n- [x] milk");
  });

  it("an item missing from the Markdown is skipped without shifting the others", () => {
    const md = "- a\n- c";
    assert.equal(
      annotateMarkdown(md, [{ text: "a", done: true }, { text: "b", done: true }, { text: "c", done: false }]),
      "- [x] a\n- [ ] c",
    );
  });

  it("non-bullet lines with an item's text are left alone", () => {
    assert.equal(annotateMarkdown("milk\n- milk", [{ text: "milk", done: true }]), "milk\n- [x] milk");
  });

  it("no items leaves the Markdown as is", () => {
    assert.equal(annotateMarkdown("- a", []), "- a");
  });
});
