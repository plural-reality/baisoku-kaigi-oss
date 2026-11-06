import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import {
  LegalDocumentLayout,
  LegalSection,
} from "@/components/legal/LegalDocumentLayout";
import { LEGAL_OPERATOR_NAME, LEGAL_SERVICE_NAME } from "@/lib/legal";
import { buildMetadata, pageTitle } from "@/lib/metadata";

export async function generateMetadata(): Promise<Metadata> {
  const [locale, t] = await Promise.all([
    getLocale(),
    getTranslations("legal"),
  ]);
  return buildMetadata({
    title: pageTitle(t("terms"), locale),
    description: t("termsDescription"),
    url: "/terms",
    locale,
  });
}

const toc = [
  { id: "scope", label: "適用" },
  { id: "service", label: "本サービスの内容" },
  { id: "registration", label: "アカウント・参加" },
  { id: "host", label: "主催者の責任" },
  { id: "participant", label: "参加者の注意事項" },
  { id: "prohibited", label: "禁止事項" },
  { id: "content", label: "入力内容とレポートの扱い" },
  { id: "ai", label: "AI出力に関する注意" },
  { id: "change-stop", label: "変更・停止・終了" },
  { id: "liability", label: "免責と責任制限" },
  { id: "revision", label: "規約変更" },
  { id: "law", label: "準拠法・管轄" },
] as const;

export default function TermsPage() {
  return (
    <LegalDocumentLayout
      eyebrow="Terms of Use"
      document="terms"
      subtitle="倍速会議を使うときのルール"
      description={`${LEGAL_SERVICE_NAME} は、主催者が複数人の認識を集めて整理するためのサービスです。この規約は、主催者と参加者の役割、入力してよい情報の範囲、AI出力の位置づけ、サービス運営上の責任分界を定めるものです。`}
      summary={[
        {
          label: "主催者の責任",
          value:
            "参加者への説明、共有権限の確認、組織内ルールへの適合は主催者が担います。",
        },
        {
          label: "参加者の注意",
          value: "回答や自由記述は主催者に閲覧される前提で入力してください。",
        },
        {
          label: "AI出力の位置づけ",
          value:
            "分析結果やレポートは意思決定を補助する参考情報であり、完全性や正確性を保証するものではありません。",
        },
      ]}
      toc={toc.map((item) => ({ ...item }))}
    >
      <LegalSection id="scope" index={1} title="適用">
        <p>
          本利用規約（以下「本規約」といいます。）は、
          {LEGAL_OPERATOR_NAME}
          （以下「当社」といいます。）が提供する
          {LEGAL_SERVICE_NAME}
          の利用条件を定めるものです。
        </p>
        <p>
          本サービスを利用する主催者および参加者は、本規約および当社のプライバシーポリシーに同意した上で本サービスを利用するものとします。
        </p>
      </LegalSection>

      <LegalSection id="service" index={2} title="本サービスの内容">
        <p>
          本サービスは、主催者がセッションを作成し、参加者の回答や自由記述を集め、AIを用いて質問生成や分析レポート生成を行うためのWebサービスです。
        </p>
        <p>
          当社は、本サービスの全部または一部を、無償または有償、正式版またはベータ版として提供する場合があります。
        </p>
      </LegalSection>

      <LegalSection id="registration" index={3} title="アカウント・参加">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            主催者は、ログインまたは当社が定める方法によりセッションを作成できます。
          </li>
          <li>
            参加者は、主催者から共有された導線を通じてセッションに参加できます。
          </li>
          <li>
            利用者は、登録情報や参加時に入力する情報について、真実かつ最新の内容を提供するものとします。
          </li>
        </ul>
      </LegalSection>

      <LegalSection id="host" index={4} title="主催者の責任">
        <p>主催者は、特に次の事項について責任を負います。</p>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            参加者に対して、本サービスの利用、回答の閲覧範囲、レポート共有の可能性を事前に説明すること
          </li>
          <li>
            組織内規程、守秘義務、労務上の配慮、第三者との契約その他適用されるルールに反しない範囲で本サービスを利用すること
          </li>
          <li>
            共有権限のない個人情報、営業秘密、機微情報その他の情報を、適法な根拠なく入力しないこと
          </li>
          <li>
            招待した参加者、共有リンク、管理用トークン等を適切に管理すること
          </li>
        </ul>
      </LegalSection>

      <LegalSection id="participant" index={5} title="参加者の注意事項">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            参加者は、主催者に閲覧される前提で回答、自由記述、追加意見を入力してください。
          </li>
          <li>
            参加者は、第三者の権利を侵害する情報、共有権限のない情報、誹謗中傷その他不適切な内容を入力してはなりません。
          </li>
          <li>
            参加者は、自己の判断で本サービスを利用し、必要に応じて主催者に取扱い範囲を確認するものとします。
          </li>
        </ul>
      </LegalSection>

      <LegalSection id="prohibited" index={6} title="禁止事項">
        <p>利用者は、次の行為を行ってはなりません。</p>
        <ul className="list-disc space-y-2 pl-5">
          <li>法令、公序良俗、本規約に違反する行為</li>
          <li>
            なりすまし、不正アクセス、リバースエンジニアリング、脆弱性探索
          </li>
          <li>本サービスの運営を妨害する行為、過度な負荷をかける行為</li>
          <li>第三者の個人情報、秘密情報、知的財産権を侵害する行為</li>
          <li>
            AI出力を偽装・改ざんし、あたかも当社が保証した事実であるかのように用いる行為
          </li>
          <li>当社が不適切と合理的に判断する行為</li>
        </ul>
      </LegalSection>

      <LegalSection id="content" index={7} title="入力内容とレポートの扱い">
        <p>
          利用者が本サービスに入力した文章、回答、資料その他の情報に関する権利は、当該利用者または正当な権利者に留保されます。
        </p>
        <p>
          利用者は、当社に対し、本サービスの提供、表示、複製、保存、解析、要約、レポート生成その他本サービス運営に必要な範囲で、当該情報を利用するための非独占的な権利を許諾するものとします。
        </p>
        <p>
          主催者は、参加者から収集した情報や社内資料等を本サービスに入力するについて、必要な権限・同意・承認を取得していることを保証するものとします。
        </p>
      </LegalSection>

      <LegalSection id="ai" index={8} title="AI出力に関する注意">
        <p>
          本サービスでは、AIを利用して質問候補、自由記述の補助、分析レポート等を生成します。
        </p>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            AI出力は、正確性、完全性、再現性、特定目的適合性を保証しません。
          </li>
          <li>
            AI出力は、法務、人事、医療、財務その他の専門判断の代替ではなく、意思決定の唯一の根拠として用いることを想定していません。
          </li>
          <li>
            利用者は、重要な判断を行う前に、必要に応じて一次情報や専門家の確認を行うものとします。
          </li>
        </ul>
      </LegalSection>

      <LegalSection id="change-stop" index={9} title="変更・停止・終了">
        <p>
          当社は、保守、障害対応、仕様変更、セキュリティ上の必要その他の理由により、本サービスの全部または一部を変更、停止または終了することがあります。
        </p>
        <p>
          重要な変更または終了がある場合、当社は、本サービス上の表示その他適切な方法で周知するよう努めます。
        </p>
      </LegalSection>

      <LegalSection id="liability" index={10} title="免責と責任制限">
        <p>
          当社は、本サービスに事実上または法律上の瑕疵がないこと、継続的に利用できること、または特定の結果が得られることを保証しません。
        </p>
        <p>
          当社は、当社の故意または重過失による場合を除き、本サービスの利用または利用不能に起因して生じた特別損害、間接損害、逸失利益について責任を負いません。
        </p>
        <p>
          当社が責任を負う場合であっても、法令上許される範囲で、通常かつ直接の損害に限るものとします。
        </p>
      </LegalSection>

      <LegalSection id="revision" index={11} title="規約変更">
        <p>
          当社は、法令改正、サービス内容の変更、運用上の必要性その他の理由により、本規約を変更することがあります。
        </p>
        <p>
          変更後の本規約は、本サービス上に表示した時点または当社が別途定めた時点から効力を生じます。
        </p>
      </LegalSection>

      <LegalSection id="law" index={12} title="準拠法・管轄">
        <p>本規約は日本法に準拠して解釈されます。</p>
        <p>
          本サービスまたは本規約に関して当社と利用者との間で紛争が生じた場合、東京地方裁判所を第一審の専属的合意管轄裁判所とします。
        </p>
      </LegalSection>
    </LegalDocumentLayout>
  );
}
