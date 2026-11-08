import { describe, expect, it } from "vitest";
import { mergeFetchedResponses } from "../merge-fetched-responses";
import type { ParticipantResponse } from "../response-item";

const FETCH_STARTED_AT = Date.parse("2026-11-08T00:00:10Z");

const response = (
  statementId: string,
  createdAt: string,
  value: ParticipantResponse["value"] = 1,
): ParticipantResponse => ({
  statementId,
  statementText: `text-${statementId}`,
  orderIndex: 0,
  responseType: "scale",
  value,
  createdAt,
});

const ids = (items: ParticipantResponse[]) =>
  items.map((item) => item.statementId).sort();

describe("mergeFetchedResponses", () => {
  it("keeps an answer given while the fetch was in flight", () => {
    const local = [response("q1", "2026-11-08T00:00:11Z")];
    expect(ids(mergeFetchedResponses([], local, FETCH_STARTED_AT))).toEqual([
      "q1",
    ]);
  });

  it("lets the newer local answer win over the fetched row", () => {
    const fetched = [response("q1", "2026-11-08T00:00:05Z", -1)];
    const local = [response("q1", "2026-11-08T00:00:11Z", 2)];
    const merged = mergeFetchedResponses(fetched, local, FETCH_STARTED_AT);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.value).toBe(2);
  });

  it("replaces state that predates the fetch with the server's rows", () => {
    const fetched = [response("q2", "2026-11-08T00:00:05Z")];
    const local = [response("q1", "2026-11-08T00:00:01Z")];
    expect(
      ids(mergeFetchedResponses(fetched, local, FETCH_STARTED_AT)),
    ).toEqual(["q2"]);
  });

  it("returns the fetched rows as they are when nothing was answered", () => {
    const fetched = [
      response("q1", "2026-11-08T00:00:01Z"),
      response("q2", "2026-11-08T00:00:02Z"),
    ];
    expect(mergeFetchedResponses(fetched, [], FETCH_STARTED_AT)).toEqual(
      fetched,
    );
  });
});
