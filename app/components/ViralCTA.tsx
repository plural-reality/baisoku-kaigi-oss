"use client";

import { ExternalLink } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/Button";
import { Card, CardContent } from "@/components/ui/card";
import { BAISOKU_KAIGI_URL } from "@/lib/products";

export function ViralCTA() {
  const t = useTranslations("viralCta");
  return (
    <Card className="print:hidden">
      <CardContent className="pt-8 pb-8">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="space-y-1">
            <p className="text-lg font-semibold">{t("title")}</p>
            <p className="text-sm text-muted-foreground max-w-md">
              {t("body")}
            </p>
          </div>
          <a href={BAISOKU_KAIGI_URL} target="_blank" rel="noopener noreferrer">
            <Button size="lg" className="gap-2">
              <ExternalLink className="h-4 w-4" />
              {t("learnMore")}
            </Button>
          </a>
        </div>
      </CardContent>
    </Card>
  );
}
