import { createHash } from "node:crypto";

import {
  type ContentLanguage,
  characterBudget,
  outputLanguageRule,
} from "@/lib/content-language";
import { callLLM, FAST_MODEL } from "@/lib/llm";
import { supabase } from "@/lib/supabase";

// じぶんレポート地図で「その人が全体の中でどんな立ち位置か」を本人レポートだけから
// 一言で生成する。生成タイミング(個人レポート作成時の pre-warm / ドットホバー時の
// オンデマンド)を問わず同一 cacheKey になるよう、プロンプト生成を単一正本にする。
// これにより作成時に温めた一言を、ホバーはキャッシュヒットで即時に読める(=ローディング無し)。

const cleanExcerpt = (markdown: string): string =>
  markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_`>#-]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 600);

// Japanese sessions keep the exact original prompt so existing cache keys stay
// valid; other languages prefix the output-language rule (and so get their own keys).
const buildStancePrompt = (
  content: string,
  language: ContentLanguage = "ja",
): string =>
  [outputLanguageRule(language), buildJapaneseStancePrompt(content)]
    .filter((part): part is string => part !== null)
    .join("\n\n");

const buildJapaneseStancePrompt = (content: string): string =>
  `次は住民一人の「じぶんレポート」の抜粋です。この人が村の議論全体の中でどんな立ち位置・ニュアンスかを、本人のレポートに即して一言で要約してください。
- 20〜38文字程度の簡潔な句または一文。人名や「〜な人」等の紋切り型は書かない。
- 単独の抽象名詞（「活性化」等）は禁止。「何を・どう考えているか」が分かる句にする。

# レポート抜粋
${cleanExcerpt(content)}

立ち位置の一言だけを、前置き・記号・引用符なしで1行で出力してください。`;

const keyFromPrompt = (prompt: string): string =>
  `report-stance:v1:${createHash("sha256").update(prompt).digest("hex")}`;

// 本人レポート本文 → 立ち位置キャッシュキー。生成・読取・バッチ読取で必ず同一キーに
// なるよう、キー導出をこの1関数に集約する(プロンプトがズレると cache miss になる)。
export const stanceCacheKey = (
  content: string,
  language: ContentLanguage = "ja",
): string => keyFromPrompt(buildStancePrompt(content, language));

// 本人レポート本文 → 立ち位置の一言(キャッシュ付き)。空/失敗時は null。
export const generateReportStance = async (
  content: string | null | undefined,
  language: ContentLanguage = "ja",
): Promise<string | null> => {
  const trimmed = content?.trim();
  if (!trimmed) return null;

  const prompt = buildStancePrompt(trimmed, language);
  const cacheKey = keyFromPrompt(prompt);

  const { data: cachedRow } = await supabase
    .from("llm_cache")
    .select("response")
    .eq("cache_key", cacheKey)
    .maybeSingle();
  if (cachedRow?.response) return cachedRow.response;

  const raw = await callLLM([{ role: "user", content: prompt }], FAST_MODEL, {
    reasoningEffort: "low",
    maxTokens: 256,
  });
  const stance =
    raw
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0)
      ?.replace(/^["'「『]+|["'」』]+$/g, "")
      .slice(0, characterBudget(60, language)) ?? "";

  if (stance) {
    await supabase
      .from("llm_cache")
      .upsert({ cache_key: cacheKey, response: stance });
  }
  return stance || null;
};

// 個人レポート作成直後の fire-and-forget 用: 立ち位置を先に生成してキャッシュを温める。
// 失敗しても本体フローに影響させない。
export const warmReportStance = (
  content: string | null | undefined,
  language: ContentLanguage = "ja",
): void => {
  void generateReportStance(content, language).catch((e) => {
    console.warn("warmReportStance failed:", e);
  });
};

// 複数レポートの立ち位置を llm_cache から一括読み(キャッシュ専用・生成しない)。
// report-map が各参加者に立ち位置を最初から同梱するために使う(ホバー時の遅延なし)。
// id → 立ち位置。キャッシュ未生成の人は含めない(その人はホバーで名前のみ表示)。
export const readCachedStances = async (
  reports: readonly { id: string; content: string | null | undefined }[],
  language: ContentLanguage = "ja",
): Promise<Record<string, string>> => {
  const keyed = reports.flatMap(({ id, content }) => {
    const trimmed = content?.trim();
    return trimmed ? [{ id, key: stanceCacheKey(trimmed, language) }] : [];
  });
  if (keyed.length === 0) return {};

  // 同一内容の参加者はキーが重複する。クエリはユニークキーで投げ、応答は各 id に
  // 展開する(重複内容の人も全員 stance を得る。キーで dedup すると取りこぼす)。
  const uniqueKeys = [...new Set(keyed.map(({ key }) => key))];
  // .in() の URL 肥大(数百件 × 81字)を避けるため 80 件ずつに分割して並列取得する。
  const batches = Array.from(
    { length: Math.ceil(uniqueKeys.length / 80) },
    (_, i) => uniqueKeys.slice(i * 80, i * 80 + 80),
  );
  const rows = (
    await Promise.all(
      batches.map((batch) =>
        supabase
          .from("llm_cache")
          .select("cache_key, response")
          .in("cache_key", batch),
      ),
    )
  ).flatMap((r) => {
    // Supabase は DB エラーでも reject せず {data:null,error} を返す。あるバッチが
    // 失敗すると立ち位置がサイレントに欠落する(名前のみに劣化)ので必ずログする。
    if (r.error) console.warn("readCachedStances: batch read failed:", r.error);
    return r.data ?? [];
  });
  const responseByKey = new Map(
    rows.flatMap((row) =>
      row.response ? [[row.cache_key, row.response]] : [],
    ),
  );

  return Object.fromEntries(
    keyed.flatMap(({ id, key }) => {
      const response = responseByKey.get(key);
      return response ? [[id, response]] : [];
    }),
  );
};
