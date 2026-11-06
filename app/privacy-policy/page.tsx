import {
  Clock3,
  Database,
  Globe,
  Lock,
  RefreshCw,
  Scale,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";
import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import {
  PrivacyNoticeDisclosure,
  PrivacyNoticeLayout,
  PrivacyNoticeSection,
} from "@/components/legal/PrivacyNoticeLayout";
import {
  LEGAL_CONTACT_EMAIL,
  LEGAL_LAST_UPDATED,
  LEGAL_OPERATOR_NAME,
  LEGAL_SERVICE_NAME,
  LEGAL_SERVICE_PROVIDERS,
} from "@/lib/legal";
import { buildMetadata, pageTitle } from "@/lib/metadata";

export async function generateMetadata(): Promise<Metadata> {
  const [locale, t] = await Promise.all([
    getLocale(),
    getTranslations("legal"),
  ]);
  return buildMetadata({
    title: pageTitle(t("privacy"), locale),
    description: t("privacyDescription"),
    url: "/privacy-policy",
    locale,
  });
}

const toc = [
  { id: "role", label: "プライバシーに関する私たちの役割" },
  { id: "data", label: "どんな情報を集めるか" },
  { id: "purpose", label: "集めた情報の使い道" },
  { id: "host-participant", label: "主催者と参加者の関係" },
  { id: "vendors", label: "第三者サービスと海外移転" },
  { id: "retention", label: "保存期間と削除" },
  { id: "security", label: "安全管理" },
  { id: "rights", label: "あなたの選択と権利" },
  { id: "changes", label: "ポリシーの改定" },
] as const;

/** Civichat data-collect style: title + description, no heavy card chrome */
const infoCardClassName = "mb-[15px] last:mb-0";

export default function PrivacyPolicyPage() {
  return (
    <PrivacyNoticeLayout
      eyebrow="Privacy Policy"
      document="privacy"
      subtitle="倍速会議が扱う情報と、その使い方について"
      description={`${LEGAL_SERVICE_NAME} は、チームの認識を集めて整理するためのサービスです。このページでは、何を取得し、何のために使い、どこまで外部サービスに処理を委託しているかを、要点から先に読める形で説明します。`}
      highlights={[
        {
          label: "学習目的では使いません",
          value:
            "入力された回答や自由記述は、当社自身の汎用的なモデル学習データとしては利用しません。",
        },
        {
          label: "AI処理では外部送信があります",
          value:
            "質問生成や分析のため、必要な範囲で OpenRouter 経由の AI サービスへ情報を送信します。",
        },
        {
          label: "主催者には閲覧範囲があります",
          value:
            "主催者は参加者の回答、自由記述、生成レポートを閲覧・共有できる場合があります。",
        },
      ]}
      toc={toc.map((item) => ({ ...item }))}
    >
      <PrivacyNoticeSection
        id="role"
        index={1}
        title="プライバシーに関する私たちの役割"
        summary={`${LEGAL_SERVICE_NAME} では、運営者である当社がサービス提供に必要な範囲で情報を取り扱います。一方で、主催者が他者の情報を持ち込む場面では、主催者にも説明責任と権限確認の責任があります。`}
        icon={<ShieldCheck className="h-5 w-5" />}
        highlights={[
          `本ポリシーは ${LEGAL_SERVICE_NAME} に適用されます。`,
          `お問い合わせ窓口は ${LEGAL_CONTACT_EMAIL} です。`,
          "主催者は参加者への説明、社内承認、共有権限の確認を担います。",
        ]}
      >
        <p>
          本プライバシーポリシーは、{LEGAL_OPERATOR_NAME}
          （以下「当社」といいます。）が提供する {LEGAL_SERVICE_NAME}
          に適用されます。
        </p>

        <div className="grid gap-4 md:grid-cols-2">
          <div className={infoCardClassName}>
            <h3 className="text-[14px] leading-[18px] font-semibold text-foreground">
              当社の責任
            </h3>
            <p className="mt-1 text-[13px] leading-[18px] text-muted-foreground">
              取得する情報の範囲、利用目的、委託先、保存と削除の運用を定め、合理的な安全管理措置を講じます。
            </p>
          </div>
          <div className={infoCardClassName}>
            <h3 className="text-[14px] leading-[18px] font-semibold text-foreground">
              主催者の責任
            </h3>
            <p className="mt-1 text-[13px] leading-[18px] text-muted-foreground">
              参加者に対し、本サービスの利用、閲覧範囲、レポート共有の可能性を説明し、必要な承認や同意を得る責任を負います。
            </p>
          </div>
        </div>

        <PrivacyNoticeDisclosure title="補足: 主催者経由で参加する場合">
          <p>
            参加者が主催者から共有されたリンクを通じて回答する場合、主催者は参加者の回答、自由記述、生成レポートを閲覧できる場合があります。
          </p>
          <p>
            主催者は、共有権限のない個人情報、営業秘密、機微情報を適法な根拠なく入力しないこと、また参加者や所属組織に対して必要な説明を行うことが求められます。
          </p>
        </PrivacyNoticeDisclosure>
      </PrivacyNoticeSection>

      <PrivacyNoticeSection
        id="data"
        index={2}
        title="どんな情報を集めるか"
        summary="ログインに必要な情報、セッション運営に必要な情報、回答や自由記述、利用状況や技術ログなどを取得します。匿名参加者については、端末内識別子をブラウザに保存します。"
        icon={<Database className="h-5 w-5" />}
        highlights={[
          "ログイン時にはメールアドレス、氏名、認証に必要な識別情報を取得します。",
          "セッション名、目的、背景、参加者名、回答、自由記述、レポートを保存します。",
          "アクセス解析、障害調査、匿名参加者識別のための技術情報を取得します。",
        ]}
      >
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <div className={infoCardClassName}>
            <h3 className="text-[14px] leading-[18px] font-semibold text-foreground">
              アカウント・認証情報
            </h3>
            <p className="mt-1 text-[13px] leading-[18px] text-muted-foreground">
              ログイン時のメールアドレス、氏名、認証に必要な識別情報
            </p>
          </div>
          <div className={infoCardClassName}>
            <h3 className="text-[14px] leading-[18px] font-semibold text-foreground">
              セッション情報
            </h3>
            <p className="mt-1 text-[13px] leading-[18px] text-muted-foreground">
              セッション名、目的、背景情報、公開設定、主催者
              ID、作成日時、管理用トークン
            </p>
          </div>
          <div className={infoCardClassName}>
            <h3 className="text-[14px] leading-[18px] font-semibold text-foreground">
              参加情報
            </h3>
            <p className="mt-1 text-[13px] leading-[18px] text-muted-foreground">
              参加者名、回答内容、自由記述、追加意見、個人レポート、全体レポート
            </p>
          </div>
          <div className={infoCardClassName}>
            <h3 className="text-[14px] leading-[18px] font-semibold text-foreground">
              利用情報
            </h3>
            <p className="mt-1 text-[13px] leading-[18px] text-muted-foreground">
              閲覧画面、イベント送信、ブラウザ情報、IP
              アドレス、アクセス日時などの利用データ
            </p>
          </div>
          <div className={infoCardClassName}>
            <h3 className="text-[14px] leading-[18px] font-semibold text-foreground">
              端末内識別子
            </h3>
            <p className="mt-1 text-[13px] leading-[18px] text-muted-foreground">
              ログインしていない参加者を区別するために、ブラウザの localStorage
              に保存される識別子
            </p>
          </div>
          <div className={infoCardClassName}>
            <h3 className="text-[14px] leading-[18px] font-semibold text-foreground">
              お問い合わせ情報
            </h3>
            <p className="mt-1 text-[13px] leading-[18px] text-muted-foreground">
              当社への連絡時に提供される氏名、メールアドレス、本文その他の情報
            </p>
          </div>
        </div>

        <PrivacyNoticeDisclosure title="入力を避けてほしい情報">
          <p>
            共有権限のない第三者情報、営業秘密、センシティブな個人情報など、主催者や参加者が正当な根拠なく共有できない情報は入力しないでください。
          </p>
          <p>
            特に自由記述欄は情報量が多くなりやすいため、閲覧される前提で取り扱うべきでない情報が含まれないよう注意してください。
          </p>
        </PrivacyNoticeDisclosure>
      </PrivacyNoticeSection>

      <PrivacyNoticeSection
        id="purpose"
        index={3}
        title="集めた情報の使い道"
        summary="取得した情報は、サービス提供、本人確認、AI機能の実行、障害対応、不正利用防止、品質改善、重要なお知らせのために使います。"
        icon={<Sparkles className="h-5 w-5" />}
        highlights={[
          "セッションの作成・管理・参加、本人確認、回答の保存に使います。",
          "質問生成、回答整理、レポート生成などの AI 機能に使います。",
          "品質改善のために使いますが、当社の汎用モデル学習には使いません。",
        ]}
      >
        <div className="grid gap-4 md:grid-cols-2">
          <div className={infoCardClassName}>
            <h3 className="text-[14px] leading-[18px] font-semibold text-foreground">
              サービス提供
            </h3>
            <p className="mt-1 text-[13px] leading-[18px] text-muted-foreground">
              セッションの作成・管理・参加、レポートの表示、利用者サポート、重要なお知らせの送付に利用します。
            </p>
          </div>
          <div className={infoCardClassName}>
            <h3 className="text-[14px] leading-[18px] font-semibold text-foreground">
              品質改善と安全性
            </h3>
            <p className="mt-1 text-[13px] leading-[18px] text-muted-foreground">
              利用状況の把握、UI
              改善、障害調査、不正利用防止、セキュリティ対応に利用します。
            </p>
          </div>
        </div>

        <div className="rounded-sm border border-border bg-muted p-[15px]">
          <h3 className="text-[14px] leading-[18px] font-semibold text-foreground">
            学習目的での利用について
          </h3>
          <p className="mt-1 text-[13px] leading-[18px] text-muted-foreground">
            当社は、本サービスに入力されたセッション本文、回答、自由記述等を、当社自身の汎用的なモデル学習データとして利用しません。
            ただし、AI 機能の提供に必要な範囲で外部 AI
            サービスへ送信する場合があります。
          </p>
        </div>

        <PrivacyNoticeDisclosure title="具体的な利用目的の一覧" defaultOpen>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              本サービスの提供、本人確認、セッションの作成・管理・参加のため
            </li>
            <li>
              質問生成、回答整理、レポート生成その他の AI 機能を提供するため
            </li>
            <li>
              障害調査、不正利用防止、セキュリティ対応、サポート対応のため
            </li>
            <li>利用状況の把握、品質改善、UI 改善、運用改善のため</li>
            <li>規約変更、重要なお知らせ、サービス上必要な連絡のため</li>
          </ul>
        </PrivacyNoticeDisclosure>
      </PrivacyNoticeSection>

      <PrivacyNoticeSection
        id="host-participant"
        index={4}
        title="主催者と参加者の関係"
        summary={`${LEGAL_SERVICE_NAME} は、主催者が参加者を招待して認識を集めるサービスです。そのため、回答内容がどこまで見えるか、何を入力してよいかを参加前に理解しておく必要があります。`}
        icon={<Users className="h-5 w-5" />}
        highlights={[
          "主催者は参加者の回答、自由記述、追加意見、生成レポートを閲覧できる場合があります。",
          "参加者は主催者に見られて困る情報を入力しないでください。",
          "主催者は必要に応じて参加者や所属組織へ説明し、承認を得る責任を負います。",
        ]}
      >
        <div className="grid gap-4 md:grid-cols-3">
          <div className={infoCardClassName}>
            <h3 className="text-[14px] leading-[18px] font-semibold text-foreground">
              主催者から見える範囲
            </h3>
            <p className="mt-1 text-[13px] leading-[18px] text-muted-foreground">
              回答、自由記述、追加意見、個人レポート、全体レポートなどが主催者に共有される場合があります。
            </p>
          </div>
          <div className={infoCardClassName}>
            <h3 className="text-[14px] leading-[18px] font-semibold text-foreground">
              参加者への注意
            </h3>
            <p className="mt-1 text-[13px] leading-[18px] text-muted-foreground">
              第三者の個人情報、共有権限のない情報、主催者に見られて困る情報は入力しないでください。
            </p>
          </div>
          <div className={infoCardClassName}>
            <h3 className="text-[14px] leading-[18px] font-semibold text-foreground">
              事前説明
            </h3>
            <p className="mt-1 text-[13px] leading-[18px] text-muted-foreground">
              主催者は、組織内ルールや守秘義務に照らして、本サービスの利用が適切かを確認してください。
            </p>
          </div>
        </div>

        <PrivacyNoticeDisclosure title="補足: 匿名参加でも記録されるもの">
          <p>
            ログインしていない参加者については、回答の継続性を保つためにブラウザの
            localStorage に識別子を保存します。
          </p>
          <p>
            これは匿名参加者を区別するためのもので、参加者が入力した回答や自由記述と結び付いて保存されます。
          </p>
        </PrivacyNoticeDisclosure>
      </PrivacyNoticeSection>

      <PrivacyNoticeSection
        id="vendors"
        index={5}
        title="第三者サービスと海外移転"
        summary="サービス提供のために認証、データ保存、AI 処理、アクセス解析、障害監視を外部サービスに委託しています。委託先が日本国外に所在する場合があります。"
        icon={<Globe className="h-5 w-5" />}
        highlights={[
          "認証、保存、AI、解析、障害監視をそれぞれ専門サービスに委託しています。",
          "AI 機能のために、必要な範囲で OpenRouter / Google Gemini に情報を送信します。",
          "委託先が海外に所在する場合があります。",
        ]}
      >
        <div className="grid gap-4 md:grid-cols-2">
          {LEGAL_SERVICE_PROVIDERS.map((service) => (
            <div key={service.name} className={infoCardClassName}>
              <h3 className="text-[14px] leading-[18px] font-semibold text-foreground">
                {service.name}
              </h3>
              <p className="mt-1 text-[13px] leading-[18px] text-muted-foreground">
                目的: {service.purpose}
              </p>
              <p className="mt-1 text-sm leading-7 text-muted-foreground">
                主な取扱情報: {service.data}
              </p>
            </div>
          ))}
        </div>

        <PrivacyNoticeDisclosure title="委託先の管理について">
          <p>
            これらの事業者は、それぞれの契約、利用規約、プライバシーポリシーに従って情報を取り扱います。
          </p>
          <p>
            当社は、提供先の選定、アクセス権限の管理、送信範囲の最小化に努めますが、各外部サービスの運用や所在国法制に起因するリスクが完全になくなるわけではありません。
          </p>
        </PrivacyNoticeDisclosure>
      </PrivacyNoticeSection>

      <PrivacyNoticeSection
        id="retention"
        index={6}
        title="保存期間と削除"
        summary="取得した情報は、本サービスの提供、品質改善、サポート、法令遵守などの正当な目的に必要な期間保存し、不要になったものから順次削除または匿名化します。"
        icon={<Clock3 className="h-5 w-5" />}
        highlights={[
          "保存期間は一律ではなく、用途と法令上の必要性に応じて決まります。",
          "不要になった情報は削除、匿名化、その他合理的な方法で処理します。",
          "障害対応や不正防止のため、一時的に保全することがあります。",
        ]}
      >
        <div className="grid gap-4 md:grid-cols-3">
          <div className={infoCardClassName}>
            <h3 className="text-[14px] leading-[18px] font-semibold text-foreground">
              通常の保存
            </h3>
            <p className="mt-1 text-[13px] leading-[18px] text-muted-foreground">
              セッション情報や回答は、サービス提供、サポート、運用改善に必要な期間保存します。
            </p>
          </div>
          <div className={infoCardClassName}>
            <h3 className="text-[14px] leading-[18px] font-semibold text-foreground">
              削除・匿名化
            </h3>
            <p className="mt-1 text-[13px] leading-[18px] text-muted-foreground">
              保存の必要がなくなった情報は、削除、匿名化、またはそれに準ずる合理的な方法で順次処理します。
            </p>
          </div>
          <div className={infoCardClassName}>
            <h3 className="text-[14px] leading-[18px] font-semibold text-foreground">
              例外
            </h3>
            <p className="mt-1 text-[13px] leading-[18px] text-muted-foreground">
              法令上保存が求められる情報や、障害対応・不正防止のため一時的に保全が必要な情報は、この限りではありません。
            </p>
          </div>
        </div>
      </PrivacyNoticeSection>

      <PrivacyNoticeSection
        id="security"
        index={7}
        title="安全管理"
        summary="認証基盤、アクセス制御、委託先管理、監視ツールなどを用いて合理的な安全管理措置を講じます。ただし、インターネット上のリスクを完全になくすことはできません。"
        icon={<Lock className="h-5 w-5" />}
        highlights={[
          "認証基盤とアクセス制御を用いて、閲覧権限を管理します。",
          "障害解析のために技術ログを収集し、エラー発生時には Sentry のリプレイが取得される場合があります。",
          "完全な安全性を保証するものではありません。",
        ]}
      >
        <div className="grid gap-4 md:grid-cols-2">
          <div className={infoCardClassName}>
            <h3 className="text-[14px] leading-[18px] font-semibold text-foreground">
              技術的・組織的対策
            </h3>
            <p className="mt-1 text-[13px] leading-[18px] text-muted-foreground">
              認証基盤の利用、アクセス制御、委託先管理、監視ツールの活用その他の合理的な安全管理措置を講じます。
            </p>
          </div>
          <div className={infoCardClassName}>
            <h3 className="text-[14px] leading-[18px] font-semibold text-foreground">
              限界
            </h3>
            <p className="mt-1 text-[13px] leading-[18px] text-muted-foreground">
              インターネット通信、外部サービス、利用者端末の状況などに起因するリスクを完全に排除することはできず、完全な安全性を保証するものではありません。
            </p>
          </div>
        </div>
      </PrivacyNoticeSection>

      <PrivacyNoticeSection
        id="rights"
        index={8}
        title="あなたの選択と権利"
        summary="当社が保有する個人情報について、本人から利用目的の通知、開示、訂正、追加、削除、利用停止等の請求があった場合、法令に従って対応します。"
        icon={<Scale className="h-5 w-5" />}
        highlights={[
          "開示、訂正、追加、削除、利用停止等の請求に対応します。",
          `窓口は ${LEGAL_CONTACT_EMAIL} です。`,
          "本人確認や対象データの特定のため、追加情報をお願いする場合があります。",
        ]}
      >
        <div className="grid gap-4 md:grid-cols-2">
          <div className={infoCardClassName}>
            <h3 className="text-[14px] leading-[18px] font-semibold text-foreground">
              できること
            </h3>
            <p className="mt-1 text-[13px] leading-[18px] text-muted-foreground">
              利用目的の通知、開示、訂正、追加、削除、利用停止等について、法令の範囲内で請求できます。
            </p>
          </div>
          <div className={infoCardClassName}>
            <h3 className="text-[14px] leading-[18px] font-semibold text-foreground">
              ご連絡方法
            </h3>
            <p className="mt-1 text-[13px] leading-[18px] text-muted-foreground">
              ご希望の内容と対象セッションが分かる情報を添えて、
              <a
                href={`mailto:${LEGAL_CONTACT_EMAIL}`}
                className="font-medium underline underline-offset-4"
              >
                {LEGAL_CONTACT_EMAIL}
              </a>
              までご連絡ください。
            </p>
          </div>
        </div>

        <PrivacyNoticeDisclosure title="手続の進み方">
          <p>
            お問い合わせ内容と本人確認の要否に応じて、必要な確認事項や回答までの流れを個別にご案内します。
          </p>
          <p>
            主催者と参加者の関係が絡むデータについては、対象データの特定や権限確認のため、追加の説明をお願いする場合があります。
          </p>
        </PrivacyNoticeDisclosure>
      </PrivacyNoticeSection>

      <PrivacyNoticeSection
        id="changes"
        index={9}
        title="ポリシーの改定"
        summary="法令改正、サービス内容の変更、運用上の必要性などに応じて、本ポリシーを改定することがあります。重要な変更がある場合は、サービス上の表示その他の適切な方法で周知します。"
        icon={<RefreshCw className="h-5 w-5" />}
        highlights={[
          "改定理由は、法令改正、仕様変更、運用見直しなどです。",
          "重要な変更はサービス上の表示その他の方法で周知します。",
          `現行版の最終更新日は ${LEGAL_LAST_UPDATED} です。`,
        ]}
      >
        <p>
          当社は、法令改正、サービス内容の変更、運用上の必要性その他の理由により、本ポリシーを改定することがあります。
        </p>
        <p>
          重要な変更がある場合は、本サービス上の表示その他の適切な方法で周知します。
        </p>
      </PrivacyNoticeSection>
    </PrivacyNoticeLayout>
  );
}
