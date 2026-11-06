import { describe, expect, it } from "vitest";
import {
  sessionAdminContextFields,
  sessionFacilitatorContext,
  sessionFacilitatorGoal,
  sessionParticipantContextFields,
} from "../session-context";

describe("session context field projection", () => {
  it("uses facilitator fields as the canonical AI context", () => {
    const session = {
      goal: "参加者向け目的",
      context: "参加者向け背景",
      facilitator_goal: "本題の目的",
      facilitator_context: "本題の背景",
    };

    expect(sessionFacilitatorGoal(session)).toBe("本題の目的");
    expect(sessionFacilitatorContext(session)).toBe("本題の背景");
  });

  it("falls back to public fields for AI when facilitator fields are missing", () => {
    const session = {
      goal: "旧形式の目的",
      context: "旧形式の背景",
      facilitator_goal: null,
      facilitator_context: null,
    };

    expect(sessionFacilitatorGoal(session)).toBe("旧形式の目的");
    expect(sessionFacilitatorContext(session)).toBe("旧形式の背景");
  });

  it("projects legacy public-only admin rows as 本題 with empty participant override", () => {
    expect(
      sessionAdminContextFields({
        goal: "旧形式の目的",
        context: "旧形式の背景",
        facilitator_goal: null,
        facilitator_context: null,
      }),
    ).toEqual({
      goal: "",
      context: "",
      facilitatorGoal: "旧形式の目的",
      facilitatorContext: "旧形式の背景",
    });
  });

  it("projects participant-visible fields from override or 本題 fallback", () => {
    expect(
      sessionParticipantContextFields({
        goal: "",
        context: "",
        facilitator_goal: "本題の目的",
        facilitator_context: "本題の背景",
      }),
    ).toEqual({
      goal: "本題の目的",
      context: "本題の背景",
    });

    expect(
      sessionParticipantContextFields({
        goal: "参加者向け目的",
        context: "参加者向け背景",
        facilitator_goal: "本題の目的",
        facilitator_context: "本題の背景",
      }),
    ).toEqual({
      goal: "参加者向け目的",
      context: "参加者向け背景",
    });
  });

  it("preserves partially split admin rows", () => {
    expect(
      sessionAdminContextFields({
        goal: "参加者向け目的",
        context: "参加者向け背景",
        facilitator_goal: "本題の目的",
        facilitator_context: "",
      }),
    ).toEqual({
      goal: "参加者向け目的",
      context: "参加者向け背景",
      facilitatorGoal: "本題の目的",
      facilitatorContext: "",
    });
  });
});
