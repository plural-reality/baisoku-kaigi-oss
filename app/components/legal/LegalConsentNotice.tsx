import Link from "next/link";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

type LegalConsentNoticeProps = Readonly<{
  className?: string;
}>;

export function LegalConsentNotice({ className }: LegalConsentNoticeProps) {
  const t = useTranslations("legal");
  return (
    <p
      className={cn(
        "text-xs leading-6 text-muted-foreground",
        "[&_a]:font-medium [&_a]:text-foreground [&_a]:underline [&_a]:underline-offset-4 hover:[&_a]:text-primary",
        className,
      )}
    >
      <Link href="/terms">{t("terms")}</Link>
      <span className="px-1.5 text-muted-foreground/70" aria-hidden="true">
        {t("separator")}
      </span>
      <Link href="/privacy-policy">{t("privacy")}</Link>
    </p>
  );
}
