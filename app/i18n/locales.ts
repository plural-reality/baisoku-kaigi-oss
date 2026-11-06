// UI locales the app ships translations for. `ja` is the default so that
// existing Japanese copy (and the e2e selectors built on it) stays the
// fallback when nothing better is known about the viewer.
export const locales = ["ja", "en"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "ja";

// Set only when the viewer explicitly picks a language in the switcher —
// a guess from Accept-Language is never persisted.
export const LOCALE_COOKIE = "NEXT_LOCALE";

// Endonyms: each language is labelled in its own script, never with a flag.
export const localeLabels: Record<Locale, string> = {
  ja: "日本語",
  en: "English",
};

export const isLocale = (value: unknown): value is Locale =>
  typeof value === "string" && (locales as readonly string[]).includes(value);
