import axios from "axios";

// テキスト -> 埋め込みベクトル。既存の OpenRouter キーで OpenAI 埋め込みをプロキシ取得する
// (OpenRouter は /embeddings をプロキシする。新しいプロバイダ/キーを増やさない)。
// じぶんレポート地図のサーバ計算(report-map-compute)に食わせるためのもの。

export const EMBEDDING_MODEL = "openai/text-embedding-3-small";

const CHAT_URL =
  process.env.OPENROUTER_API_URL ??
  "https://openrouter.ai/api/v1/chat/completions";
const EMBEDDINGS_URL = CHAT_URL.replace(
  /\/chat\/completions\/?$/,
  "/embeddings",
);

const MAX_CHARS = 6000; // 1 入力の上限(トークン超過回避)。長文レポートを頭から切る。
const BATCH = 96; // 1 リクエストあたりの入力数。

const embedBatch = async (
  inputs: string[],
  apiKey: string,
): Promise<number[][]> => {
  const res = await axios.post(
    EMBEDDINGS_URL,
    { model: EMBEDDING_MODEL, input: inputs },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://cartographer.app",
        "X-Title": "Cartographer",
      },
      timeout: 60000,
    },
  );
  const rows = res.data?.data;
  if (!Array.isArray(rows) || rows.length !== inputs.length) {
    throw new Error(
      `embeddings: unexpected response (${rows?.length} for ${inputs.length} inputs)`,
    );
  }
  // API は index を返すので順序を保証するため index で並べ直す。
  return [...rows]
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .map((r) => r.embedding as number[]);
};

// テキスト配列 -> 埋め込み配列(入力順)。空文字は " " に寄せて次元を揃える。
export const embedTexts = async (texts: string[]): Promise<number[][]> => {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set");

  const inputs = texts.map((t) => t.slice(0, MAX_CHARS) || " ");
  const batches = Array.from(
    { length: Math.ceil(inputs.length / BATCH) },
    (_, i) => inputs.slice(i * BATCH, i * BATCH + BATCH),
  );
  const results = await Promise.all(
    batches.map((batch) => embedBatch(batch, apiKey)),
  );
  return results.flat();
};
