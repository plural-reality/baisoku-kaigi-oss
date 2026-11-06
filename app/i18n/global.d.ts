import type messages from "../../messages/ja.json";
import type { Locale } from "./locales";

// Type-checks every t("…") key against the Japanese catalog (the source).
declare module "next-intl" {
  interface AppConfig {
    Locale: Locale;
    Messages: typeof messages;
  }
}
