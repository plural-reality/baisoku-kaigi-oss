import axios from "axios";

// Shared retry/backoff for OpenRouter calls. app/lib/llm.ts has its own
// (provider-error-aware) loop; this is the generic version for the agent path
// (audit M3: agents/llm.ts had no retry) and the inline file/form routes. Pure
// so the separate agents/ runtime can import it.

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const RETRYABLE_CODES = new Set(["ECONNABORTED", "ETIMEDOUT", "ECONNRESET"]);

export const isRetryableHttpError = (error: unknown): boolean =>
  axios.isAxiosError(error)
    ? RETRYABLE_STATUS.has(error.response?.status ?? 0) ||
      RETRYABLE_CODES.has(error.code ?? "")
    : false;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

type RetryOptions = Readonly<{
  maxRetries?: number;
  baseDelayMs?: number;
  isRetryable?: (error: unknown) => boolean;
}>;

// Recursive (no loop): retries `fn` on retryable failures with exponential
// backoff, then rethrows the last error.
export const withRetry = <T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> => {
  const maxRetries = options.maxRetries ?? 4;
  const baseDelayMs = options.baseDelayMs ?? 2000;
  const isRetryable = options.isRetryable ?? isRetryableHttpError;

  const attempt = (n: number): Promise<T> =>
    fn().catch((error) =>
      n < maxRetries && isRetryable(error)
        ? sleep(baseDelayMs * 2 ** n).then(() => attempt(n + 1))
        : Promise.reject(error),
    );

  return attempt(0);
};
