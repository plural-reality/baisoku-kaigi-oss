import type { Locale } from "@/i18n/locales";
import type {
  ParticipantProgress,
  StatementWithStats,
} from "@/sessions/[sessionId]/[accessToken]/admin-parts";
import type { ResponseValue } from "@/sessions/[sessionId]/response-item";

// Session content of the marketing-site demo (/embed/demo). It is data of a
// made-up session in both languages, not UI copy: the screens around it come
// from the real components and messages/*.json.

type Bilingual = Readonly<Record<Locale, string>>;

export const DEMO_TITLE: Bilingual = {
  ja: "プッシュ型社会保障の制度設計",
  en: "Designing push-type social security",
};

// [強く賛成, 賛成, わからない, 反対, 強く反対] people-counts at the end of the demo.
type Counts = readonly [number, number, number, number, number];

const STATEMENTS: readonly {
  text: Bilingual;
  counts: Counts;
  freeText?: readonly { participant: number; text: Bilingual }[];
}[] = [
  {
    text: {
      ja: "行政が情報を活用して支援を提案する際、その「選定された理由」を住民がいつでも確認できる透明性が必要である。",
      en: "When the government uses its data to propose support, residents should be able to see at any time why they were selected.",
    },
    counts: [24, 15, 3, 2, 0],
  },
  {
    text: {
      ja: "プッシュ型支援の対象者は、高齢者や障害者に限定せず、全住民を対象とすべきである。",
      en: "Push-type support should cover all residents, not only older people and people with disabilities.",
    },
    counts: [18, 17, 5, 4, 1],
  },
  {
    text: {
      ja: "行政が保有する所得や家族構成のデータを、本人の個別同意を得ることなく、支援情報の通知に利用することに賛成である。",
      en: "I support using the income and household data the government holds to notify people of support, without asking each person's consent.",
    },
    counts: [9, 12, 4, 11, 10],
    freeText: [
      {
        participant: 2,
        text: {
          ja: "通知だけなら良いが、他の用途に使わない約束が先に欲しい。",
          en: "Notifications are fine, but I want a promise first that the data is used for nothing else.",
        },
      },
    ],
  },
  {
    text: {
      ja: "AIが「このままでは将来困窮する可能性がある」と予測した場合、たとえ本人が不快に感じるリスクがあっても、早期救済のためにその結果を本人に通知すべきである。",
      en: "If AI predicts that someone may fall into hardship, they should be told early so help can start, even at the risk of upsetting them.",
    },
    counts: [6, 10, 17, 7, 4],
  },
  {
    text: {
      ja: "「自分に合う支援が漏れなくわかる」ことよりも、「個人情報が絶対に漏洩しない」ことの方が重要だ。",
      en: "Never leaking personal data matters more than learning about every kind of support that fits me.",
    },
    counts: [10, 11, 3, 12, 8],
  },
  {
    text: {
      ja: "国が一元的にデータを管理するよりも、各市区町村が独立して管理し活用する方が安心感がある。",
      en: "I would feel safer if each municipality managed its own data rather than the national government holding it all.",
    },
    counts: [5, 9, 19, 8, 3],
  },
  {
    text: {
      ja: "AIによる予測や判定を用いる場合、その判定根拠が専門用語を使わずに本人へ説明されないのであれば、その仕組みは導入すべきではない。",
      en: "If the reason behind an AI judgment cannot be explained to the person in plain words, the system should not be introduced.",
    },
    counts: [20, 16, 4, 3, 1],
    freeText: [
      {
        participant: 5,
        text: {
          ja: "窓口でも同じ説明を聞けるようにしてほしい。",
          en: "The same explanation should be available at the service desk too.",
        },
      },
    ],
  },
  {
    text: {
      ja: "行政の窓口担当者の裁量で支援の可否が左右されるよりも、システムがルールに基づいて一律に判定する方が公平である。",
      en: "Rule-based decisions by a system are fairer than leaving support to the discretion of individual staff.",
    },
    counts: [7, 13, 6, 12, 6],
  },
];

const PARTICIPANT_NAMES: Readonly<Record<Locale, readonly string[]>> = {
  ja: [
    "佐藤",
    "鈴木",
    "高橋",
    "田中",
    "伊藤",
    "渡辺",
    "山本",
    "中村",
    "小林",
    "加藤",
    "吉田",
    "山田",
  ],
  en: [
    "Alex",
    "Sam",
    "Jordan",
    "Taylor",
    "Morgan",
    "Riley",
    "Casey",
    "Jamie",
    "Avery",
    "Quinn",
    "Drew",
    "Robin",
  ],
};

export const participantId = (index: number) => `demo-participant-${index}`;

const pct = (n: number, total: number) =>
  total > 0 ? Math.round((n / total) * 10000) / 100 : 0;

// Counts scaled by `progress` (0..1), so the screens fill up like a live session.
const scaled = (counts: Counts, progress: number): Counts =>
  counts.map((n) => Math.round(n * progress)) as unknown as Counts;

// Same shape as GET /api/sessions/[sessionId]/[accessToken] builds.
export const demoStatements = (
  locale: Locale,
  progress = 1,
): StatementWithStats[] =>
  STATEMENTS.map((s, index) => {
    const [strongYes, yes, dontKnow, no, strongNo] = scaled(s.counts, progress);
    const totalCount = strongYes + yes + dontKnow + no + strongNo;
    const freeTextSamples =
      progress >= 1
        ? (s.freeText ?? []).map((f) => ({
            participantUserId: participantId(f.participant),
            text: f.text[locale],
          }))
        : [];
    return {
      id: `demo-statement-${index}`,
      sessionId: "demo",
      text: s.text[locale],
      orderIndex: index,
      responses: {
        strongYes: pct(strongYes, totalCount),
        yes: pct(yes, totalCount),
        dontKnow: pct(dontKnow, totalCount),
        no: pct(no, totalCount),
        strongNo: pct(strongNo, totalCount),
        counts: { strongYes, yes, dontKnow, no, strongNo },
        totalCount,
        freeTextCount: freeTextSamples.length,
        freeTextSamples,
      },
      agreementScore: Math.abs(strongYes + yes - (no + strongNo)),
    };
  });

// Answered statements per participant at the end of the demo.
const FINAL_ANSWERED = [8, 8, 8, 8, 7, 8, 6, 8, 5, 3, 8, 0] as const;

export const demoParticipants = (
  locale: Locale,
  progress = 1,
  now = Date.now(),
): ParticipantProgress[] =>
  PARTICIPANT_NAMES[locale].map((name, index) => {
    const answeredCount = Math.round(FINAL_ANSWERED[index] * progress);
    return {
      userId: participantId(index),
      name,
      answeredCount,
      completionRate: (answeredCount / STATEMENTS.length) * 100,
      totalStatements: STATEMENTS.length,
      updatedAt: new Date(now - (index + 1) * 47_000).toISOString(),
    };
  });

export const demoNameMap = (locale: Locale): Record<string, string> =>
  Object.fromEntries(
    PARTICIPANT_NAMES[locale].map((name, index) => [
      participantId(index),
      name,
    ]),
  );

// The participant's own answers, in the order the phone scene plays them.
export const DEMO_ANSWERS: readonly ResponseValue[] = [2, 1, -1, 0, 2];

export const demoTimeline = (locale: Locale) =>
  STATEMENTS.slice(0, DEMO_ANSWERS.length + 1).map((s, index) => ({
    id: `demo-statement-${index}`,
    text: s.text[locale],
  }));
