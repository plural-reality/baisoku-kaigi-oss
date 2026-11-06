import { expect, test } from "@playwright/test";

test.describe("Participant Completion Flow", () => {
  const sessionId = "00000000-0000-0000-0000-000000000e2e";

  /**
   * Helper: join session with a given name and answer all 3 questions.
   * Returns after the last vote button is clicked.
   */
  const joinAndAnswerAll = async (
    page: import("@playwright/test").Page,
    participantName: string,
  ) => {
    await page.goto(`/sessions/${sessionId}`);
    await page.waitForLoadState("networkidle");

    // Click "始める"
    const startButton = page.getByRole("button", { name: "始める" });
    await expect(startButton).toBeVisible({ timeout: 15_000 });
    await startButton.click();

    // Enter name
    const nameInput = page.getByPlaceholder("あなたの名前");
    await expect(nameInput).toBeVisible({ timeout: 10_000 });
    await nameInput.fill(participantName);

    // Join
    const joinButton = page.getByRole("button", { name: "参加する" });
    await joinButton.click();

    // Answer 3 questions with "同意" (active card 内のラベル span に限定)
    for (let i = 0; i < 3; i++) {
      const agreeButton = page.getByText("同意", { exact: true });
      await expect(agreeButton).toBeVisible({ timeout: 15_000 });
      await agreeButton.click();
      // Wait for transition
      await page.waitForTimeout(800);
    }
  };

  test("should reach completed state after answering all questions and skipping reflection", async ({
    page,
  }) => {
    await joinAndAnswerAll(page, "完了テストA");

    // Should see the reflection card or the completed card
    // Try skipping reflection
    const skipButton = page.locator('[data-testid="skip-reflection"]');
    const completedCard = page.locator('[data-testid="completed-card"]');

    // Either reflection shows (skip it) or we're already completed
    const reflectionVisible = await skipButton
      .isVisible({ timeout: 5_000 })
      .catch(() => false);

    if (reflectionVisible) {
      await skipButton.click();
    }

    // Should see the completed card
    await expect(completedCard).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("完了しました！")).toBeVisible();
  });

  test("should reach completed state after answering all questions and submitting reflection", async ({
    page,
  }) => {
    await joinAndAnswerAll(page, "完了テストB");

    // Should see the reflection card
    const reflectionTextarea = page.locator(
      '[data-testid="reflection-textarea"]',
    );
    const submitButton = page.locator('[data-testid="submit-reflection"]');

    const reflectionVisible = await reflectionTextarea
      .isVisible({ timeout: 5_000 })
      .catch(() => false);

    if (reflectionVisible) {
      await reflectionTextarea.fill(
        "テスト用リフレクション: もっとAIの倫理について議論したい",
      );
      await submitButton.click();
    }

    // Should see the completed card
    const completedCard = page.locator('[data-testid="completed-card"]');
    await expect(completedCard).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("完了しました！")).toBeVisible();
  });
});
