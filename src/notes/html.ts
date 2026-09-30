/**
 * Minimal HTML helpers for Notes.app bodies (which are typically HTML).
 * No external dependency — good enough for plaintext display and light markdown.
 */

export function htmlToPlaintext(html: string): string {
  if (!html) return "";
  let s = html;
  // Line breaks
  s = s.replace(/<\s*br\s*\/?\s*>/gi, "\n");
  s = s.replace(/<\s*\/\s*p\s*>/gi, "\n");
  s = s.replace(/<\s*\/\s*div\s*>/gi, "\n");
  s = s.replace(/<\s*\/\s*li\s*>/gi, "\n");
  s = s.replace(/<\s*\/\s*h[1-6]\s*>/gi, "\n");
  // Strip tags
  s = s.replace(/<[^>]+>/g, "");
  // Decode common entities
  s = decodeEntities(s);
  // Collapse excessive blank lines
  s = s.replace(/\n{3,}/g, "\n\n").trim();
  return s;
}

export function htmlToMarkdown(html: string): string {
  if (!html) return "";
  let s = html;

  s = s.replace(/<\s*br\s*\/?\s*>/gi, "\n");
  s = s.replace(/<\s*h1[^>]*>([\s\S]*?)<\s*\/\s*h1\s*>/gi, "# $1\n\n");
  s = s.replace(/<\s*h2[^>]*>([\s\S]*?)<\s*\/\s*h2\s*>/gi, "## $1\n\n");
  s = s.replace(/<\s*h3[^>]*>([\s\S]*?)<\s*\/\s*h3\s*>/gi, "### $1\n\n");
  s = s.replace(/<\s*h[4-6][^>]*>([\s\S]*?)<\s*\/\s*h[4-6]\s*>/gi, "#### $1\n\n");
  s = s.replace(/<\s*strong[^>]*>([\s\S]*?)<\s*\/\s*strong\s*>/gi, "**$1**");
  s = s.replace(/<\s*b[^>]*>([\s\S]*?)<\s*\/\s*b\s*>/gi, "**$1**");
  s = s.replace(/<\s*em[^>]*>([\s\S]*?)<\s*\/\s*em\s*>/gi, "*$1*");
  s = s.replace(/<\s*i[^>]*>([\s\S]*?)<\s*\/\s*i\s*>/gi, "*$1*");
  s = s.replace(/<\s*u[^>]*>([\s\S]*?)<\s*\/\s*u\s*>/gi, "$1");
  s = s.replace(
    /<\s*a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\s*\/\s*a\s*>/gi,
    "[$2]($1)",
  );
  s = s.replace(/<\s*li[^>]*>([\s\S]*?)<\s*\/\s*li\s*>/gi, "- $1\n");
  s = s.replace(/<\s*\/?\s*ul[^>]*>/gi, "\n");
  s = s.replace(/<\s*\/?\s*ol[^>]*>/gi, "\n");
  s = s.replace(/<\s*\/\s*p\s*>/gi, "\n\n");
  s = s.replace(/<\s*p[^>]*>/gi, "");
  s = s.replace(/<\s*\/\s*div\s*>/gi, "\n");
  s = s.replace(/<\s*div[^>]*>/gi, "");
  s = s.replace(/<[^>]+>/g, "");
  s = decodeEntities(s);
  s = s.replace(/\n{3,}/g, "\n\n").trim();
  return s;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) =>
      String.fromCharCode(parseInt(h, 16)),
    );
}

/** Escape text for inclusion as HTML body content in Notes. */
export function plaintextToHtml(text: string): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const paragraphs = escaped.split(/\n{2,}/);
  return paragraphs
    .map((p) => `<div>${p.replace(/\n/g, "<br>")}</div>`)
    .join("");
}
