/**
 * Creates a minimal NextRequest-like object for testing API route handlers.
 */
export function createMockRequest(
  options: {
    method?: string;
    url?: string;
    headers?: Record<string, string>;
    body?: unknown;
  } = {},
) {
  const headers = new Map(
    Object.entries(options.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]),
  );

  return {
    method: options.method ?? "GET",
    url: options.url ?? "http://localhost:3000/api/test",
    headers: {
      get(name: string) {
        return headers.get(name.toLowerCase()) ?? null;
      },
      has(name: string) {
        return headers.has(name.toLowerCase());
      },
      entries() {
        return headers.entries();
      },
    },
    json: async () => options.body ?? {},
    text: async () => JSON.stringify(options.body ?? {}),
  } as unknown as import("next/server").NextRequest;
}

/**
 * Creates a mock request with Bearer authorization.
 */
export function createAuthedRequest(
  userId: string,
  options: {
    method?: string;
    url?: string;
    body?: unknown;
    headers?: Record<string, string>;
  } = {},
) {
  return createMockRequest({
    ...options,
    headers: {
      ...options.headers,
      authorization: `Bearer ${userId}`,
    },
  });
}
