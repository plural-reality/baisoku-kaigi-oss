export type SessionFacilitatorFields = Readonly<{
  context: string;
  goal: string;
  facilitator_context?: string | null;
  facilitator_goal?: string | null;
}>;

export type SessionAdminContextFields = Readonly<{
  context: string | null;
  goal: string | null;
  facilitator_context?: string | null;
  facilitator_goal?: string | null;
}>;

export type SessionParticipantContextFields = Readonly<{
  context: string | null;
  goal: string | null;
  facilitator_context?: string | null;
  facilitator_goal?: string | null;
}>;

export type AdminSessionContextFields = Readonly<{
  context: string;
  goal: string;
  facilitatorContext: string;
  facilitatorGoal: string;
}>;

export type ParticipantSessionContextFields = Readonly<{
  context: string;
  goal: string;
}>;

const normalizedText = (value: string | null | undefined) =>
  value?.trim() ?? "";

const hasText = (value: string | null | undefined) =>
  normalizedText(value).length > 0;

const visibleOrFallback = (
  value: string | null | undefined,
  fallback: string,
) => normalizedText(value) || fallback;

export const sessionFacilitatorGoal = (
  session: SessionFacilitatorFields,
): string => visibleOrFallback(session.facilitator_goal, session.goal);

export const sessionFacilitatorContext = (
  session: SessionFacilitatorFields,
): string => visibleOrFallback(session.facilitator_context, session.context);

export const sessionParticipantContextFields = (
  session: SessionParticipantContextFields,
): ParticipantSessionContextFields => ({
  context: visibleOrFallback(
    session.context,
    session.facilitator_context ?? "",
  ),
  goal: visibleOrFallback(session.goal, session.facilitator_goal ?? ""),
});

export const sessionAdminContextFields = (
  session: SessionAdminContextFields,
): AdminSessionContextFields => {
  const legacyPublicOnly =
    !hasText(session.facilitator_goal) &&
    !hasText(session.facilitator_context) &&
    (hasText(session.goal) || hasText(session.context));

  return {
    context: legacyPublicOnly ? "" : (session.context ?? ""),
    goal: legacyPublicOnly ? "" : (session.goal ?? ""),
    facilitatorContext: legacyPublicOnly
      ? (session.context ?? "")
      : (session.facilitator_context ?? ""),
    facilitatorGoal: legacyPublicOnly
      ? (session.goal ?? "")
      : (session.facilitator_goal ?? ""),
  };
};
