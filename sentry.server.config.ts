import * as Sentry from "@sentry/nextjs";

// Use bracket notation for dynamic property access — process.env.NEXT_PUBLIC_*
// is inlined by Next.js at build time, which bakes in Nix build placeholders.
Sentry.init({
  // biome-ignore lint/complexity/useLiteralKeys: bracket notation prevents Next.js build-time inlining (Nix placeholder issue)
  dsn: process.env["NEXT_PUBLIC_SENTRY_DSN"],
  // Only report from deployed builds (next dev → NODE_ENV=development → off);
  // staging & production are both `next build` (NODE_ENV=production) and stay on.
  enabled: process.env.NODE_ENV === "production",
  // biome-ignore lint/complexity/useLiteralKeys: bracket notation prevents Next.js build-time inlining (Nix placeholder issue)
  environment: process.env["NEXT_PUBLIC_SENTRY_ENVIRONMENT"] || "development",
  tracesSampleRate: 0.1,
  // Scanner traffic: a multipart POST naming a Server Action that does not exist, or a body
  // Next cannot parse as a form, throws inside Next's action handler and surfaces as a 500
  // with nothing of ours to fix (real stale tabs send the Next-Action header and get a 404).
  ignoreErrors: [
    /Failed to find Server Action/,
    /Failed to parse body as FormData/,
  ],
  _experiments: {
    enableLogs: true,
  },
});
