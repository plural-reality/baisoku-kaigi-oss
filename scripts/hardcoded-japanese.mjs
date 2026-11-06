#!/usr/bin/env node
// Hardcoded Japanese check: every Japanese string in source must come from messages/*.json,
// so that switching the screen language to English leaves nothing behind.
// Run by `npm run lint` after biome.
//
//   node scripts/hardcoded-japanese.mjs            check app/ and agents/
//   node scripts/hardcoded-japanese.mjs a.tsx b.ts check these files
//
// It parses each file with the TypeScript compiler and looks only at text that can reach a
// screen: string literals, template literals and JSX text. Comments, types, import paths and
// console.* arguments are never reported.
//
// Japanese is allowed where it is the canonical content, not a UI label:
//   - files listed in ALLOWED_FILES (AI prompts written in Japanese, the Japanese legal text, …)
//   - a line carrying `i18n-allow: <reason>` in a comment, or the line right after one; a mark
//     right above a declaration or statement covers all of it
// Anything else is reported with its location; move the text to messages/ja.json and
// messages/en.json and read it with useTranslations / getTranslations.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// Kana blocks rather than Script=Hiragana/Katakana: ・ and ー are Script=Common
// but read as Japanese.
export const JAPANESE =
  /[\u3000-\u30ff\u31f0-\u31ff\uff01-\uff60\p{Script=Han}]/u;

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SOURCE_DIRS = ["app", "agents"];
const ALLOW_MARK = /i18n-allow:\s*\S/;

/** Files whose Japanese is canonical content. Each needs a reason. */
export const ALLOWED_FILES = [
  {
    path: "app/embed/demo/fixtures.ts",
    reason:
      "made-up session content of the marketing-site demo, in both languages",
  },
  {
    path: "app/lib/llm.ts",
    reason: "AI prompts (Japanese is canonical, ADR 2026-10-16)",
  },
  {
    path: "agents/llm.ts",
    reason: "AI prompts of the Ptolemy agent",
  },
  {
    path: "app/lib/server/session-reports.ts",
    reason:
      "report prompt and the data written into it (failures are stored as codes)",
  },
  {
    path: "app/lib/server/report-stance.ts",
    reason: "stance prompt",
  },
  {
    path: "app/lib/untrusted-text.ts",
    reason: "security rule prepended to prompts",
  },
  {
    path: "app/lib/report-template-prompts.ts",
    reason: "report template requests sent to the AI",
  },
  {
    path: "app/api/sessions/[sessionId]/statements/[statementId]/suggestions/route.ts",
    reason: "suggestion prompt",
  },
  {
    path: "app/api/sessions/extract-text/route.ts",
    reason: "summary prompt (UI errors use the catalog)",
  },
  {
    path: "app/api/sessions/form-suggestions/route.ts",
    reason: "form review prompt (UI errors use the catalog)",
  },
  {
    path: "app/terms/page.tsx",
    reason:
      "legal text: Japanese is authoritative (the page frame is in the catalog)",
  },
  {
    path: "app/privacy-policy/page.tsx",
    reason:
      "legal text: Japanese is authoritative (the page frame is in the catalog)",
  },
  {
    path: "app/lib/legal.ts",
    reason: "legal text: Japanese is authoritative",
  },
];

const isTest = (path) =>
  /(^|\/)(__tests__|test|e2e)\//.test(path) ||
  /\.(test|spec)\.tsx?$/.test(path);

const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory()
      ? name === "node_modules"
        ? []
        : walk(path)
      : [path];
  });

const isConsoleCall = (node) =>
  ts.isCallExpression(node) &&
  ts.isPropertyAccessExpression(node.expression) &&
  ts.isIdentifier(node.expression.expression) &&
  node.expression.expression.text === "console";

const propertyName = (node) =>
  node.name && (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name))
    ? node.name.text
    : undefined;

// `{ ja: "…", en: "…" }`: the Japanese half of a pair that has its English half next to it.
const isJapaneseHalfOfPair = (node) =>
  ts.isPropertyAssignment(node) &&
  propertyName(node) === "ja" &&
  ts.isObjectLiteralExpression(node.parent) &&
  node.parent.properties.some((sibling) => propertyName(sibling) === "en");

// `tr("…", "…")` / `zodError("…", "…")`: the Japanese argument of a {ja, en} pair.
const PAIR_FUNCTIONS = new Set(["tr", "zodError"]);
const isPairCall = (node) =>
  ts.isCallExpression(node) &&
  ts.isIdentifier(node.expression) &&
  PAIR_FUNCTIONS.has(node.expression.text) &&
  node.arguments.length >= 2;

// Text in these positions never reaches a screen, or already has its English counterpart.
const isSilent = (node) => {
  for (
    let child = node, current = node.parent;
    current;
    child = current, current = current.parent
  ) {
    if (ts.isImportDeclaration(current) || ts.isExportDeclaration(current))
      return true;
    if (ts.isLiteralTypeNode(current) || ts.isTypeNode(current)) return true;
    if (isConsoleCall(current)) return true;
    if (isJapaneseHalfOfPair(current)) return true;
    if (isPairCall(current) && current.arguments[0] === child) return true;
  }
  return false;
};

const literalText = (node) => {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    return node.text;
  if (
    ts.isTemplateHead(node) ||
    ts.isTemplateMiddle(node) ||
    ts.isTemplateTail(node)
  )
    return node.text;
  if (ts.isJsxText(node)) return node.text;
  return undefined;
};

// `date.toLocaleDateString("ja-JP")`, `new Intl.NumberFormat("ja")`: a format fixed to Japanese
// prints 2026年10月22日 on an English screen. Pass the viewer's locale instead.
const LOCALE_METHODS = new Set([
  "toLocaleDateString",
  "toLocaleTimeString",
  "toLocaleString",
]);
const isFixedJapaneseFormat = (node) => {
  if (!(ts.isStringLiteral(node) && /^ja(-JP)?$/.test(node.text))) return false;
  const call = node.parent;
  if (!call || call.arguments?.[0] !== node) return false;
  if (
    ts.isCallExpression(call) &&
    ts.isPropertyAccessExpression(call.expression)
  ) {
    return LOCALE_METHODS.has(call.expression.name.text);
  }
  return (
    ts.isNewExpression(call) &&
    ts.isPropertyAccessExpression(call.expression) &&
    ts.isIdentifier(call.expression.expression) &&
    call.expression.expression.text === "Intl"
  );
};

/** @returns {Array<{ line: number; text: string }>} */
export const findHardcodedJapanese = (source, fileName = "file.tsx") => {
  const kind = fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const file = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    kind,
  );
  const lines = source.split("\n");
  const allowed = (line) =>
    ALLOW_MARK.test(lines[line] ?? "") ||
    ALLOW_MARK.test(lines[line - 1] ?? "");
  const found = [];
  const visit = (node) => {
    const text = literalText(node);
    if (
      text !== undefined &&
      ((JAPANESE.test(text) && !isSilent(node)) || isFixedJapaneseFormat(node))
    ) {
      const lineOf = (position) =>
        file.getLineAndCharacterOfPosition(position).line;
      const line = lineOf(node.getStart(file));
      const span = Array.from(
        { length: lineOf(node.getEnd()) - line + 1 },
        (_, i) => line + i,
      );
      // A mark above a declaration or statement covers everything inside it.
      const enclosing = [];
      for (
        let current = node.parent;
        current && !ts.isSourceFile(current);
        current = current.parent
      ) {
        enclosing.push(lineOf(current.getStart(file)));
      }
      if (![...span, ...enclosing].some(allowed))
        found.push({
          line: line + 1,
          text: text.trim().replace(/\s+/g, " ").slice(0, 80),
        });
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
};

const isMain =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isMain) {
  const args = process.argv.slice(2);
  const files = (
    args.length > 0
      ? args.map((path) => resolve(path))
      : SOURCE_DIRS.flatMap((dir) => walk(join(ROOT, dir)))
  )
    .filter((path) => /\.tsx?$/.test(path) && !path.endsWith(".d.ts"))
    .map((path) => relative(ROOT, path))
    .filter((path) => !isTest(path))
    .filter((path) => !ALLOWED_FILES.some((entry) => entry.path === path));
  // A listed file that is gone would silently widen the list when the path is reused.
  const stale =
    args.length > 0
      ? []
      : ALLOWED_FILES.filter((entry) => !existsSync(join(ROOT, entry.path)));
  for (const { path } of stale)
    console.error(`${path}  is in ALLOWED_FILES but does not exist`);
  const problems = files.flatMap((path) =>
    findHardcodedJapanese(readFileSync(join(ROOT, path), "utf8"), path).map(
      (hit) => ({ path, ...hit }),
    ),
  );
  for (const { path, line, text } of problems)
    console.error(`${path}:${line}  ${text}`);
  if (problems.length > 0 || stale.length > 0) {
    console.error(
      `\n${problems.length} hardcoded Japanese string(s). Move them to messages/ja.json + messages/en.json, ` +
        "or mark canonical Japanese content with an `i18n-allow: <reason>` comment.",
    );
    process.exit(1);
  }
}
