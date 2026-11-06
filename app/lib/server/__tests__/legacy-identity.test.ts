import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({
  supabase: { rpc: vi.fn() },
}));

import { supabase } from "@/lib/supabase";
import { toStableUUID } from "@/lib/workos-uuid";
import { claimLegacyIdentity } from "../legacy-identity";

const rpc = supabase.rpc as unknown as ReturnType<typeof vi.fn>;
const LEGACY = "2f0e8d1b-c34a-4148-9f53-f980c87bfa30";

describe("claimLegacyIdentity", () => {
  beforeEach(() => {
    rpc.mockReset();
  });

  it("claims by lower-cased verified email for the new stable UUID", async () => {
    rpc.mockResolvedValue({ data: LEGACY, error: null });
    const result = await claimLegacyIdentity({
      id: "user_new",
      email: "Host@Example.com",
      emailVerified: true,
    });
    expect(result).toBe(LEGACY);
    expect(rpc).toHaveBeenCalledWith("claim_workos_legacy_identity", {
      p_email: "host@example.com",
      p_new_id: toStableUUID("user_new"),
    });
  });

  it("does nothing for an unverified email", async () => {
    const result = await claimLegacyIdentity({
      id: "user_new",
      email: "host@example.com",
      emailVerified: false,
    });
    expect(result).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("returns null when there is nothing to claim", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    expect(
      await claimLegacyIdentity({
        id: "user_new",
        email: "host@example.com",
        emailVerified: true,
      }),
    ).toBeNull();
  });

  it("surfaces RPC errors to the caller", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    await expect(
      claimLegacyIdentity({
        id: "user_new",
        email: "host@example.com",
        emailVerified: true,
      }),
    ).rejects.toEqual({ message: "boom" });
  });
});
