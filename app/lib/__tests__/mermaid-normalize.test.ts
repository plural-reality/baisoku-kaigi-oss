// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { normalizeMermaid } from "../mermaid-normalize";

// Riverside Park サンプルの英語レポートで描画されずソース表示になったブロック。
// quadrant-1 / quadrant-4 の素の `(` `)` が mermaid の字句解析で落ちていた。
const RIVERSIDE_PARK_CHART = `quadrantChart
  title Consensus vs. Controversy Mapping
  x-axis Low Polarization --> High Polarization
  y-axis Low Support --> High Support
  quadrant-1 Unifying Wins (Action First)
  quadrant-2 High Reward / High Conflict
  quadrant-3 Low Support / Divisive
  quadrant-4 Broad Rejection (Drop)
  "#16 Public Restrooms": [0.1, 0.95]
  "#8 Bright Lighting": [0.2, 0.85]
  "#7 Fenced Dog Area": [0.25, 0.8]
  "#10 Paved Paths": [0.3, 0.75]
  "#11 Vendors Allowed": [0.65, 0.65]
  "#6 Event Lawn/Stage": [0.85, 0.55]
  "#3 Expand Car Park": [0.75, 0.5]
  "#2 Playground vs Wetland": [0.9, 0.45]
  "#12 Peaceful Sanctuary": [0.8, 0.45]
  "#13 Delay Play for Flood": [0.85, 0.35]
  "#4 Paid Parking": [0.4, 0.2]`;

const parse = async (chart: string): Promise<boolean> => {
  const mermaid = (await import("mermaid")).default;
  mermaid.initialize({ startOnLoad: false, securityLevel: "strict" });
  return mermaid.parse(chart, { suppressErrors: true }).then(Boolean);
};

describe("normalizeMermaid", () => {
  it("quotes bare quadrant and axis labels in a quadrantChart", () => {
    const out = normalizeMermaid(RIVERSIDE_PARK_CHART).split("\n");
    expect(out).toContain('  quadrant-1 "Unifying Wins (Action First)"');
    expect(out).toContain('  quadrant-4 "Broad Rejection (Drop)"');
    expect(out).toContain(
      '  x-axis "Low Polarization" --> "High Polarization"',
    );
    expect(out).toContain('  y-axis "Low Support" --> "High Support"');
  });

  it("leaves title, points and already-quoted labels untouched", () => {
    const out = normalizeMermaid(RIVERSIDE_PARK_CHART).split("\n");
    expect(out).toContain("  title Consensus vs. Controversy Mapping");
    expect(out).toContain('  "#6 Event Lawn/Stage": [0.85, 0.55]');
    const quoted =
      'quadrantChart\n  quadrant-1 "a (b)"\n  x-axis "lo" --> "hi"';
    expect(normalizeMermaid(quoted)).toBe(quoted);
  });

  it("handles one-sided axes and inner double quotes", () => {
    const out = normalizeMermaid(
      'quadrantChart\n  x-axis Low (a)\n  y-axis Low -->\n  quadrant-2 say "hi": now',
    );
    expect(out).toBe(
      'quadrantChart\n  x-axis "Low (a)"\n  y-axis "Low" -->\n  quadrant-2 "say \'hi\': now"',
    );
  });

  it("does not split an axis on --> inside a quoted label", () => {
    const chart = 'quadrantChart\n  x-axis "Current --> target" --> Future';
    expect(normalizeMermaid(chart)).toBe(
      'quadrantChart\n  x-axis "Current --> target" --> "Future"',
    );
  });

  it("does not touch other diagram types", () => {
    const graph = "graph LR\n  quadrant-1 (x) --> B";
    expect(normalizeMermaid(graph)).toBe(graph);
  });

  // 実際の mermaid パーサで、元ブロックは落ち、正規化後は通ることを確かめる。
  it("makes the Riverside Park report chart parse with the bundled mermaid", {
    timeout: 120_000,
  }, async () => {
    expect(await parse(RIVERSIDE_PARK_CHART)).toBe(false);
    expect(await parse(normalizeMermaid(RIVERSIDE_PARK_CHART))).toBe(true);
  });
});
