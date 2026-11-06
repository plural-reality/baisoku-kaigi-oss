import { beforeEach, describe, expect, it, vi } from "vitest";

// report-stance は @/lib/llm と @/lib/supabase を読み込む。DB/LLM を叩かないよう両方モック。
vi.mock("@/lib/llm", () => ({
  callLLM: vi.fn(),
  FAST_MODEL: "test-model",
}));

const inMock = vi.fn();
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({ in: inMock })),
    })),
  },
}));

import { readCachedStances, stanceCacheKey } from "../report-stance";

const CONTENT_A = "私は光回線の整備を最優先にしたい。";
const CONTENT_B = "集落機能は中心部へ集約すべきだ。";

describe("stanceCacheKey", () => {
  it("is deterministic and namespaced (キー契約の固定)", () => {
    expect(stanceCacheKey(CONTENT_A)).toBe(stanceCacheKey(CONTENT_A));
    expect(stanceCacheKey(CONTENT_A)).toMatch(
      /^report-stance:v1:[0-9a-f]{64}$/,
    );
  });

  it("differs for different content", () => {
    expect(stanceCacheKey(CONTENT_A)).not.toBe(stanceCacheKey(CONTENT_B));
  });
});

describe("readCachedStances", () => {
  beforeEach(() => inMock.mockReset());

  it("maps only cache hits back to their id, keyed by the same stanceCacheKey", async () => {
    const kA = stanceCacheKey(CONTENT_A);
    // A はヒット / B はミス / 空文字はキー生成対象外
    inMock.mockResolvedValue({
      data: [{ cache_key: kA, response: "光回線整備を最優先" }],
    });

    const result = await readCachedStances([
      { id: "u1", content: CONTENT_A },
      { id: "u2", content: CONTENT_B },
      { id: "u3", content: "" },
    ]);

    expect(result).toEqual({ u1: "光回線整備を最優先" });
    // .in() には空を除いた 2 件が、生成と同一のキーで渡る
    expect(inMock).toHaveBeenCalledWith("cache_key", [
      kA,
      stanceCacheKey(CONTENT_B),
    ]);
  });

  it("expands one cached response to every participant with identical content", async () => {
    const kA = stanceCacheKey(CONTENT_A);
    inMock.mockResolvedValue({
      data: [{ cache_key: kA, response: "光回線整備を最優先" }],
    });

    const result = await readCachedStances([
      { id: "u1", content: CONTENT_A },
      { id: "u2", content: CONTENT_A }, // 同一内容 → キー衝突しても両方 stance を得る
    ]);

    expect(result).toEqual({
      u1: "光回線整備を最優先",
      u2: "光回線整備を最優先",
    });
    // クエリはユニークキー 1 件のみ(重複を投げない)
    expect(inMock).toHaveBeenCalledWith("cache_key", [kA]);
  });

  it("returns {} and skips the query when no usable content", async () => {
    expect(await readCachedStances([{ id: "x", content: null }])).toEqual({});
    expect(inMock).not.toHaveBeenCalled();
  });
});
