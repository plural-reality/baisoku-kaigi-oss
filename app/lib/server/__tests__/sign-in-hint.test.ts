import { describe, expect, it, vi } from "vitest";

vi.mock("@workos-inc/authkit-nextjs", () => ({ getWorkOS: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));

const { organizationToName } = await import("../sign-in-hint");

const membership = (
  organizationId: string,
  createdAt: string,
  status = "active",
) => ({ organizationId, createdAt, status });

describe("organizationToName", () => {
  it("組織が1つ以下なら渡さない（WorkOS は選ばせない）", () => {
    expect(organizationToName([])).toBeUndefined();
    expect(
      organizationToName([membership("org_a", "2026-10-01T00:00:00Z")]),
    ).toBeUndefined();
  });

  it("2つ以上なら、いちばん古い所属の組織を渡す", () => {
    expect(
      organizationToName([
        membership("org_new", "2026-10-20T00:00:00Z"),
        membership("org_old", "2026-10-01T00:00:00Z"),
      ]),
    ).toBe("org_old");
  });

  it("有効でない所属は数えない", () => {
    expect(
      organizationToName([
        membership("org_a", "2026-10-01T00:00:00Z", "inactive"),
        membership("org_b", "2026-10-02T00:00:00Z"),
      ]),
    ).toBeUndefined();
  });
});
