import { afterEach, describe, expect, it, vi } from "vitest";
import {
  __resetParticipantTokenWarnings,
  isParticipantToken,
  isParticipantTokenEnforced,
  LEGACY_OPT_OUT_UNTIL,
  participantTokenStatus,
  signParticipantToken,
  verifyParticipantToken,
} from "../participant-token";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("participant-token (H1/M2)", () => {
  it("round-trips sign → verify with the secret", async () => {
    vi.stubEnv("PARTICIPANT_TOKEN_SECRET", "test-secret");
    const token = await signParticipantToken("user-123");
    expect(isParticipantToken(token)).toBe(true);
    expect(await verifyParticipantToken(token)).toBe("user-123");
  });

  it("rejects a tampered signature", async () => {
    vi.stubEnv("PARTICIPANT_TOKEN_SECRET", "test-secret");
    const token = await signParticipantToken("user-123");
    const tampered = `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`;
    expect(await verifyParticipantToken(tampered)).toBeNull();
  });

  it("rejects a token signed with a different secret", async () => {
    vi.stubEnv("PARTICIPANT_TOKEN_SECRET", "secret-a");
    const token = await signParticipantToken("user-123");
    vi.stubEnv("PARTICIPANT_TOKEN_SECRET", "secret-b");
    expect(await verifyParticipantToken(token)).toBeNull();
  });

  it("returns null when no secret is configured", async () => {
    expect(await verifyParticipantToken("cpt1.dXNlcg.c2ln")).toBeNull();
  });

  it("signing throws without a secret (caller falls back to legacy)", async () => {
    await expect(signParticipantToken("u")).rejects.toThrow();
  });

  it("does not treat a raw UUID as a participant token", () => {
    expect(isParticipantToken("11111111-1111-4111-8111-111111111111")).toBe(
      false,
    );
  });

  // Audit 2026-10-06 H2: enforcement is the default; the only opt-out is the
  // dated PARTICIPANT_TOKEN_ENFORCE=false window.
  describe("enforcement default", () => {
    it("is ON by default once a secret is configured (no flag needed)", () => {
      vi.stubEnv("PARTICIPANT_TOKEN_SECRET", "test-secret");
      expect(isParticipantTokenEnforced()).toBe(true);
    });

    it("stays a safe no-op outside production when no secret is set (lockout guard)", () => {
      vi.stubEnv("NODE_ENV", "test");
      expect(isParticipantTokenEnforced()).toBe(false);
    });

    it("stays Stage 1 in production without a secret but warns once (no auto-deploy lockout)", () => {
      __resetParticipantTokenWarnings();
      const warn = vi
        .spyOn(console, "warn")
        .mockImplementation(() => undefined);
      vi.stubEnv("NODE_ENV", "production");
      expect(isParticipantTokenEnforced()).toBe(false);
      expect(isParticipantTokenEnforced()).toBe(false);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toContain(
        "PARTICIPANT_TOKEN_SECRET is not set",
      );
    });

    it("exposes a secret-free rollout status", () => {
      vi.stubEnv("PARTICIPANT_TOKEN_SECRET", "test-secret");
      expect(participantTokenStatus()).toEqual({
        secretConfigured: true,
        enforced: true,
        legacyOptOut: false,
        legacyOptOutUntil: LEGACY_OPT_OUT_UNTIL,
      });
      expect(JSON.stringify(participantTokenStatus())).not.toContain(
        "test-secret",
      );
    });

    it("honours only the explicit opt-out PARTICIPANT_TOKEN_ENFORCE=false", () => {
      vi.stubEnv("PARTICIPANT_TOKEN_SECRET", "test-secret");
      vi.spyOn(console, "warn").mockImplementation(() => undefined);
      vi.stubEnv("PARTICIPANT_TOKEN_ENFORCE", "false");
      expect(isParticipantTokenEnforced()).toBe(false);
      // Any other value (including the old "true") is not an opt-out.
      vi.stubEnv("PARTICIPANT_TOKEN_ENFORCE", "true");
      expect(isParticipantTokenEnforced()).toBe(true);
      vi.stubEnv("PARTICIPANT_TOKEN_ENFORCE", "0");
      expect(isParticipantTokenEnforced()).toBe(true);
    });
  });
});
