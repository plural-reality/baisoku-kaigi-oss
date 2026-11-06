"use client";

import { FileText } from "lucide-react";
import { useTranslations } from "next-intl";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { ContentLanguage } from "@/lib/content-language";
import { type SessionTemplate, sessionTemplates } from "@/lib/templates";

type TemplateSelectorProps = {
  onSelect: (template: SessionTemplate) => void;
  onSkip: () => void;
  language?: ContentLanguage;
};

export function TemplateSelector({
  onSelect,
  onSkip,
  language = "ja",
}: TemplateSelectorProps) {
  const t = useTranslations("templateSelector");
  return (
    <div className="space-y-6">
      <div>
        <p className="text-muted-foreground">{t("intro")}</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <button type="button" onClick={onSkip} className="text-left">
          <Card className="h-full border-dashed transition-all hover:shadow-md hover:border-primary/40 cursor-pointer">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-3">
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-border bg-muted/40 text-muted-foreground">
                  <FileText className="h-4 w-4" />
                </span>
                {t("blank")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription className="text-sm">
                {t("blankDescription")}
              </CardDescription>
            </CardContent>
          </Card>
        </button>

        {sessionTemplates(language).map((template) => (
          <button
            key={template.id}
            type="button"
            onClick={() => onSelect(template)}
            className="text-left"
          >
            <Card className="h-full transition-all hover:shadow-md hover:border-primary/40 cursor-pointer">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <span className="text-2xl">{template.emoji}</span>
                  {template.title}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription className="text-sm">
                  {template.description}
                </CardDescription>
              </CardContent>
            </Card>
          </button>
        ))}
      </div>
    </div>
  );
}
