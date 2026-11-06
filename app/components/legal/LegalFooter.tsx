import Link from "next/link";
import { useTranslations } from "next-intl";
import { Fragment } from "react";
import { CompanyMark } from "@/components/brand/company-mark";
import {
  LEGAL_OPERATOR_URL,
  LEGAL_SOURCE_CODE_URL,
  LEGAL_TOKUSHOHO_URL,
  legalCopyright,
} from "@/lib/legal";
import { PRODUCT_LINKS } from "@/lib/products";
import { cn } from "@/lib/utils";

// 全サイト共通の最下段「会社の帯」（IMPLEMENTATION.md §4）。
//   [会社マーク] 合同会社多元現実   倍速会議 ・ 倍速アンケート   利用規約 ・ … ・ 特定商取引法に基づく表記 ・ ソースコード   © {年} Plural Reality LLC
// モバイルは 3 行（会社 / 製品 / 法務＋©）。閲覧中の製品は太字にするだけで、バッジは付けない。

const linkClassName = "hover:text-foreground hover:underline";

const Separator = () => {
  const t = useTranslations("legal");
  return <span aria-hidden="true">{t("separator")}</span>;
};

export function LegalFooter() {
  const t = useTranslations("legal");
  const tProduct = useTranslations("products");
  return (
    <footer className="border-t border-border bg-surface-1 text-xs text-muted-foreground print:hidden">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-2 px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:gap-8">
        <a
          href={LEGAL_OPERATOR_URL}
          target="_blank"
          rel="noopener noreferrer"
          className={cn("inline-flex items-center gap-2", linkClassName)}
        >
          <CompanyMark className="h-5 w-auto" />
          <span>{t("operatorName")}</span>
        </a>

        <nav
          aria-label={t("productsNav")}
          className="flex flex-wrap items-center gap-x-2 gap-y-1"
        >
          {PRODUCT_LINKS.map((product, index) => (
            <Fragment key={product.key}>
              {index > 0 && <Separator />}
              <a
                href={product.href}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(
                  linkClassName,
                  product.current && "font-semibold text-foreground",
                )}
              >
                {tProduct(product.key)}
              </a>
            </Fragment>
          ))}
        </nav>

        <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
          <nav
            aria-label={t("legalNav")}
            className="flex flex-wrap items-center gap-x-2 gap-y-1"
          >
            <Link href="/terms" className={linkClassName}>
              {t("terms")}
            </Link>
            <Separator />
            <Link href="/privacy-policy" className={linkClassName}>
              {t("privacy")}
            </Link>
            <Separator />
            <a
              href={LEGAL_TOKUSHOHO_URL}
              target="_blank"
              rel="noopener noreferrer"
              className={linkClassName}
            >
              {t("tokushoho")}
            </a>
            <Separator />
            <a
              href={LEGAL_SOURCE_CODE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className={linkClassName}
            >
              {t("sourceCode")}
            </a>
          </nav>
          <span>{legalCopyright()}</span>
        </div>
      </div>
    </footer>
  );
}
