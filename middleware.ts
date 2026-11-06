import { authkitMiddleware } from "@workos-inc/authkit-nextjs";
import type { NextFetchEvent, NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { clientIpOf } from "@/lib/client-ip";
import { getCspHeader } from "@/lib/csp";

// --- IP Allowlist ---
const ipAllowlist = (process.env.ALLOWED_IPS ?? "")
  .split(",")
  .map((ip) => ip.trim())
  .filter(Boolean);

const isIpRestrictionEnabled = ipAllowlist.length > 0;

// --- Basic Auth ---
const basicAuthUsername = process.env.BASIC_AUTH_USERNAME ?? "";
const basicAuthPassword = process.env.BASIC_AUTH_PASSWORD ?? "";
const basicAuthRealm = process.env.BASIC_AUTH_REALM ?? "Restricted";
const isBasicAuthEnabled = Boolean(basicAuthUsername && basicAuthPassword);

const BASIC_AUTH_COOKIE_NAME = "basic-auth-session";

let cachedBasicCookieValue: string | null = null;

// --- WorkOS AuthKit middleware (session management only, no enforcement) ---
// Conditionally initialised: when WORKOS_CLIENT_ID is absent, WorkOS is
// disabled and requests pass through (env-contract allOrNone constraint).
const isWorkOSConfigured = Boolean(process.env.WORKOS_CLIENT_ID);
const workosMiddleware = isWorkOSConfigured ? authkitMiddleware() : null;

export default async function middleware(
  request: NextRequest,
  event: NextFetchEvent,
) {
  if (request.method === "OPTIONS") {
    return applyCsp(request, NextResponse.next());
  }

  if (isIpRestrictionEnabled) {
    const ipResponse = enforceIpAllowlist(request);
    if (ipResponse) {
      return applyCsp(request, ipResponse);
    }
  }

  if (isBasicAuthEnabled) {
    const basicResponse = await enforceBasicAuth(request);
    if (basicResponse) {
      return applyCsp(request, basicResponse);
    }
  }

  // Delegate to WorkOS for session cookie management + callback handling
  const response =
    (await workosMiddleware?.(request, event)) ?? NextResponse.next();

  return applyCsp(request, response);
}

// Attach the runtime-built CSP to every middleware response (page, error and
// preflight) so the posture stays uniform when CSP_MODE flips to enforce. Built
// from env in app/lib/csp.ts (next.config.ts headers() is build-time, where
// NEXT_PUBLIC_* are placeholders).
function applyCsp<T extends Response>(request: NextRequest, response: T): T {
  const csp = getCspHeader(request.nextUrl.pathname);
  response.headers.set(csp.name, csp.value);
  return response;
}

// Match all routes except static assets
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico).*)"],
};

// --- Helper functions (unchanged) ---

function enforceIpAllowlist(request: NextRequest): NextResponse | undefined {
  const clientIp = getClientIp(request);
  if (!clientIp) {
    return undefined;
  }

  const isAllowed = ipAllowlist.some((allowedIp) => allowedIp === clientIp);
  return isAllowed ? undefined : new NextResponse("Forbidden", { status: 403 });
}

async function enforceBasicAuth(
  request: NextRequest,
): Promise<NextResponse | undefined> {
  const expectedCookieValue = await getBasicCookieValue();
  const existingCookie = request.cookies.get(BASIC_AUTH_COOKIE_NAME);

  if (existingCookie?.value === expectedCookieValue) {
    return undefined;
  }

  const header = request.headers.get("authorization");
  if (!header || !header.startsWith("Basic ")) {
    return unauthorizedResponse();
  }

  const encodedCredentials = header.slice(6).trim();
  const decodedCredentials = decodeBase64(encodedCredentials);
  if (!decodedCredentials) {
    return unauthorizedResponse();
  }

  const separatorIndex = decodedCredentials.indexOf(":");
  if (separatorIndex === -1) {
    return unauthorizedResponse();
  }

  const username = decodedCredentials.slice(0, separatorIndex);
  const password = decodedCredentials.slice(separatorIndex + 1);

  if (username !== basicAuthUsername || password !== basicAuthPassword) {
    return unauthorizedResponse();
  }

  const response = NextResponse.next();
  response.cookies.set({
    name: BASIC_AUTH_COOKIE_NAME,
    value: expectedCookieValue,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });

  return response;
}

function decodeBase64(value: string): string {
  try {
    return atob(value);
  } catch {
    return "";
  }
}

async function getBasicCookieValue(): Promise<string> {
  if (cachedBasicCookieValue) {
    return cachedBasicCookieValue;
  }

  const rawValue = `${basicAuthUsername}:${basicAuthPassword}`;
  cachedBasicCookieValue = await sha256Hex(rawValue);
  return cachedBasicCookieValue;
}

async function sha256Hex(value: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(digest));
  return hashArray.map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

// Shared with the participant-token issuance rate limit (app/lib/client-ip.ts).
function getClientIp(request: NextRequest): string | null {
  return clientIpOf(request.headers);
}

function unauthorizedResponse(): NextResponse {
  return new NextResponse("Unauthorized", {
    status: 401,
    headers: {
      "WWW-Authenticate": `Basic realm="${basicAuthRealm}"`,
    },
  });
}
