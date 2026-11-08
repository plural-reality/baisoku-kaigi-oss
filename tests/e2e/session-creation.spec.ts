import { expect, test } from "@playwright/test";

test.describe("Session Creation Flow", () => {
  test("should create a new session from home page", async ({ page }) => {
    // Navigate to the home page
    await page.goto("/");

    // The home page shows a "セッションを作成" button (empty state) or
    // "新しいセッションを作成" button (when sessions exist).
    // Wait for the page to finish loading.
    await page.waitForLoadState("networkidle");

    // Click the session creation button (handles both empty and non-empty states)
    const createButton = page
      .getByRole("link", { name: /セッションを作成/ })
      .first();
    await expect(createButton).toBeVisible({ timeout: 15_000 });
    await createButton.click();

    // Should navigate to /sessions/new
    await expect(page).toHaveURL(/\/sessions\/new/);

    // The template selector is shown first - skip it by clicking "白紙から始める"
    const skipTemplateButton = page.getByRole("button", {
      name: /白紙から始める/,
    });
    // Wait for the template selector to appear (it may take a moment)
    await expect(skipTemplateButton).toBeVisible({ timeout: 10_000 });
    await skipTemplateButton.click();

    // Now the session creation form should be visible
    // Fill in the title field
    const titleInput = page.locator("#title");
    await expect(titleInput).toBeVisible({ timeout: 10_000 });
    await titleInput.fill("E2E テストセッション");

    // Fill in the purpose/goal field
    const purposeTextarea = page.locator("#purpose");
    await expect(purposeTextarea).toBeVisible();
    await purposeTextarea.fill(
      "E2Eテストのために作成した目的です。チーム内の認識差を明らかにします。",
    );

    // Optionally fill in background info
    const backgroundTextarea = page.locator("#backgroundInfo");
    await expect(backgroundTextarea).toBeVisible();
    await backgroundTextarea.fill("これはE2Eテスト用の背景情報です。");

    // Wait for the preview questions to generate (the submit button appears inside the preview panel)
    // The submit button text is "セッションを作成"
    const submitButton = page.getByRole("button", {
      name: /セッションを作成/,
    });
    await expect(submitButton).toBeVisible({ timeout: 30_000 });

    // Click submit
    await submitButton.click();

    // After successful creation, the user is redirected to the admin page:
    // /sessions/{sessionId}/{adminAccessToken}
    await expect(page).toHaveURL(/\/sessions\/[\w-]+\/[\w-]+/, {
      timeout: 30_000,
    });
  });

  test("should show validation errors when required fields are empty", async ({
    page,
  }) => {
    // Navigate directly to the session creation form, bypassing the template selector
    // by providing a title param (which sets hasUrlParams = true)
    await page.goto("/sessions/new?title=");

    await page.waitForLoadState("networkidle");

    // The form should be shown (no template selector since hasUrlParams is technically true for "title=" but empty)
    // Actually, with title="" the searchParams.get("title") returns "" which is falsy.
    // Let's just navigate and skip the template:
    await page.goto("/sessions/new");

    // Skip template selector
    const skipTemplateButton = page.getByRole("button", {
      name: /白紙から始める/,
    });
    await expect(skipTemplateButton).toBeVisible({ timeout: 10_000 });
    await skipTemplateButton.click();

    // The form should now be visible
    const titleInput = page.locator("#title");
    await expect(titleInput).toBeVisible({ timeout: 10_000 });

    // Try to submit without filling in required fields
    // We need to trigger form submission - use the form's submit event
    // The form has an onSubmit handler, so we can press Enter on a field
    // or find the submit button. The submit button is in the preview panel
    // and only appears when preview questions are generated.
    // Instead, press Enter on the title input to trigger form submit.
    await titleInput.press("Enter");

    // Validation error should appear for the title
    const titleError = page.getByText("セッションのタイトルを入力してください");
    await expect(titleError).toBeVisible({ timeout: 5_000 });
  });

  test("should navigate to new session page from template shortcut", async ({
    page,
  }) => {
    await page.goto("/sessions/new?template=budget-allocation");
    await page.waitForLoadState("networkidle");

    // When a template param is provided, the template selector is skipped
    // and the form is pre-filled with the template data
    const titleInput = page.locator("#title");
    await expect(titleInput).toBeVisible({ timeout: 10_000 });

    // The title should be pre-filled from the template
    const titleValue = await titleInput.inputValue();
    expect(titleValue.length).toBeGreaterThan(0);
  });
});
