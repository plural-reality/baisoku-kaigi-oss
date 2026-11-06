import { describe, expect, it } from "vitest";
import {
  LEGAL_OPERATOR_NAME,
  LEGAL_OPERATOR_NAME_EN,
  LEGAL_OPERATOR_URL,
  LEGAL_TOKUSHOHO_URL,
  legalCopyright,
} from "../legal";

describe("会社表記", () => {
  it("和文はスペースなしの 合同会社多元現実、英文は Plural Reality LLC", () => {
    expect(LEGAL_OPERATOR_NAME).toBe("合同会社多元現実");
    expect(LEGAL_OPERATOR_NAME_EN).toBe("Plural Reality LLC");
  });

  it("会社サイトと特商法の URL は www.plural-reality.com", () => {
    expect(LEGAL_OPERATOR_URL).toBe("https://www.plural-reality.com/");
    expect(LEGAL_TOKUSHOHO_URL).toBe(
      "https://www.plural-reality.com/tokushoho",
    );
  });

  it("© の年は引数、省略時は実行時の西暦", () => {
    expect(legalCopyright(2026)).toBe("© 2026 Plural Reality LLC");
    expect(legalCopyright()).toBe(
      `© ${new Date().getFullYear()} Plural Reality LLC`,
    );
  });
});
