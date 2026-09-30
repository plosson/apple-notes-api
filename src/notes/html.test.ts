import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { htmlToMarkdown, htmlToPlaintext, plaintextToHtml } from "./html.js";

describe("htmlToPlaintext", () => {
  it("strips tags and decodes entities", () => {
    assert.equal(htmlToPlaintext("<div>Hello&nbsp;<b>world</b></div>"), "Hello world");
  });

  it("preserves line breaks from br/p", () => {
    assert.equal(htmlToPlaintext("a<br>b</p>c"), "a\nb\nc");
  });
});

describe("htmlToMarkdown", () => {
  it("converts bold and links", () => {
    const md = htmlToMarkdown(
      '<div><b>Hi</b> <a href="https://example.com">ex</a></div>',
    );
    assert.match(md, /\*\*Hi\*\*/);
    assert.match(md, /\[ex\]\(https:\/\/example\.com\)/);
  });
});

describe("plaintextToHtml", () => {
  it("escapes and wraps paragraphs", () => {
    const html = plaintextToHtml("a < b\n\nc");
    assert.match(html, /a &lt; b/);
    assert.match(html, /<div>/);
  });
});
