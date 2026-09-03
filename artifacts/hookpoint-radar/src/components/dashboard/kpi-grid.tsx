import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Target, Flame, Activity, ShieldCheck } from "lucide-react";
import { formatNumber } from "@/lib/utils";
import { DashboardSummary, DataQuality } from "@workspace/api-client-react";

interface KpiGridProps {
  summary?: DashboardSummary;
  quality?: DataQuality;
}

export function KpiGrid({ summary, quality }: KpiGridProps) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4" data-testid="grid-kpi">
      <Card data-testid="kpi-accounts" className="bg-card shadow-sm hover:shadow-md transition-shadow">
        <CardHeader className="flex flex-row items-start justify-between gap-2 p-4 pb-1 sm:p-6 sm:pb-2">
          <CardTitle className="text-xs font-medium text-muted-foreground sm:text-sm">Total Accounts</CardTitle>
          <div className="shrink-0 rounded-md bg-primary/10 p-1.5 sm:p-2">
            <Target className="h-4 w-4 text-primary" />
          </div>
        </CardHeader>
        <CardContent className="px-4 pb-4 sm:px-6 sm:pb-6">
          <div className="text-2xl font-bold tracking-tight sm:text-3xl" data-testid="text-kpi-accounts">
            {formatNumber(summary?.companies || 0)}
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Active in radar
          </p>
        </CardContent>
      </Card>

      <Card data-testid="kpi-hot" className="bg-card shadow-sm hover:shadow-md transition-shadow border-hot/20 relative overflow-hidden">
        <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-hot/40 to-hot" />
        <CardHeader className="flex flex-row items-start justify-between gap-2 p-4 pb-1 sm:p-6 sm:pb-2">
          <CardTitle className="text-xs font-medium text-foreground sm:text-sm">Hot Opportunities</CardTitle>
          <div className="shrink-0 rounded-md bg-hot/10 p-1.5 sm:p-2">
            <Flame className="h-4 w-4 text-hot" />
          </div>
        </CardHeader>
        <CardContent className="px-4 pb-4 sm:px-6 sm:pb-6">
          <div className="text-2xl font-bold tracking-tight text-hot sm:text-3xl" data-testid="text-kpi-hot">
            {formatNumber(summary?.hot || 0)}
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Immediate action recommended
          </p>
        </CardContent>
      </Card>

      <Card data-testid="kpi-signals" className="bg-card shadow-sm hover:shadow-md transition-shadow">
        <CardHeader className="flex flex-row items-start justify-between gap-2 p-4 pb-1 sm:p-6 sm:pb-2">
          <CardTitle className="text-xs font-medium text-muted-foreground sm:text-sm">Active Signals</CardTitle>
          <div className="shrink-0 rounded-md bg-blue-500/10 p-1.5 sm:p-2">
             <Activity className="h-4 w-4 text-blue-500" />
          </div>
        </CardHeader>
        <CardContent className="px-4 pb-4 sm:px-6 sm:pb-6">
          <div className="text-2xl font-bold tracking-tight sm:text-3xl" data-testid="text-kpi-signals">
            {formatNumber(summary?.active_signals || 0)}
          </div>
          <div className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
            <span className="text-emerald-500 font-medium bg-emerald-500/10 px-1.5 py-0.5 rounded-sm tabular-nums">
              +{formatNumber(summary?.new_signals_7d || 0)}
            </span>
            <span>last 7 days</span>
          </div>
        </CardContent>
      </Card>

      <Card data-testid="kpi-health" className="bg-card shadow-sm hover:shadow-md transition-shadow">
        <CardHeader className="flex flex-row items-start justify-between gap-2 p-4 pb-1 sm:p-6 sm:pb-2">
          <CardTitle className="text-xs font-medium text-muted-foreground sm:text-sm">Data Health</CardTitle>
          <div className="shrink-0 rounded-md bg-emerald-500/10 p-1.5 sm:p-2">
            <ShieldCheck className="h-4 w-4 text-emerald-500" />
          </div>
        </CardHeader>
        <CardContent className="px-4 pb-4 sm:px-6 sm:pb-6">
          <div className="text-2xl font-bold tracking-tight sm:text-3xl" data-testid="text-kpi-health">
            {quality ? `${Math.round(quality.observations.average_confidence * 100)}%` : "--"}
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Avg confidence score
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
