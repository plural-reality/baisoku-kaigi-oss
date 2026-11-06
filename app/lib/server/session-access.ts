import { timingSafeEqual } from "node:crypto";
import { supabase } from "@/lib/supabase";

export function safeCompare(a: string, b: string): boolean {
  if (!a || !b) return false;
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export class SessionAccessError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export type SessionHostRow = {
  id: string;
  title: string;
  context: string;
  goal: string;
  facilitator_context: string | null;
  facilitator_goal: string | null;
  language: string;
  is_public: boolean;
  host_user_id: string;
};

export type SessionAdminRow = SessionHostRow & {
  admin_access_token: string;
};

export async function requireSessionHost(
  sessionId: string,
  userId: string,
): Promise<SessionHostRow> {
  const { data: session, error } = await supabase
    .from("sessions")
    .select(
      "id, title, context, goal, facilitator_context, facilitator_goal, language, is_public, host_user_id",
    )
    .eq("id", sessionId)
    .single();

  if (error || !session) {
    // PGRST116: no row. 22P02: the id is not a UUID at all (a mistyped or probed URL).
    if (error?.code === "PGRST116" || error?.code === "22P02") {
      throw new SessionAccessError("Session not found", 404);
    }
    console.error("Failed to fetch session:", error);
    throw new SessionAccessError("Failed to load session", 500);
  }

  if (session.host_user_id !== userId) {
    throw new SessionAccessError("Forbidden", 403);
  }

  return session;
}

async function fetchSessionAdminRow(
  sessionId: string,
): Promise<SessionAdminRow> {
  const { data: session, error } = await supabase
    .from("sessions")
    .select(
      "id, title, context, goal, facilitator_context, facilitator_goal, language, is_public, host_user_id, admin_access_token",
    )
    .eq("id", sessionId)
    .single();

  if (error || !session) {
    // PGRST116: no row. 22P02: the id is not a UUID at all (a mistyped or probed URL).
    if (error?.code === "PGRST116" || error?.code === "22P02") {
      throw new SessionAccessError("Session not found", 404);
    }
    console.error("Failed to fetch session:", error);
    throw new SessionAccessError("Failed to load session", 500);
  }

  return session;
}

export async function requireSessionAdminToken(
  sessionId: string,
  accessToken: string,
): Promise<SessionAdminRow> {
  const session = await fetchSessionAdminRow(sessionId);

  if (!safeCompare(session.admin_access_token, accessToken)) {
    throw new SessionAccessError("Forbidden", 403);
  }

  return session;
}

export async function requireSessionAdminAccess(
  sessionId: string,
  accessToken: string,
): Promise<SessionAdminRow> {
  return requireSessionAdminToken(sessionId, accessToken);
}
