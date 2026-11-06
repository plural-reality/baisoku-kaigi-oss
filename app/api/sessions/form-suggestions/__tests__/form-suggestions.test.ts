import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockRequest } from "@/lib/__tests__/helpers/mock-request";

// --- Mocks (module-level) ---

vi.mock("@/lib/auth", () => ({
  getHostUserIdFromRequest: vi.fn(),
}));

vi.mock("@/lib/llm", () => ({
  FAST_MODEL: "test-model",
}));

vi.mock("axios", () => ({
  default: { post: vi.fn(), isAxiosError: () => false },
}));

// --- Imports (after mocks) ---

import axios from "axios";
import { getHostUserIdFromRequest } from "@/lib/auth";
import { __resetUserGuard } from "@/lib/llm-user-guard";
import { POST } from "../route";

const mockedGetUserId = getHostUserIdFromRequest as ReturnType<typeof vi.fn>;
const mockedPost = (axios as unknown as { post: ReturnType<typeof vi.fn> })
  .post;

const llmResponse = (content: string) => ({
  data: { choices: [{ message: { content } }] },
});

describe("POST /api/sessions/form-suggestions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the per-user rate-limit + cache singleton so cases that reuse the
    // same identity/input do not see each other's cached results.
    __resetUserGuard();
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
  });

  it("returns 401 when no auth (no anonymous LLM access)", async () => {
    mockedGetUserId.mockResolvedValue(null);
    const req = createMockRequest({
      method: "POST",
      body: { purpose: "x", backgroundInfo: "y" },
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error).toContain("Unauthorized");
  });

  it("parses an array even when an element contains brackets (L3 regression)", async () => {
    mockedGetUserId.mockResolvedValue("user-1");
    mockedPost.mockResolvedValue(
      llmResponse('["条件[A]について教えてください", "Q2を教えてください"]'),
    );
    const req = createMockRequest({
      method: "POST",
      body: { purpose: "p", backgroundInfo: "b" },
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.suggestions).toHaveLength(2);
    expect(body.suggestions[0]).toContain("条件[A]");
  });

  it("degrades to [] (not 500) when the model output has no parseable array", async () => {
    mockedGetUserId.mockResolvedValue("user-1");
    mockedPost.mockResolvedValue(llmResponse("これは提案ではありません。"));
    const req = createMockRequest({
      method: "POST",
      body: { purpose: "p", backgroundInfo: "b" },
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.suggestions).toEqual([]);
  });
});
