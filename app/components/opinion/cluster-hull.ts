// クラスタ領域(blob)を描くための純粋幾何ヘルパ。
// TopicMap(論点マップ)と ReportMap(じぶんレポート地図)の2つの scatter view が
// 共有する single source。描画状態には触れない純関数のみ (storage/processing 分離)。

export type Pt = { x: number; y: number };

export const centroidOf = (pts: readonly Pt[]): Pt => {
  let x = 0;
  let y = 0;
  for (const p of pts) {
    x += p.x;
    y += p.y;
  }
  return { x: x / pts.length, y: y / pts.length };
};

const cross = (o: Pt, a: Pt, b: Pt): number =>
  (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

// Andrew monotone-chain。反時計回りの凸包頂点列を返す。
export const convexHull = (points: readonly Pt[]): Pt[] => {
  const pts = [...points].sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));
  if (pts.length <= 2) return pts;
  const lower: Pt[] = [];
  for (const p of pts) {
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0
    )
      lower.pop();
    lower.push(p);
  }
  const upper: Pt[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (
      upper.length >= 2 &&
      cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0
    )
      upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
};

// 凸包を重心方向の外側へ pad だけ膨らませる。
export const padHull = (hull: readonly Pt[], pad: number): Pt[] => {
  const c = centroidOf(hull);
  return hull.map((p) => {
    const dx = p.x - c.x;
    const dy = p.y - c.y;
    const len = Math.hypot(dx, dy) || 1;
    return { x: p.x + (dx / len) * pad, y: p.y + (dy / len) * pad };
  });
};

// Closed Catmull-Rom → cubic Bézier。角ばった凸包を有機的な「雲(blob)」に。
export const smoothClosedPath = (pts: readonly Pt[]): string => {
  const n = pts.length;
  if (n < 3) return "";
  const at = (i: number) => pts[((i % n) + n) % n];
  let d = `M ${at(0).x.toFixed(1)} ${at(0).y.toFixed(1)}`;
  for (let i = 0; i < n; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return `${d} Z`;
};

export type Region =
  | { kind: "path"; d: string }
  | { kind: "circle"; cx: number; cy: number; r: number };

// メンバー点(画面座標)群 -> 領域。3点以上は smoothed 凸包、それ未満は円で退避。
export const regionOf = (members: readonly Pt[], pad: number): Region => {
  if (members.length >= 3) {
    const hull = convexHull(members);
    if (hull.length >= 3) {
      return { kind: "path", d: smoothClosedPath(padHull(hull, pad)) };
    }
  }
  const c = centroidOf(members);
  const far =
    Math.max(0, ...members.map((m) => Math.hypot(m.x - c.x, m.y - c.y))) + pad;
  return { kind: "circle", cx: c.x, cy: c.y, r: far };
};
