export const dynamic = "force-dynamic";

import * as Sentry from "@sentry/nextjs";
import { type NextRequest, NextResponse } from "next/server";
import { createSession } from "@/lib/api/client";
import type { CreateSessionRequest } from "@/lib/api/types";
import { getHostUserIdFromRequest, getUserIdFromRequest } from "@/lib/auth";
import { isContentLanguage, toContentLanguage } from "@/lib/content-language";
import { parseDecidimUrl } from "@/lib/server/decidim/url";
import { respondExclusive } from "@/lib/server/single-flight";
import { sessionParticipantContextFields } from "@/lib/session-context";
import { supabase } from "@/lib/supabase";
import { generateSurveyStatements } from "../../../agents/llm";

type SessionRow = {
  id: string;
  title: string;
  context: string;
  goal: string;
  facilitator_context?: string | null;
  facilitator_goal?: string | null;
  is_public: boolean;
  host_user_id: string;
  admin_access_token: string;
  created_at: string;
  updated_at: string;
  participants?: { user_id: string }[] | null;
  statements?: { id: string }[] | null;
};

function mapSession(row: SessionRow) {
  const participantContextFields = sessionParticipantContextFields(row);

  return {
    id: row.id,
    title: row.title,
    context: participantContextFields.context,
    goal: participantContextFields.goal,
    isPublic: row.is_public,
    hostUserId: row.host_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function GET(request: NextRequest) {
  try {
    const userId = await getUserIdFromRequest(request);
    if (!userId) {
      return NextResponse.json(
        { error: "Unauthorized: Missing user ID" },
        { status: 401 },
      );
    }

    // participants.user_id is UUID type — skip query if userId is not UUID
    // (e.g. WorkOS IDs like "user_01..." would cause a Postgres type error)
    const isUUID =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        userId,
      );

    let participantSessionIds: string[] = [];
    if (isUUID) {
      const { data: participantSessions, error: participantSessionsError } =
        await supabase
          .from("participants")
          .select("session_id")
          .eq("user_id", userId);

      if (participantSessionsError) {
        console.error(
          "Failed to load participant session IDs:",
          participantSessionsError,
        );
        return NextResponse.json(
          { error: "Failed to fetch sessions" },
          { status: 500 },
        );
      }

      participantSessionIds = (participantSessions ?? []).map(
        (participant) => participant.session_id,
      );
    }

    const participantFilter =
      participantSessionIds.length > 0
        ? `id.in.(${participantSessionIds.map((id) => `"${id}"`).join(",")})`
        : null;

    const orFilters = [
      // host_user_id is UUID type — only filter if userId is UUID
      ...(isUUID ? [`host_user_id.eq.${userId}`] : []),
      "is_public.eq.true",
      ...(participantFilter ? [participantFilter] : []),
    ].join(",");

    const { data: sessionsData, error: sessionsError } = await supabase
      .from("sessions")
      .select(
        `
          id,
          title,
          context,
          goal,
          facilitator_context,
          facilitator_goal,
          is_public,
          host_user_id,
          admin_access_token,
          created_at,
          updated_at,
          participants ( user_id ),
          statements ( id )
        `,
      )
      .or(orFilters)
      .order("created_at", { ascending: false });

    if (sessionsError) {
      console.error("Failed to fetch sessions:", sessionsError);
      return NextResponse.json(
        { error: "Failed to fetch sessions" },
        { status: 500 },
      );
    }

    const sessionsWithRoles = (sessionsData ?? []).map((session) => {
      const mappedSession = mapSession(session);
      const participants = session.participants ?? [];
      const statements = session.statements ?? [];
      const isHost = mappedSession.hostUserId === userId;
      const isParticipant = participants.some(
        (participant) => participant.user_id === userId,
      );

      return {
        ...mappedSession,
        // Do not leak other users' host_user_id: combined with the legacy
        // Bearer-UUID identity path (app/lib/auth.ts), a leaked host UUID is
        // enough to impersonate the host. Only the host receives their own id.
        hostUserId: isHost ? mappedSession.hostUserId : undefined,
        isHost,
        isParticipant,
        adminAccessToken: isHost ? session.admin_access_token : undefined,
        _count: {
          participants: participants.length,
          statements: statements.length,
        },
      };
    });

    return NextResponse.json({ sessions: sessionsWithRoles });
  } catch (error) {
    console.error("Sessions fetch error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  return Sentry.startSpan(
    { name: "session.create", op: "api" },
    async (span) => {
      try {
        const userId = await getHostUserIdFromRequest(request);
        if (!userId) {
          return NextResponse.json(
            { error: "Unauthorized: Missing user ID" },
            { status: 401 },
          );
        }

        span.setAttribute("user.id", userId);

        const body = await request.json();
        const {
          title,
          context,
          goal,
          facilitatorContext,
          facilitatorGoal,
          language,
          sourceUrl,
        } = body as {
          title?: unknown;
          context?: unknown;
          goal?: unknown;
          facilitatorContext?: unknown;
          facilitatorGoal?: unknown;
          language?: unknown;
          sourceUrl?: unknown;
        };

        const source =
          typeof sourceUrl === "string"
            ? parseDecidimUrl(sourceUrl)
            : undefined;
        if (typeof sourceUrl !== "undefined" && source === undefined) {
          return NextResponse.json(
            { error: "Invalid value for sourceUrl" },
            { status: 400 },
          );
        }

        if (typeof language !== "undefined" && !isContentLanguage(language)) {
          return NextResponse.json(
            { error: "Invalid value for language" },
            { status: 400 },
          );
        }
        const contentLanguage = toContentLanguage(language);

        if (typeof title !== "string" || title.trim().length === 0) {
          return NextResponse.json(
            { error: "Missing required field: title" },
            { status: 400 },
          );
        }

        if (typeof goal !== "string" || goal.trim().length === 0) {
          return NextResponse.json(
            { error: "Missing required field: goal" },
            { status: 400 },
          );
        }

        if (typeof context !== "string") {
          return NextResponse.json(
            { error: "Invalid value for context" },
            { status: 400 },
          );
        }

        if (
          typeof facilitatorGoal !== "undefined" &&
          typeof facilitatorGoal !== "string"
        ) {
          return NextResponse.json(
            { error: "Invalid value for facilitatorGoal" },
            { status: 400 },
          );
        }

        if (
          typeof facilitatorContext !== "undefined" &&
          typeof facilitatorContext !== "string"
        ) {
          return NextResponse.json(
            { error: "Invalid value for facilitatorContext" },
            { status: 400 },
          );
        }

        const trimmedTitle = title.trim();
        const trimmedGoal = goal.trim();
        const trimmedContext = context.trim();
        const providedFacilitatorGoal =
          typeof facilitatorGoal === "string" &&
          facilitatorGoal.trim().length > 0
            ? facilitatorGoal.trim()
            : null;
        const providedFacilitatorContext =
          typeof facilitatorContext === "string" &&
          facilitatorContext.trim().length > 0
            ? facilitatorContext.trim()
            : null;
        // 本題(facilitator_*) を canonical として保存する。明示の facilitator が無ければ
        // 入力(purpose=goal)を本題に入れる。公開(goal/context)は本題と「異なる」場合だけ値を持ち、
        // 同じ/未指定なら空にして参加者側で本題を継承させる（重複保存しない）。
        const facilitatorGoalValue = providedFacilitatorGoal ?? trimmedGoal;
        const facilitatorContextValue =
          providedFacilitatorContext ?? trimmedContext;
        const publicGoalValue =
          trimmedGoal && trimmedGoal !== facilitatorGoalValue
            ? trimmedGoal
            : "";
        const publicContextValue =
          trimmedContext && trimmedContext !== facilitatorContextValue
            ? trimmedContext
            : "";

        span.setAttribute("session.title", trimmedTitle);

        // One creation per host at a time: a re-click after a CDN timeout
        // (the LLM path below can outlast it) must not create a duplicate
        // session while the first is still being created.
        return await respondExclusive(`session-create:${userId}`, async () => {
          // Generate initial 15 questions
          let statementTexts: string[] = [];
          try {
            const { initialQuestions } = body as {
              initialQuestions?: string[];
            };

            if (
              Array.isArray(initialQuestions) &&
              initialQuestions.every((q) => typeof q === "string") &&
              initialQuestions.length > 0
            ) {
              statementTexts = initialQuestions;
            } else {
              // Generate with minimal context (since we don't have Supabase thread history anymore)
              statementTexts = await generateSurveyStatements({
                sessionTitle: trimmedTitle,
                sessionGoal: facilitatorGoalValue,
                initialContext: facilitatorContextValue,
                eventThreadContext: "[]", // Empty history
                participantCount: 0,
                language: contentLanguage,
              });
            }
          } catch (genError) {
            console.error("Failed to generate initial statements:", genError);
            // Continue without questions if generation fails
          }

          // Call Haskell Backend
          const createReq: CreateSessionRequest = {
            title: trimmedTitle,
            purpose: trimmedGoal,
            background: trimmedContext,
            hostUserId: userId,
            initialQuestions:
              statementTexts.length > 0 ? statementTexts : undefined,
          };

          const backendRes = await createSession(createReq);

          span.setAttribute("session.id", backendRes.sessionId);
          span.setAttribute("statements.count", statementTexts.length);

          // Verify the session was projected to Supabase before returning.
          // Projection can fail silently, so we poll until the row appears.
          const MAX_ATTEMPTS = 5;
          const DELAY_MS = 200;

          const waitMs = (ms: number) =>
            new Promise<void>((resolve) => setTimeout(resolve, ms));

          const pollSession = async (attempt: number): Promise<boolean> => {
            const { data } = await supabase
              .from("sessions")
              .select("id")
              .eq("id", backendRes.sessionId)
              .single();
            return data !== null
              ? true
              : attempt >= MAX_ATTEMPTS
                ? false
                : waitMs(DELAY_MS).then(() => pollSession(attempt + 1));
          };

          const sessionExists = await pollSession(1);

          if (!sessionExists) {
            Sentry.captureMessage(
              "Session projection to Supabase failed after retries",
              { level: "error", extra: { sessionId: backendRes.sessionId } },
            );
            return NextResponse.json(
              {
                error:
                  "Session creation failed: could not verify session in database",
              },
              { status: 500 },
            );
          }

          // backend projection は purpose を sessions.goal/context に入れるが、本モデルでは
          // 本題(facilitator_*) が canonical。ここで本題へ確定し、公開(goal/context)は本題と
          // 異なる時だけ残し、同じ/未指定なら空にする（参加者側で本題を継承）。
          const { error: contextUpdateError } = await supabase
            .from("sessions")
            .update({
              facilitator_goal: facilitatorGoalValue,
              facilitator_context: facilitatorContextValue,
              goal: publicGoalValue,
              context: publicContextValue,
              language: contentLanguage,
              ...(source ? { source_url: source.canonicalUrl } : {}),
            })
            .eq("id", backendRes.sessionId);

          if (contextUpdateError) {
            Sentry.captureException(contextUpdateError, {
              extra: { sessionId: backendRes.sessionId },
            });
            return NextResponse.json(
              {
                error:
                  "Session creation failed: could not save facilitator context",
              },
              { status: 500 },
            );
          }

          Sentry.logger.info("session.create completed", {
            sessionId: backendRes.sessionId,
            statementsCount: statementTexts.length,
          });

          return NextResponse.json({
            session: {
              id: backendRes.sessionId,
              adminAccessToken: backendRes.adminAccessToken,
            },
          });
        });
      } catch (error) {
        console.error("Session creation error:", error);
        return NextResponse.json(
          { error: "Internal server error" },
          { status: 500 },
        );
      }
    },
  );
}
