import { describe, expect, it } from "vitest";
import { toPlainText, truncate } from "../text";

describe("toPlainText", () => {
  it("turns Decidim's HTML into text with paragraph breaks", () => {
    expect(
      toPlainText(
        '<p>駅近に施設を。<br>人が集まる。</p><p><a href="https://x.example" rel="noopener">リンク&nbsp;(外部)</a></p>',
      ),
    ).toBe("駅近に施設を。\n人が集まる。\n\nリンク (外部)");
  });

  it.each([
    ["script", "a<script>alert(1)</script>b", "ab"],
    ["uppercase script", "a<SCRIPT src=x>alert(1)</SCRIPT >b", "ab"],
    ["unterminated script", "a<script>alert(1)", "a"],
    ["style", "a<style>x{}</style>b", "ab"],
    ["iframe", 'a<iframe src="https://x"></iframe>b', "ab"],
    ["svg", "a<svg onload=alert(1)><circle/></svg>b", "ab"],
    ["comment", "a<!-- <img src=x> -->b", "ab"],
    ["event handler", "<img src=x onerror=alert(1)>a", "a"],
    ["encoded script", "&lt;script&gt;alert(1)&lt;/script&gt;a", "a"],
    ["double-encoded tag", "&amp;lt;img src=x&amp;gt;a", "a"],
    ["numeric entity", "&#60;img src=x&#62;a", "a"],
    ["hex entity", "&#x3c;img src=x&#x3e;a", "a"],
    ["a tag rebuilt by stripping", "<scr<script></script>ipt>a", "a"],
  ])("removes %s", (_, input, expected) => {
    expect(toPlainText(input)).toBe(expected);
  });

  it.each([
    ["zero-width space", "<\u200Bscript>alert(1)<\u200B/script>a"],
    ["NUL", "<\u0000img src=x onerror=alert(1)>a"],
    ["BOM", "<\uFEFFsvg onload=alert(1)>a"],
    ["encoded zero-width", "&lt;&#8203;img src=x&gt;a"],
    ["doubly encoded", "&amp;lt;&amp;#8203;img src=x&amp;gt;a"],
  ])("does not rebuild a tag from one split by a %s", (_, input) => {
    expect(toPlainText(input)).not.toContain("<");
  });

  it.each([
    "<a ",
    "<p ",
    "<script ",
    "<script>",
    "<!-- ",
    "&lt;a ",
  ])("stays fast on a long run of %s", (unit) => {
    const start = Date.now();
    toPlainText(unit.repeat(1_000_000));
    expect(Date.now() - start).toBeLessThan(2000);
  });

  it("keeps text after an opening tag that holds no code", () => {
    expect(toPlainText("<title> タグを修正する案")).toBe("タグを修正する案");
  });

  it("removes lone surrogates", () => {
    expect(toPlainText("a&#xD800;b")).toBe("ab");
  });

  it("leaves nothing that parses as a tag when markup is unclosed", () => {
    expect(toPlainText("<img src=x onerror=alert(1)")).toBe(
      "＜img src=x onerror=alert(1)",
    );
  });

  it("keeps ordinary comparisons in plain comments", () => {
    expect(toPlainText("a < b かつ x<y の場合")).toBe(
      "a ＜ b かつ x＜y の場合",
    );
  });

  it("removes controls and invisible characters but keeps line breaks", () => {
    expect(toPlainText("a\u0000b​c‮d\n\ne")).toBe("abcd\n\ne");
  });

  it("ignores invalid numeric references", () => {
    expect(toPlainText("a&#0;b&#x110000;c&#99999999;d")).toBe("abcd");
  });
});

describe("truncate", () => {
  it("cuts only what is over the limit", () => {
    expect(truncate("abc", 3)).toBe("abc");
    expect(truncate("abcd", 3)).toBe("abc…");
    expect(truncate("a😀b", 2)).toBe("a…");
  });
});
