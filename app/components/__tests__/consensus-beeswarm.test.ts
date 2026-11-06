import { describe, expect, it } from "vitest";

import {
  type BeeswarmStatementInput,
  dotColor,
  layoutBeeswarm,
  placeableData,
  toDatum,
} from "../consensus-beeswarm-layout";

const stmt = (
  id: string,
  counts: Partial<BeeswarmStatementInput["responses"]["counts"]>,
): BeeswarmStatementInput => {
  const c = {
    strongYes: 0,
    yes: 0,
    dontKnow: 0,
    no: 0,
    strongNo: 0,
    ...counts,
  };
  return {
    id,
    text: `statement ${id}`,
    responses: {
      counts: c,
      totalCount: c.strongYes + c.yes + c.dontKnow + c.no + c.strongNo,
    },
  };
};

describe("toDatum", () => {
  it("agreeRate excludes わからない (agree / (agree+disagree))", () => {
    // 3 agree, 26 disagree → 3/29, matching civic-report semantics.
    const d = toDatum(stmt("a", { yes: 3, no: 26 }));
    expect(d.agreeRate).toBeCloseTo(3 / 29, 6);
    expect(d.voteCount).toBe(29);
    expect(d.responseCount).toBe(29);
  });

  it("folds strong votes into agree/disagree and keeps わからない separate", () => {
    const d = toDatum(stmt("b", { strongYes: 2, yes: 1, no: 1, dontKnow: 4 }));
    expect(d.agreeCount).toBe(3);
    expect(d.disagreeCount).toBe(1);
    expect(d.dontKnowCount).toBe(4);
    expect(d.voteCount).toBe(4);
    expect(d.responseCount).toBe(8);
    expect(d.agreeRate).toBeCloseTo(0.75, 6);
  });

  it("agreeRate is null when there is no 賛否 vote (only わからない)", () => {
    const d = toDatum(stmt("c", { dontKnow: 5 }));
    expect(d.agreeRate).toBeNull();
  });
});

describe("dotColor", () => {
  it("maps agree rate to the civic-report red→green palette", () => {
    expect(dotColor(0)).toBe("#e04e4e");
    expect(dotColor(0.29)).toBe("#e04e4e");
    expect(dotColor(0.3)).toBe("#d4a643");
    expect(dotColor(0.5)).toBe("#a8c44b");
    expect(dotColor(0.7)).toBe("#68cd52");
    expect(dotColor(1)).toBe("#68cd52");
  });
});

describe("placeableData", () => {
  it("drops statements with no 賛否 signal", () => {
    const data = [
      stmt("yes", { yes: 1, no: 1 }),
      stmt("dk", { dontKnow: 3 }),
    ].map(toDatum);
    expect(placeableData(data).map((d) => d.id)).toEqual(["yes"]);
  });
});

describe("layoutBeeswarm", () => {
  const opts = { width: 600, height: 176, padX: 44, minR: 3.5, maxR: 9 };

  it("places every placeable statement and skips unplaceable ones", () => {
    const data = [
      stmt("a", { yes: 5, no: 1 }),
      stmt("b", { dontKnow: 3 }),
      stmt("c", { strongNo: 4, no: 2 }),
    ].map(toDatum);
    const placed = layoutBeeswarm(data, opts);
    expect(placed.map((p) => p.datum.id).sort()).toEqual(["a", "c"]);
  });

  it("positions x by agree rate within the padded axis", () => {
    const allAgree = layoutBeeswarm([toDatum(stmt("hi", { yes: 10 }))], opts);
    const allDisagree = layoutBeeswarm([toDatum(stmt("lo", { no: 10 }))], opts);
    expect(allAgree[0].x).toBeCloseTo(opts.width - opts.padX, 6); // rate 1 → right
    expect(allDisagree[0].x).toBeCloseTo(opts.padX, 6); // rate 0 → left
  });

  it("sizes dots by 賛否 votes, not total responses", () => {
    // Same total (30) but very different vote counts → bigger dot for more votes.
    const placed = layoutBeeswarm(
      [
        toDatum(stmt("manyVotes", { yes: 20, no: 10 })),
        toDatum(stmt("fewVotes", { yes: 2, no: 1, dontKnow: 27 })),
      ],
      opts,
    );
    const big = placed.find((p) => p.datum.id === "manyVotes");
    const small = placed.find((p) => p.datum.id === "fewVotes");
    expect(big).toBeDefined();
    expect(small).toBeDefined();
    expect((big as { r: number }).r).toBeGreaterThan(
      (small as { r: number }).r,
    );
  });

  it("centers each column on the axis line (mean y == midY)", () => {
    // 5 statements sharing an agree rate → one column, balanced around midY.
    const data = Array.from({ length: 5 }, (_, i) =>
      toDatum(stmt(`s${i}`, { yes: 3, no: 3 })),
    );
    const placed = layoutBeeswarm(data, opts);
    const meanY = placed.reduce((a, p) => a + p.y, 0) / placed.length;
    expect(meanY).toBeCloseTo(opts.height / 2, 6);
    // and an even column straddles the line (no dot sits exactly on it)
    const even = layoutBeeswarm(
      [
        toDatum(stmt("a", { yes: 2, no: 1 })),
        toDatum(stmt("b", { yes: 2, no: 1 })),
      ],
      opts,
    );
    const mid = opts.height / 2;
    expect(even.every((p) => p.y !== mid)).toBe(true);
    expect((even[0].y + even[1].y) / 2).toBeCloseTo(mid, 6);
  });

  it("never overlaps dots (centers kept >= r1+r2)", () => {
    // Many statements at the same agree rate force vertical stacking.
    const data = Array.from({ length: 12 }, (_, i) =>
      toDatum(stmt(`s${i}`, { yes: 3, no: 3 })),
    );
    const placed = layoutBeeswarm(data, opts);
    expect(placed).toHaveLength(12);
    for (let i = 0; i < placed.length; i += 1) {
      for (let j = i + 1; j < placed.length; j += 1) {
        const a = placed[i];
        const b = placed[j];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        expect(dist).toBeGreaterThanOrEqual(a.r + b.r - 1e-6);
      }
    }
  });
});
