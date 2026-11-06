import { describe, expect, it } from "vitest";

import {
  extractPoles,
  kmeans2d,
  layoutFromVectors,
  pca2,
} from "../report-map-compute";

// 決定論的な擬似乱数(テスト内でのみ使用・シード固定)。
const prng = (seed: number): (() => number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

// dim 次元・count 個のブロブを center 周りに small ノイズで生成。
const blob = (center: number[], count: number, rng: () => number): number[][] =>
  Array.from({ length: count }, () =>
    center.map((c) => c + (rng() - 0.5) * 0.2),
  );

const DIM = 48;
const makeCenters = (rng: () => number, n: number): number[][] =>
  Array.from({ length: n }, () =>
    Array.from({ length: DIM }, () => (rng() - 0.5) * 6),
  );

describe("pca2", () => {
  it("returns n×2 coords and descending, bounded variance ratios", () => {
    const rng = prng(7);
    const centers = makeCenters(rng, 2);
    const vectors = [
      ...blob(centers[0], 20, rng),
      ...blob(centers[1], 20, rng),
    ];
    const { coords, variance } = pca2(vectors);

    expect(coords).toHaveLength(40);
    expect(coords[0]).toHaveLength(2);
    expect(variance[0]).toBeGreaterThanOrEqual(variance[1]);
    expect(variance[1]).toBeGreaterThanOrEqual(0);
    expect(variance[0] + variance[1]).toBeLessThanOrEqual(1 + 1e-9);
    // 2 つの離れたブロブなら PC1 が支配的(大半の分散を説明)。
    expect(variance[0]).toBeGreaterThan(0.5);
  });
});

describe("kmeans2d", () => {
  it("separates two well-separated groups deterministically", () => {
    const coordsA: [number, number][] = Array.from(
      { length: 15 },
      (_, i): [number, number] => [i * 0.01, 0],
    );
    const coordsB: [number, number][] = Array.from(
      { length: 15 },
      (_, i): [number, number] => [10 + i * 0.01, 0],
    );
    const coords = [...coordsA, ...coordsB];
    const labels = kmeans2d(coords, 2);
    // 前半と後半でそれぞれ単一クラスタに割れる。
    expect(new Set(labels.slice(0, 15)).size).toBe(1);
    expect(new Set(labels.slice(15)).size).toBe(1);
    expect(labels[0]).not.toBe(labels[15]);
    // 決定論: 同じ入力で同じラベル。
    expect(kmeans2d(coords, 2)).toEqual(labels);
  });
});

describe("extractPoles", () => {
  it("returns top-k extreme ids per axis, pos/neg disjoint", () => {
    const ids = ["a", "b", "c", "d", "e", "f"];
    const coords: [number, number][] = [
      [-3, 0],
      [-2, 1],
      [-1, 2],
      [1, -2],
      [2, -1],
      [3, 0],
    ];
    const { pc1 } = extractPoles(ids, coords, 2);
    expect(pc1.pos).toEqual(["f", "e"]); // x 最大の2件
    expect(pc1.neg).toEqual(["a", "b"]); // x 最小の2件
    expect(pc1.pos.every((id) => !pc1.neg.includes(id))).toBe(true);
  });
});

describe("layoutFromVectors", () => {
  it("recovers separated blobs into distinct clusters, is deterministic", () => {
    const rng = prng(11);
    // n=135 → k=max(2,min(6,round(135/45)))=3。3 つの離れたブロブを 3 クラスタに。
    const centers = makeCenters(rng, 3);
    const vectors = centers.flatMap((c) => blob(c, 45, rng));
    const ids = vectors.map((_, i) => `id${i}`);

    const out = layoutFromVectors(ids, vectors, "test-model");
    expect(out.points).toHaveLength(135);
    expect(out.method).toBe("pca+kmeans");
    expect(out.model).toBe("test-model");
    expect(out.noiseCount).toBe(0);

    // 各ブロブ(45件ずつ)が主に単一クラスタに入る(純度が高い)。
    const purity = (start: number): number => {
      const labels = out.points.slice(start, start + 45).map((p) => p.cluster);
      const counts = labels.reduce<Record<number, number>>((acc, l) => {
        acc[l] = (acc[l] ?? 0) + 1;
        return acc;
      }, {});
      return Math.max(...Object.values(counts)) / 45;
    };
    expect(purity(0)).toBeGreaterThan(0.9);
    expect(purity(45)).toBeGreaterThan(0.9);
    expect(purity(90)).toBeGreaterThan(0.9);

    // 決定論: 同じ入力で同じ座標・ラベル。
    const again = layoutFromVectors(ids, vectors, "test-model");
    expect(again.points).toEqual(out.points);
  });
});
