// Best-effort client IP from proxy headers. Shared by the edge middleware (IP
// allowlist) and Node route handlers (per-IP rate limits), so it must stay free
// of Node-only imports. Header values are attacker-influenced unless the
// deployment's reverse proxy overwrites them — treat the result as a throttle
// key, never as an identity.

type HeaderReader = Readonly<{ get(name: string): string | null }>;

const FALLBACK_HEADERS = [
  "x-real-ip",
  "x-client-ip",
  "cf-connecting-ip",
  "true-client-ip",
  "x-cluster-client-ip",
] as const;

export const clientIpOf = (headers: HeaderReader): string | null => {
  const forwarded = headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  if (first) return first;

  const found = FALLBACK_HEADERS.map((h) => headers.get(h)?.trim()).find((v) =>
    Boolean(v),
  );
  return found ?? null;
};
