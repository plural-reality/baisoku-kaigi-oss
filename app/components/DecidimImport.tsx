"use client";

import axios from "axios";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Button } from "@/components/ui/Button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { createAuthorizationHeader } from "@/lib/auth-header";
import type { ContentLanguage } from "@/lib/content-language";
import { sanitizeErrorForLog } from "@/lib/sanitize-error";

export type DecidimImportResult = Readonly<{
  title: string;
  purpose: string;
  background: string;
  sourceUrl: string;
  truncated: boolean;
}>;

type DecidimImportProps = Readonly<{
  language: ContentLanguage;
  accessToken: string | null | undefined;
  onImported: (result: DecidimImportResult) => void;
}>;

const responseMessage = (error: unknown): string | undefined =>
  axios.isAxiosError<{ message?: string }>(error)
    ? error.response?.data?.message
    : undefined;

export const DecidimImport = ({
  language,
  accessToken,
  onImported,
}: DecidimImportProps) => {
  const t = useTranslations("decidimImport");
  const [url, setUrl] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleImport = () => {
    setIsImporting(true);
    setError(null);
    return axios
      .post<DecidimImportResult>(
        "/api/sessions/import-decidim",
        { url: url.trim(), language },
        { headers: createAuthorizationHeader(accessToken ?? null) },
      )
      .then(
        (response) => onImported(response.data),
        (err: unknown) => {
          console.error("Decidim import failed:", sanitizeErrorForLog(err));
          setError(
            axios.isAxiosError(err) && err.response?.status === 409
              ? t("busy")
              : (responseMessage(err) ?? t("importFailed")),
          );
        },
      )
      .finally(() => setIsImporting(false));
  };

  return (
    <Card data-testid="decidim-import" className="mb-6">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <Field data-invalid={!!error}>
          <FieldLabel htmlFor="decidimUrl">{t("urlLabel")}</FieldLabel>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              type="url"
              id="decidimUrl"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={t("urlPlaceholder")}
              aria-invalid={!!error}
            />
            <Button
              type="button"
              onClick={handleImport}
              disabled={isImporting || !url.trim()}
              isLoading={isImporting}
              className="shrink-0"
            >
              {isImporting ? t("importing") : t("import")}
            </Button>
          </div>
          {error && <FieldError>{error}</FieldError>}
        </Field>
      </CardContent>
    </Card>
  );
};
