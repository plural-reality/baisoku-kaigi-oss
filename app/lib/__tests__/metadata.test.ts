import { describe, expect, it } from "vitest";
import {
  buildMetadata,
  DEFAULT_DESCRIPTION,
  DEFAULT_TITLE,
  pageTitle,
  SITE_NAME,
  truncateForMeta,
} from "../metadata";

describe("truncateForMeta", () => {
  it("returns the string unchanged when shorter than maxLength", () => {
    expect(truncateForMeta("short")).toBe("short");
  });

  it("truncates and adds ellipsis when exceeding maxLength", () => {
    const long = "a".repeat(200);
    const result = truncateForMeta(long, 120);
    expect(result.length).toBe(121); // 120 chars + ellipsis character
    expect(result.endsWith("…")).toBe(true);
  });

  it("respects custom maxLength", () => {
    const result = truncateForMeta("hello world", 5);
    expect(result).toBe("hello…");
  });

  it("returns exact string when length equals maxLength", () => {
    const str = "a".repeat(120);
    expect(truncateForMeta(str, 120)).toBe(str);
  });
});

describe("title の型（title_format）", () => {
  it("ページは `ページ名 | 倍速会議`（半角の | の前後に半角スペース）", () => {
    expect(pageTitle("利用規約")).toBe("利用規約 | 倍速会議");
    expect(pageTitle("ログイン")).toBe("ログイン | 倍速会議");
  });

  it("製品トップだけ `製品名 | 一文`", () => {
    expect(DEFAULT_TITLE).toBe(
      "倍速会議 | チームの認識を可視化し、合意形成を促進する",
    );
  });

  it("全角の ｜ や ` - ` の区切り、社名は title に入れない", () => {
    for (const title of [DEFAULT_TITLE, pageTitle("プライバシーポリシー")]) {
      expect(title).not.toContain("｜");
      expect(title).not.toContain(" - ");
      expect(title).not.toContain("多元現実");
    }
  });
});

describe("buildMetadata", () => {
  it("returns default title when no title is provided", () => {
    const meta = buildMetadata({});
    expect(meta.title).toBe(DEFAULT_TITLE);
    expect(meta.title).toContain(SITE_NAME);
  });

  it("og:site_name は製品名で、twitter:card は summary_large_image", () => {
    const meta = buildMetadata({});
    const og = meta.openGraph as Record<string, unknown>;
    const tw = meta.twitter as Record<string, unknown>;
    expect(og.siteName).toBe("倍速会議");
    expect(tw.card).toBe("summary_large_image");
  });

  it("uses the provided title", () => {
    const meta = buildMetadata({ title: "Custom Title" });
    expect(meta.title).toBe("Custom Title");
  });

  it("uses the default description when none provided", () => {
    const meta = buildMetadata({});
    expect(meta.description).toBe(DEFAULT_DESCRIPTION);
  });

  it("includes openGraph metadata", () => {
    const meta = buildMetadata({ title: "Test", description: "Test desc" });
    expect(meta.openGraph).toBeDefined();
    const og = meta.openGraph as Record<string, unknown>;
    expect(og.title).toBe("Test");
    expect(og.description).toBe("Test desc");
  });

  it("includes twitter metadata", () => {
    const meta = buildMetadata({ title: "Test" });
    expect(meta.twitter).toBeDefined();
    const tw = meta.twitter as Record<string, unknown>;
    expect(tw.title).toBe("Test");
  });

  it("passes url to openGraph", () => {
    const meta = buildMetadata({ url: "/sessions/1" });
    const og = meta.openGraph as Record<string, unknown>;
    expect(og.url).toBe("/sessions/1");
  });
});
