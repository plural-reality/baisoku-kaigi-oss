import { describe, expect, it } from "vitest";
import {
  ALLOWED_FILES,
  findHardcodedJapanese,
} from "../../../scripts/hardcoded-japanese.mjs";

const texts = (source: string, file = "x.tsx") =>
  findHardcodedJapanese(source, file).map((hit) => hit.text);

describe("hardcoded-japanese", () => {
  it("flags Japanese in strings, templates and JSX text, with the line it is on", () => {
    expect(
      findHardcodedJapanese('const a = 1;\nconst b = "保存しました";', "x.ts"),
    ).toEqual([{ line: 2, text: "保存しました" }]);
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the source under test is a template literal
    expect(texts("const a = `${n}件の回答`;")).toEqual(["件の回答"]);
    expect(texts("export const A = () => <p>\n  送信する\n</p>;")).toEqual([
      "送信する",
    ]);
    expect(
      texts('export const A = () => <input placeholder="名前" />;'),
    ).toEqual(["名前"]);
  });

  it("counts a lone full-width middle dot as Japanese", () => {
    expect(texts("export const A = () => <span>・</span>;")).toEqual(["・"]);
  });

  it("ignores comments, types, imports and console output", () => {
    expect(texts('// 保存する\n/* 送信 */\nconst a = "save";')).toEqual([]);
    expect(texts('type Label = "はい" | "いいえ";')).toEqual([]);
    expect(texts('console.error("保存に失敗", error);')).toEqual([]);
  });

  it("accepts the Japanese half of a {ja, en} pair, but not a lone ja", () => {
    expect(texts('const copy = { ja: "保存しました", en: "Saved" };')).toEqual(
      [],
    );
    expect(
      texts('const copy = { ja: { save: "保存" }, en: { save: "Save" } };'),
    ).toEqual([]);
    expect(texts('const copy = { ja: "保存" };')).toEqual(["保存"]);
  });

  it("accepts a line marked i18n-allow, or the line after the mark", () => {
    expect(
      texts('const prompt = "あなたは聞き手です"; // i18n-allow: AI prompt'),
    ).toEqual([]);
    expect(
      texts('// i18n-allow: AI prompt\nconst prompt = "あなたは聞き手です";'),
    ).toEqual([]);
    expect(
      texts('// i18n-allow:\nconst prompt = "あなたは聞き手です";'),
    ).toEqual(["あなたは聞き手です"]);
    expect(
      texts(
        '// i18n-allow: matched against Japanese input\nconst keywords = [\n  "背景",\n  "人数",\n];',
      ),
    ).toEqual([]);
    expect(
      texts(
        '// i18n-allow: matched against Japanese input\nconst keywords = ["背景"];\n\nconst label = "保存";',
      ),
    ).toEqual(["保存"]);
  });

  it("flags a date or number format fixed to Japanese", () => {
    expect(texts('date.toLocaleDateString("ja-JP");')).toEqual(["ja-JP"]);
    expect(texts('new Intl.NumberFormat("ja");')).toEqual(["ja"]);
    expect(
      texts('date.toLocaleDateString(locale === "en" ? "en-AU" : "ja-JP");'),
    ).toEqual([]);
  });

  it("gives every allowed file a reason", () => {
    expect(ALLOWED_FILES.filter((entry) => !entry.reason)).toEqual([]);
  });
});
