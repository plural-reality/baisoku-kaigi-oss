import axios from "axios";

/**
 * Axios エラーからセンシティブな情報（Authorization ヘッダー、URL内トークン）を
 * 除去した安全なエラーメッセージを返す。
 */
export function sanitizeErrorForLog(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const status = err.response?.status ?? "no response";
    const method = err.config?.method?.toUpperCase() ?? "UNKNOWN";
    // URL からアクセストークン部分をマスク
    const rawUrl = err.config?.url ?? "unknown";
    const safeUrl = rawUrl
      // パス形式: /sessions/{sessionId}/{accessToken} → .../[REDACTED]
      .replace(/\/sessions\/[^/]+\/[^/?(]+/g, (match) => {
        const parts = match.split("/");
        if (parts.length >= 4) {
          parts[parts.length - 1] = "[REDACTED]";
        }
        return parts.join("/");
      })
      // クエリ形式: ?accessToken=... / &token=... なども伏せる
      .replace(
        /([?&](?:accessToken|access_token|token)=)[^&#]*/gi,
        "$1[REDACTED]",
      );
    return `${method} ${safeUrl} → ${status}: ${err.message}`;
  }

  if (err instanceof Error) {
    return err.message;
  }

  return String(err);
}
