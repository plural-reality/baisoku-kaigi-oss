// Pure layout/derivation logic for the 合意度マップ (consensus beeswarm).
// Kept free of React/JSX so it stays unit-testable in isolation (logic vs.
// rendering). One dot == one statement, positioned along a 全員反対↔全員賛成
// axis by agree rate, sized by how many people answered. Faithful to the
// civic-report BeeswarmChart definition: agreeRate = agree / (agree+disagree),
// わからない(=pass) is excluded from positioning.

// Minimal statement shape shared by the admin + print pages. Both pass their
// richer StatementWithStats objects (structurally compatible).
export interface BeeswarmStatementInput {
  id: string;
  text: string;
  responses: {
    counts: {
      strongYes: number;
      yes: number;
      dontKnow: number;
      no: number;
      strongNo: number;
    };
    totalCount: number;
  };
}

export interface BeeswarmDatum {
  id: string;
  text: string;
  agreeCount: number;
  disagreeCount: number;
  dontKnowCount: number;
  // Total responses incl. わからない — drives dot size and the low-response filter.
  responseCount: number;
  // agree + disagree — the denominator of agreeRate.
  voteCount: number;
  // null when nobody picked agree/disagree (no consensus signal → unplaceable).
  agreeRate: number | null;
}

export interface PlacedDot {
  datum: BeeswarmDatum;
  x: number;
  y: number;
  r: number;
}

export interface LayoutOptions {
  width: number;
  height: number;
  padX: number;
  minR: number;
  maxR: number;
}

export const toDatum = (s: BeeswarmStatementInput): BeeswarmDatum => {
  const c = s.responses.counts;
  const agreeCount = c.yes + c.strongYes;
  const disagreeCount = c.no + c.strongNo;
  const voteCount = agreeCount + disagreeCount;
  return {
    id: s.id,
    text: s.text,
    agreeCount,
    disagreeCount,
    dontKnowCount: c.dontKnow,
    responseCount: s.responses.totalCount,
    voteCount,
    agreeRate: voteCount > 0 ? agreeCount / voteCount : null,
  };
};

// civic-report palette (red → amber → lime → green by agree rate).
export const dotColor = (agreeRate: number): string =>
  agreeRate >= 0.7
    ? "#68cd52"
    : agreeRate >= 0.5
      ? "#a8c44b"
      : agreeRate >= 0.3
        ? "#d4a643"
        : "#e04e4e";

// Statements that can be placed on the axis (have at least one 賛否 vote).
export const placeableData = (data: BeeswarmDatum[]): BeeswarmDatum[] =>
  data.filter((d) => d.agreeRate !== null);

// Beeswarm packing: x = agree rate, r ∝ √(responses) so heavily-answered
// statements read as bigger/heavier. Statements that share an agree rate form
// one vertical column, stacked SYMMETRICALLY around the centre line so the swarm
// sits on the axis (no upward drift); the heaviest dot anchors the column centre.
export const layoutBeeswarm = (
  data: BeeswarmDatum[],
  opts: LayoutOptions,
): PlacedDot[] => {
  const placeable = placeableData(data);
  if (placeable.length === 0) return [];

  // Size by 賛否 votes (what x actually depends on), so a dot's visual weight
  // matches how many people took a side — not how many merely responded.
  const maxVotes = Math.max(1, ...placeable.map((d) => d.voteCount));
  const radiusFor = (d: BeeswarmDatum) =>
    opts.minR + (opts.maxR - opts.minR) * Math.sqrt(d.voteCount / maxVotes);
  const xFor = (rate: number) =>
    opts.padX + rate * (opts.width - 2 * opts.padX);

  const midY = opts.height / 2;
  const gap = 2;

  // Group dots by their (rounded) x so identical agree rates share a column.
  // ponytail: distinct-but-near agree rates can still visually touch; acceptable
  // for the small statement counts here — upgrade to global packing if it bites.
  const columns = new Map<string, BeeswarmDatum[]>();
  for (const d of placeable) {
    const key = xFor(d.agreeRate as number).toFixed(3);
    const col = columns.get(key);
    if (col) col.push(d);
    else columns.set(key, [d]);
  }

  const placed: PlacedDot[] = [];
  for (const [key, group] of columns) {
    const x = Number(key);
    // Largest first, assigned to centre-out slots ({0, -1, +1, -2, +2, …} for
    // odd counts; straddling {-0.5, +0.5, …} for even) so the column's mean y is
    // exactly the centre line.
    const sorted = [...group].sort(
      (a, b) => b.responseCount - a.responseCount || a.id.localeCompare(b.id),
    );
    const n = sorted.length;
    const colMaxR = Math.max(...sorted.map(radiusFor));
    const pitch = 2 * colMaxR + gap;
    const centeredSlots = Array.from({ length: n }, (_, k) => k - (n - 1) / 2);
    const centerOut = centeredSlots.sort(
      (a, b) => Math.abs(a) - Math.abs(b) || a - b,
    );
    sorted.forEach((d, i) => {
      placed.push({
        datum: d,
        x,
        y: midY + centerOut[i] * pitch,
        r: radiusFor(d),
      });
    });
  }
  return placed;
};
