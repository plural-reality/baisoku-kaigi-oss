/**
 * Create Authorization header for API requests.
 * Returns empty headers when token is null (WorkOS cookie-based auth).
 * Client-safe — no server-only imports.
 */
export const createAuthorizationHeader = (
  token: string | null,
): Record<string, string> =>
  token ? { Authorization: `Bearer ${token}` } : {};
