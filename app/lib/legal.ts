// 会社表記は IMPLEMENTATION.md §1（round 2）に従う。
// 和: 合同会社多元現実（スペースなし） / 英: Plural Reality LLC。
export const LEGAL_OPERATOR_NAME = "合同会社多元現実";
export const LEGAL_OPERATOR_NAME_EN = "Plural Reality LLC";
export const LEGAL_OPERATOR_URL = "https://www.plural-reality.com/";
// 特定商取引法に基づく表記と会社概要は HP に 1 つだけ置く（HP の PR で新設）。
export const LEGAL_TOKUSHOHO_URL = "https://www.plural-reality.com/tokushoho";

// © 行の年は表示時の西暦（new Date().getFullYear()）。
export const legalCopyright = (year: number = new Date().getFullYear()) =>
  `© ${year} ${LEGAL_OPERATOR_NAME_EN}`;

export const LEGAL_CONTACT_EMAIL = "info@plural-reality.com";
const LEGAL_LAST_UPDATED_ON = new Date(Date.UTC(2026, 2, 10));
// The frame of a legal page shows the date in the viewer's language; the Japanese
// text itself quotes LEGAL_LAST_UPDATED (2026年3月10日).
export const formatLegalLastUpdated = (locale: string): string =>
  new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "ja-JP", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(LEGAL_LAST_UPDATED_ON);
export const LEGAL_LAST_UPDATED = formatLegalLastUpdated("ja");

export const LEGAL_SERVICE_NAME = "倍速会議";

export const LEGAL_SERVICE_PROVIDERS = [
  {
    name: "AWS（東京リージョン）",
    purpose: "サービス本体のホスティング、ネットワーク基盤",
    data: "サービス提供に伴うアプリケーション処理データ、アクセスに伴う技術情報",
  },
  {
    name: "WorkOS",
    purpose: "ログイン認証",
    data: "メールアドレス、氏名、認証に必要な識別情報",
  },
  {
    name: "Supabase",
    purpose: "データ保存、リアルタイム同期",
    data: "セッション情報、参加者情報、回答、レポート、操作ログ",
  },
  {
    name: "OpenRouter",
    purpose: "質問生成、自由記述の補助、分析レポート生成",
    data: "セッションの目的・背景、参加者の回答、自由記述、追加意見",
  },
  {
    name: "Umami",
    purpose: "アクセス解析、利用状況の把握",
    data: "閲覧ページ、イベント、ブラウザ情報等の利用データ",
  },
  {
    name: "Sentry",
    purpose: "障害監視、エラー解析",
    data: "エラー発生時の操作文脈、ブラウザ情報、技術ログ",
  },
] as const;
