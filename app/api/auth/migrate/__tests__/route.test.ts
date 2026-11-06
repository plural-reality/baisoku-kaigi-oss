import { withAuth } from "@workos-inc/authkit-nextjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMockRequest } from "@/lib/__tests__/helpers/mock-request";
import { supabase } from "@/lib/supabase";
import { POST } from "../route";

vi.mock("@workos-inc/authkit-nextjs", () => ({ withAuth: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: vi.fn() } }));

const NEW = "22222222-2222-4222-8222-222222222222"; // WorkOS identity (UUID form)
const OLD = "11111111-1111-4111-8111-111111111111"; // legacy anonymous identity
const OTHER = "33333333-3333-4333-8333-333333333333";

const migrateRequest = (body: unknown, bearer?: string) =>
  createMockRequest({
    method: "POST",
    body,
    headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
  });

beforeEach(() => {
  vi.mocked(withAuth).mockResolvedValue({ user: { id: NEW } } as never);
  vi.mocked(supabase.rpc as never).mockResolvedValue({ error: null } as never);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/auth/migrate (M1 ownership proof)", () => {
  it("401 without a WorkOS session", async () => {
    vi.mocked(withAuth).mockResolvedValue({ user: null } as never);
    const res = await POST(migrateRequest({ oldUserId: OLD }, OLD));
    expect(res.status).toBe(401);
  });

  it("403 when the caller presents no bearer for oldUserId", async () => {
    const res = await POST(migrateRequest({ oldUserId: OLD }));
    expect(res.status).toBe(403);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("403 when the bearer proves a DIFFERENT identity (no laundering)", async () => {
    const res = await POST(migrateRequest({ oldUserId: OLD }, OTHER));
    expect(res.status).toBe(403);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("migrates when the bearer proves ownership of oldUserId", async () => {
    const res = await POST(migrateRequest({ oldUserId: OLD }, OLD));
    const json = await res.json();
    expect(json.migrated).toBe(true);
    expect(supabase.rpc).toHaveBeenCalledWith("migrate_user_id", {
      old_id: OLD,
      new_id: NEW,
    });
  });
});
