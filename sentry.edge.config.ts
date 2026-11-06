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
});
