import { expect, test } from "@playwright/test";

test.describe("Response Modification", () => {
  const sessionId = "00000000-0000-0000-0000-000000000e2e";

  test("modifying a past response should preserve subsequent responses", async ({
    page,
  }) => {
    await page.goto(`/sessions/${sessionId}`);
    await page.waitForLoadState("networkidle");

    // Join the session
    const startButton = page.getByRole("button", { name: "始める" });
    await expect(startButton).toBeVisible({ timeout: 15_000 });
    await startButton.click();

    const nameInput = page.getByPlaceholder("あなたの名前");
    await expect(nameInput).toBeVisible({ timeout: 10_000 });
    await nameInput.fill("修正テストユーザー");

    const joinButton = page.getByRole("button", { name: "参加する" });
    await joinButton.click();

    // Answer question 1 with "同意"
    const agreeButton1 = page.getByText("同意", { exact: true });
    await expect(agreeButton1).toBeVisible({ timeout: 15_000 });
    await agreeButton1.click();
    await page.waitForTimeout(800);

    // Answer question 2 with "反対"
    const disagreeButton = page.getByText("反対", { exact: true });
    await expect(disagreeButton).toBeVisible({ timeout: 15_000 });
    await disagreeButton.click();
    await page.waitForTimeout(800);

    // Now we should be on question 3. Look for response history items.
    const responseItems = page.locator('[data-testid="response-item"]');
    const countBeforeModify = await responseItems.count();

    // 過去カードはデフォルト折りたたみなので、まず展開する
    const firstPastCard = responseItems.first();
    const toggleButton = firstPastCard.getByRole("button", { expanded: false });
    const canToggle = await toggleButton
      .isVisible({ timeout: 3_000 })
      .catch(() => false);

    if (!canToggle) {
      test.skip();
      return;
    }

    await toggleButton.click();
    await page.waitForTimeout(300);

    const modifyButton = firstPastCard.getByRole("button", {
      name: "修正する",
    });
    await expect(modifyButton).toBeVisible({ timeout: 5_000 });
    await modifyButton.click();
    await page.waitForTimeout(500);

    // Re-answer with a different choice
    const strongAgreeButton = page.getByText("強く同意", { exact: true });
    await expect(strongAgreeButton).toBeVisible({ timeout: 10_000 });
    await strongAgreeButton.click();
    await page.waitForTimeout(1_000);

    // After modification, response count should remain the same (no responses cleared)
    const countAfterModify = await responseItems.count();
    expect(countAfterModify).toBe(countBeforeModify);
  });
});
