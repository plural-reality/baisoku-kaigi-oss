// 会社の帯（フッター）と製品間リンクで使う、Plural Reality の製品 URL。
// 値は IMPLEMENTATION.md §1（round 2）。両製品とも LP は製品ドメインの /lp（2026-10-24 移行）。
export const BAISOKU_KAIGI_URL = "https://baisoku-kaigi.plural-reality.com/lp";
export const BAISOKU_SURVEY_URL =
  "https://baisoku-survey.plural-reality.com/lp";

// `key` indexes the `products` message namespace (localized product names).
export const PRODUCT_LINKS = [
  { key: "kaigi", href: BAISOKU_KAIGI_URL, current: true },
  { key: "survey", href: BAISOKU_SURVEY_URL, current: false },
] as const;
