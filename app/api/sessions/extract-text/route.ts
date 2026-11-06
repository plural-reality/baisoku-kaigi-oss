export const dynamic = "force-dynamic";

import { recordLLMUsage, withLLMLimit } from "@agents/llm-limiter";
import { withRetry } from "@agents/llm-retry";
import axios from "axios";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getTranslations } from "next-intl/server";
import { getHostUserIdFromRequest } from "@/lib/auth";
import {
  type ContentLanguage,
  characterBudget,
  contentLanguageNames,
  toContentLanguage,
  withOutputLanguage,
} from "@/lib/content-language";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_FILE_COUNT = 10;
const MAX_TOTAL_BYTES = 30 * 1024 * 1024; // 30MB (matches nginx client_max_body_size)
const EXTRACT_CONCURRENCY = 2; // bound parallel native parses + OpenRouter calls
const SUMMARIZE_THRESHOLD = 3000;
const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
const FAST_MODEL = "google/gemini-3.5-flash";

// テキスト系は全て utf-8 として読む
const TEXT_EXTENSIONS: ReadonlyArray<string> = [
  "txt",
  "csv",
  "md",
  "markdown",
  "json",
  "jsonl",
  "xml",
  "html",
  "htm",
  "yaml",
  "yml",
  "toml",
  "ini",
  "cfg",
  "conf",
  "log",
  "tsv",
  "tex",
  "rst",
  "adoc",
  "org",
  "rtf",
  "env",
  "sh",
  "bash",
  "zsh",
  "fish",
  "py",
  "js",
  "ts",
  "jsx",
  "tsx",
  "rb",
  "go",
  "rs",
  "java",
  "c",
  "cpp",
  "h",
  "hpp",
  "cs",
  "swift",
  "kt",
  "sql",
  "r",
  "hs",
  "nix",
];

const BINARY_EXTENSIONS: ReadonlyArray<string> = ["pdf", "docx", "xlsx"];

const ALL_SUPPORTED_EXTENSIONS: ReadonlyArray<string> = [
  ...TEXT_EXTENSIONS,
  ...BINARY_EXTENSIONS,
];

const detectExtension = (file: File): string =>
  file.name.split(".").pop()?.toLowerCase() ?? "";

// These CJS packages are listed in serverExternalPackages (next.config.ts)
// so Next.js loads them via native require() at runtime.
import mammoth from "mammoth";
import pdfParse from "pdf-parse";
import * as XLSX from "xlsx";

const extractPdf = async (buffer: Buffer): Promise<string> => {
  const result = await pdfParse(buffer);
  return result.text;
};

const extractDocx = async (buffer: Buffer): Promise<string> => {
  const result = await mammoth.extractRawText({ buffer });
  return result.value;
};

const extractXlsx = (buffer: Buffer): string => {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  return workbook.SheetNames.map((name: string) => {
    const sheet = workbook.Sheets[name];
    const csv: string = XLSX.utils.sheet_to_csv(sheet);
    return `[${name}]\n${csv}`;
  }).join("\n\n");
};

const HTML_EXTENSIONS: ReadonlyArray<string> = ["html", "htm"];

const stripHtmlTags = (html: string): string =>
  html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ");

const extractText = async (buffer: Buffer, ext: string): Promise<string> =>
  ext === "pdf"
    ? extractPdf(buffer)
    : ext === "docx"
      ? extractDocx(buffer)
      : ext === "xlsx"
        ? extractXlsx(buffer)
        : HTML_EXTENSIONS.includes(ext)
          ? stripHtmlTags(buffer.toString("utf-8"))
          : buffer.toString("utf-8");

const summarizeText = async (
  rawText: string,
  fileName: string,
  language: ContentLanguage,
): Promise<string> => {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return rawText;

  const response = await withRetry(() =>
    withLLMLimit(() =>
      axios.post(
        OPENROUTER_API_URL,
        {
          model: FAST_MODEL,
          messages: withOutputLanguage(
            [
              {
                role: "system" as const,
                content: `あなたはドキュメント要約アシスタントです。
アップロードされたファイルの内容を、倍速会議（合意形成セッション）の「背景情報」として使えるように要約してください。

要約のルール:
- 重要な事実・日付・人名・数値・固有名詞は必ず残す
- 議論の論点や対立軸があれば明示する
- PDF抽出時のゴミ文字・空行・意味不明な断片は除去する
- 箇条書きで構造化する
- ${contentLanguageNames[language]}で出力する
- ${characterBudget(2000, language)}文字以内に収める`,
              },
              {
                role: "user" as const,
                content: `以下は「${fileName}」から抽出されたテキストです。背景情報として使える形に要約してください。\n\n${rawText.slice(0, 30000)}`,
              },
            ],
            language,
          ),
          temperature: 0.3,
        },
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "HTTP-Referer": "https://cartographer.app",
            "X-Title": "Cartographer-ExtractText",
          },
          timeout: 30000,
        },
      ),
    ),
  );

  recordLLMUsage({
    promptTokens: response.data?.usage?.prompt_tokens,
    completionTokens: response.data?.usage?.completion_tokens,
  });
  const content = response.data?.choices?.[0]?.message?.content;
  return typeof content === "string" && content.trim().length > 0
    ? content.trim()
    : rawText;
};

type ExtractResult = {
  readonly text: string;
  readonly fileName: string;
  readonly summarized: boolean;
};

type FileUploadT = Awaited<ReturnType<typeof getTranslations<"fileUpload">>>;

const processOneFile = async (
  file: File,
  language: ContentLanguage,
  t: FileUploadT,
): Promise<ExtractResult> => {
  const ext = detectExtension(file);

  if (!ALL_SUPPORTED_EXTENSIONS.includes(ext)) {
    throw new Error(t("unsupportedType", { ext }));
  }

  if (file.size > MAX_FILE_SIZE) {
    throw new Error(t("tooLarge", { name: file.name }));
  }

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const raw = await extractText(buffer, ext);
  const trimmed = raw.trim();

  if (!trimmed) {
    const hint = ext === "pdf" ? t("scannedPdf") : t("noText");
    throw new Error(`${file.name}: ${hint}`);
  }

  const needsSummary = trimmed.length > SUMMARIZE_THRESHOLD;
  const text = needsSummary
    ? await summarizeText(trimmed, file.name, language).catch(() => trimmed)
    : trimmed;

  return { text, fileName: file.name, summarized: needsSummary };
};

// Bounded concurrency: process files in ordered batches of `limit` so one
// request cannot fan out N parallel parses + LLM calls (immutable, no loops).
const chunk = <T>(xs: ReadonlyArray<T>, size: number): T[][] =>
  xs.length === 0 ? [] : [xs.slice(0, size), ...chunk(xs.slice(size), size)];

const mapWithConcurrency = async <T, R>(
  items: ReadonlyArray<T>,
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> => {
  const run = async (
    batches: ReadonlyArray<ReadonlyArray<T>>,
    acc: PromiseSettledResult<R>[],
  ): Promise<PromiseSettledResult<R>[]> =>
    batches.length === 0
      ? acc
      : run(batches.slice(1), [
          ...acc,
          ...(await Promise.allSettled(batches[0].map(fn))),
        ]);
  return run(chunk(items, limit), []);
};

export const POST = async (request: NextRequest): Promise<NextResponse> => {
  // UI-facing errors follow the viewer's UI locale (cookie / Accept-Language).
  const t = await getTranslations("fileUpload");
  try {
    // Require an authenticated identity. This endpoint drives native document
    // parsers (xlsx/pdf/docx) and the OpenRouter LLM; leaving it unauthenticated
    // exposes server compute + API cost to anonymous abuse (DoS / parser CVEs).
    const userId = await getHostUserIdFromRequest(request);
    if (!userId) {
      return NextResponse.json(
        { error: "Unauthorized: Missing user ID" },
        { status: 401 },
      );
    }

    // Reject obviously-oversized uploads before buffering the whole multipart
    // body into memory. Content-Length is spoofable, so the post-parse
    // aggregate cap + nginx client_max_body_size are the real enforcement;
    // this is a cheap fast-path guard.
    const declaredBytes = Number(request.headers.get("content-length") ?? "0");
    if (Number.isFinite(declaredBytes) && declaredBytes > MAX_TOTAL_BYTES) {
      return NextResponse.json({ error: t("totalTooLarge") }, { status: 413 });
    }

    const formData = await request.formData();
    const files = formData.getAll("files");
    const language = toContentLanguage(formData.get("language"));

    // 後方互換: 単一ファイル (key="file") もサポート
    const singleFile = formData.get("file");
    const allFiles = [
      ...files.filter((f): f is File => f instanceof File),
      ...(singleFile instanceof File ? [singleFile] : []),
    ];

    if (allFiles.length === 0) {
      return NextResponse.json({ error: t("noFile") }, { status: 400 });
    }

    if (allFiles.length > MAX_FILE_COUNT) {
      return NextResponse.json(
        { error: t("tooMany", { max: MAX_FILE_COUNT }) },
        { status: 400 },
      );
    }

    const totalBytes = allFiles.reduce((sum, file) => sum + file.size, 0);
    if (totalBytes > MAX_TOTAL_BYTES) {
      return NextResponse.json({ error: t("totalTooLarge") }, { status: 413 });
    }

    const results = await mapWithConcurrency(
      allFiles,
      EXTRACT_CONCURRENCY,
      (file) => processOneFile(file, language, t),
    );

    const successes = results.flatMap((r) =>
      r.status === "fulfilled" ? [r.value] : [],
    );
    const errors = results.flatMap((r) =>
      r.status === "rejected"
        ? [r.reason instanceof Error ? r.reason.message : String(r.reason)]
        : [],
    );

    if (successes.length === 0) {
      return NextResponse.json({ error: errors.join("\n") }, { status: 422 });
    }

    return NextResponse.json({
      results: successes,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err) {
    console.error("Text extraction failed:", err);
    return NextResponse.json({ error: t("extractFailed") }, { status: 500 });
  }
};
