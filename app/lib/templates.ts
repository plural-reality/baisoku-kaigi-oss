import type { ContentLanguage } from "./content-language";

export type SessionTemplate = {
  id: string;
  title: string;
  emoji: string;
  description: string;
  prefill: {
    title: string;
    purpose: string;
    backgroundInfo: string;
  };
};

type TemplateText = Omit<SessionTemplate, "id" | "emoji">;

// Each template exists in every content language so the picker never mixes
// languages; the prefill becomes the session's own (AI-facing) text.
const TEMPLATES: ReadonlyArray<{
  id: string;
  emoji: string;
  text: Record<ContentLanguage, TemplateText>;
}> = [
  {
    id: "budget-allocation",
    emoji: "💰",
    text: {
      ja: {
        title: "予算配分",
        description: "限られた予算をどう配分すべきか、チームの認識を揃える",
        prefill: {
          title: "次期予算配分に関する認識すり合わせ",
          purpose:
            "限られた予算をどのプロジェクトや施策に優先的に配分すべきか、チームメンバー間の認識の違いを可視化し、合意形成を進めたい。",
          backgroundInfo: "",
        },
      },
      en: {
        title: "Budget allocation",
        description: "Align the team on how a limited budget should be split",
        prefill: {
          title: "Aligning views on next year's budget allocation",
          purpose:
            "We want to surface how team members differ on which projects and initiatives should get priority from a limited budget, and move towards agreement.",
          backgroundInfo: "",
        },
      },
    },
  },
  {
    id: "go-nogo",
    emoji: "🚦",
    text: {
      ja: {
        title: "Go / No-Go 判断",
        description: "プロジェクトの進行可否について全員の立場を明確にする",
        prefill: {
          title: "プロジェクト Go/No-Go 判断",
          purpose:
            "プロジェクトを次のフェーズに進めるべきかどうか、関係者全員の立場や懸念を把握し、意思決定の根拠を明確にしたい。",
          backgroundInfo: "",
        },
      },
      en: {
        title: "Go / No-Go decision",
        description: "Make everyone's position on proceeding explicit",
        prefill: {
          title: "Project Go/No-Go decision",
          purpose:
            "We want to understand every stakeholder's position and concerns on whether the project should move to the next phase, and make the basis for the decision clear.",
          backgroundInfo: "",
        },
      },
    },
  },
  {
    id: "org-change",
    emoji: "🏢",
    text: {
      ja: {
        title: "組織変更",
        description:
          "組織変更やチーム再編に対する各メンバーの受け止めを把握する",
        prefill: {
          title: "組織変更に関するメンバーの認識調査",
          purpose:
            "組織変更やチーム再編について、各メンバーがどのように受け止めているか、懸念や期待を可視化し、スムーズな移行のための対策を検討したい。",
          backgroundInfo: "",
        },
      },
      en: {
        title: "Organisational change",
        description: "Understand how each member is taking a restructure",
        prefill: {
          title: "How members see the upcoming restructure",
          purpose:
            "We want to see how each member is taking the organisational change, make their concerns and expectations visible, and plan for a smooth transition.",
          backgroundInfo: "",
        },
      },
    },
  },
  {
    id: "quarterly-review",
    emoji: "📊",
    text: {
      ja: {
        title: "四半期振り返り",
        description: "四半期の成果と課題についてチームの認識を揃える",
        prefill: {
          title: "四半期の振り返りと認識すり合わせ",
          purpose:
            "今四半期の成果、課題、来期に向けた優先事項について、チームメンバー間の認識の違いを明らかにし、次の四半期の方向性を合意したい。",
          backgroundInfo: "",
        },
      },
      en: {
        title: "Quarterly review",
        description: "Align on the quarter's results and challenges",
        prefill: {
          title: "Quarterly review and alignment",
          purpose:
            "We want to clarify where team members differ on this quarter's results, challenges and next-quarter priorities, and agree on direction for the next quarter.",
          backgroundInfo: "",
        },
      },
    },
  },
  {
    id: "product-priority",
    emoji: "🎯",
    text: {
      ja: {
        title: "プロダクト優先順位",
        description: "どの機能やタスクを優先すべきか、チームの合意を形成する",
        prefill: {
          title: "プロダクト開発の優先順位決め",
          purpose:
            "複数の機能要望やタスクがある中で、どれを優先的に開発すべきか、チームメンバーの認識を可視化し、優先順位の合意を形成したい。",
          backgroundInfo: "",
        },
      },
      en: {
        title: "Product priorities",
        description: "Agree on which features or tasks come first",
        prefill: {
          title: "Setting product development priorities",
          purpose:
            "With many feature requests and tasks competing, we want to make team members' views visible and agree on what to build first.",
          backgroundInfo: "",
        },
      },
    },
  },
  {
    id: "customer-forum",
    emoji: "🗣️",
    text: {
      ja: {
        title: "顧客・住民フォーラム",
        description:
          "無作為に選ばれた顧客や住民の優先順位と、その理由をたどれる形で集める",
        prefill: {
          title: "今後5年間の事業計画に関する顧客フォーラム",
          purpose:
            "無作為に選ばれた顧客が、料金・サービス水準・投資の優先順位についてどう考えるかを、理由とともに把握したい。合意している点、意見が分かれる点、判断に情報が足りない点を明らかにし、事業計画にどう反映したかを説明できる記録を残したい。",
          backgroundInfo: "",
        },
      },
      en: {
        title: "Customer or community forum",
        description:
          "Capture a randomly selected panel's priorities, with traceable reasons",
        prefill: {
          title: "Customer forum on the next five-year plan",
          purpose:
            "We want to understand how a randomly selected panel of customers weighs prices, service levels and investment priorities, and why. We want to see where they agree, where views divide, and where they need more information, and keep a record that shows how their input shaped the plan.",
          backgroundInfo: "",
        },
      },
    },
  },
];

export const sessionTemplates = (
  language: ContentLanguage,
): SessionTemplate[] =>
  TEMPLATES.map(({ id, emoji, text }) => ({ id, emoji, ...text[language] }));

// Japanese list kept for existing callers and tests.
export const SESSION_TEMPLATES: SessionTemplate[] = sessionTemplates("ja");
