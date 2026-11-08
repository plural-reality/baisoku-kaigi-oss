import { expect, test } from "@playwright/test";

test("homepage loads successfully", async ({ page }) => {
  await page.goto("/");

  // Stays on the home page (any host/port: CI serves on 13000)
  await expect(page).toHaveURL(/\/$/);

  // Verify the "セッションを作成" link is displayed
  const createLink = page
    .getByRole("link", { name: /セッションを作成/ })
    .first();
  await expect(createLink).toBeVisible({ timeout: 15_000 });
});
