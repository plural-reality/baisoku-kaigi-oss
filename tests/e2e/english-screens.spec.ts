import { expect, type Page, test } from "@playwright/test";

// An English screen carries no Japanese of its own. Japanese is allowed only
// where it is declared with lang="ja": the switcher's own 日本語 and the legal
// text, whose Japanese is authoritative. The static check
// (scripts/hardcoded-japanese.mjs) catches literals in the source; this one
// catches what only shows once the page is rendered.

// Kana blocks rather than Script=Katakana, so that ・ and ー count too.
const JAPANESE = /[\u3000-\u30ff\u31f0-\u31ff\p{Script=Han}]/u;

const japaneseOn = (page: Page): Promise<string[]> =>
  page.evaluate((source) => {
    const pattern = new RegExp(source, "u");
    const found = new Set<string>();
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
    );
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const text = node.textContent?.trim() ?? "";
      const parent = node.parentElement;
      if (
        !text ||
        !pattern.test(text) ||
        !parent ||
        parent.closest("script, style, [lang='ja']")
      )
        continue;
      found.add(text.slice(0, 80));
    }
    for (const element of document.querySelectorAll(
      "[aria-label], [placeholder], [title], [alt]",
    )) {
      for (const name of ["aria-label", "placeholder", "title", "alt"]) {
        const value = element.getAttribute(name);
        if (value && pattern.test(value) && !element.closest("[lang='ja']"))
          found.add(`@${name}: ${value.slice(0, 80)}`);
      }
    }
    const head = [
      document.title,
      ...[
        ...document.querySelectorAll(
          "meta[name='description'], meta[property^='og:']",
        ),
      ].map((meta) => meta.getAttribute("content") ?? ""),
    ];
    for (const value of head) {
      if (pattern.test(value)) found.add(`@head: ${value.slice(0, 80)}`);
    }
    return [...found];
  }, JAPANESE.source);

test.describe("English screens", () => {
  test.use({ locale: "en-GB" });
  // The dev server compiles each page on its first visit.
  test.describe.configure({ timeout: 120_000 });

  for (const path of ["/terms", "/privacy-policy"]) {
    test(`${path} keeps its Japanese text but frames it in English`, async ({
      page,
    }) => {
      await page.goto(path);
      await expect(page.locator("html")).toHaveAttribute("lang", "en");
      await expect(
        page.getByText("The Japanese text is the authoritative version", {
          exact: false,
        }),
      ).toBeVisible();
      expect(await japaneseOn(page)).toEqual([]);
    });
  }

  test("the 404 page is English", async ({ page }) => {
    await page.goto("/this-page-does-not-exist");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    expect(await japaneseOn(page)).toEqual([]);
  });
});
