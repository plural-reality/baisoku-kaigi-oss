export const dynamic = "force-dynamic";

import { createHash } from "node:crypto";
import { type NextRequest, NextResponse } from "next/server";

import { getTranslations } from "next-intl/server";
import { getUserIdFromRequest } from "@/lib/auth";
import {
  type ContentLanguage,
  toContentLanguage,
  withOutputLanguage,
} from "@/lib/content-language";
import { callLLMWithMeta } from "@/lib/llm";
import { ACCURATE_MODEL, PROMPT_VERSIONS } from "@/lib/llm-models";
import { jsonSchemaFormat } from "@/lib/llm-structured-output";
import { EMBEDDING_MODEL, embedTexts } from "@/lib/server/embeddings";
import { layoutFromVectors } from "@/lib/server/report-map-compute";
import { readCachedStances } from "@/lib/server/report-stance";
import { safeCompare } from "@/lib/server/session-access";
import { selectAllRange, supabase } from "@/lib/supabase";

interface ReportPoint {
  id: string;
  name: string;
  x: number;
  y: number;
  cluster: number;
  reportId: string;
  createdAt: string;
  preview: string;
  // 全体の中でのこの人の立ち位置の一言(キャッシュ済みのみ同梱・ホバーで即表示)。
  stance?: string;
}

interface ReportCluster {
  id: number;
  size: number;
  label?: string;
  summary?: string;
  sampleParticipant?: { name: string; preview: string };
}

interface ReportAxisPole {
  posIds: string[];
  negIds: string[];
  variance: number;
  posLabel?: string;
  negLabel?: string;
}

interface ReportAxes {
  pc1: ReportAxisPole;
  pc2: ReportAxisPole;
}

interface ReportMapData {
  participants: ReportPoint[];
  clusters: ReportCluster[];
  method: string;
  model: string;
  noiseCount: number;
  axes?: ReportAxes;
}

type ParticipantRow = {
  user_id: string;
  name: string | null;
  latest_individual_report_id: string | null;
};

type ReportRow = {
  id: string;
  participant_user_id: string;
  content_markdown: string;
  created_at: string;
};

const NOISE = -1;
const MIN_REPORTS = 3;

const insufficientDataResponse = (message: string) =>
  NextResponse.json({ status: "insufficient-data", reason: message });

const reportPreview = (markdown: string): string =>
  markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_`>#-]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);

const latestReportsByParticipant = (
  participants: readonly ParticipantRow[],
  reports: readonly ReportRow[],
): { participant: ParticipantRow; report: ReportRow }[] => {
  const byId = new Map(reports.map((report) => [report.id, report]));
  const latestByParticipant = reports.reduce((acc, report) => {
    const prev = acc.get(report.participant_user_id);
    return prev && prev.created_at >= report.created_at
      ? acc
      : acc.set(report.participant_user_id, report);
  }, new Map<string, ReportRow>());

  return participants.flatMap((participant) => {
    const report =
      (participant.latest_individual_report_id
        ? byId.get(participant.latest_individual_report_id)
        : undefined) ?? latestByParticipant.get(participant.user_id);
    const content = report?.content_markdown.trim() ?? "";
    return report && content ? [{ participant, report }] : [];
  });
};

// i18n-allow: the label older cached maps stored for anonymous participants.
const LEGACY_ANONYMOUS_NAME = "匿名";

const buildClusters = (points: readonly ReportPoint[]): ReportCluster[] =>
  Array.from(
    new Set(points.map((point) => point.cluster).filter((id) => id !== NOISE)),
  )
    .sort((a, b) => a - b)
    .map((id) => {
      const members = points.filter((point) => point.cluster === id);
      const cx =
        members.reduce((sum, point) => sum + point.x, 0) / members.length;
      const cy =
        members.reduce((sum, point) => sum + point.y, 0) / members.length;
      const sample = members.reduce(
        (best, point) => {
          const dist = (point.x - cx) ** 2 + (point.y - cy) ** 2;
          return dist < best.dist ? { dist, point } : best;
        },
        { dist: Number.POSITIVE_INFINITY, point: members[0] },
      ).point;

      return {
        id,
        size: members.length,
        sampleParticipant: sample
          ? { name: sample.name, preview: sample.preview }
          : undefined,
      };
    });

const shortenText = (s: string, n: number): string =>
  s.length > n ? `${s.slice(0, n)}…` : s;

// クラスタ重心に近い順の代表レポート preview を n 件。ラベル生成の素材。
const clusterRepPreviews = (
  data: ReportMapData,
  clusterId: number,
  n: number,
): string[] => {
  const members = data.participants.filter((p) => p.cluster === clusterId);
  if (members.length === 0) return [];
  const cx = members.reduce((s, p) => s + p.x, 0) / members.length;
  const cy = members.reduce((s, p) => s + p.y, 0) / members.length;
  return [...members]
    .sort(
      (a, b) =>
        (a.x - cx) ** 2 + (a.y - cy) ** 2 - ((b.x - cx) ** 2 + (b.y - cy) ** 2),
    )
    .slice(0, n)
    .map((p) => shortenText(p.preview, 140))
    .filter((t) => t.length > 0);
};

// 軸の極 id 群を preview に解決 (Python が既に極端順で返している)。
const poleExcerpts = (
  data: ReportMapData,
  ids: string[],
  n: number,
): string[] => {
  const byId = new Map(data.participants.map((p) => [p.id, p]));
  return ids
    .map((id) => byId.get(id)?.preview ?? "")
    .filter((t) => t.length > 0)
    .slice(0, n)
    .map((t) => shortenText(t, 140));
};

// Strict JSON schema for the narrative labels (same shape the prompt spells
// out); strict mode requires every property and no extras.
const strictObject = (properties: Record<string, unknown>) => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const POLE_LABELS_SCHEMA = strictObject({
  posLabel: { type: "string" },
  negLabel: { type: "string" },
});
const NARRATIVE_FORMAT = jsonSchemaFormat(
  "report_map_narrative",
  strictObject({
    axes: strictObject({ pc1: POLE_LABELS_SCHEMA, pc2: POLE_LABELS_SCHEMA }),
    clusters: {
      type: "array",
      items: strictObject({
        i: { type: "integer" },
        label: { type: "string" },
        summary: { type: "string" },
      }),
    },
  }),
);

// 「全体 vs 部分の差分」で軸極とクラスタを対比命名する (?narrative=1 時のみ)。
// user-map の narrative パターンを自由記述素材向けに移植。失敗しても data は無傷。
// i18n-allow: prompt for the map labels (the labels come back in the session language)
const addNarrativeLabels = async (
  data: ReportMapData,
  language: ContentLanguage,
): Promise<void> => {
  const axes = data.axes;
  if (!axes || data.clusters.length === 0) return;
  try {
    const poleBlock = (label: string, ids: string[]): string =>
      `## ${label}\n${
        poleExcerpts(data, ids, 4)
          .map((t) => `- ${t}`)
          .join("\n") || "- （なし）"
      }`;
    const clusterBlocks = data.clusters
      .map((c, i) => {
        const reps = clusterRepPreviews(data, c.id, 4)
          .map((t) => `- ${t}`)
          .join("\n");
        return `## グループ${i + 1}（${c.size}人）\n${reps || "- （代表レポートなし）"}`;
      })
      .join("\n\n");
    const prompt = `あなたは住民会議のファシリテーターです。参加者が自由記述で書いた「じぶんレポート」を意味の近さで地図化しました。地図は2つの軸(PC1=横, PC2=縦)を持ち、似た内容ほど近くに配置されます。全体（すべてのレポートの集合）の中で、各軸の両端と各グループが「何を際立って言っているか（対比）」を名付けてください。

# タスク
1. axes: 各軸の両端(極)に、その方向の代表レポートから、対になる短い対比名を付ける。
   - posLabel / negLabel は各端の立場を表す短句(最大12文字)。2端が対比になること(例:「機能を集約」↔「集落を維持」)。
   - 単独の抽象名詞(例:「活性化」「調和」)は禁止。「何を/どうしたいか」が分かる句にする。
2. clusters: 各グループの label と summary を作る。
   - label: 全体の中でそのグループだけが際立って言っていること(対比)が一目で分かる短句(最大14文字)。単独の抽象名詞・「〜派」・数値・記号は禁止。
   - summary: 全体と比べてどう違う立場・価値観の人たちかを1文で(自然な日本語・専門用語や数値なし)。
   - 良い例:「移住者の受け入れを重視」「中心部へ機能を集約」 / 悪い例:「活性化」「全体調和」

# 軸の両端の代表レポート
${poleBlock("PC1 プラス側", axes.pc1.posIds)}
${poleBlock("PC1 マイナス側", axes.pc1.negIds)}
${poleBlock("PC2 プラス側", axes.pc2.posIds)}
${poleBlock("PC2 マイナス側", axes.pc2.negIds)}

# グループごとの代表レポート
${clusterBlocks}

出力は厳密に次のJSONのみ(前後に説明やコードフェンスを付けない):
{"axes":{"pc1":{"posLabel":"...","negLabel":"..."},"pc2":{"posLabel":"...","negLabel":"..."}},"clusters":[${data.clusters
      .map((_, i) => `{"i":${i},"label":"...","summary":"..."}`)
      .join(",")}]}`;

    // Japanese keeps its historical key; other languages get their own entries.
    const cacheKey = createHash("sha256")
      .update(language === "ja" ? prompt : `${language}\n${prompt}`)
      .digest("hex");
    const { data: cachedRow } = await supabase
      .from("llm_cache")
      .select("response")
      .eq("cache_key", cacheKey)
      .maybeSingle();
    let raw: string;
    if (cachedRow?.response) {
      raw = cachedRow.response;
    } else {
      const generation = await callLLMWithMeta(
        withOutputLanguage([{ role: "user", content: prompt }], language),
        ACCURATE_MODEL,
        { responseFormat: NARRATIVE_FORMAT },
      );
      raw = generation.content;
      await supabase.from("llm_cache").upsert({
        cache_key: cacheKey,
        response: raw,
        model: generation.model,
        prompt_version: PROMPT_VERSIONS.reportMapNarrative,
      });
    }

    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return;
    const parsed = JSON.parse(match[0]) as {
      axes?: {
        pc1?: { posLabel?: string; negLabel?: string };
        pc2?: { posLabel?: string; negLabel?: string };
      };
      clusters?: { i: number; label?: string; summary?: string }[];
    };
    const applyPole = (
      pole: ReportAxisPole,
      p?: { posLabel?: string; negLabel?: string },
    ): void => {
      if (p?.posLabel?.trim()) pole.posLabel = p.posLabel.trim();
      if (p?.negLabel?.trim()) pole.negLabel = p.negLabel.trim();
    };
    applyPole(axes.pc1, parsed.axes?.pc1);
    applyPole(axes.pc2, parsed.axes?.pc2);
    for (const c of parsed.clusters ?? []) {
      const target = data.clusters[c.i];
      if (!target) continue;
      if (c.label?.trim()) target.label = c.label.trim();
      if (c.summary?.trim()) target.summary = c.summary.trim();
    }
  } catch (e) {
    console.warn("Report map narrative LLM failed; keeping unlabeled:", e);
  }
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  try {
    const { sessionId } = await params;
    const userId = await getUserIdFromRequest(request);
    const reqUrl = new URL(request.url);
    // アクセストークンは x-access-token ヘッダでのみ受け取る。URL(クエリ)に
    // 載せるとアクセスログ・履歴・proxy に平文で残るため、クエリ経路は撤去した
    // (唯一の呼び出し元 ReportMap はヘッダ送信に移行済み)。
    const accessToken = request.headers.get("x-access-token");
    const forceRefresh = reqUrl.searchParams.get("refresh") === "1";

    const { data: session, error: sessionError } = await supabase
      .from("sessions")
      .select("id, host_user_id, admin_access_token, language")
      .eq("id", sessionId)
      .single();

    if (sessionError || !session) {
      return sessionError?.code === "PGRST116"
        ? NextResponse.json({ error: "Session not found" }, { status: 404 })
        : NextResponse.json(
            { error: "Internal server error" },
            { status: 500 },
          );
    }

    const tokenOk =
      accessToken != null &&
      safeCompare(session.admin_access_token, accessToken);
    const hostOk = userId != null && session.host_user_id === userId;
    if (!tokenOk && !hostOk) {
      return NextResponse.json(
        {
          error:
            "Forbidden: a valid admin access token or host identity is required",
        },
        { status: 403 },
      );
    }

    const { data: participants, error: participantsError } =
      await selectAllRange((from, to) =>
        supabase
          .from("participants")
          .select("user_id, name, latest_individual_report_id")
          .eq("session_id", sessionId)
          .range(from, to),
      );

    if (participantsError) {
      console.error(
        "Failed to fetch participants for report map:",
        participantsError,
      );
      return NextResponse.json(
        { error: "Internal server error" },
        { status: 500 },
      );
    }

    const { data: reports, error: reportsError } = await selectAllRange(
      (from, to) =>
        supabase
          .from("individual_reports")
          .select("id, participant_user_id, content_markdown, created_at")
          .eq("session_id", sessionId)
          .order("created_at", { ascending: false })
          .range(from, to),
    );

    if (reportsError) {
      console.error(
        "Failed to fetch individual reports for report map:",
        reportsError,
      );
      return NextResponse.json(
        { error: "Internal server error" },
        { status: 500 },
      );
    }

    const items = latestReportsByParticipant(
      (participants ?? []) as ParticipantRow[],
      (reports ?? []) as ReportRow[],
    );

    if (items.length < MIN_REPORTS) {
      return insufficientDataResponse(
        (await getTranslations("reportMap"))("needThree"),
      );
    }

    // id でソートして順序非依存にする。DB の行順は環境で異なるため、ソートしないと
    // 同一データでもキャッシュキーがズレて cache miss になる(ローカルで温めたキャッシュが
    // staging/prod でヒットしない → Python 未導入の本番で 500)。
    const inputTexts = items
      .map(({ participant, report }) => ({
        id: participant.user_id,
        reportId: report.id,
        text: report.content_markdown,
      }))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    // v3: 埋め込みを OpenRouter(openai/text-embedding-3-small) に、PCA(2)+kmeans を TS で
    // 計算する版(v2 は e5+Python。埋め込み空間が変わり座標が別物なので版を上げて混在を防ぐ)。
    const cacheKey = `report-map:v3:${createHash("sha256")
      .update(JSON.stringify(inputTexts))
      .digest("hex")}`;

    let data: ReportMapData | null = null;
    if (!forceRefresh) {
      const { data: cachedRow } = await supabase
        .from("llm_cache")
        .select("response")
        .eq("cache_key", cacheKey)
        .maybeSingle();
      data = cachedRow?.response
        ? (JSON.parse(cachedRow.response) as ReportMapData)
        : null;
    }

    if (!data) {
      const metaById = new Map(
        items.map(({ participant, report }) => [
          participant.user_id,
          {
            // Anonymous participants get "" — the map labels them in the viewer's language.
            name: (participant.name ?? "").trim(),
            reportId: report.id,
            createdAt: report.created_at,
            preview: reportPreview(report.content_markdown),
          },
        ]),
      );
      // 埋め込みを API で取得し、PCA(2)+kmeans+極抽出を TS で計算する(本番に Python 不要)。
      const vectors = await embedTexts(inputTexts.map(({ text }) => text));
      const layout = layoutFromVectors(
        inputTexts.map(({ id }) => id),
        vectors,
        EMBEDDING_MODEL,
      );
      const points = layout.points.map((point): ReportPoint => {
        const meta = metaById.get(point.id);
        return {
          id: point.id,
          name: meta?.name ?? "",
          x: point.x,
          y: point.y,
          cluster: point.cluster,
          reportId: meta?.reportId ?? "",
          createdAt: meta?.createdAt ?? "",
          preview: meta?.preview ?? "",
        };
      });
      const axes: ReportAxes = {
        pc1: {
          posIds: layout.axes.pc1.pos,
          negIds: layout.axes.pc1.neg,
          variance: layout.variance[0],
        },
        pc2: {
          posIds: layout.axes.pc2.pos,
          negIds: layout.axes.pc2.neg,
          variance: layout.variance[1],
        },
      };
      data = {
        participants: points,
        clusters: buildClusters(points),
        method: layout.method,
        model: layout.model,
        noiseCount: layout.noiseCount,
        axes,
      };
      await supabase
        .from("llm_cache")
        .upsert({ cache_key: cacheKey, response: JSON.stringify(data) });
    }

    // 各参加者の「立ち位置の一言」をキャッシュから同梱する(生成しない・Python 不要)。
    // ホバー時に取りに行かず最初から表示するため、地図データと一緒に返す。
    // 地図ジオメトリのキャッシュとは独立に読むので、地図キャッシュの再生成は不要。
    const language = toContentLanguage(session.language);
    const stances = await readCachedStances(
      items.map(({ participant, report }) => ({
        id: participant.user_id,
        content: report.content_markdown,
      })),
      language,
    );
    data = {
      ...data,
      participants: data.participants
        // Maps cached before anonymous names became "" still carry the Japanese label.
        .map((p) => (p.name === LEGACY_ANONYMOUS_NAME ? { ...p, name: "" } : p))
        .map((p) => (stances[p.id] ? { ...p, stance: stances[p.id] } : p)),
      clusters: data.clusters.map((c) =>
        c.sampleParticipant?.name === LEGACY_ANONYMOUS_NAME
          ? { ...c, sampleParticipant: { ...c.sampleParticipant, name: "" } }
          : c,
      ),
    };

    if (reqUrl.searchParams.get("narrative") === "1") {
      await addNarrativeLabels(data, language);
    }

    return NextResponse.json({ status: "ok", data });
  } catch (error) {
    console.error("Error generating report map:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
