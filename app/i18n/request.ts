import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { LOCALE_COOKIE } from "./locales";
import { resolveLocale } from "./resolve-locale";

// No locale segment in URLs: the app is not indexed, and shared session links
// must keep working for everyone. The locale comes from the viewer instead.
export default getRequestConfig(async () => {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  const locale = resolveLocale({
    explicit: cookieStore.get(LOCALE_COOKIE)?.value,
    acceptLanguage: headerStore.get("accept-language"),
  });
  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
