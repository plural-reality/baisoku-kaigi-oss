import { expect, test } from "@playwright/test";

// Regression guard for the 2026-06-02 incident: /sessions/new used to fire
// preview-questions + form-suggestions on every keystroke (100ms debounce),
// which under fast / streaming input produced thousands of LLM calls and drained
// the shared OpenRouter budget. The fix is a 2.5s trailing debounce plus a
// min-change guard. This test asserts the client behaviour by counting the
// requests the browser actually sends (independent of the LLM stub's responses).
test.describe("Preview generation throttling (incident 2026-06-02)", () => {
  test("debounces a burst and skips tiny edits instead of firing per keystroke", async ({
    page,
  }) => {
    test.setTimeout(60_000);

    let previewCount = 0;
    page.on("request", (req) => {
      if (
        req.method() === "POST" &&
        req.url().includes("/api/sessions/preview-questions")
      ) {
        previewCount += 1;
      }
    });

    await page.goto("/sessions/new");

    // Skip the template selector ("白紙から始める" = start from blank) to reach the form.
    const skipTemplate = page.getByRole("button", { name: /白紙から始める/ });
    await expect(skipTemplate).toBeVisible({ timeout: 15_000 });
    await skipTemplate.click();

    const purpose = page.locator("#purpose");
    await expect(purpose).toBeVisible({ timeout: 10_000 });

    // 1) Type a ~25-char purpose as a burst, then settle past the 2.5s debounce.
    // The old 100ms debounce + per-keystroke fan-out would have produced many
    // requests; the trailing debounce collapses the burst into one.
    await purpose.pressSequentially(
      "チーム内の認識差を洗い出し、合意形成を加速したい",
      { delay: 40 },
    );
    await page.waitForTimeout(3500);
    const afterFirst = previewCount;
    expect(afterFirst).toBeGreaterThanOrEqual(1);
    expect(afterFirst).toBeLessThanOrEqual(3);

    // 2) A tiny (<10 char) incremental edit must NOT trigger a new generation
    // (min-change guard) — this is the streaming-voice / fast-typing case.
    await purpose.pressSequentially("です", { delay: 40 });
    await page.waitForTimeout(3500);
    expect(previewCount).toBe(afterFirst);

    // 3) A material (>=10 char) change DOES trigger exactly one more generation.
    await purpose.pressSequentially(
      "。特に新システム移行への期待と不安を比較する",
      {
        delay: 40,
      },
    );
    await page.waitForTimeout(3500);
    expect(previewCount).toBe(afterFirst + 1);
  });
});
