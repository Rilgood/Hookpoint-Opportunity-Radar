import { Activity, ArrowUpRight, CircleDot, ShieldCheck } from "lucide-react";
import { formatNumber } from "@/lib/utils";
import type {
  DashboardSummary,
  DataQuality,
} from "@workspace/api-client-react";

interface KpiGridProps {
  summary?: DashboardSummary;
  quality?: DataQuality;
}

export function KpiGrid({ summary, quality }: KpiGridProps) {
  const metrics = [
    {
      key: "accounts",
      label: "Total accounts",
      value: formatNumber(summary?.companies || 0),
      context: "In your workspace",
      icon: CircleDot,
    },
    {
      key: "hot",
      label: "Hot opportunities",
      value: formatNumber(summary?.hot || 0),
      context: "Prioritized for review",
      icon: ArrowUpRight,
    },
    {
      key: "signals",
      label: "Active signals",
      value: formatNumber(summary?.active_signals || 0),
      context: `${formatNumber(summary?.new_signals_7d || 0)} seen in the past 7 days`,
      icon: Activity,
    },
    {
      key: "health",
      label: "Evidence confidence",
      value:
        quality && quality.observations.total > 0
          ? `${Math.round(quality.observations.average_confidence * 100)}%`
          : "—",
      context: "Source-reported, not accuracy",
      icon: ShieldCheck,
    },
  ];
  return (
    <dl
      className="glass-panel grid grid-cols-2 overflow-hidden rounded-[28px] md:grid-cols-4"
      data-testid="grid-kpi"
      aria-label="Workspace at a glance"
    >
      {metrics.map((metric, index) => (
        <div
          key={metric.key}
          data-testid={`kpi-${metric.key}`}
          className={`relative px-5 py-6 sm:px-7 sm:py-7 ${index < 2 ? "border-b border-white/70 md:border-b-0" : ""} ${index % 2 === 0 ? "border-r border-white/70" : ""} ${index === 1 ? "md:border-r md:border-white/70" : ""}`}
        >
          <dt className="flex items-center gap-2 text-[12px] font-medium tracking-[-0.01em] text-slate-600 sm:text-[13px]">
            <metric.icon
              className="size-3.5 shrink-0 text-slate-400"
              strokeWidth={1.5}
              aria-hidden="true"
            />
            {metric.label}
          </dt>
          <dd className="mt-3">
            <span
              className="block text-[40px] font-medium leading-none tracking-[-0.065em] text-slate-950 tabular-nums sm:text-[46px]"
              data-testid={`text-kpi-${metric.key}`}
            >
              {metric.value}
            </span>
            <span className="mt-3 block text-[11px] leading-relaxed tracking-[-0.01em] text-slate-500 sm:text-xs">
              {metric.context}
            </span>
          </dd>
        </div>
      ))}
    </dl>
  );
}
