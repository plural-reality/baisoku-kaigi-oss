import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockRequest } from "@/lib/__tests__/helpers/mock-request";

vi.mock("@/lib/auth", () => ({ getHostUserIdFromRequest: vi.fn() }));
vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(async () => (key: string) => `t:${key}`),
}));
vi.mock("@/lib/llm", () => ({ generateDecidimSessionBrief: vi.fn() }));
vi.mock("@/lib/server/decidim/api", () => ({
  readDecidimDiscussion: vi.fn(),
}));
vi.mock("@/lib/server/decidim/http", () => ({ postToDecidim: vi.fn() }));

import { getHostUserIdFromRequest } from "@/lib/auth";
import { generateDecidimSessionBrief } from "@/lib/llm";
import { __resetUserGuard } from "@/lib/llm-user-guard";
import { readDecidimDiscussion } from "@/lib/server/decidim/api";
import { POST } from "../route";

const mockedUser = getHostUserIdFromRequest as ReturnType<typeof vi.fn>;
const mockedRead = readDecidimDiscussion as ReturnType<typeof vi.fn>;
const mockedBrief = generateDecidimSessionBrief as ReturnType<typeof vi.fn>;

const URL_P = "https://x.example/processes/env";
const discussion = {
  spaceTitle: "s",
  spaceDescription: "",
  items: [],
  truncated: true,
};
const brief = { title: "T", purpose: "P", background: "B" };

const post = (body: unknown) =>
  POST(createMockRequest({ method: "POST", body }) as never);

describe("POST /api/sessions/import-decidim", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetUserGuard();
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockedUser.mockResolvedValue("user-1");
    mockedRead.mockResolvedValue({ ok: true, discussion });
    mockedBrief.mockResolvedValue(brief);
  });

  it("requires a host identity before touching anything", async () => {
    mockedUser.mockResolvedValue(null);
    const res = await post({ url: URL_P });
    expect(res.status).toBe(401);
    expect(mockedRead).not.toHaveBeenCalled();
  });

  it.each([
    ["a missing URL", {}],
    ["a non-string", { url: 1 }],
    ["an internal host", { url: "https://127.0.0.1/processes/p" }],
    ["http", { url: "http://x.example/processes/p" }],
  ])("rejects %s without any request", async (_, body) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalidUrl");
    expect(mockedRead).not.toHaveBeenCalled();
  });

  it("returns the draft with its canonical source", async () => {
    const res = await post({ url: `${URL_P}/?x=1`, language: "en" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ...brief,
      sourceUrl: URL_P,
      truncated: true,
    });
    expect(mockedBrief).toHaveBeenCalledWith({
      discussion,
      sourceUrl: URL_P,
      language: "en",
    });
  });

  it.each([
    ["unavailable", 502],
    ["notFound", 404],
    ["unsupported", 502],
    ["noContent", 422],
  ])("maps %s to %i without calling the LLM", async (reason, status) => {
    mockedRead.mockResolvedValue({ ok: false, reason });
    const res = await post({ url: URL_P });
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({
      error: reason,
      message: `t:${reason}`,
    });
    expect(mockedBrief).not.toHaveBeenCalled();
  });

  it("reports a failed or malformed brief", async () => {
    mockedBrief.mockRejectedValueOnce(new Error("down"));
    expect((await post({ url: URL_P })).status).toBe(502);
    mockedBrief.mockResolvedValueOnce(undefined);
    expect((await post({ url: URL_P })).status).toBe(502);
  });

  it("limits reads per instance across identities", async () => {
    const results = await Array.from(
      { length: 11 },
      (_, index) => index,
    ).reduce<Promise<number[]>>(async (previous, index) => {
      const statuses = await previous;
      mockedUser.mockResolvedValue(`user-${index}`);
      return [...statuses, (await post({ url: URL_P })).status];
    }, Promise.resolve([]));

    expect(results.slice(0, 10).every((status) => status === 200)).toBe(true);
    expect(results[10]).toBe(429);
    expect(mockedRead).toHaveBeenCalledTimes(10);
  });

  it("serves a repeat from cache and rate limits distinct imports", async () => {
    await post({ url: URL_P });
    await post({ url: URL_P });
    expect(mockedRead).toHaveBeenCalledTimes(1);

    await post({ url: `${URL_P}2` });
    await post({ url: `${URL_P}3` });
    const limited = await post({ url: `${URL_P}4` });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBeTruthy();
    expect(mockedRead).toHaveBeenCalledTimes(3);
  });
});
