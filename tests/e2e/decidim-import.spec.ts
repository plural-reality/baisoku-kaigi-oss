import { expect, test } from "@playwright/test";

const SOURCE_URL = "https://decidim.example/processes/station";

// The import endpoint reads a real Decidim over the public internet and refuses
// local addresses, so CI cannot point it at a stub. Its reading logic is covered
// by Vitest; this covers what the host sees: the form is filled, the source
// travels with the created session and shows up on the admin page.
test.describe("Create a session from a Decidim discussion", () => {
  test("fills the form and keeps the source on the session", async ({
    page,
  }) => {
    test.setTimeout(90_000);

    await page.route("**/api/sessions/import-decidim", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          title: "駅周辺のにぎわいづくり",
          purpose: "駅周辺の将来像について、合意点と相違点を明らかにする。",
          background: `出典: ${SOURCE_URL}\n\n- 芝生広場を求める声が多い。`,
          sourceUrl: SOURCE_URL,
          truncated: true,
        }),
      }),
    );

    await page.goto("/sessions/new");

    const url = page.locator("#decidimUrl");
    await expect(url).toBeVisible({ timeout: 15_000 });
    await url.fill(SOURCE_URL);
    await page.getByRole("button", { name: "読み込む" }).click();

    await expect(page.locator("#title")).toHaveValue("駅周辺のにぎわいづくり");
    await expect(page.locator("#purpose")).toHaveValue(/合意点と相違点/);
    await expect(page.locator("#backgroundInfo")).toHaveValue(/芝生広場/);
    await expect(page.getByTestId("decidim-source")).toContainText(SOURCE_URL);

    const submit = page.getByRole("button", { name: /セッションを作成/ });
    await expect(submit).toBeVisible({ timeout: 30_000 });
    await submit.click();

    await expect(page).toHaveURL(/\/sessions\/[\w-]+\/[\w-]+/, {
      timeout: 30_000,
    });
    await expect(page.getByTestId("session-source-url")).toHaveAttribute(
      "href",
      SOURCE_URL,
      { timeout: 30_000 },
    );
  });

  test("shows why an import failed and keeps the URL", async ({ page }) => {
    await page.route("**/api/sessions/import-decidim", (route) =>
      route.fulfill({
        status: 422,
        contentType: "application/json",
        body: JSON.stringify({ error: "noContent", message: "読めません" }),
      }),
    );

    await page.goto("/sessions/new");

    const url = page.locator("#decidimUrl");
    await expect(url).toBeVisible({ timeout: 15_000 });
    await url.fill(SOURCE_URL);
    await page.getByRole("button", { name: "読み込む" }).click();

    await expect(page.getByText("読めません")).toBeVisible();
    await expect(url).toHaveValue(SOURCE_URL);
  });
});
