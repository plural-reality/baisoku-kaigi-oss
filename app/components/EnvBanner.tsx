// 本番以外の環境を示す帯（env_badge、IMPLEMENTATION.md §6）。画面の下端に固定する。
// 背景 #f59e0b（amber-500）・黒文字 12px 600・文言 `STAGING: {環境名}`。
// 環境名は NEXT_PUBLIC_SENTRY_ENVIRONMENT（実行時に layout が collectPublicEnv() で渡す）。
// production・development（ローカル）・ci と、未設定のときは出さない。

const HIDDEN_ENVIRONMENTS: ReadonlySet<string> = new Set([
  "production",
  "development",
  "ci",
]);

export const shouldShowEnvBanner = (
  environment: string | undefined,
): boolean => {
  const name = environment?.trim().toLowerCase();
  return name !== undefined && name !== "" && !HIDDEN_ENVIRONMENTS.has(name);
};

type EnvBannerProps = Readonly<{
  environment: string | undefined;
}>;

export function EnvBanner({ environment }: EnvBannerProps) {
  if (!shouldShowEnvBanner(environment)) return null;

  return (
    <>
      {/* 固定の帯がフッターの最下行を隠さないよう、同じ高さの余白を流れの中に置く。帯は 24px + 下端の
          safe-area。24px はこの余白、safe-area 分は body の padding-bottom（globals.css）が受け持つ */}
      <div aria-hidden="true" className="h-6 print:hidden" />
      <div className="fixed inset-x-0 bottom-0 z-[9999] flex h-[calc(1.5rem+var(--safe-bottom))] items-center justify-center bg-amber-500 px-3 pb-[var(--safe-bottom)] text-xs font-semibold text-black print:hidden">
        STAGING: {environment?.trim()}
      </div>
    </>
  );
}
