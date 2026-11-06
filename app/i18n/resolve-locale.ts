import { match } from "@formatjs/intl-localematcher";
import { defaultLocale, isLocale, type Locale, locales } from "./locales";

// "en-AU,en;q=0.9,ja;q=0.5" → ["en-AU", "en", "ja"], ordered by q (stable).
export const parseAcceptLanguage = (header: string | null): string[] =>
  (header ?? "")
    .split(",")
    .map((part, index) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
      return { tag: tag.trim(), q: q ? Number(q.slice(2)) : 1, index };
    })
    .filter(({ tag, q }) => tag !== "" && tag !== "*" && q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index)
    .map(({ tag }) => tag);

const safeMatch = (requested: string[]): Locale => {
  try {
    const matched = match(requested, locales, defaultLocale);
    return isLocale(matched) ? matched : defaultLocale;
  } catch {
    // Malformed language tags make Intl throw; fall back rather than 500.
    return defaultLocale;
  }
};

// Precedence: explicit choice (cookie / account) → device language → default.
export const resolveLocale = ({
  explicit,
  acceptLanguage,
}: {
  explicit?: string | null;
  acceptLanguage?: string | null;
}): Locale =>
  isLocale(explicit)
    ? explicit
    : safeMatch(parseAcceptLanguage(acceptLanguage ?? null));
