const PUBLIC_ENV_KEYS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "NEXT_PUBLIC_AUTH_SUPABASE_URL",
  "NEXT_PUBLIC_AUTH_SUPABASE_ANON_KEY",
  "NEXT_PUBLIC_WORKOS_REDIRECT_URI",
  "NEXT_PUBLIC_SITE_URL",
  "NEXT_PUBLIC_UMAMI_URL",
  "NEXT_PUBLIC_UMAMI_WEBSITE_ID",
  "NEXT_PUBLIC_SENTRY_DSN",
  "NEXT_PUBLIC_SENTRY_ENVIRONMENT",
] as const;

type PublicEnvKey = (typeof PUBLIC_ENV_KEYS)[number];
type PublicEnv = Record<PublicEnvKey, string | undefined>;

const normalizePublicEnvValue = (value: unknown): string | undefined =>
  typeof value === "string" ? value.trim().replace(/;$/, "") : undefined;

const normalizePublicEnv = (
  env: Partial<Record<PublicEnvKey, unknown>>,
): PublicEnv =>
  Object.fromEntries(
    PUBLIC_ENV_KEYS.map((k) => [k, normalizePublicEnvValue(env[k])]),
  ) as PublicEnv;

export const collectPublicEnv = (): PublicEnv =>
  normalizePublicEnv(process.env as Record<string, unknown>);

export const getPublicEnv = (): PublicEnv =>
  typeof window !== "undefined"
    ? normalizePublicEnv(
        ((window as unknown as Record<string, unknown>).__ENV ?? {}) as Partial<
          Record<PublicEnvKey, unknown>
        >,
      )
    : collectPublicEnv();
