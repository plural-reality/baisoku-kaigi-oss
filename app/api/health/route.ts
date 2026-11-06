import axios from "axios";
import { NextResponse } from "next/server";
import { cspMode } from "@/lib/csp";
import {
  type ParticipantTokenStatus,
  participantTokenStatus,
} from "@/lib/participant-token";
import { supabase } from "@/lib/supabase";

type CheckStatus = "ok" | "error";

interface HealthResponse {
  status: "ok" | "degraded" | "error";
  checks: {
    supabase: CheckStatus;
    openrouter: CheckStatus;
  };
  // Security-rollout readback (audit 2026-10-06): lets an operator confirm after
  // a deploy which auth / CSP posture is live, without reading server logs. No
  // secret material — booleans and a date only.
  security: {
    participantToken: ParticipantTokenStatus;
    cspMode: ReturnType<typeof cspMode>;
  };
}

async function checkSupabase(): Promise<CheckStatus> {
  try {
    const { error } = await supabase.from("sessions").select("id").limit(1);
    return error ? "error" : "ok";
  } catch {
    return "error";
  }
}

async function checkOpenRouter(): Promise<CheckStatus> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return "error";
  }
  try {
    // Hit the authenticated key endpoint, not the public /models ping: this is
    // the only check that catches a disabled key or an exhausted per-key credit
    // limit — the exact failure modes behind the 402/403 report-generation
    // outages that the unauthenticated ping silently reported as healthy.
    const { data } = await axios.get<{
      data?: { limit: number | null; limit_remaining: number | null };
    }>("https://openrouter.ai/api/v1/key", {
      headers: { Authorization: `Bearer ${apiKey}` },
      timeout: 5000,
    });
    const limit = data?.data?.limit ?? null;
    const remaining = data?.data?.limit_remaining ?? null;
    const limitExhausted =
      limit !== null && remaining !== null && remaining <= 0;
    return limitExhausted ? "error" : "ok";
  } catch {
    return "error";
  }
}

export async function GET() {
  const [supabaseStatus, openrouterStatus] = await Promise.all([
    checkSupabase(),
    checkOpenRouter(),
  ]);

  const allDown = supabaseStatus === "error" && openrouterStatus === "error";

  const body: HealthResponse = {
    status: allDown
      ? "error"
      : supabaseStatus === "ok" && openrouterStatus === "ok"
        ? "ok"
        : "degraded",
    checks: {
      supabase: supabaseStatus,
      openrouter: openrouterStatus,
    },
    security: {
      participantToken: participantTokenStatus(),
      cspMode: cspMode(),
    },
  };

  return NextResponse.json(body, { status: allDown ? 503 : 200 });
}
