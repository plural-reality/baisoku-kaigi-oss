import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale } from "next-intl/server";
import { isLocale, type Locale } from "@/i18n/locales";
import { DemoPlayer } from "./demo-player";
import { isDemoScene } from "./scenes";

// The live demo framed into the marketing site (plural-reality.com, the 倍速会議
// slide of the home page). It renders the real participant and admin
// components with the made-up session in ./fixtures, so the site follows this
// app's UI without a hand-made copy. One scene per frame: ?scene=participant
// (phone) | issues | participants (desktop); ?lang=ja|en.
// The embedding page restarts a scene with
//   postMessage({ type: "baisoku-kaigi-demo", action: "play" }, origin)
// and a scene opened on its own plays once on load. Once rendered, the scene
// posts { type: "baisoku-kaigi-demo", event: "ready", scene } to its parent.

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function EmbedDemoPage({
  searchParams,
}: {
  searchParams: Promise<{ scene?: string; lang?: string }>;
}) {
  const { scene, lang } = await searchParams;
  const locale: Locale = isLocale(lang)
    ? lang
    : ((await getLocale()) as Locale);
  const messages = (await import(`../../../messages/${locale}.json`)).default;

  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      <DemoPlayer
        scene={isDemoScene(scene) ? scene : "participant"}
        locale={locale}
      />
    </NextIntlClientProvider>
  );
}
