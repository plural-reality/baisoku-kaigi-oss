import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Vite 8 transforms with Oxc. tsconfig keeps `jsx: preserve` for Next.js, so
  // the tests need the automatic runtime set here.
  oxc: {
    jsx: { runtime: "automatic" },
  },
  // design-system の部品（app/components/pr/）は自分の CSS を import する。テストでは CSS を読まないので、
  // Tailwind の PostCSS 設定（postcss.config.mjs）を通さない。
  css: { postcss: { plugins: [] } },
  resolve: {
    alias: {
      "@/": `${path.resolve(__dirname, "app")}/`,
      "@agents/": `${path.resolve(__dirname, "agents")}/`,
    },
  },
  test: {
    globals: true,
    environment: "node",
    setupFiles: ["./app/components/__tests__/setup.ts"],
    include: ["**/__tests__/**/*.test.ts", "**/__tests__/**/*.test.tsx"],
    exclude: ["node_modules", ".direnv", "dist", ".next"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "json-summary"],
      include: [
        "app/api/health/route.ts",
        "app/api/sessions/route.ts",
        "app/api/sessions/\\[sessionId\\]/participants/route.ts",
        "app/api/sessions/\\[sessionId\\]/responses/route.ts",
        "app/api/sessions/\\[sessionId\\]/\\[accessToken\\]/route.ts",
        "app/api/sessions/\\[sessionId\\]/\\[accessToken\\]/reports/route.ts",
        "app/lib/auth.ts",
        "app/lib/llm.ts",
        "app/lib/metadata.ts",
        "app/lib/server/api-handler.ts",
        "app/lib/server/session-access.ts",
      ],
      exclude: ["**/__tests__/**", "**/*.d.ts", "app/lib/database.types.ts"],
      thresholds: {
        lines: 70,
        statements: 70,
        functions: 75,
        branches: 65,
      },
    },
  },
});
