import { expect, test } from "@playwright/test";

test("homepage loads successfully", async ({ page }) => {
  await page.goto("/");

  // Wait for the page to be visible
  await expect(page).toHaveURL(/.*localhost:3000/);

  // Verify the "セッションを作成" link is displayed
  const createLink = page
    .getByRole("link", { name: /セッションを作成/ })
    .first();
  await expect(createLink).toBeVisible({ timeout: 15_000 });
});
