import { afterEach, describe, expect, it, vi } from "vitest";
import {
  aliasEventPayload,
  aliasNullableUserId,
  aliasUserId,
} from "../user-alias";

const USER = "550e8400-e29b-41d4-a716-446655440000";

afterEach(() => {
  vi.unstubAllEnvs();
});

// Audit 2026-10-06 H2: admin responses must not disclose user UUIDs.
describe("user-alias", () => {
  it("never contains the UUID and is not UUID-shaped", () => {
    vi.stubEnv("PARTICIPANT_TOKEN_SECRET", "s");
    const alias = aliasUserId("session-1", USER);
    expect(alias).toMatch(/^u_[A-Za-z0-9_-]{22}$/);
    expect(alias).not.toContain(USER);
    expect(alias).not.toContain(USER.slice(0, 8));
  });

  it("is deterministic for the same (secret, session, user)", () => {
    vi.stubEnv("PARTICIPANT_TOKEN_SECRET", "s");
    expect(aliasUserId("session-1", USER)).toBe(aliasUserId("session-1", USER));
  });

  it("differs per session (no cross-session tracking) and per user", () => {
    vi.stubEnv("PARTICIPANT_TOKEN_SECRET", "s");
    expect(aliasUserId("session-1", USER)).not.toBe(
      aliasUserId("session-2", USER),
    );
    expect(aliasUserId("session-1", USER)).not.toBe(
      aliasUserId("session-1", "660e8400-e29b-41d4-a716-446655440000"),
    );
  });

  it("differs per secret (cannot be precomputed without it)", () => {
    vi.stubEnv("PARTICIPANT_TOKEN_SECRET", "secret-a");
    const a = aliasUserId("session-1", USER);
    vi.stubEnv("PARTICIPANT_TOKEN_SECRET", "secret-b");
    expect(aliasUserId("session-1", USER)).not.toBe(a);
  });

  it("prefers USER_ALIAS_SECRET over the participant-token secret", () => {
    vi.stubEnv("PARTICIPANT_TOKEN_SECRET", "s");
    const fromTokenSecret = aliasUserId("session-1", USER);
    vi.stubEnv("USER_ALIAS_SECRET", "dedicated");
    expect(aliasUserId("session-1", USER)).not.toBe(fromTokenSecret);
  });

  it("still aliases (stably within the process) when no secret is configured", () => {
    const a = aliasUserId("session-1", USER);
    expect(a).toMatch(/^u_/);
    expect(a).not.toContain(USER);
    expect(aliasUserId("session-1", USER)).toBe(a);
  });

  it("aliases participant ids inside event payload metadata, leaving the rest intact", () => {
    vi.stubEnv("PARTICIPANT_TOKEN_SECRET", "s");
    const payload = {
      markdown: "text",
      metadata: {
        kind: "participant_reflection",
        source: "participant",
        participantUserId: USER,
      },
    };
    const out = aliasEventPayload("session-1", payload);
    expect(out.markdown).toBe("text");
    expect((out.metadata as Record<string, unknown>).kind).toBe(
      "participant_reflection",
    );
    expect((out.metadata as Record<string, unknown>).participantUserId).toBe(
      aliasUserId("session-1", USER),
    );
    // Input is not mutated.
    expect(payload.metadata.participantUserId).toBe(USER);
    // Payloads without metadata / without ids are returned as-is.
    expect(aliasEventPayload("session-1", { markdown: "x" })).toEqual({
      markdown: "x",
    });
    expect(
      aliasEventPayload("session-1", { metadata: { source: "admin_console" } }),
    ).toEqual({ metadata: { source: "admin_console" } });
  });

  it("passes null / undefined through", () => {
    expect(aliasNullableUserId("session-1", null)).toBeNull();
    expect(aliasNullableUserId("session-1", undefined)).toBeNull();
    expect(aliasNullableUserId("session-1", USER)).toBe(
      aliasUserId("session-1", USER),
    );
  });
});
