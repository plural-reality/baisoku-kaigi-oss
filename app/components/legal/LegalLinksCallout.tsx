import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

type LegalLinksCalloutProps = Readonly<{
  className?: string;
}>;

export function LegalLinksCallout({ className }: LegalLinksCalloutProps) {
  const t = useTranslations("legal");
  return (
    <section
      className={cn(
        "flex flex-wrap items-center gap-x-4 gap-y-2 text-sm",
        className,
      )}
    >
      <Link
        href="/terms"
        className="inline-flex items-center gap-1.5 font-medium text-foreground/80 underline-offset-4 transition hover:text-foreground hover:underline"
      >
        {t("terms")}
        <ArrowUpRight className="h-3.5 w-3.5" />
      </Link>
      <Link
        href="/privacy-policy"
        className="inline-flex items-center gap-1.5 font-medium text-foreground/80 underline-offset-4 transition hover:text-foreground hover:underline"
      >
        {t("privacy")}
        <ArrowUpRight className="h-3.5 w-3.5" />
      </Link>
    </section>
  );
}
