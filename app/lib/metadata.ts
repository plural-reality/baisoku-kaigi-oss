import type { Metadata } from "next";

// Per-locale brand copy. Kept here (not in messages/*.json) because metadata
// helpers also run in client components outside a translation context.
// Product names follow plural-reality.com: 倍速会議 / Baisoku Kaigi.
const BRAND = {
  ja: {
    siteName: "倍速会議",
    description: "チームの認識を可視化し、合意形成を促進するツール",
    tagline: "チームの認識を可視化し、合意形成を促進する",
    ogLocale: "ja_JP",
  },
  en: {
    siteName: "Baisoku Kaigi",
    description:
      "A tool that maps how your group sees an issue and helps it reach agreement",
    tagline: "Map how your group sees an issue and build agreement",
    ogLocale: "en_US",
  },
} as const;

type BrandLocale = keyof typeof BRAND;
const brand = (locale?: string) =>
  BRAND[(locale && locale in BRAND ? locale : "ja") as BrandLocale];

const SITE_NAME = BRAND.ja.siteName;
const DEFAULT_DESCRIPTION = BRAND.ja.description;
const DEFAULT_SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ??
  "https://baisoku-kaigi.plural-reality.com";
const DEFAULT_OG_IMAGE = "/og-default.png";

// <title> の型（title_format、IMPLEMENTATION.md §5）。
//   ページ: `ページ名 | 倍速会議`（半角の | の前後に半角スペース）
//   製品トップ: `倍速会議 | チームの認識を可視化し、合意形成を促進する`
// 社名は title に入れない。og:site_name は製品名。
const pageTitle = (page: string, locale?: string): string =>
  `${page} | ${brand(locale).siteName}`;
const SITE_NAME_BY_LOCALE = (locale?: string): string => brand(locale).siteName;
const defaultTitle = (locale?: string): string =>
  `${brand(locale).siteName} | ${brand(locale).tagline}`;
const DEFAULT_TITLE = defaultTitle("ja");

export function buildMetadata(opts: {
  title?: string;
  description?: string;
  url?: string;
  locale?: string;
}): Metadata {
  const b = brand(opts.locale);
  const title = opts.title ?? defaultTitle(opts.locale);
  const description = opts.description ?? b.description;

  return {
    metadataBase: new URL(DEFAULT_SITE_URL),
    title,
    description,
    openGraph: {
      siteName: b.siteName,
      locale: b.ogLocale,
      type: "website",
      images: [
        {
          url: DEFAULT_OG_IMAGE,
          width: 1200,
          height: 630,
          alt: `${b.siteName} | ${b.description}`,
        },
      ],
      title,
      description,
      url: opts.url,
    },
    twitter: {
      card: "summary_large_image",
      images: [DEFAULT_OG_IMAGE],
      title,
      description,
    },
  };
}

export function truncateForMeta(text: string, maxLength = 120): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}…`;
}

export {
  DEFAULT_DESCRIPTION,
  DEFAULT_OG_IMAGE,
  DEFAULT_TITLE,
  defaultTitle,
  pageTitle,
  SITE_NAME,
  SITE_NAME_BY_LOCALE,
};
