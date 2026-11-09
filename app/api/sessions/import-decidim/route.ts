export const dynamic = "force-dynamic";

import { type NextRequest, NextResponse } from "next/server";
import { getTranslations } from "next-intl/server";
import { getHostUserIdFromRequest } from "@/lib/auth";
import { toContentLanguage } from "@/lib/content-language";
import {
  type DecidimSessionBrief,
  generateDecidimSessionBrief,
} from "@/lib/llm";
import {
  cacheKeyFor,
  readCache,
  takeRateSlot,
  writeCache,
} from "@/lib/llm-user-guard";
import {
  type DecidimFailure,
  readDecidimDiscussion,
} from "@/lib/server/decidim/api";
import { postToDecidim } from "@/lib/server/decidim/http";
import { parseDecidimUrl } from "@/lib/server/decidim/url";
import { respondExclusive } from "@/lib/server/single-flight";

type ImportResult = DecidimSessionBrief &
  Readonly<{ sourceUrl: string; truncated: boolean }>;

const FAILURE_STATUS: Readonly<Record<DecidimFailure, number>> = {
  unavailable: 502,
  notFound: 404,
  unsupported: 502,
  noContent: 422,
};

// Read-only: fetches a public Decidim discussion and drafts a session from it.
// Creating the session stays with POST /api/sessions, after the host has seen
// the draft in the form.
export const POST = async (request: NextRequest): Promise<Response> => {
  const userId = await getHostUserIdFromRequest(request);
  if (!userId) {
    return NextResponse.json(
      { error: "Unauthorized: Missing user ID" },
      { status: 401 },
    );
  }

  const t = await getTranslations("decidimImport");
  const fail = (
    code: Parameters<typeof t>[0],
    status: number,
    headers?: HeadersInit,
  ) =>
    NextResponse.json({ error: code, message: t(code) }, { status, headers });

  const body: unknown = await request.json().catch(() => undefined);
  const { url, language } = (body ?? {}) as {
    url?: unknown;
    language?: unknown;
  };
  const target = typeof url === "string" ? parseDecidimUrl(url) : undefined;
  if (target === undefined) {
    return fail("invalidUrl", 400);
  }
  const contentLanguage = toContentLanguage(language);

  const cacheKey = cacheKeyFor("decidim-import", userId, [
    target.canonicalUrl,
    contentLanguage,
  ]);
  const cached = readCache<ImportResult>(cacheKey);
  if (cached) {
    return NextResponse.json(cached);
  }

  const rate = takeRateSlot("decidim-import", userId);
  if (!rate.allowed) {
    return fail("rateLimited", 429, {
      "Retry-After": String(rate.retryAfterSeconds),
    });
  }

  return respondExclusive(`decidim-import:${userId}`, async () => {
    const read = await readDecidimDiscussion(
      postToDecidim,
      target,
      contentLanguage,
    );
    if (!read.ok) {
      return fail(read.reason, FAILURE_STATUS[read.reason]);
    }
    const brief = await generateDecidimSessionBrief({
      discussion: read.discussion,
      sourceUrl: target.canonicalUrl,
      language: contentLanguage,
    }).catch((error: unknown) => {
      console.error("Decidim brief generation failed:", error);
      return undefined;
    });
    if (brief === undefined) {
      return fail("briefFailed", 502);
    }
    const result: ImportResult = {
      ...brief,
      sourceUrl: target.canonicalUrl,
      truncated: read.discussion.truncated,
    };
    writeCache(cacheKey, result);
    return NextResponse.json(result);
  });
};
