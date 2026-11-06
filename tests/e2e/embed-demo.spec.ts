import { expect, test } from "@playwright/test";

// /embed/demo is framed into plural-reality.com (the 倍速会議 slide of the home
// page). It renders the real participant and admin components with made-up
// data, so a change to those components shows up there as is — this spec only
// checks that every scene still renders and may be framed by our sites.

test.describe("embed demo for the marketing site", () => {
  test("participant scene renders the answering timeline", async ({ page }) => {
    await page.goto("/embed/demo?scene=participant&lang=ja");
    await expect(page.getByTestId("response-item").first()).toBeVisible();
    await expect(page.getByTestId("response-item")).toHaveCount(6);
    // No account entry (and so no /login prefetch) in the demo.
    await expect(page.locator('a[href="/login"]')).toHaveCount(0);
  });

  test("issues scene renders the consensus map and the top-3 columns", async ({
    page,
  }) => {
    await page.goto("/embed/demo?scene=issues&lang=en");
    await expect(page.locator("svg").first()).toBeVisible();
    // The frame is aria-hidden (a picture of the app), so match the tags.
    await expect(page.locator("h3")).toHaveCount(4);
  });

  test("participants scene renders one card per participant", async ({
    page,
  }) => {
    await page.goto("/embed/demo?scene=participants&lang=ja");
    await expect(page.getByTestId("participant-progress-card")).toHaveCount(12);
  });

  test("only /embed/* may be framed, and only by our sites", async ({
    request,
  }) => {
    const embed = await request.get("/embed/demo?scene=issues");
    expect(embed.headers()["x-frame-options"]).toBeUndefined();
    expect(embed.headers()["content-security-policy"]).toContain(
      "frame-ancestors 'self' https://plural-reality.com",
    );

    const home = await request.get("/");
    expect(home.headers()["x-frame-options"]).toBe("DENY");
    expect(home.headers()["content-security-policy"]).toContain(
      "frame-ancestors 'none'",
    );
  });
});
