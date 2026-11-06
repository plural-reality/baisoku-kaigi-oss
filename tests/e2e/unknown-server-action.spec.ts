import { expect, test } from "@playwright/test";

// Regression guard for Sentry CARTOGRAPHER-29 (2026-10-19): scanners POST with
// `Next-Action` and a urlencoded body. Next answers with app/not-found.tsx
// rendered WITHOUT the root layout, and AppHeader's useTranslations crashed for
// lack of NextIntlClientProvider, turning the 404 into a 500.
test.describe("Unknown Server Action probe", () => {
  test("answers a urlencoded Next-Action POST with the 404 page, not a 500", async ({
    request,
  }) => {
    const response = await request.post("/", {
      headers: { "Next-Action": "x" },
      form: { probe: "yes" },
    });

    expect(response.status()).toBe(404);
    expect(await response.text()).toContain("ページが見つかりません");
  });
});
