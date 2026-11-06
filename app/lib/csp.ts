// Content-Security-Policy, built from RUNTIME env.
//
// Why not next.config.ts `headers()`: that is evaluated at BUILD time, where the
// `NEXT_PUBLIC_*` origins are placeholders (flake.nix injects real values only at
// runtime via EnvironmentFile; the client reads them from `window.__ENV`). Building
// the policy there would bake `placeholder.supabase.co` into `connect-src`. So the
// policy is assembled here and applied in middleware.ts (runtime), reading env via
// dynamic `process.env[key]` access — the same idiom as app/lib/public-env.ts — so
// Next.js cannot inline the build-time placeholders.
//
// Enforcing by default since 2026-10-06 (security audit H1: the report-only
// posture let LLM/participant markdown beacon to arbitrary hosts). Set
// `CSP_MODE=report-only` to fall back to the observe-only header while
// diagnosing a violation — that is an explicit, temporary opt-out.

const readEnv = (key: string): string | undefined => process.env[key];

const tryOrUndefined = <T>(f: () => T): T | undefined => {
  try {
    return f();
  } catch {
    return undefined;
  }
};

const originOf = (url: string | undefined): string | undefined =>
  url ? tryOrUndefined(() => new URL(url).origin) : undefined;

const toWebSocket = (httpOrigin: string): string =>
  httpOrigin.replace(/^http/, "ws");

const uniq = (xs: readonly string[]): readonly string[] => [...new Set(xs)];

const present = (xs: readonly (string | undefined)[]): readonly string[] =>
  xs.filter((x): x is string => Boolean(x));

type SentryReporting = Readonly<{ ingest: string; reportUri: string }>;

// DSN shape: https://<publicKey>@<host>/<projectId>. The CSP report endpoint is
// Sentry's documented `/api/<projectId>/security/?sentry_key=<publicKey>`.
const sentryReporting = (
  dsn: string | undefined,
): SentryReporting | undefined =>
  tryOrUndefined(() => {
    const u = new URL(dsn ?? "");
    const projectId = u.pathname.replace(/^\/+/, "");
    const ingest = `${u.protocol}//${u.host}`;
    return u.username && projectId
      ? {
          ingest,
          reportUri: `${ingest}/api/${projectId}/security/?sentry_key=${u.username}`,
        }
      : undefined;
  });

export type CspMode = "report-only" | "enforce";

export const cspMode = (): CspMode =>
  readEnv("CSP_MODE") === "report-only" ? "report-only" : "enforce";

export const cspHeaderName = (mode: CspMode = cspMode()): string =>
  mode === "enforce"
    ? "Content-Security-Policy"
    : "Content-Security-Policy-Report-Only";

const isDevelopmentRuntime = (): boolean =>
  readEnv("NODE_ENV") === "development";

// The only remote image the app loads itself: the share QR code on the admin
// page (next.config.ts `images.remotePatterns`, rendered `unoptimized` so the
// browser fetches it directly). Everything else is `'self'` or an inline
// `data:` URI. No `https:` wildcard — an `<img src>` smuggled into markdown would
// otherwise be a zero-click exfiltration beacon (audit 2026-10-06 H1); the
// Markdown renderer drops `<img>` too, this is the second layer.
const QR_IMAGE_ORIGIN = "https://api.qrserver.com";

// Cloudflare Web Analytics: the zone injects `beacon.min.js` at the edge and the
// beacon posts to cloudflareinsights.com. Observed as the only violation once
// the policy went enforcing on staging (2026-10-07); not app-critical, but keep
// the analytics the zone is configured for.
const CLOUDFLARE_INSIGHTS_SCRIPT = "https://static.cloudflareinsights.com";
const CLOUDFLARE_INSIGHTS_CONNECT = "https://cloudflareinsights.com";

// /embed/* (the demo on the marketing site, app/embed/demo) is the only page
// another site may frame. It shows a made-up session and takes no input, so
// framing it carries no clickjacking risk; the list only keeps it on our sites.
// EMBED_FRAME_ANCESTORS (space-separated sources) overrides the default.
const DEFAULT_EMBED_FRAME_ANCESTORS = [
  "https://plural-reality.com",
  "https://*.plural-reality.com",
  "https://*.vercel.app",
  "http://localhost:*",
];

export const isEmbedPath = (pathname: string): boolean =>
  pathname.startsWith("/embed/");

const embedFrameAncestors = (): readonly string[] => {
  const configured = (readEnv("EMBED_FRAME_ANCESTORS") ?? "")
    .split(/\s+/)
    .filter(Boolean);
  return [
    "'self'",
    ...(configured.length > 0 ? configured : DEFAULT_EMBED_FRAME_ANCESTORS),
  ];
};

export const buildCspValue = ({
  embed = false,
}: {
  embed?: boolean;
} = {}): string => {
  const supabaseOrigins = uniq(
    present([
      originOf(readEnv("NEXT_PUBLIC_SUPABASE_URL")),
      originOf(readEnv("NEXT_PUBLIC_AUTH_SUPABASE_URL")),
      // Platform DB (common-ID base): defined in env but not yet contacted from
      // the browser — allowed defensively for the planned cross-product reads.
      originOf(readEnv("NEXT_PUBLIC_PLATFORM_SUPABASE_URL")),
    ]),
  );
  const umami = originOf(readEnv("NEXT_PUBLIC_UMAMI_URL"));
  const sentry = sentryReporting(readEnv("NEXT_PUBLIC_SENTRY_DSN"));

  const connectSrc = uniq([
    "'self'",
    ...supabaseOrigins,
    ...supabaseOrigins.map(toWebSocket), // Supabase realtime uses wss
    ...present([umami, sentry?.ingest]),
    CLOUDFLARE_INSIGHTS_CONNECT,
  ]);

  // `'unsafe-inline'` covers the `window.__ENV` runtime-env inline script
  // (layout.tsx) and Next.js's bootstrap scripts, which have no per-request nonce
  // in this static policy. Tightening to nonce + `'strict-dynamic'` is the
  // enforce-phase follow-up; rehype-sanitize (H3) is the primary XSS control.
  const scriptSrc = uniq([
    "'self'",
    "'unsafe-inline'",
    ...(isDevelopmentRuntime() ? ["'unsafe-eval'"] : []),
    ...present([umami]),
    CLOUDFLARE_INSIGHTS_SCRIPT,
  ]);

  const directives: readonly (readonly [string, readonly string[]])[] = [
    ["default-src", ["'self'"]],
    ["base-uri", ["'self'"]],
    ["object-src", ["'none'"]],
    ["frame-ancestors", embed ? embedFrameAncestors() : ["'none'"]],
    ["form-action", ["'self'"]],
    ["script-src", scriptSrc],
    ["style-src", ["'self'", "'unsafe-inline'"]],
    ["img-src", ["'self'", "data:", QR_IMAGE_ORIGIN]],
    ["font-src", ["'self'", "data:"]],
    ["connect-src", connectSrc],
    ["worker-src", ["'self'", "blob:"]],
    ...(sentry ? [["report-uri", [sentry.reportUri]] as const] : []),
  ];

  return directives
    .map(([name, values]) => `${name} ${values.join(" ")}`)
    .join("; ");
};

type CspHeader = Readonly<{ name: string; value: string }>;

const cached: { page?: CspHeader; embed?: CspHeader } = {};

// Memoised: env is fixed per process, and middleware runs this on every request.
export const getCspHeader = (pathname = "/"): CspHeader => {
  const embed = isEmbedPath(pathname);
  const key = embed ? "embed" : "page";
  cached[key] ??= { name: cspHeaderName(), value: buildCspValue({ embed }) };
  return cached[key];
};
