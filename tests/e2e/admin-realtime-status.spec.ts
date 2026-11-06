import { expect, type Locator, type Page, test } from "@playwright/test";

const sessionId = "00000000-0000-0000-0000-000000000e2e";
const accessToken = "e2e00000-0000-0000-0000-admin00token";
const adminUrl = `/sessions/${sessionId}/${accessToken}`;

const readMetricCount = async (locator: Locator) => {
  const text = (await locator.textContent()) ?? "";
  const match = text.match(/(\d+)人/);
  if (!match) {
    throw new Error(`メトリクスから人数を読めませんでした: ${text}`);
  }
  return Number.parseInt(match[1], 10);
};

const joinSession = async (page: Page, participantName: string) => {
  await page.goto(`/sessions/${sessionId}`);
  await page.waitForLoadState("networkidle");

  await page.getByRole("button", { name: "始める" }).click();
  await page.getByPlaceholder("あなたの名前").fill(participantName);
  await page.getByRole("button", { name: "参加する" }).click();
};

const answerCurrentQuestion = async (page: Page) => {
  const agreeButton = page.getByText("同意", { exact: true });
  await expect(agreeButton).toBeVisible({ timeout: 15_000 });
  await agreeButton.click();
  await page.waitForTimeout(800);
};

test.describe("Admin Realtime Status", () => {
  test("admin should reflect participant status changes without manual reload", async ({
    browser,
  }) => {
    test.setTimeout(60_000);

    const adminContext = await browser.newContext();
    const participantContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    const participantPage = await participantContext.newPage();
    const participantName = `自動反映-${Date.now()}`;

    try {
      await adminPage.goto(adminUrl);
      await adminPage.waitForLoadState("networkidle");
      await expect(adminPage.getByTestId("participant-section")).toBeVisible({
        timeout: 15_000,
      });

      const inProgressMetric = adminPage.getByTestId(
        "monitoring-metric-in-progress",
      );
      const completedMetric = adminPage.getByTestId(
        "monitoring-metric-completed",
      );
      const baselineInProgress = await readMetricCount(inProgressMetric);
      const baselineCompleted = await readMetricCount(completedMetric);

      await joinSession(participantPage, participantName);

      const participantCard = adminPage
        .getByTestId("participant-progress-card")
        .filter({ hasText: participantName })
        .first();

      await expect(participantCard).toBeVisible({ timeout: 15_000 });
      await expect(
        participantCard.getByTestId("participant-status-badge"),
      ).toHaveText("未開始", { timeout: 15_000 });

      await answerCurrentQuestion(participantPage);

      await expect(
        participantCard.getByTestId("participant-status-badge"),
      ).toHaveText("進行中", { timeout: 15_000 });
      await expect(participantCard).toContainText("1/3", {
        timeout: 15_000,
      });
      await expect
        .poll(() => readMetricCount(inProgressMetric), {
          timeout: 15_000,
        })
        .toBe(baselineInProgress + 1);

      await answerCurrentQuestion(participantPage);
      await answerCurrentQuestion(participantPage);

      const skipReflectionButton =
        participantPage.getByTestId("skip-reflection");
      const reflectionVisible = await skipReflectionButton
        .isVisible({ timeout: 5_000 })
        .catch(() => false);
      if (reflectionVisible) {
        await skipReflectionButton.click();
      }

      await expect(participantPage.getByTestId("completed-card")).toBeVisible({
        timeout: 15_000,
      });
      await expect(
        participantCard.getByTestId("participant-status-badge"),
      ).toHaveText("完了", { timeout: 15_000 });
      await expect(participantCard).toContainText("3/3", {
        timeout: 15_000,
      });
      await expect
        .poll(() => readMetricCount(inProgressMetric), {
          timeout: 15_000,
        })
        .toBe(baselineInProgress);
      await expect
        .poll(() => readMetricCount(completedMetric), {
          timeout: 15_000,
        })
        .toBe(baselineCompleted + 1);
    } finally {
      await participantContext.close().catch(() => undefined);
      await adminContext.close().catch(() => undefined);
    }
  });
});
