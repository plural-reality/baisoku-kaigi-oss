import { describe, expect, it } from "vitest";
import { CHUNK_ERROR, isChunkLoadError } from "../chunk-reload";

// Next's own error for a Server Action id the server no longer has (after a deploy).
class UnrecognizedActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnrecognizedActionError";
  }
}

describe("デプロイ後の古いタブ", () => {
  it("見つからない Server Action はチャンクの読み込み失敗と同じく再読み込みの対象にする", () => {
    const error = new UnrecognizedActionError(
      'Server Action "7f3a" was not found on the server. \nRead more: https://nextjs.org/docs/messages/failed-to-find-server-action',
    );
    expect(isChunkLoadError(error)).toBe(true);
  });

  it("Sentry の ignoreErrors（メッセージだけを見る）でも同じ判定になる", () => {
    expect(
      CHUNK_ERROR.test('Server Action "7f3a" was not found on the server.'),
    ).toBe(true);
  });

  it("チャンクの読み込み失敗は今まで通り対象", () => {
    expect(isChunkLoadError(new Error("Loading chunk 123 failed."))).toBe(true);
  });

  it("ほかのエラーは対象にしない", () => {
    expect(
      isChunkLoadError(new Error("Cannot read properties of undefined")),
    ).toBe(false);
    expect(isChunkLoadError(new Error("Failed to join session"))).toBe(false);
  });
});
