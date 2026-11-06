import { cn } from "@/lib/utils";

/** 必須項目の札。ラベルの後ろに置く（黒い札、文字は反転）。 */
export function RequiredBadge({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "ml-1.5 inline-flex items-center rounded-sm bg-foreground px-1.5 py-0.5 align-middle text-[10px] font-semibold leading-none text-background",
        className,
      )}
    >
      {children}
    </span>
  );
}
