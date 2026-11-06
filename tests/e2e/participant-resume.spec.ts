import { expect, test } from "@playwright/test";

test.describe("Participant Resume Flow", () => {
  const sessionId = "00000000-0000-0000-0000-000000000e2e";

  test("再アクセス時にバナーが表示され、過去カードが折りたたまれている", async ({
    page,
  }) => {
    await page.goto(`/sessions/${sessionId}`);
    await page.waitForLoadState("networkidle");

    // 1回目: 名前入力 → 1問回答
    await page.getByRole("button", { name: "始める" }).click();
    await page.getByPlaceholder("あなたの名前").fill("再開テスト");
    await page.getByRole("button", { name: "参加する" }).click();

    const agreeButton = page.getByText("同意", { exact: true });
    await expect(agreeButton).toBeVisible({ timeout: 15_000 });
    await agreeButton.click();
    await page.waitForTimeout(800);

    // 2回目: リロード
    await page.reload();
    await page.waitForLoadState("networkidle");

    // バナーが表示される
    const banner = page.locator('[data-testid="resume-banner"]');
    await expect(banner).toBeVisible({ timeout: 10_000 });
    await expect(banner).toContainText("1 問");

    // 過去カードはデフォルトで折りたたまれている → 修正ボタンが見えない
    const responseItems = page.locator('[data-testid="response-item"]');
    const firstPastCard = responseItems.first();
    await expect(
      firstPastCard.getByRole("button", { name: "修正する" }),
    ).not.toBeVisible();

    // トグルボタンをクリックして展開
    const toggleButton = firstPastCard.getByRole("button", { expanded: false });
    await expect(toggleButton).toBeVisible();
    await toggleButton.click();
    await page.waitForTimeout(300);

    // 修正ボタンが表示される
    await expect(
      firstPastCard.getByRole("button", { name: "修正する" }),
    ).toBeVisible({ timeout: 5_000 });
  });

  test("新規参加者にはバナーが表示されない", async ({ page }) => {
    await page.goto(`/sessions/${sessionId}`);
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: "始める" }).click();
    await page.getByPlaceholder("あなたの名前").fill("新規テスト");
    await page.getByRole("button", { name: "参加する" }).click();

    const agreeButton = page.getByText("同意", { exact: true });
    await expect(agreeButton).toBeVisible({ timeout: 15_000 });

    // 1問目の時点ではバナーは出ない
    const banner = page.locator('[data-testid="resume-banner"]');
    await expect(banner).not.toBeVisible();
  });
});
