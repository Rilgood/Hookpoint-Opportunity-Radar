import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataQuality, DashboardSummary } from "@workspace/api-client-react";
import { CheckCircle2, AlertCircle, Database, ShieldCheck, Activity } from "lucide-react";
import { formatNumber } from "@/lib/utils";
import { Link } from "wouter";

export function DataReadiness({ quality, summary, isLoading }: { quality?: DataQuality, summary?: DashboardSummary, isLoading: boolean }) {
  if (isLoading) {
    return (
      <Card className="h-full shadow-sm">
        <CardContent className="p-5"><div className="h-40 bg-muted/40 animate-pulse rounded-md" /></CardContent>
      </Card>
    );
  }

  return (
    <Card className="h-full flex flex-col shadow-sm" data-testid="card-data-readiness">
      <CardHeader className="pb-4 border-b bg-muted/10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-primary/10 rounded-md">
              <ShieldCheck className="h-4 w-4 text-primary shrink-0" />
            </div>
            <CardTitle className="text-sm font-semibold">Data Quality</CardTitle>
          </div>
          <Link href="/quality" className="text-xs text-primary hover:underline font-medium">
            Details
          </Link>
        </div>
      </CardHeader>
      <CardContent className="p-5 flex flex-col gap-4 flex-1">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5 p-3 rounded-lg bg-muted/30 border border-border/50 hover:bg-muted/40 transition-colors" data-testid="metric-connectors">
            <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5 mb-2">
              <Database className="h-3 w-3 text-primary/70"/> Connectors
            </div>
            <div className="text-2xl font-bold leading-none tabular-nums">
              {summary?.connectors.enabled || 0}
              <span className="text-sm font-medium text-muted-foreground ml-1">/ {summary?.connectors.total || 0}</span>
            </div>
            {quality?.connector_health.errors ? (
              <div className="text-xs text-destructive font-medium flex items-center gap-1 pt-1">
                <AlertCircle className="h-3.5 w-3.5"/> {quality.connector_health.errors} degraded
              </div>
            ) : (
               <div className="text-xs text-emerald-500 font-medium flex items-center gap-1 pt-1">
                 <CheckCircle2 className="h-3.5 w-3.5"/> All healthy
               </div>
            )}
          </div>

          <div className="space-y-1.5 p-3 rounded-lg bg-muted/30 border border-border/50 hover:bg-muted/40 transition-colors" data-testid="metric-identity">
            <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5 mb-2">
              <Activity className="h-3 w-3 text-primary/70"/> Resolution
            </div>
            <div className="text-2xl font-bold leading-none flex items-baseline tabular-nums">
              {quality ? Math.round(quality.identity.average_confidence * 100) : 0}
              <span className="text-sm font-bold text-muted-foreground ml-0.5">%</span>
            </div>
            <div className="text-xs text-muted-foreground font-medium pt-1 tabular-nums">
              {formatNumber(quality?.identity.needs_review || 0)} pending review
            </div>
          </div>
        </div>

        <div className="mt-auto pt-2" data-testid="metric-freshness">
          <h4 className="text-[10px] font-bold text-muted-foreground mb-3 uppercase tracking-widest border-b pb-2">Source Freshness (Top 3)</h4>
          <div className="space-y-3">
            {quality?.source_freshness.slice(0, 3).map((source) => (
              <div key={source.source} className="flex items-center justify-between text-sm group">
                <span className="capitalize text-foreground font-medium text-xs group-hover:text-primary transition-colors">
                  {source.source.replace(/_/g, ' ')}
                </span>
                <div className="flex items-center gap-3">
                  <span className="text-[10px] font-bold text-muted-foreground tabular-nums">{formatNumber(source.observations)}</span>
                  <div className="w-12 h-1.5 bg-muted rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-primary/80 rounded-full" 
                      style={{ width: `${Math.round(source.average_confidence * 100)}%` }} 
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
