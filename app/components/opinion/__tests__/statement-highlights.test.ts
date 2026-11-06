import { describe, expect, it } from "vitest";

import {
  buildStatementHighlights,
  type StatementHighlightSource,
} from "../statement-highlights";

interface TestStatement extends StatementHighlightSource {
  id: string;
  text: string;
}

const statement = (
  id: string,
  counts: StatementHighlightSource["responses"]["counts"],
): TestStatement => ({
  id,
  text: id,
  responses: {
    counts,
    totalCount:
      counts.strongYes +
      counts.yes +
      counts.dontKnow +
      counts.no +
      counts.strongNo,
  },
});

describe("buildStatementHighlights", () => {
  it("keeps the existing conflict and dont-know rankings", () => {
    const highlights = buildStatementHighlights([
      statement("split", {
        strongYes: 0,
        yes: 4,
        dontKnow: 0,
        no: 4,
        strongNo: 0,
      }),
      statement("unsure", {
        strongYes: 0,
        yes: 1,
        dontKnow: 7,
        no: 0,
        strongNo: 0,
      }),
      statement("consensus", {
        strongYes: 0,
        yes: 9,
        dontKnow: 0,
        no: 0,
        strongNo: 0,
      }),
    ]);

    expect(highlights.conflict[0].statement.id).toBe("split");
    expect(highlights.dontKnow[0].statement.id).toBe("unsure");
    expect(highlights.consensus[0].statement.id).toBe("consensus");
  });

  it("returns empty groups for no statements", () => {
    expect(buildStatementHighlights([])).toEqual({
      conflict: [],
      consensus: [],
      dontKnow: [],
    });
  });
});
