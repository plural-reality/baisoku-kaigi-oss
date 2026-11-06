import * as Sentry from "@sentry/nextjs";

declare global {
  interface Window {
    umami?: {
      track: (event: string, data?: Record<string, string | number>) => void;
    };
  }
}

/**
 * Dual-sink event tracker: Umami (product analytics) + Sentry (observability).
 * Both sinks are fire-and-forget; neither blocks the caller.
 */
export const trackEvent = (
  eventName: string,
  data?: Record<string, string | number>,
): void => {
  // Umami — client-side only, silently no-ops if script not loaded
  typeof window !== "undefined" && window.umami?.track(eventName, data);

  // Sentry — works on both client and server
  Sentry.startSpan({ name: eventName, op: "user.action" }, (span) => {
    data &&
      Object.entries(data).map(([k, v]) => span.setAttribute(k, String(v)));
  });
};

export const ANALYTICS_EVENTS = {
  SESSION_CREATED: "session_created",
  PARTICIPANT_JOINED: "participant_joined",
  RESPONSE_SUBMITTED: "response_submitted",
  REPORT_GENERATED: "report_generated",
  REPORT_VIEWED: "report_viewed",
  REPORT_SHARED: "report_shared",
} as const;
