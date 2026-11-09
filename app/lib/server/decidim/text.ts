// Decidim API text can carry unescaped HTML, in any field and on any instance.
// Everything read from it passes through toPlainText before it reaches a prompt
// or the database, so what remains is text with no live markup.

const MAX_DECODE_PASSES = 5;
// Applied before any regex. A single field is never legitimately this long, and
// a hostile instance can otherwise send 5 MB of it.
const MAX_RAW_CHARS = 100_000;

// Tag patterns exclude `<` inside a tag, so a run of `<a <a <a ...` fails at the
// next `<` instead of rescanning to the end of the text for every one of them.
const RAW_CONTENT_RE =
  /<(script|style|iframe|object|embed|svg|math|template|noscript|noembed|noframes|xmp)\b[^<>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi;
const COMMENT_RE = /<!--[\s\S]*?(?:-->|$)/g;
const BLOCK_TAG_RE =
  /<\/?(?:p|div|br|li|ul|ol|h[1-6]|tr|blockquote|pre|hr|section|article)\b[^<>]*>/gi;
const TAG_RE = /<\/?[A-Za-z!?][^<>]*>/g;
// `<` that still opens something after stripping (an unclosed tag, or `a<b` in a
// plain comment). A space keeps the words and stops it parsing as a tag.
const OPENING_RE = /<(?=[A-Za-z/!?])/g;
// Controls and invisible format characters (zero-width, bidi overrides), which
// can hide instructions from the host who reviews the imported text, and lone
// surrogates. Removed before tags are looked for: removing them afterwards would
// turn `<\u200Bscript>` back into a tag.
const INVISIBLE_RE = /(?![\n\t])[\p{Cc}\p{Cf}\p{Cs}]/gu;

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

const decodeCodePoint = (code: number): string =>
  code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";

const decodeEntities = (text: string): string =>
  text
    .replace(
      /&(amp|lt|gt|quot|apos|nbsp);/g,
      (_, name: string) => NAMED_ENTITIES[name],
    )
    .replace(/&#(\d+);/g, (_, digits: string) =>
      decodeCodePoint(Number(digits)),
    )
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) =>
      decodeCodePoint(Number.parseInt(hex, 16)),
    );

const stripMarkup = (text: string): string =>
  text
    .replace(COMMENT_RE, "")
    .replace(RAW_CONTENT_RE, "")
    .replace(BLOCK_TAG_RE, "\n")
    .replace(TAG_RE, "");

// Encoded markup (`&lt;script&gt;`) only appears after decoding, so strip and
// decode until nothing changes. A bounded input may nest deeper than the pass
// limit; the final OPENING_RE leaves no tag behind in that case either.
const stripAndDecode = (text: string, passesLeft: number): string => {
  const next = decodeEntities(stripMarkup(text.replace(INVISIBLE_RE, "")));
  return next === text || passesLeft <= 1
    ? next
    : stripAndDecode(next, passesLeft - 1);
};

export const toPlainText = (raw: string): string =>
  stripAndDecode(raw.slice(0, MAX_RAW_CHARS), MAX_DECODE_PASSES)
    .replace(INVISIBLE_RE, "")
    .replace(OPENING_RE, "< ")
    .replace(/[ \t　]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

export const truncate = (text: string, maxChars: number): string =>
  text.length <= maxChars
    ? text
    : `${text.slice(0, maxChars).replace(/[\uD800-\uDBFF]$/, "")}…`;
