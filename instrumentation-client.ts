import * as Sentry from "@sentry/nextjs";
import { CHUNK_ERROR, installChunkReloadHandler } from "@/lib/chunk-reload";
import { getPublicEnv } from "@/lib/public-env";

// Single canonical client Sentry init (Next.js 15.3+ browser entry).
// Why the enabled gate: `next dev --turbopack` runs with NODE_ENV=development, while
// both staging and production are `next build` (NODE_ENV=production). Gating on build
// mode — not on an env profile — keeps staging/production identical while ensuring
// localhost/HMR noise (e.g. Turbopack's ephemeral content-hashed chunks) never reaches
// the production Sentry project.
// environment is resolved at runtime from window.__ENV (staging & prod share one build,
// so it cannot be baked at build time); DSN is a project-level constant and bakes fine.
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: process.env.NODE_ENV === "production",
  tracesSampleRate: 0.1,
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 1.0,
  integrations: [Sentry.replayIntegration()],
  _experiments: {
    enableLogs: true,
  },
  // ChunkLoadError is an expected transient, not an actionable issue: a client holding a
  // stale bundle after a deploy (or a Turbopack recompile in dev) requests a content-hashed
  // chunk that no longer exists. The fix is a reload on the client (see chunk-reload.ts),
  // not a Sentry alert. Same matcher as the reload path so the two never drift.
  ignoreErrors: [CHUNK_ERROR],
  beforeSend: (event) => ({
    ...event,
    environment:
      getPublicEnv().NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? event.environment,
  }),
});

// Auto-recover real users from a stale-bundle ChunkLoadError after a deploy. Prod only:
// in dev, Turbopack HMR chunk churn would otherwise trigger spurious reloads.
process.env.NODE_ENV === "production" && installChunkReloadHandler();

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
