import { afterEach, describe, expect, it, vi } from "vitest";
import { buildCspValue, cspHeaderName, cspMode, isEmbedPath } from "../csp";

const SENTRY_DSN =
  "https://00000000000000000000000000000000@o0000000000000000.ingest.de.sentry.io/0000000000000000";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("cspMode / cspHeaderName", () => {
  it("enforces by default (audit 2026-10-06 H1)", () => {
    expect(cspMode()).toBe("enforce");
    expect(cspHeaderName()).toBe("Content-Security-Policy");
  });

  it("falls back to report-only only via the explicit CSP_MODE opt-out", () => {
    vi.stubEnv("CSP_MODE", "report-only");
    expect(cspMode()).toBe("report-only");
    expect(cspHeaderName()).toBe("Content-Security-Policy-Report-Only");
  });

  it("treats any other CSP_MODE value as enforce", () => {
    vi.stubEnv("CSP_MODE", "enforce");
    expect(cspMode()).toBe("enforce");
    vi.stubEnv("CSP_MODE", "whatever");
    expect(cspMode()).toBe("enforce");
  });
});

describe("img-src (exfiltration beacon guard, audit H1)", () => {
  const imgSrc = () =>
    buildCspValue()
      .split("; ")
      .find((d) => d.startsWith("img-src ")) ?? "";

  it("allows only self, data: and the QR image origin — no https: wildcard", () => {
    expect(imgSrc()).toBe("img-src 'self' data: https://api.qrserver.com");
    expect(imgSrc()).not.toContain("https: ");
    expect(imgSrc()).not.toMatch(/https:$/);
    expect(imgSrc()).not.toContain("blob:");
  });
});

describe("buildCspValue", () => {
  it("keeps a self baseline and locks down dangerous fetch targets", () => {
    const csp = buildCspValue();
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("connect-src 'self'");
  });

  it("derives connect-src origins (https + wss) from runtime env", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://data.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_AUTH_SUPABASE_URL", "https://auth.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_UMAMI_URL", "https://umami.example.com/script.js");
    const csp = buildCspValue();
    expect(csp).toContain("https://data.supabase.co");
    expect(csp).toContain("wss://data.supabase.co");
    expect(csp).toContain("https://auth.supabase.co");
    expect(csp).toContain("wss://auth.supabase.co");
    // Umami origin only (not the full script path)
    expect(csp).toContain("https://umami.example.com");
    expect(csp).not.toContain("script.js");
  });

  it("allows the Cloudflare Web Analytics beacon (edge-injected) in script-src / connect-src", () => {
    const directives = buildCspValue().split("; ");
    expect(directives.find((d) => d.startsWith("script-src "))).toContain(
      "https://static.cloudflareinsights.com",
    );
    expect(directives.find((d) => d.startsWith("connect-src "))).toContain(
      "https://cloudflareinsights.com",
    );
  });

  it("allows the Umami script origin in script-src", () => {
    vi.stubEnv("NEXT_PUBLIC_UMAMI_URL", "https://umami.example.com/script.js");
    const scriptSrc = buildCspValue()
      .split("; ")
      .find((d) => d.startsWith("script-src "));
    expect(scriptSrc).toContain("'self'");
    expect(scriptSrc).toContain("'unsafe-inline'");
    expect(scriptSrc).toContain("https://umami.example.com");
  });

  it("allows unsafe-eval only for the Next.js development runtime", () => {
    vi.stubEnv("NODE_ENV", "development");
    const developmentScriptSrc = buildCspValue()
      .split("; ")
      .find((d) => d.startsWith("script-src "));

    vi.stubEnv("NODE_ENV", "production");
    const productionScriptSrc = buildCspValue()
      .split("; ")
      .find((d) => d.startsWith("script-src "));

    expect(developmentScriptSrc).toContain("'unsafe-eval'");
    expect(productionScriptSrc).not.toContain("'unsafe-eval'");
  });

  it("derives the Sentry ingest origin and report-uri from the DSN", () => {
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", SENTRY_DSN);
    const csp = buildCspValue();
    expect(csp).toContain("https://o0000000000000000.ingest.de.sentry.io");
    expect(csp).toContain(
      "report-uri https://o0000000000000000.ingest.de.sentry.io/api/0000000000000000/security/?sentry_key=00000000000000000000000000000000",
    );
  });

  it("omits report-uri when no DSN is configured", () => {
    expect(buildCspValue()).not.toContain("report-uri");
  });

  it("ignores malformed origin env without throwing", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "not a url");
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "garbage");
    const csp = buildCspValue();
    expect(csp).toContain("connect-src 'self'");
    expect(csp).not.toContain("report-uri");
  });
});

describe("frame-ancestors for /embed/* (marketing-site demo)", () => {
  const frameAncestors = (csp: string) =>
    csp.split("; ").find((d) => d.startsWith("frame-ancestors ")) ?? "";

  it("lets only our sites frame /embed/*, and nothing else frames other pages", () => {
    expect(isEmbedPath("/embed/demo")).toBe(true);
    expect(isEmbedPath("/sessions/x")).toBe(false);
    expect(frameAncestors(buildCspValue())).toBe("frame-ancestors 'none'");
    const embed = frameAncestors(buildCspValue({ embed: true }));
    expect(embed).toContain("'self'");
    expect(embed).toContain("https://*.plural-reality.com");
    expect(embed).not.toMatch(/ \*( |$)/);
  });

  it("takes the list from EMBED_FRAME_ANCESTORS when set", () => {
    vi.stubEnv("EMBED_FRAME_ANCESTORS", "https://example.org");
    expect(frameAncestors(buildCspValue({ embed: true }))).toBe(
      "frame-ancestors 'self' https://example.org",
    );
  });
});
