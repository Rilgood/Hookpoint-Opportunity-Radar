import { useGetRadarOutcomeAnalytics } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/loading-states";
import { Info, Target, TrendingUp, ShieldAlert, BarChart3 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export function CalibrationAnalytics() {
  const { data: analyticsRes, isLoading, isError } = useGetRadarOutcomeAnalytics();

  if (isLoading) {
    return <Skeleton className="h-[300px] w-full" />;
  }

  const calibration = analyticsRes?.data?.calibration;

  if (isError || !calibration || !calibration.summary || !calibration.score_bands) {
    return null;
  }

  const { summary, score_bands: calScoreBands } = calibration;

  // Let's create an informative surface
  return (
    <Card className="shadow-sm border-slate-200 dark:border-slate-800">
      <CardHeader className="bg-slate-50/50 dark:bg-slate-900/50 border-b">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-xl font-bold flex items-center gap-2">
              <Target className="h-5 w-5 text-primary" />
              Outcome Calibration
            </CardTitle>
            <CardDescription className="text-sm mt-1">
              Calibration covers labeled accounts only and does not automatically change scores
            </CardDescription>
          </div>
          {!summary.sufficient_sample && (
            <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">
              <Info className="h-3 w-3 mr-1" />
              Learning Phase
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-6">
        {!summary.sufficient_sample ? (
          <div className="space-y-4">
            <Alert className="bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800">
              <ShieldAlert className="h-5 w-5 text-amber-600 dark:text-amber-500" />
              <AlertTitle className="text-amber-800 dark:text-amber-400 font-bold">
                Insufficient Sample Size
              </AlertTitle>
              <AlertDescription className="text-amber-700/90 dark:text-amber-500/90 mt-1 font-medium">
                {summary.cohort_note}
              </AlertDescription>
            </Alert>
            <div className="grid grid-cols-3 gap-4 text-center py-4">
              <div className="space-y-1">
                <p className="text-2xl font-bold text-foreground">{summary.labeled_accounts}</p>
                <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Labeled</p>
              </div>
              <div className="space-y-1">
                <p className="text-2xl font-bold text-foreground">{summary.qualified_accounts}</p>
                <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Qualified</p>
              </div>
              <div className="space-y-1">
                <p className="text-2xl font-bold text-foreground">{summary.minimum_sample}</p>
                <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Required</p>
              </div>
            </div>
            <p className="text-sm text-center text-muted-foreground bg-muted/50 p-3 rounded-lg border border-dashed">
              {summary.recommendation}
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-muted/30 p-4 rounded-xl border border-border">
              <div className="space-y-1">
                <p className="text-sm font-semibold text-foreground">{summary.cohort_note}</p>
                <p className="text-xs text-muted-foreground">Based on {summary.labeled_accounts} labeled accounts</p>
              </div>
              <div className="bg-white dark:bg-slate-950 px-4 py-2 rounded-lg border border-border text-sm font-medium shadow-sm">
                {summary.recommendation}
              </div>
            </div>

            <div className="space-y-3">
              <h4 className="text-sm font-bold text-foreground uppercase tracking-wider flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-muted-foreground" /> 
                Score Band Performance
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {calScoreBands.map((band) => (
                  <div key={band.score_band} className="p-4 rounded-xl border bg-card shadow-sm hover-elevate transition-all">
                    <div className="flex justify-between items-center mb-3">
                      <span className={`font-bold capitalize text-sm px-2 py-0.5 rounded-full border ${
                        band.score_band === "hot" ? "bg-red-50 text-red-700 border-red-200" :
                        band.score_band === "warm" ? "bg-orange-50 text-orange-700 border-orange-200" :
                        band.score_band === "watch" ? "bg-blue-50 text-blue-700 border-blue-200" :
                        "bg-green-50 text-green-700 border-green-200"
                      }`}>
                        {band.score_band}
                      </span>
                      <span className="text-xs font-semibold text-muted-foreground uppercase">{band.labeled} Labeled</span>
                    </div>
                    <div className="space-y-1">
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-3xl font-bold tracking-tight">{band.smoothed_qualified_rate.toFixed(0)}%</span>
                        <span className="text-sm text-muted-foreground font-medium">Qualified rate</span>
                      </div>
                      <div className="text-[10px] text-muted-foreground mt-0.5">
                        {band.qualified} qualified / {band.negative} negative &bull; {(band.raw_qualified_rate * 100).toFixed(0)}% raw
                      </div>
                      <div className="text-[10px] text-muted-foreground mb-1">
                        95% CI: {(band.wilson_95_lower * 100).toFixed(0)}% - {(band.wilson_95_upper * 100).toFixed(0)}%
                      </div>
                      {band.qualified_rate_lift_vs_cold !== null && (
                        <div className="flex items-center gap-1 text-xs font-medium pt-1">
                          {band.qualified_rate_lift_vs_cold > 0 ? (
                            <>
                              <TrendingUp className="h-3 w-3 text-green-600" />
                              <span className="text-green-600">+{band.qualified_rate_lift_vs_cold.toFixed(1)} pp vs cold</span>
                            </>
                          ) : band.qualified_rate_lift_vs_cold < 0 ? (
                            <span className="text-destructive">{band.qualified_rate_lift_vs_cold.toFixed(1)} pp vs cold</span>
                          ) : (
                            <span className="text-muted-foreground">Baseline</span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
