import "@testing-library/jest-dom/vitest";
import { createTranslator } from "next-intl";
import { vi } from "vitest";
import ja from "../../../messages/ja.json";

// Unit tests render components and call route handlers outside a Next.js
// request, so next-intl's provider/request config is absent. Back the hooks
// with the Japanese catalog (the source locale) so existing assertions on
// Japanese copy keep meaning what they meant before i18n.
const translatorFor = (namespace?: string) =>
  createTranslator({ locale: "ja", messages: ja, namespace } as never);

vi.mock("next-intl", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next-intl")>();
  return {
    ...actual,
    useLocale: () => "ja",
    useTranslations: (namespace?: string) => translatorFor(namespace),
  };
});

vi.mock("next-intl/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next-intl/server")>();
  return {
    ...actual,
    getLocale: async () => "ja",
    getMessages: async () => ja,
    getTranslations: async (namespace?: string) => translatorFor(namespace),
  };
});
