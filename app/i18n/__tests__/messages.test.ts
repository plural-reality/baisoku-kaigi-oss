import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ja from "../../../messages/ja.json";
import { parseAcceptLanguage, resolveLocale } from "../resolve-locale";

const keyPaths = (value: unknown, prefix = ""): string[] =>
  value !== null && typeof value === "object"
    ? Object.entries(value).flatMap(([k, v]) =>
        keyPaths(v, prefix ? `${prefix}.${k}` : k),
      )
    : [prefix];

const placeholders = (text: string): string[] =>
  [...text.matchAll(/\{(\w+)/g)].map((m) => m[1]).sort();

const lookup = (catalog: unknown, path: string): string =>
  path
    .split(".")
    .reduce<unknown>(
      (node, key) => (node as Record<string, unknown>)[key],
      catalog,
    ) as string;

describe("message catalogs", () => {
  it("en has exactly the same keys as ja", () => {
    expect(keyPaths(en).sort()).toEqual(keyPaths(ja).sort());
  });

  it("every translation keeps the same ICU placeholders and tags", () => {
    const mismatches = keyPaths(ja).filter((path) => {
      const source = lookup(ja, path);
      const target = lookup(en, path);
      const tags = (s: string) => [...s.matchAll(/<(\w+)>/g)].map((m) => m[1]);
      return (
        JSON.stringify(placeholders(source)) !==
          JSON.stringify(placeholders(target)) ||
        JSON.stringify(tags(source)) !== JSON.stringify(tags(target))
      );
    });
    expect(mismatches).toEqual([]);
  });

  it("en contains no untranslated Japanese", () => {
    const japanese = /[\p{Script=Hiragana}\p{Script=Katakana}]/u;
    const leftovers = keyPaths(en).filter((path) =>
      japanese.test(lookup(en, path)),
    );
    expect(leftovers).toEqual([]);
  });
});

describe("resolveLocale", () => {
  it("prefers an explicit choice over the device language", () => {
    expect(resolveLocale({ explicit: "ja", acceptLanguage: "en-AU,en" })).toBe(
      "ja",
    );
  });

  it("follows the device language when nothing was chosen", () => {
    expect(resolveLocale({ acceptLanguage: "en-AU,en;q=0.9,ja;q=0.5" })).toBe(
      "en",
    );
    expect(resolveLocale({ acceptLanguage: "ja-JP,ja;q=0.9,en;q=0.8" })).toBe(
      "ja",
    );
  });

  it("orders by q-value, not header position", () => {
    expect(resolveLocale({ acceptLanguage: "ja;q=0.2,en;q=0.9" })).toBe("en");
  });

  it("falls back to Japanese for unsupported or malformed input", () => {
    expect(resolveLocale({ acceptLanguage: "fr-FR,de;q=0.8" })).toBe("ja");
    expect(resolveLocale({ acceptLanguage: "@@@" })).toBe("ja");
    expect(resolveLocale({ explicit: "xx", acceptLanguage: null })).toBe("ja");
  });

  it("parses Accept-Language and drops q=0 and wildcards", () => {
    expect(parseAcceptLanguage("en-US,*;q=0.5,fr;q=0")).toEqual(["en-US"]);
  });
});
