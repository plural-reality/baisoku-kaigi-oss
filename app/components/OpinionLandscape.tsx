"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import ReportMap from "@/components/ReportMap";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

interface OpinionLandscapeProps {
  sessionId: string;
  userId: string;
  accessToken?: string;
  // ドット(参加者)クリックで、その人のじぶんレポート+回答履歴モーダルを開く。
  onSelectParticipant?: (userId: string) => void;
}

export default function OpinionLandscape({
  sessionId,
  userId,
  accessToken,
  onSelectParticipant,
}: OpinionLandscapeProps) {
  const t = useTranslations("reportMap");
  const [showNames, setShowNames] = useState(false);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-end">
        <div className="flex items-center gap-2 rounded-lg border border-border px-3 py-2">
          <Switch
            id="opinion-landscape-show-names"
            checked={showNames}
            onCheckedChange={setShowNames}
          />
          <Label
            htmlFor="opinion-landscape-show-names"
            className="text-xs text-muted-foreground"
          >
            {t("showNames")}
          </Label>
        </div>
      </div>
      <ReportMap
        sessionId={sessionId}
        userId={userId}
        accessToken={accessToken}
        showNames={showNames}
        onSelectParticipant={onSelectParticipant}
      />
    </div>
  );
}
