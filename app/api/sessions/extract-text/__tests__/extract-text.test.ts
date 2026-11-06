import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockRequest } from "@/lib/__tests__/helpers/mock-request";

// --- Mocks (module-level) ---
// The route imports native document parsers at module scope; mock them so the
// route module imports cleanly under vitest and no real parsing/LLM happens.

vi.mock("@/lib/auth", () => ({
  getHostUserIdFromRequest: vi.fn(),
}));

vi.mock("axios", () => ({
  default: { post: vi.fn(), isAxiosError: () => false },
}));

vi.mock("pdf-parse", () => ({ default: vi.fn() }));
vi.mock("mammoth", () => ({ default: { extractRawText: vi.fn() } }));
vi.mock("xlsx", () => ({ read: vi.fn(), utils: { sheet_to_csv: vi.fn() } }));

// --- Imports (after mocks) ---

import { getHostUserIdFromRequest } from "@/lib/auth";
import { POST } from "../route";

const mockedGetUserId = getHostUserIdFromRequest as ReturnType<typeof vi.fn>;

describe("POST /api/sessions/extract-text", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when no auth (no anonymous file parsing / LLM access)", async () => {
    mockedGetUserId.mockResolvedValue(null);
    const req = createMockRequest({ method: "POST" });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error).toContain("Unauthorized");
  });

  it("returns 413 when declared content-length exceeds the total cap", async () => {
    mockedGetUserId.mockResolvedValue("user-1");
    const req = createMockRequest({
      method: "POST",
      headers: { "content-length": String(40 * 1024 * 1024) },
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(413);
    expect(body.error).toContain("30MB");
  });
});
