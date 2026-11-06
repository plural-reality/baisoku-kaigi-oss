import { NextResponse } from "next/server";

// Per-key in-process guard for routes that call the LLM synchronously behind
// the HTTP request. Cloudflare (~100s) and nginx (120s) can time the request
// out while the server keeps working; a re-click then started a second LLM
// call and appended a second batch of statements / a second analysis. While a
// key is in flight, a second caller is refused instead of starting another run.
//
// The frontend runs as a single Node process (nixos/application.nix), so an
// in-memory set is authoritative. It does not survive a restart — nor does the
// work it guards.
const inFlight = new Set<string>();

export type SingleFlightResult<T> =
  | { readonly status: "done"; readonly value: T }
  | { readonly status: "busy" };

export async function runExclusive<T>(
  key: string,
  work: () => Promise<T>,
): Promise<SingleFlightResult<T>> {
  if (inFlight.has(key)) {
    return { status: "busy" };
  }
  inFlight.add(key);
  try {
    return { status: "done", value: await work() };
  } finally {
    inFlight.delete(key);
  }
}

export const GENERATION_IN_PROGRESS = "generation_in_progress";

// 409 body shared by every guarded route so the client can recognise it.
export const generationInProgressResponse = () =>
  NextResponse.json(
    { error: "Generation already in progress", code: GENERATION_IN_PROGRESS },
    { status: 409 },
  );

export async function respondExclusive(
  key: string,
  work: () => Promise<Response>,
): Promise<Response> {
  const result = await runExclusive(key, work);
  return result.status === "done"
    ? result.value
    : generationInProgressResponse();
}
