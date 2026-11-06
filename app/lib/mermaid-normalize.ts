// Mermaid ソースを描画前に正規化する純粋関数群。
//
// レポートの ```mermaid は LLM 生成なので、文法上は引用符が必要な記号を素で書いてくる。
// mermaid 11 の quadrantChart は `quadrant-N` と `x-axis` / `y-axis` のラベルを
// 引用符なしだと英数字と一部記号しか受け付けず、`(` `)` `:` が入ると
// "Lexical error ... Unrecognized text" で図全体が描けなくなる
// (例: `quadrant-1 Unifying Wins (Action First)`)。
// 二重引用符で囲めば同じ文字列が通るので、引用符なしのラベルだけ囲み直す。
// title と点ラベル (`"…": [x, y]`) はそのままで通るので触らない。

const QUADRANT_CHART_RE = /^\s*quadrantChart\s*$/m;
const QUADRANT_LABEL_RE = /^(\s*quadrant-[1-4])\s+(.+?)\s*$/;
const AXIS_RE = /^(\s*[xy]-axis)\s+(.+?)\s*$/;
const isQuoted = (text: string): boolean => /^".*"$/.test(text);

// 引用符つき文字列の中に `"` は書けない(エスケープ構文がない)ので ' に置き換える。
const quote = (text: string): string =>
  isQuoted(text) ? text : `"${text.replace(/"/g, "'")}"`;

// `-->` で左右に分ける。引用符の中の `-->` は区切りとみなさない。
const splitAxis = (rest: string): readonly [string, string | null] => {
  let inQuote = false;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '"') inQuote = !inQuote;
    else if (!inQuote && rest.startsWith("-->", i))
      return [rest.slice(0, i).trim(), rest.slice(i + 3).trim()];
  }
  return [rest, null];
};

const quoteAxis = (rest: string): string => {
  const [left, right] = splitAxis(rest);
  return right === null
    ? quote(left)
    : right === ""
      ? `${quote(left)} -->`
      : `${quote(left)} --> ${quote(right)}`;
};

const normalizeQuadrantLine = (line: string): string => {
  const quadrant = line.match(QUADRANT_LABEL_RE);
  if (quadrant) return `${quadrant[1]} ${quote(quadrant[2])}`;
  const axis = line.match(AXIS_RE);
  if (axis) return `${axis[1]} ${quoteAxis(axis[2])}`;
  return line;
};

export const normalizeMermaid = (chart: string): string =>
  QUADRANT_CHART_RE.test(chart)
    ? chart.split("\n").map(normalizeQuadrantLine).join("\n")
    : chart;
