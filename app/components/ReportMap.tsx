"use client";

import axios from "axios";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  centroidOf,
  type Pt,
  type Region,
  regionOf,
} from "@/components/opinion/cluster-hull";
import { createAuthorizationHeader } from "@/lib/auth-header";
import { getParticipantBearer } from "@/lib/participant-identity";
import { sanitizeErrorForLog } from "@/lib/sanitize-error";

interface ReportPoint {
  id: string;
  name: string;
  x: number;
  y: number;
  cluster: number;
  reportId: string;
  createdAt: string;
  preview: string;
  // 全体の中でのこの人の立ち位置の一言(report-map が最初から同梱・ホバーで即表示)。
  stance?: string;
}

interface ReportCluster {
  id: number;
  size: number;
  label?: string;
  summary?: string;
  sampleParticipant?: { name: string; preview: string };
}

interface ReportAxisPole {
  variance: number;
  posLabel?: string;
  negLabel?: string;
}

interface ReportAxes {
  pc1: ReportAxisPole;
  pc2: ReportAxisPole;
}

interface ReportMapData {
  participants: ReportPoint[];
  clusters: ReportCluster[];
  method: string;
  model: string;
  noiseCount: number;
  axes?: ReportAxes;
}

interface ReportMapProps {
  sessionId: string;
  userId: string;
  accessToken?: string;
  showNames?: boolean;
  // ドットクリックで参加者詳細(じぶんレポート+回答履歴)モーダルを開く。
  onSelectParticipant?: (userId: string) => void;
}

type Node = ReportPoint & {
  sx: number;
  sy: number;
  r: number;
  label: string;
};

const W = 860;
const H = 560;
const LABEL_LIMIT = 30;
// クラスタ色。report-map は PCA+kmeans で最大 ~6 群だが、余裕をもって10色。
const CLUSTER_COLORS = [
  "#3b82f6",
  "#f59e0b",
  "#10b981",
  "#ec4899",
  "#8b5cf6",
  "#ef4444",
  "#06b6d4",
  "#84cc16",
  "#f97316",
  "#14b8a6",
];
const NOISE_COLOR = "#94a3b8";

const shorten = (s: string, n = 64): string =>
  s.length > n ? `${s.slice(0, n)}…` : s;

const compactName = (name: string): string => {
  const chars = [...name.replace(/\s+/g, "")];
  return chars.length > 6 ? `${chars.slice(0, 5).join("")}…` : chars.join("");
};

const clusterOrder = (
  clusterId: number,
  clusters: readonly ReportCluster[],
): number => clusters.findIndex((cluster) => cluster.id === clusterId);

const colorFor = (
  clusterId: number,
  clusters: readonly ReportCluster[],
): string => {
  const order = clusterOrder(clusterId, clusters);
  return order < 0
    ? NOISE_COLOR
    : CLUSTER_COLORS[order % CLUSTER_COLORS.length];
};

const clusterName = (
  cluster: ReportCluster,
  clusters: readonly ReportCluster[],
  fallback: (n: number) => string,
): string => cluster.label ?? fallback(clusterOrder(cluster.id, clusters) + 1);

type ClusterViz = {
  cluster: ReportCluster;
  color: string;
  region: Region;
  labelX: number;
  labelY: number;
  name: string;
};

export default function ReportMap({
  sessionId,
  userId,
  accessToken,
  showNames = false,
  onSelectParticipant,
}: ReportMapProps) {
  const [data, setData] = useState<ReportMapData | null>(null);
  const [loading, setLoading] = useState(true);
  const t = useTranslations("reportMap");
  // Server-provided reason (already localized) or a client-side message key.
  const [error, setError] = useState<
    | { reason: string }
    | { key: "insufficient" | "noData" | "loadFailed" }
    | null
  >(null);
  const [activeId, setActiveId] = useState<string | null>(null);

  // 立ち位置の一言は report-map レスポンスに各参加者ごと最初から同梱されている
  // (node.stance)。ホバーはアクティブ化するだけ。取得待ちのローディングは無い。
  const handleHover = useCallback((id: string) => setActiveId(id), []);

  const buildUrl = useCallback(
    (narrative: boolean) => {
      // accessToken は URL(クエリ)に載せない。アクセスログ・履歴・proxy に秘密が
      // 残らないよう、x-access-token ヘッダで送る(下の headers を参照)。
      const params = new URLSearchParams();
      if (narrative) params.set("narrative", "1");
      const qs = params.toString();
      return `/api/sessions/${sessionId}/report-map${qs ? `?${qs}` : ""}`;
    },
    [sessionId],
  );

  const fetchData = useCallback(() => {
    if (!userId && !accessToken) {
      setLoading(false);
      return;
    }
    const headers = {
      ...createAuthorizationHeader(getParticipantBearer()),
      ...(accessToken ? { "x-access-token": accessToken } : {}),
    };
    setLoading(true);
    setError(null);
    // 2相: まず素の地図を即描画し、続けて narrative=1 で対比ラベルを後入れする。
    axios
      .get(buildUrl(false), { headers })
      .then((response) => {
        const payload = response.data as
          | { status: "ok"; data?: ReportMapData }
          | { status: "insufficient-data"; reason?: string };
        if (payload.status === "insufficient-data") {
          setData(null);
          setError(
            payload.reason
              ? { reason: payload.reason }
              : { key: "insufficient" },
          );
          return;
        }
        if (!payload.data) {
          setData(null);
          setError({ key: "noData" });
          return;
        }
        setData(payload.data);
        // 対比ラベル(LLM)は遅いので別フェッチで後追い。失敗しても地図は残す。
        axios
          .get(buildUrl(true), { headers })
          .then((res) => {
            const p = res.data as { status: string; data?: ReportMapData };
            if (p.status === "ok" && p.data) setData(p.data);
          })
          .catch(() => undefined);
      })
      .catch((err: unknown) => {
        console.error(
          "Failed to fetch report map data:",
          sanitizeErrorForLog(err),
        );
        setError({ key: "loadFailed" });
      })
      .finally(() => setLoading(false));
  }, [accessToken, buildUrl, userId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const layout = useMemo(() => {
    const points = data?.participants ?? [];
    if (points.length === 0) return null;

    // 原点(0,0)=全体の平均。両軸を同一スケールで中央に置き、B のような四象限にする。
    const maxAbs =
      Math.max(
        1e-6,
        ...points.map((p) => Math.max(Math.abs(p.x), Math.abs(p.y))),
      ) * 1.12;
    const showInlineNames = showNames || points.length <= LABEL_LIMIT;
    const pad = showInlineNames ? 76 : 52;
    const cx = W / 2;
    const cy = H / 2;
    const halfW = (W - 2 * pad) / 2;
    const halfH = (H - 2 * pad) / 2;
    const sx = (x: number) => cx + (x / maxAbs) * halfW;
    const sy = (y: number) => cy - (y / maxAbs) * halfH;

    const clusters = data?.clusters ?? [];
    const nodes = points.map((point): Node => {
      const name = point.name || t("anonymous");
      const label = compactName(name);
      const r = showInlineNames
        ? Math.min(30, Math.max(16, 8 + [...label].length * 5.2))
        : Math.max(3.5, Math.min(7, 130 / Math.sqrt(points.length)));
      return {
        ...point,
        name,
        label,
        r,
        sx: sx(point.x),
        sy: sy(point.y),
      };
    });
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const rawClusters: ClusterViz[] = clusters
      .map((cluster) => {
        const members = nodes.filter((n) => n.cluster === cluster.id);
        if (members.length === 0) return null;
        const pts: Pt[] = members.map((m) => ({ x: m.sx, y: m.sy }));
        const c = centroidOf(pts);
        const memberR = members[0]?.r ?? 6;
        return {
          cluster,
          color: colorFor(cluster.id, clusters),
          region: regionOf(pts, memberR + 18),
          labelX: c.x,
          labelY: c.y,
          name: clusterName(cluster, clusters, (n) => t("group", { n })),
        };
      })
      .filter((c): c is ClusterViz => c !== null);

    // ピルの縦方向の重なりを貪欲に回避 (y 昇順で押し下げ)。
    const PILL_H = 22;
    const placed = [...rawClusters]
      .sort((a, b) => a.labelY - b.labelY)
      .reduce<ClusterViz[]>((acc, cv) => {
        const clampedY = Math.min(H - pad / 2, Math.max(pad / 2, cv.labelY));
        const last = acc[acc.length - 1];
        const y =
          last && clampedY - last.labelY < PILL_H
            ? last.labelY + PILL_H
            : clampedY;
        acc.push({ ...cv, labelY: y });
        return acc;
      }, []);

    const active = activeId === null ? null : (byId.get(activeId) ?? null);

    return { nodes, clusterViz: placed, active, showInlineNames, cx, cy, pad };
  }, [activeId, data, showNames, t]);

  return loading && !data ? (
    <div className="flex items-center justify-center py-12">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
    </div>
  ) : error ? (
    <div className="rounded-lg border border-muted bg-muted/50 p-8 text-center">
      <p className="text-sm text-muted-foreground">
        {"reason" in error ? error.reason : t(error.key)}
      </p>
    </div>
  ) : !data || !layout ? (
    <div className="rounded-lg border border-muted bg-muted/50 p-8 text-center">
      <p className="text-sm text-muted-foreground">{t("empty")}</p>
    </div>
  ) : (
    <div className="space-y-4" data-testid="report-map-section">
      <div className="relative w-full overflow-hidden rounded-xl border bg-card">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-auto w-full"
          role="img"
          aria-label={t("mapLabel")}
        >
          <title>{t("mapLabel")}</title>
          <defs>
            <pattern
              id="reportmap-dotgrid"
              width={26}
              height={26}
              patternUnits="userSpaceOnUse"
            >
              <circle cx={1.5} cy={1.5} r={1.5} fill="#e2e8f0" />
            </pattern>
          </defs>
          <rect
            x={0}
            y={0}
            width={W}
            height={H}
            fill="url(#reportmap-dotgrid)"
          />

          {/* 原点十字線 (=全体の平均) による四象限 */}
          {data.axes ? (
            <g stroke="#cbd5e1" strokeWidth={1} strokeDasharray="4 4">
              <line
                x1={layout.cx}
                y1={layout.pad / 2}
                x2={layout.cx}
                y2={H - layout.pad / 2}
              />
              <line
                x1={layout.pad / 2}
                y1={layout.cy}
                x2={W - layout.pad / 2}
                y2={layout.cy}
              />
            </g>
          ) : null}

          {/* 軸の極ラベル (対比) */}
          {data.axes ? (
            <g
              fontSize={12}
              fontWeight={600}
              fill="#64748b"
              pointerEvents="none"
            >
              {data.axes.pc1.posLabel ? (
                <text x={W - layout.pad / 2} y={layout.cy - 8} textAnchor="end">
                  {data.axes.pc1.posLabel} →
                </text>
              ) : null}
              {data.axes.pc1.negLabel ? (
                <text x={layout.pad / 2} y={layout.cy - 8} textAnchor="start">
                  ← {data.axes.pc1.negLabel}
                </text>
              ) : null}
              {data.axes.pc2.posLabel ? (
                <text x={layout.cx} y={layout.pad / 2} textAnchor="middle">
                  ↑ {data.axes.pc2.posLabel}
                </text>
              ) : null}
              {data.axes.pc2.negLabel ? (
                <text
                  x={layout.cx}
                  y={H - layout.pad / 2 + 4}
                  textAnchor="middle"
                >
                  ↓ {data.axes.pc2.negLabel}
                </text>
              ) : null}
            </g>
          ) : null}

          {/* クラスタ領域 (blob) */}
          {layout.clusterViz.map((cv) => (
            <g key={`region-${cv.cluster.id}`}>
              {cv.region.kind === "path" ? (
                <path
                  d={cv.region.d}
                  fill={cv.color}
                  fillOpacity={0.1}
                  stroke={cv.color}
                  strokeOpacity={0.35}
                  strokeWidth={1.5}
                />
              ) : (
                <circle
                  cx={cv.region.cx}
                  cy={cv.region.cy}
                  r={cv.region.r}
                  fill={cv.color}
                  fillOpacity={0.1}
                  stroke={cv.color}
                  strokeOpacity={0.35}
                  strokeWidth={1.5}
                />
              )}
            </g>
          ))}

          {/* 参加者ドット */}
          {layout.nodes.map((node) => {
            const fill = colorFor(node.cluster, data.clusters);
            const fontSize =
              node.label.length <= 2 ? 13 : node.label.length <= 4 ? 10 : 9;
            const active = layout.active?.id === node.id;
            return (
              <g key={node.id}>
                <title>{node.name}</title>
                {/* biome-ignore lint/a11y/noStaticElementInteractions: SVG data points need hover/tap tooltips; a native button cannot be nested in SVG. */}
                {/* biome-ignore lint/a11y/useKeyWithMouseEvents: SVG title carries the accessible label; this mouse handler only controls the visual tooltip. */}
                <circle
                  cx={node.sx}
                  cy={node.sy}
                  r={node.r + (active ? 2 : 0)}
                  fill={fill}
                  fillOpacity={layout.showInlineNames ? 0.95 : 0.85}
                  stroke={active ? "#0f172a" : "#fff"}
                  strokeWidth={active ? 2 : 1}
                  onMouseOver={() => handleHover(node.id)}
                  onMouseOut={() => setActiveId(null)}
                  onPointerEnter={() => handleHover(node.id)}
                  onPointerLeave={() => setActiveId(null)}
                  onClick={() => onSelectParticipant?.(node.id)}
                  className="cursor-pointer outline-none"
                />
                {layout.showInlineNames ? (
                  <text
                    x={node.sx}
                    y={node.sy}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize={fontSize}
                    fontWeight={700}
                    fill="#fff"
                    pointerEvents="none"
                  >
                    {node.label}
                  </text>
                ) : null}
              </g>
            );
          })}

          {/* クラスタの対比ラベル pill (地図上に配置) */}
          {layout.clusterViz.map((cv) => {
            const w = Math.max(44, cv.name.length * 12 + 20);
            return (
              <g key={`pill-${cv.cluster.id}`} pointerEvents="none">
                <rect
                  x={cv.labelX - w / 2}
                  y={cv.labelY - 11}
                  width={w}
                  height={22}
                  rx={11}
                  fill="#ffffff"
                  fillOpacity={0.92}
                  stroke={cv.color}
                  strokeWidth={1.5}
                />
                <text
                  x={cv.labelX}
                  y={cv.labelY}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={12}
                  fontWeight={700}
                  fill="#0f172a"
                >
                  {cv.name}
                </text>
              </g>
            );
          })}
        </svg>

        {layout.active ? (
          <div
            className="pointer-events-none absolute z-10 max-w-64 rounded-lg border border-border bg-popover px-3 py-2 text-xs leading-relaxed text-popover-foreground shadow-lg"
            style={{
              left: `${Math.min(92, Math.max(8, (layout.active.sx / W) * 100))}%`,
              top: `${Math.min(88, Math.max(8, (layout.active.sy / H) * 100))}%`,
              transform: "translate(-50%, -105%)",
            }}
          >
            <p className="font-semibold text-foreground">
              {layout.active.name}
            </p>
            {layout.active.stance ? (
              <p className="mt-1 text-muted-foreground">
                {layout.active.stance}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>{t("people", { count: data.participants.length })}</span>
        <span>{t("groups", { count: data.clusters.length })}</span>
        {data.noiseCount > 0 ? (
          <span>{t("unclassified", { count: data.noiseCount })}</span>
        ) : null}
        {data.axes ? (
          <span className="text-muted-foreground/70">
            {t("axes", {
              x: Math.round(data.axes.pc1.variance * 100),
              y: Math.round(data.axes.pc2.variance * 100),
            })}
          </span>
        ) : null}
      </div>

      {data.clusters.length > 0 ? (
        <div className="grid gap-2 md:grid-cols-2">
          {data.clusters.map((cluster) => (
            <div
              key={cluster.id}
              className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm"
            >
              <div className="flex items-center gap-2">
                <span
                  className="inline-block h-3 w-3 rounded-full"
                  style={{
                    backgroundColor: colorFor(cluster.id, data.clusters),
                  }}
                />
                <span className="font-semibold text-foreground">
                  {clusterName(cluster, data.clusters, (n) =>
                    t("group", { n }),
                  )}
                </span>
                <span className="text-muted-foreground">
                  {t("people", { count: cluster.size })}
                </span>
              </div>
              {cluster.summary ? (
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {cluster.summary}
                </p>
              ) : cluster.sampleParticipant ? (
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {cluster.sampleParticipant.name || t("anonymous")}:{" "}
                  {shorten(cluster.sampleParticipant.preview, 64)}
                </p>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
