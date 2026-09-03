import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { Target, Flame, Activity, ShieldCheck, ArrowUpRight, TrendingUp } from "lucide-react";
import { formatNumber } from "@/lib/utils";
import { DashboardSummary, DataQuality } from "@workspace/api-client-react";

interface KpiGridProps {
  summary?: DashboardSummary;
  quality?: DataQuality;
}

export function KpiGrid({ summary, quality }: KpiGridProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4" data-testid="grid-kpi">
      <Card data-testid="kpi-accounts" className="shadow-sm border border-border/80 rounded-xl">
        <CardContent className="p-5 flex flex-col justify-between h-full">
          <div className="flex items-center justify-between">
            <CardTitle className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wide">Total accounts</CardTitle>
            <Target className="h-4 w-4 text-muted-foreground/40" />
          </div>
          <div className="mt-4 flex items-baseline gap-3">
            <div className="text-3xl font-bold tracking-tight text-foreground" data-testid="text-kpi-accounts">
              {formatNumber(summary?.companies || 0)}
            </div>
            <span className="inline-flex items-center gap-1 rounded bg-cold/10 px-1.5 py-0.5 text-xs font-semibold text-cold">
              <TrendingUp className="h-3 w-3" /> 12%
            </span>
          </div>
        </CardContent>
      </Card>

      <Card data-testid="kpi-hot" className="shadow-sm border border-border/80 rounded-xl relative overflow-hidden">
        <div className="absolute left-0 top-0 bottom-0 w-1 bg-hot" />
        <CardContent className="p-5 flex flex-col justify-between h-full pl-6">
          <div className="flex items-center justify-between">
            <CardTitle className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wide">Hot Opportunities</CardTitle>
            <Flame className="h-4 w-4 text-hot/50" />
          </div>
          <div className="mt-4 flex items-baseline gap-3">
            <div className="text-3xl font-bold tracking-tight text-foreground" data-testid="text-kpi-hot">
              {formatNumber(summary?.hot || 0)}
            </div>
            <span className="inline-flex items-center gap-1 rounded bg-hot/10 px-1.5 py-0.5 text-xs font-semibold text-hot">
              Action needed
            </span>
          </div>
        </CardContent>
      </Card>

      <Card data-testid="kpi-signals" className="shadow-sm border border-border/80 rounded-xl">
        <CardContent className="p-5 flex flex-col justify-between h-full">
          <div className="flex items-center justify-between">
            <CardTitle className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wide">Active Signals</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground/40" />
          </div>
          <div className="mt-4 flex items-baseline gap-3">
            <div className="text-3xl font-bold tracking-tight text-foreground" data-testid="text-kpi-signals">
              {formatNumber(summary?.active_signals || 0)}
            </div>
            <span className="inline-flex items-center gap-1 rounded bg-cold/10 px-1.5 py-0.5 text-xs font-semibold text-cold">
              +{formatNumber(summary?.new_signals_7d || 0)} new
            </span>
          </div>
        </CardContent>
      </Card>

      <Card data-testid="kpi-health" className="shadow-sm border border-border/80 rounded-xl">
        <CardContent className="p-5 flex flex-col justify-between h-full">
          <div className="flex items-center justify-between">
            <CardTitle className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wide">Data Health</CardTitle>
            <ShieldCheck className="h-4 w-4 text-muted-foreground/40" />
          </div>
          <div className="mt-4 flex items-baseline gap-3">
            <div className="text-3xl font-bold tracking-tight text-foreground" data-testid="text-kpi-health">
              {quality ? `${Math.round(quality.observations.average_confidence * 100)}%` : "--"}
            </div>
            <span className="text-[11px] font-medium text-muted-foreground">
              Avg confidence
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}