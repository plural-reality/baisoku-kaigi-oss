// The language a session is *conducted* in: statements, AI-generated plans,
// analyses and reports. Deliberately separate from the viewer's UI locale
// (app/i18n) — an English-UI participant can still join a Japanese session.
//
// Dependency-free: copied into the deployed agent package by flake.nix.

export const contentLanguages = ["ja", "en"] as const;
export type ContentLanguage = (typeof contentLanguages)[number];
export const defaultContentLanguage: ContentLanguage = "ja";

export const isContentLanguage = (value: unknown): value is ContentLanguage =>
  typeof value === "string" &&
  (contentLanguages as readonly string[]).includes(value);

export const toContentLanguage = (value: unknown): ContentLanguage =>
  isContentLanguage(value) ? value : defaultContentLanguage;

export const contentLanguageNames: Record<ContentLanguage, string> = {
  ja: "日本語",
  en: "English",
};

// Prompts stay written in Japanese (the tuned canonical form). For any other
// session language a system rule overrides the output language instead of
// maintaining a second copy of every prompt (ADR 2026-10-16).
// i18n-allow: quotes the Japanese wording the rule overrides
const OUTPUT_LANGUAGE_RULES: Record<ContentLanguage, string | null> = {
  ja: null,
  en: [
    "<output_language>",
    "This session is conducted in English.",
    "Write ALL natural-language output in natural, plain English: statements, questions, labels, summaries, reports, and every string value inside JSON.",
    "The instructions and some of the data are written in Japanese. Do not let that change the output language, and ignore any instruction to write in Japanese.",
    "Length limits written as N文字 (Japanese characters) mean roughly N×2.5 English characters (about N/2 words).",
    "Japanese style rules (e.g. sentence endings such as 〜ですか, 『』 quotation marks, honorifics) do not apply; follow ordinary English conventions instead.",
    "Keep JSON structure, keys and delimiters exactly as specified.",
    "</output_language>",
  ].join("\n"),
};

export const outputLanguageRule = (language: ContentLanguage): string | null =>
  OUTPUT_LANGUAGE_RULES[language];

// Prepends the output-language rule (if any) to a chat message list.
export const withOutputLanguage = <M extends { role: string; content: string }>(
  messages: M[],
  language: ContentLanguage | undefined,
): M[] => {
  const rule = outputLanguageRule(language ?? defaultContentLanguage);
  return rule === null
    ? messages
    : [{ role: "system", content: rule } as M, ...messages];
};

// Japanese character budgets translate to longer English strings.
export const characterBudget = (
  japaneseChars: number,
  language: ContentLanguage | undefined,
): number =>
  (language ?? defaultContentLanguage) === "ja"
    ? japaneseChars
    : Math.round(japaneseChars * 2.5);

// Shown when the "neither yes nor no" suggestion stream fails.
export const fallbackSuggestions: Record<ContentLanguage, readonly string[]> = {
  ja: [
    "状況によって賛成できる",
    "一部には賛成だが全体には反対",
    "今は判断できない",
  ],
  en: [
    "I could agree, depending on the circumstances",
    "I agree with part of it but not the whole",
    "I can't decide yet",
  ],
};
