import { withAuth } from "@workos-inc/authkit-nextjs";
import { type NextRequest, NextResponse } from "next/server";

import { resolveBearerIdentity } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { toStableUUID } from "@/lib/workos-uuid";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const POST = async (_request: NextRequest) => {
  // 1. Authenticate via WorkOS session cookie
  const { user } = await withAuth();
  const workosId = user?.id ?? null;

  return !workosId
    ? NextResponse.json(
        { error: "Unauthorized: No WorkOS session" },
        { status: 401 },
      )
    : handleMigration(_request, workosId);
};

const handleMigration = async (request: NextRequest, workosId: string) => {
  const newUserId = UUID_RE.test(workosId) ? workosId : toStableUUID(workosId);

  const body = await request.json();
  const { oldUserId } = body as { oldUserId?: unknown };

  return typeof oldUserId !== "string" || !oldUserId.trim()
    ? NextResponse.json(
        { error: "Bad Request: oldUserId is required" },
        { status: 400 },
      )
    : !UUID_RE.test(oldUserId)
      ? NextResponse.json(
          { error: "Bad Request: oldUserId must be a valid UUID" },
          { status: 400 },
        )
      : oldUserId === newUserId
        ? NextResponse.json({
            migrated: false,
            message: "Old and new user IDs are the same",
          })
        : executeMigration(request, oldUserId, newUserId);
};

const executeMigration = async (
  request: NextRequest,
  oldUserId: string,
  newUserId: string,
) => {
  // Ownership proof (audit M1): the caller must present the old identity's own
  // bearer credential (signed token / legacy UUID). Without this, any logged-in
  // user could pass an arbitrary oldUserId and absorb another participant's data.
  const provenOldId = await resolveBearerIdentity(request);
  if (!provenOldId || provenOldId !== oldUserId) {
    return NextResponse.json(
      { error: "Forbidden: ownership of oldUserId not proven" },
      { status: 403 },
    );
  }

  try {
    const { error } = await (supabase.rpc as CallableFunction)(
      "migrate_user_id",
      { old_id: oldUserId, new_id: newUserId },
    );

    if (error) {
      console.error("Migration failed:", error);
      return NextResponse.json({ error: "Migration failed" }, { status: 500 });
    }
    return NextResponse.json({ migrated: true, oldUserId, newUserId });
  } catch (err) {
    console.error("Migration error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
};
