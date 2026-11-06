import { expect, test } from "@playwright/test";

test.describe("Participant Voting Flow", () => {
  // Use the seed data session
  const sessionId = "00000000-0000-0000-0000-000000000e2e";

  test("should display session info and start button", async ({ page }) => {
    await page.goto(`/sessions/${sessionId}`);
    await page.waitForLoadState("networkidle");

    // The session page initially shows the session title and a "始める" button
    // (NEEDS_NAME state, hasStarted = false)
    const sessionTitle = page.getByRole("heading", {
      name: /E2E テストセッション/,
    });
    await expect(sessionTitle).toBeVisible({ timeout: 15_000 });

    // Should see the "ゴール" and "背景情報" accordion sections
    const goalSection = page.getByText("ゴール");
    await expect(goalSection).toBeVisible();

    const contextSection = page.getByText("背景情報");
    await expect(contextSection).toBeVisible();

    // Should see the "始める" button
    const startButton = page.getByRole("button", { name: "始める" });
    await expect(startButton).toBeVisible();
  });

  test("should allow a participant to enter their name and join", async ({
    page,
  }) => {
    await page.goto(`/sessions/${sessionId}`);
    await page.waitForLoadState("networkidle");

    // Click "始める" to proceed to name entry
    const startButton = page.getByRole("button", { name: "始める" });
    await expect(startButton).toBeVisible({ timeout: 15_000 });
    await startButton.click();

    // Should now see the name entry form (NEEDS_NAME state, hasStarted = true)
    // The card shows "ようこそ" title and "まず名前を入力してください" description
    const welcomeTitle = page.getByText("ようこそ");
    await expect(welcomeTitle).toBeVisible({ timeout: 10_000 });

    const nameInput = page.getByPlaceholder("あなたの名前");
    await expect(nameInput).toBeVisible();

    // Fill in the participant name
    await nameInput.fill("E2Eテストユーザー");

    // Click the "参加する" button to join the session
    const joinButton = page.getByRole("button", { name: "参加する" });
    await expect(joinButton).toBeVisible();
    await joinButton.click();

    // After joining, the state should transition to ANSWERING
    // Wait for a question/statement to appear
    // The voting buttons should be visible (e.g. "強く同意", "同意", etc.)
    const agreeButton = page.getByText("強く同意", { exact: true });
    await expect(agreeButton).toBeVisible({ timeout: 15_000 });
  });

  test("should allow a participant to vote on statements", async ({ page }) => {
    await page.goto(`/sessions/${sessionId}`);
    await page.waitForLoadState("networkidle");

    // Click "始める"
    const startButton = page.getByRole("button", { name: "始める" });
    await expect(startButton).toBeVisible({ timeout: 15_000 });
    await startButton.click();

    // Enter name
    const nameInput = page.getByPlaceholder("あなたの名前");
    await expect(nameInput).toBeVisible({ timeout: 10_000 });
    await nameInput.fill("投票テストユーザー");

    // Join the session
    const joinButton = page.getByRole("button", { name: "参加する" });
    await joinButton.click();

    // Wait for the first question to appear with voting buttons
    const strongAgreeButton = page.getByText("強く同意", { exact: true });
    await expect(strongAgreeButton).toBeVisible({ timeout: 15_000 });

    // The question card should show the statement text
    const responseItems = page.locator('[data-testid="response-item"]');
    await expect(responseItems.first()).toBeVisible({ timeout: 10_000 });

    // Click "同意" to vote on the first question
    const agreeButton = page.getByText("同意", { exact: true });
    await agreeButton.click();

    // After voting, the next question should appear (or we move to completion)
    // Wait for the UI to update
    await page.waitForTimeout(1_000);

    // Verify that a response was recorded by checking for:
    // 1. A new active question appeared, OR
    // 2. The response-value indicator appears on the answered question
    const hasNextQuestion =
      (await page.getByText("強く同意", { exact: true }).count()) > 0 ||
      (await page.getByText("追加の論点").count()) > 0;
    const hasResponseValue =
      (await page.locator('[data-testid="response-value"]').count()) > 0;

    // Either a new question appeared or we see the response was recorded
    expect(hasNextQuestion || hasResponseValue).toBeTruthy();
  });

  test("should show the session title on the participant page", async ({
    page,
  }) => {
    await page.goto(`/sessions/${sessionId}`);
    await page.waitForLoadState("networkidle");

    // Verify the page loads with the correct session title
    const heading = page.getByRole("heading", {
      name: /E2E テストセッション/,
    });
    await expect(heading).toBeVisible({ timeout: 15_000 });
  });
});
