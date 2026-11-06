import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./app/i18n/request.ts");

const nextConfig: NextConfig = {
  // Produce a minimal runtime bundle (Node.js) that we can ship separately
  // from build-time dependencies via Nix two-stage build.
  output: "standalone",
  // CJS packages that must not be bundled by webpack — loaded at runtime via require()
  serverExternalPackages: ["pdf-parse", "mammoth", "xlsx"],
  // Type checking is handled by CI (ci.yml).
  // Skip during Nix builds to prevent OOM on memory-constrained build servers.
  typescript: { ignoreBuildErrors: !!process.env.NIX_BUILD_TOP },
  // Ensure tracing stays inside this repo and copies only .env.local (not .env)
  outputFileTracingRoot: __dirname,
  outputFileTracingExcludes: {
    "*": ["**/.env"],
  },
  outputFileTracingIncludes: {
    "*": [".env.local"],
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "api.qrserver.com",
      },
    ],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          { key: "X-XSS-Protection", value: "1; mode=block" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
        ],
      },
      // Every page but /embed/* (framed by the marketing site; its CSP
      // frame-ancestors, set in middleware.ts, decides who may frame it).
      {
        source: "/:path((?!embed/).*)",
        headers: [{ key: "X-Frame-Options", value: "DENY" }],
      },
    ];
  },
};

export default withSentryConfig(withNextIntl(nextConfig), {
  silent: true,
  org: process.env.SENTRY_ORG || "plural-reality",
  project: process.env.SENTRY_PROJECT || "cartographer",
  sourcemaps: {
    disable: !process.env.SENTRY_AUTH_TOKEN,
  },
});
