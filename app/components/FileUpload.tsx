"use client";

import axios from "axios";
import { FileText, Loader2, Upload, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useRef, useState } from "react";
import { createAuthorizationHeader } from "@/lib/auth-header";
import type { ContentLanguage } from "@/lib/content-language";
import { useUserId } from "@/lib/useUserId";

const ACCEPTED_EXTENSIONS =
  ".pdf,.docx,.xlsx,.txt,.csv,.md,.markdown,.json,.jsonl,.xml,.html,.htm,.yaml,.yml,.toml,.ini,.cfg,.conf,.log,.tsv,.tex,.rst,.adoc,.org,.rtf,.sh,.py,.js,.ts,.jsx,.tsx,.rb,.go,.rs,.java,.c,.cpp,.h,.hpp,.cs,.swift,.kt,.sql,.r,.hs,.nix,.env";
const MAX_FILE_SIZE = 10 * 1024 * 1024;

const EXTENSION_LABELS: Readonly<Record<string, string>> = {
  pdf: "PDF",
  docx: "Word",
  xlsx: "Excel",
  csv: "CSV",
  md: "Markdown",
  markdown: "Markdown",
  json: "JSON",
  jsonl: "JSONL",
  xml: "XML",
  html: "HTML",
  htm: "HTML",
  yaml: "YAML",
  yml: "YAML",
  toml: "TOML",
  ini: "INI",
  tsv: "TSV",
  tex: "LaTeX",
  rst: "reStructuredText",
  adoc: "AsciiDoc",
  org: "Org",
  rtf: "RTF",
  sh: "Shell",
  py: "Python",
  js: "JavaScript",
  ts: "TypeScript",
  jsx: "JSX",
  tsx: "TSX",
  rb: "Ruby",
  go: "Go",
  rs: "Rust",
  java: "Java",
  sql: "SQL",
  hs: "Haskell",
  nix: "Nix",
};

type UploadedFile = {
  readonly id: string;
  readonly name: string;
  readonly extractedText: string;
};

type FileUploadProps = {
  readonly onTextExtracted: (
    text: string,
    fileName: string,
    summarized: boolean,
  ) => void;
  readonly onTextRemoved?: (fileName: string) => void;
  // Summaries of long files are written in the session language.
  readonly language?: ContentLanguage;
};

type ExtractResult = {
  readonly text: string;
  readonly fileName: string;
  readonly summarized: boolean;
};

export const FileUpload = ({
  onTextExtracted,
  onTextRemoved,
  language = "ja",
}: FileUploadProps) => {
  const t = useTranslations("fileUpload");
  const [uploadedFiles, setUploadedFiles] = useState<
    ReadonlyArray<UploadedFile>
  >([]);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { accessToken } = useUserId();

  const processFiles = useCallback(
    async (files: ReadonlyArray<File>) => {
      setError(null);

      const validFiles = files.filter((file) => {
        const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
        return ext.length > 0 && file.size <= MAX_FILE_SIZE;
      });

      if (validFiles.length === 0) {
        setError(t("noSupportedFiles"));
        return;
      }

      setIsUploading(true);

      try {
        const formData = new FormData();
        validFiles.forEach((file) => {
          formData.append("files", file);
        });
        formData.append("language", language);

        const response = await axios.post<{
          results: ReadonlyArray<ExtractResult>;
          errors?: ReadonlyArray<string>;
        }>("/api/sessions/extract-text", formData, {
          headers: createAuthorizationHeader(accessToken),
        });

        const newFiles: ReadonlyArray<UploadedFile> = response.data.results.map(
          (r) => ({
            id: crypto.randomUUID(),
            name: r.fileName,
            extractedText: r.text,
          }),
        );

        setUploadedFiles((prev) => [...prev, ...newFiles]);
        response.data.results.forEach((r) => {
          onTextExtracted(r.text, r.fileName, r.summarized);
        });

        const apiErrors = response.data.errors;
        (apiErrors?.length ?? 0) > 0 &&
          setError(`${t("partialFailure")}\n${(apiErrors ?? []).join("\n")}`);
      } catch (err) {
        const message =
          axios.isAxiosError(err) && err.response?.data?.error
            ? err.response.data.error
            : t("processFailed");
        setError(message);
      } finally {
        setIsUploading(false);
        // biome-ignore lint/suspicious/noAssignInExpressions: reset file input for re-selection
        inputRef.current && (inputRef.current.value = "");
      }
    },
    [onTextExtracted, accessToken, language, t],
  );

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      files && files.length > 0 && processFiles(Array.from(files));
    },
    [processFiles],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      const files = e.dataTransfer.files;
      files.length > 0 && processFiles(Array.from(files));
    },
    [processFiles],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const handleRemoveFile = useCallback(
    (id: string) => {
      setUploadedFiles((prev) => {
        const target = prev.find((f) => f.id === id);
        target && onTextRemoved?.(target.name);
        return prev.filter((f) => f.id !== id);
      });
    },
    [onTextRemoved],
  );

  const formatFileLabel = (name: string): string => {
    const ext = name.split(".").pop()?.toLowerCase() ?? "";
    return ext === "txt"
      ? t("labelText")
      : ext === "log"
        ? t("labelLog")
        : (EXTENSION_LABELS[ext] ?? ext.toUpperCase());
  };

  return (
    <div className="space-y-3">
      <button
        type="button"
        className={[
          "relative flex flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-4 transition-colors cursor-pointer w-full bg-transparent",
          isDragOver
            ? "border-indigo-400 bg-indigo-50/50 dark:border-indigo-500 dark:bg-indigo-950/30"
            : "border-muted-foreground/25 hover:border-muted-foreground/50",
          isUploading ? "pointer-events-none opacity-60" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED_EXTENSIONS}
          multiple
          onChange={handleFileChange}
          className="hidden"
          aria-label={t("chooseFile")}
        />
        {isUploading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>{t("extracting")}</span>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Upload className="h-4 w-4" />
            <span>{t("dropzone")}</span>
          </div>
        )}
        <p className="mt-1 text-xs text-muted-foreground/70">{t("accepted")}</p>
      </button>

      {error && (
        <p className="text-sm text-red-600 dark:text-red-400 whitespace-pre-line">
          {error}
        </p>
      )}

      {uploadedFiles.length > 0 && (
        <div className="space-y-2">
          {uploadedFiles.map((file) => (
            <div
              key={file.id}
              className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-sm min-w-0"
            >
              <FileText className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
              <span className="flex-1 truncate">{file.name}</span>
              <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                {formatFileLabel(file.name)}
              </span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleRemoveFile(file.id);
                }}
                className="rounded p-0.5 text-muted-foreground hover:text-foreground transition-colors"
                aria-label={t("remove", { name: file.name })}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
