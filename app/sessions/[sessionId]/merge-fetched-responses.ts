import type { ParticipantResponse } from "./response-item";

// The response list is fetched once after joining. A participant can answer
// while that request is in flight, and its result (read before the answer was
// saved) must not erase the answer already shown. Answers recorded locally at
// or after `fetchStartedAt` win over the fetched row for the same statement.
export const mergeFetchedResponses = (
  fetched: readonly ParticipantResponse[],
  local: readonly ParticipantResponse[],
  fetchStartedAt: number,
): ParticipantResponse[] => {
  const answeredDuringFetch = local.filter(
    (response) => new Date(response.createdAt).getTime() >= fetchStartedAt,
  );
  const overridden = new Set(
    answeredDuringFetch.map((response) => response.statementId),
  );
  return [
    ...answeredDuringFetch,
    ...fetched.filter((response) => !overridden.has(response.statementId)),
  ];
};
