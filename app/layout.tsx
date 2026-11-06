import "@fontsource-variable/geist";
import "@fontsource-variable/noto-sans-jp";
import "@fontsource-variable/jetbrains-mono";
import "./globals.css";
import { withAuth } from "@workos-inc/authkit-nextjs";
import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import { Toaster } from "sonner";
import { EnvBanner } from "@/components/EnvBanner";
import { LegalFooter } from "@/components/legal/LegalFooter";
import { ThemeProvider } from "@/components/theme-provider";
import { AuthProvider } from "@/lib/auth-provider";
import { buildMetadata } from "@/lib/metadata";
import { collectPublicEnv } from "@/lib/public-env";

// window.__ENV (injected below) is read from process.env at render time and must
// reflect RUNTIME env, never the build-time placeholders (flake.nix sets
// placeholder.supabase.co etc). Because __ENV is set once per SPA session from
// whichever page loads first, the root layout must render at request time for
// EVERY route — otherwise a statically-prerendered entry page (e.g. "/",
// "/sessions/new") bakes placeholder.supabase.co into window.__ENV and poisons the
// Supabase client for the whole session (realtime → wss://placeholder.supabase.co,
// tripping CSP). Build skips withAuth() when WORKOS_CLIENT_ID is unset, removing
// the only dynamic API, so without this the layout is statically optimized.
export const dynamic = "force-dynamic";

const isWorkOSConfigured = Boolean(process.env.WORKOS_CLIENT_ID);

// viewport-fit=cover lets backgrounds run under the iPhone Duo's status column and the notch;
// globals.css keeps the content clear of them with the safe-area insets.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // The page colour (globals.css --bg) for the browser chrome that still reads it.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0e0e10" },
  ],
};

export async function generateMetadata(): Promise<Metadata> {
  return buildMetadata({ locale: await getLocale() });
}

const safeWithAuth = async () => {
  if (!isWorkOSConfigured) return { user: null };
  try {
    return await withAuth();
  } catch {
    return { user: null };
  }
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const { user } = await safeWithAuth();
  const serializedUser = user
    ? {
        id: user.id,
        email: user.email ?? null,
        firstName: user.firstName ?? null,
        lastName: user.lastName ?? null,
      }
    : null;

  const publicEnv = collectPublicEnv();
  const locale = await getLocale();
  const t = await getTranslations("layout");

  return (
    <html lang={locale} suppressHydrationWarning>
      <body className="antialiased" suppressHydrationWarning>
        <script
          // biome-ignore lint/security/noDangerouslySetInnerHtml: runtime env injection — server-controlled data only
          dangerouslySetInnerHTML={{
            __html: `window.__ENV=${JSON.stringify(publicEnv)}`,
          }}
        />
        {process.env.NEXT_PUBLIC_UMAMI_URL &&
          process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID && (
            <Script
              defer
              src={process.env.NEXT_PUBLIC_UMAMI_URL}
              data-website-id={process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID}
              strategy="afterInteractive"
            />
          )}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:bg-background focus:text-foreground focus:px-4 focus:py-2 focus:rounded-md focus:ring-2 focus:ring-ring"
        >
          {t("skipToContent")}
        </a>
        <NextIntlClientProvider>
          <AuthProvider user={serializedUser}>
            <ThemeProvider
              attribute="class"
              defaultTheme="system"
              enableSystem
              disableTransitionOnChange
            >
              <main id="main-content">{children}</main>
              <LegalFooter />
              <EnvBanner
                environment={publicEnv.NEXT_PUBLIC_SENTRY_ENVIRONMENT}
              />
              <Toaster
                position="bottom-center"
                offset={24}
                toastOptions={{
                  classNames: {
                    description: "!text-current",
                    success:
                      "!border-transparent !bg-success-soft !text-success",
                    error: "!border-transparent !bg-danger-soft !text-danger",
                    warning:
                      "!border-transparent !bg-warning-soft !text-warning",
                    info: "!border-transparent !bg-info-soft !text-info",
                  },
                }}
              />
            </ThemeProvider>
          </AuthProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
