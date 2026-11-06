import {
  type APIRequestContext,
  expect,
  type Page,
  test,
} from "@playwright/test";

type ParticipantIdentity = Readonly<{
  userId: string;
  token: string;
}>;

type CreatedSession = Readonly<{
  id: string;
  adminAccessToken: string;
}>;

const isRemoteBaseURL =
  !!process.env.PLAYWRIGHT_BASE_URL &&
  !process.env.PLAYWRIGHT_BASE_URL.includes("localhost") &&
  !process.env.PLAYWRIGHT_BASE_URL.includes("127.0.0.1");

const authHeaders = (token: string): Record<string, string> => ({
  Authorization: `Bearer ${token}`,
});

const expectApiOk = async (
  response: Awaited<ReturnType<APIRequestContext["get"]>>,
  label: string,
): Promise<void> => {
  const body = response.ok() ? "" : await response.text();
  expect(response.ok(), `${label} failed: ${response.status()} ${body}`).toBe(
    true,
  );
};

const issueIdentity = async (
  request: APIRequestContext,
): Promise<ParticipantIdentity> => {
  const response = await request.post("/api/auth/participant-token");
  if (response.status() === 503) {
    const userId = crypto.randomUUID();
    return { userId, token: userId };
  }

  await expectApiOk(response, "POST /api/auth/participant-token");
  const body = (await response.json()) as Partial<ParticipantIdentity>;

  expect(body.userId, "participant token response userId").toEqual(
    expect.any(String),
  );
  expect(
    body.token === null || typeof body.token === "string",
    "participant token response token",
  ).toBe(true);

  return {
    userId: body.userId ?? "",
    token: body.token ?? body.userId ?? "",
  };
};

const collectPageFailures = (page: Page): string[] => {
  const failures: string[] = [];

  page.on("response", (response) =>
    response.status() >= 500
      ? failures.push(
          `${response.request().method()} ${response.url()} -> ${response.status()}`,
        )
      : undefined,
  );

  page.on("console", (message) =>
    message.type() === "error"
      ? failures.push(`console.error: ${message.text()}`)
      : undefined,
  );

  return failures;
};

test.describe("staging session context", () => {
  test.skip(
    !isRemoteBaseURL,
    "requires PLAYWRIGHT_BASE_URL to point at staging",
  );

  test("covers login hover notice, context inheritance, public override edit, and cleanup", async ({
    context,
    page,
    request,
  }) => {
    const pageFailures = collectPageFailures(page);
    const identity = await issueIdentity(request);
    const suffix = `${Date.now()}`;
    const title = `E2E staging context ${suffix}`;
    const facilitatorGoal = `E2E本題目的 ${suffix}`;
    const facilitatorContext = `E2E本題背景 ${suffix}`;
    const publicGoal = `E2E参加者目的 ${suffix}`;
    const publicContext = `E2E参加者背景 ${suffix}`;
    const headers = authHeaders(identity.token);
    let createdSession: CreatedSession | null = null;

    try {
      const createResponse = await request.post("/api/sessions", {
        headers,
        data: {
          title,
          goal: facilitatorGoal,
          context: facilitatorContext,
          facilitatorGoal,
          facilitatorContext,
          initialQuestions: [
            `E2E固定質問1 ${suffix}`,
            `E2E固定質問2 ${suffix}`,
          ],
        },
      });

      await expectApiOk(createResponse, "POST /api/sessions");
      const createBody = (await createResponse.json()) as {
        session: CreatedSession;
      };
      createdSession = createBody.session;

      const adminApiResponse = await request.get(
        `/api/sessions/${createdSession.id}/${createdSession.adminAccessToken}`,
        { headers },
      );
      await expectApiOk(adminApiResponse, "GET admin session");
      const adminApiBody = (await adminApiResponse.json()) as {
        data: {
          title: string;
          goal: string;
          context: string;
          facilitatorGoal: string;
          facilitatorContext: string;
        };
      };

      expect(adminApiBody.data.title).toBe(title);
      expect(adminApiBody.data.facilitatorGoal).toBe(facilitatorGoal);
      expect(adminApiBody.data.facilitatorContext).toBe(facilitatorContext);
      expect(adminApiBody.data.goal).toBe("");
      expect(adminApiBody.data.context).toBe("");

      const participantApiResponse = await request.get(
        `/api/sessions/${createdSession.id}`,
        { headers },
      );
      await expectApiOk(participantApiResponse, "GET participant session");
      const participantApiBody = (await participantApiResponse.json()) as {
        session: { goal: string; context: string };
      };

      expect(participantApiBody.session.goal).toBe(facilitatorGoal);
      expect(participantApiBody.session.context).toBe(facilitatorContext);

      await page.goto(
        `/sessions/${createdSession.id}/${createdSession.adminAccessToken}`,
        { waitUntil: "domcontentloaded" },
      );

      const loginLink = page.getByRole("link", { name: "ログイン" }).first();
      await expect(loginLink).toHaveText("ログイン");
      await expect(loginLink).toHaveAttribute("href", "/login");
      await expect(page.getByText("ログイン機能は")).toHaveCount(0);

      await expect(page.getByRole("heading", { name: title })).toBeVisible({
        timeout: 15_000,
      });
      await expect(
        page.getByText("目的・背景（本題）", { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText(facilitatorGoal, { exact: true }).last(),
      ).toBeVisible();
      await expect(
        page.getByText(facilitatorContext, { exact: true }).last(),
      ).toBeVisible();
      await expect(page.getByText(/未上書き/)).toBeVisible();

      await page.getByRole("button", { name: "編集" }).click();
      await page.locator("#sessionGoal").fill(publicGoal);
      await page.locator("#sessionContext").fill(publicContext);
      const updateResponsePromise = page.waitForResponse(
        (response) =>
          response
            .url()
            .includes(
              `/api/sessions/${createdSession.id}/${createdSession.adminAccessToken}`,
            ) && response.request().method() === "PATCH",
      );
      await page.getByRole("button", { name: "変更を保存" }).click();
      const updateResponse = await updateResponsePromise;
      expect(
        updateResponse.ok(),
        `PATCH admin session failed: ${updateResponse.status()} ${await updateResponse.text()}`,
      ).toBe(true);
      await expect(page.getByRole("dialog")).toBeHidden({ timeout: 15_000 });

      await expect(
        page.getByText(publicGoal, { exact: true }).last(),
      ).toBeVisible({ timeout: 15_000 });
      await expect(
        page.getByText(publicContext, { exact: true }).last(),
      ).toBeVisible();

      const updatedParticipantApiResponse = await request.get(
        `/api/sessions/${createdSession.id}`,
        { headers },
      );
      await expectApiOk(
        updatedParticipantApiResponse,
        "GET participant session after override",
      );
      const updatedParticipantApiBody =
        (await updatedParticipantApiResponse.json()) as {
          session: { goal: string; context: string };
        };

      expect(updatedParticipantApiBody.session.goal).toBe(publicGoal);
      expect(updatedParticipantApiBody.session.context).toBe(publicContext);

      const participantPage = await context.newPage();
      const participantFailures = collectPageFailures(participantPage);
      await participantPage.goto(`/sessions/${createdSession.id}`, {
        waitUntil: "domcontentloaded",
      });
      await expect(
        participantPage.getByRole("heading", { name: title }),
      ).toBeVisible({ timeout: 15_000 });
      await expect(
        participantPage.getByText(publicGoal, { exact: true }),
      ).toBeVisible();
      await participantPage.getByRole("button", { name: "背景情報" }).click();
      await expect(
        participantPage.getByText(publicContext, { exact: true }),
      ).toBeVisible();
      await expect(
        participantPage.getByRole("button", { name: "始める" }),
      ).toBeVisible();
      await participantPage.close();

      expect([...pageFailures, ...participantFailures]).toEqual([]);
    } finally {
      if (createdSession) {
        const deleteResponse = await request.delete(
          `/api/sessions/${createdSession.id}/${createdSession.adminAccessToken}`,
          { headers },
        );
        await expectApiOk(deleteResponse, "DELETE created session");
      }
    }
  });
});
