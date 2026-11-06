// じぶんレポート地図の座標計算(旧 scripts/topic_map.py の PCA 経路の TS 移植)。
//
// 本番ランタイムに Python(uv/torch) を置かないための純関数レイヤ。埋め込みベクトル
// (embeddings.ts が API で取得) を入力に、PCA(2) で「軸に意味を持たせた」座標を作り、
// 決定論的 k-means でクラスタ化する。UMAP/EVoC(論点マップ側)は移植しない。
//
// PCA は n(参加者数) << d(埋め込み次元) なので、d×d 共分散ではなく n×n グラム行列の
// 上位2固有対をべき乗法で解く(dual PCA)。座標 = U[:,:2]·S[:2]、寄与率 = λ_k / trace。
// 数値カーネル(行列積・反復)は for ループで書く(この用途では最も明快で速い)。

export interface LayoutPoint {
  id: string;
  x: number;
  y: number;
  cluster: number;
}

export interface AxisEnds {
  pos: string[];
  neg: string[];
}

export interface LayoutResult {
  points: LayoutPoint[];
  method: string;
  model: string;
  noiseCount: number;
  variance: [number, number];
  axes: { pc1: AxisEnds; pc2: AxisEnds };
}

// 決定論的 PRNG(mulberry32)。k-means++ の初期化を固定シードで再現可能にする。
const mulberry32 = (seed: number): (() => number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const l2normalize = (v: readonly number[]): number[] => {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i] * v[i];
  const inv = 1 / (Math.sqrt(s) + 1e-9);
  return v.map((x) => x * inv);
};

// 中心化した行の n×n グラム行列 G[i][j] = <c_i, c_j> と trace(=総分散) を返す。
const centeredGram = (
  vectors: readonly (readonly number[])[],
): { gram: number[][]; trace: number } => {
  const n = vectors.length;
  const d = vectors[0].length;
  const mean = new Array<number>(d).fill(0);
  for (let i = 0; i < n; i++)
    for (let j = 0; j < d; j++) mean[j] += vectors[i][j];
  for (let j = 0; j < d; j++) mean[j] /= n;

  const centered = vectors.map((v) => v.map((x, j) => x - mean[j]));
  const gram = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  let trace = 0;
  for (let i = 0; i < n; i++) {
    for (let k = i; k < n; k++) {
      let dot = 0;
      for (let j = 0; j < d; j++) dot += centered[i][j] * centered[k][j];
      gram[i][k] = dot;
      gram[k][i] = dot;
    }
    trace += gram[i][i];
  }
  return { gram, trace };
};

// 対称行列 M の最大固有対をべき乗法で。シード固定の初期ベクトルで決定論的。
const topEigenpair = (
  m: readonly number[][],
  seed: number,
): { value: number; vector: number[] } => {
  const n = m.length;
  const rng = mulberry32(seed);
  let v = Array.from({ length: n }, () => rng() - 0.5);
  const norm = (x: number[]): number[] => {
    let s = 0;
    for (let i = 0; i < n; i++) s += x[i] * x[i];
    const inv = 1 / (Math.sqrt(s) + 1e-12);
    return x.map((y) => y * inv);
  };
  v = norm(v);
  let value = 0;
  for (let iter = 0; iter < 300; iter++) {
    const mv = new Array<number>(n).fill(0);
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let j = 0; j < n; j++) s += m[i][j] * v[j];
      mv[i] = s;
    }
    const next = norm(mv);
    let dot = 0;
    for (let i = 0; i < n; i++) dot += next[i] * v[i];
    v = next;
    // Rayleigh 商で固有値を推定。連続反復で向きが安定したら停止。
    if (Math.abs(Math.abs(dot) - 1) < 1e-9 && iter > 5) break;
  }
  const mv = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = 0; j < n; j++) s += m[i][j] * v[j];
    mv[i] = s;
  }
  for (let i = 0; i < n; i++) value += v[i] * mv[i];
  return { value, vector: v };
};

// 符号の向きを決定論化(最大絶対成分を正にする)。再計算で極/ラベルがブレないように。
const orient = (v: number[]): number[] => {
  let idx = 0;
  for (let i = 1; i < v.length; i++)
    if (Math.abs(v[i]) > Math.abs(v[idx])) idx = i;
  return v[idx] < 0 ? v.map((x) => -x) : v;
};

// 上位2主成分スコア(座標)と寄与率。グラム行列の上位2固有対から:
// coords[:,k] = U[:,k]*S[k] = eigvec_k * sqrt(eigval_k), variance_k = eigval_k / trace。
export const pca2 = (
  vectors: readonly (readonly number[])[],
): { coords: [number, number][]; variance: [number, number] } => {
  const n = vectors.length;
  const { gram, trace } = centeredGram(vectors);

  const e1 = topEigenpair(gram, 1);
  const u1 = orient(e1.vector);
  const lambda1 = Math.max(0, e1.value);

  // デフレーション: G2 = G - λ1 u1 u1^T の最大固有対 = 元の第2固有対。
  const g2 = gram.map((row, i) =>
    row.map((val, j) => val - lambda1 * u1[i] * u1[j]),
  );
  const e2 = topEigenpair(g2, 2);
  const u2 = orient(e2.vector);
  const lambda2 = Math.max(0, e2.value);

  const s1 = Math.sqrt(lambda1);
  const s2 = Math.sqrt(lambda2);
  const coords = Array.from({ length: n }, (_, i): [number, number] => [
    u1[i] * s1,
    u2[i] * s2,
  ]);
  const total = trace || 1;
  return { coords, variance: [lambda1 / total, lambda2 / total] };
};

const dist2 = (a: readonly number[], b: readonly number[]): number =>
  (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;

// 2D 座標上の決定論的 k-means(k-means++ 初期化・固定シード)。ノイズ(-1)は作らない。
export const kmeans2d = (
  coords: readonly [number, number][],
  k: number,
): number[] => {
  const n = coords.length;
  const effK = Math.max(2, Math.min(k, n));
  const rng = mulberry32(42);

  // k-means++ による初期中心選び。
  const centers: [number, number][] = [coords[Math.floor(rng() * n)]];
  while (centers.length < effK) {
    const d2 = coords.map((p) => Math.min(...centers.map((c) => dist2(p, c))));
    const sum = d2.reduce((s, x) => s + x, 0) || 1;
    let r = rng() * sum;
    let pick = n - 1;
    for (let i = 0; i < n; i++) {
      r -= d2[i];
      if (r <= 0) {
        pick = i;
        break;
      }
    }
    centers.push(coords[pick]);
  }

  const labels = new Array<number>(n).fill(0);
  for (let iter = 0; iter < 50; iter++) {
    let moved = false;
    for (let i = 0; i < n; i++) {
      let best = 0;
      let bestD = Number.POSITIVE_INFINITY;
      for (let c = 0; c < effK; c++) {
        const dd = dist2(coords[i], centers[c]);
        if (dd < bestD) {
          bestD = dd;
          best = c;
        }
      }
      if (labels[i] !== best) {
        labels[i] = best;
        moved = true;
      }
    }
    const sums = Array.from({ length: effK }, () => [0, 0, 0]); // x, y, count
    for (let i = 0; i < n; i++) {
      const c = labels[i];
      sums[c][0] += coords[i][0];
      sums[c][1] += coords[i][1];
      sums[c][2] += 1;
    }
    for (let c = 0; c < effK; c++)
      if (sums[c][2] > 0)
        centers[c] = [sums[c][0] / sums[c][2], sums[c][1] / sums[c][2]];
    if (!moved && iter > 0) break;
  }
  return labels;
};

// 各軸(PC1=x, PC2=y)の ± 両端に最も振れたレポート id を top_k 件返す(軸の極の命名素材)。
export const extractPoles = (
  ids: readonly string[],
  coords: readonly [number, number][],
  topK = 4,
): { pc1: AxisEnds; pc2: AxisEnds } => {
  const ends = (axis: 0 | 1): AxisEnds => {
    const order = ids
      .map((_, i) => i)
      .sort((a, b) => coords[a][axis] - coords[b][axis]);
    return {
      neg: order.slice(0, topK).map((i) => ids[i]),
      pos: order
        .slice(-topK)
        .reverse()
        .map((i) => ids[i]),
    };
  };
  return { pc1: ends(0), pc2: ends(1) };
};

// 埋め込みベクトル -> 地図レイアウト(旧 topic_map.py の pca 経路の出力形に合わせる)。
export const layoutFromVectors = (
  ids: readonly string[],
  vectors: readonly (readonly number[])[],
  model: string,
): LayoutResult => {
  const normalized = vectors.map((v) => l2normalize(v));
  const { coords, variance } = pca2(normalized);
  const k = Math.max(2, Math.min(6, Math.round(ids.length / 45)));
  const labels = kmeans2d(coords, k);
  return {
    points: ids.map((id, i) => ({
      id,
      x: coords[i][0],
      y: coords[i][1],
      cluster: labels[i],
    })),
    method: "pca+kmeans",
    model,
    noiseCount: 0,
    variance,
    axes: extractPoles(ids, coords),
  };
};
