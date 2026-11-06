import { expect, test } from "@playwright/test";

test.describe("Admin Page", () => {
  const sessionId = "00000000-0000-0000-0000-000000000e2e";
  const accessToken = "e2e00000-0000-0000-0000-000000000001";
  const adminUrl = `/sessions/${sessionId}/${accessToken}`;

  test("should display participant section with seeded participants", async ({
    page,
  }) => {
    await page.goto(adminUrl);
    await page.waitForLoadState("networkidle");

    // Participant section should be visible
    const participantSection = page.locator(
      '[data-testid="participant-section"]',
    );
    await expect(participantSection).toBeVisible({ timeout: 15_000 });

    // Seeded participant names should appear
    await expect(page.getByText("テスト太郎")).toBeVisible();
    await expect(page.getByText("テスト花子")).toBeVisible();
  });

  test("should show share link containing the session ID", async ({ page }) => {
    await page.goto(adminUrl);
    await page.waitForLoadState("networkidle");

    // The share link input should contain the session ID
    const shareLinkInput = page.locator("#shareLink");
    await expect(shareLinkInput).toBeVisible({ timeout: 15_000 });

    const shareUrl = await shareLinkInput.inputValue();
    expect(shareUrl).toContain(sessionId);
  });

  test("should show copied status when copy button is clicked", async ({
    page,
  }) => {
    await page.goto(adminUrl);
    await page.waitForLoadState("networkidle");

    const copyButton = page.locator('[data-testid="copy-share-link"]');
    await expect(copyButton).toBeVisible({ timeout: 15_000 });

    // Grant clipboard permissions for the test
    await page
      .context()
      .grantPermissions(["clipboard-read", "clipboard-write"]);
    await copyButton.click();

    // Should show "コピー済み" after clicking
    await expect(copyButton).toContainText("コピー済み", { timeout: 5_000 });
  });

  test("should display the report generation button", async ({ page }) => {
    await page.goto(adminUrl);
    await page.waitForLoadState("networkidle");

    const generateButton = page.locator(
      '[data-testid="generate-report-button"]',
    );
    await expect(generateButton).toBeVisible({ timeout: 15_000 });
    await expect(generateButton).toContainText("レポートを生成");
  });
});
