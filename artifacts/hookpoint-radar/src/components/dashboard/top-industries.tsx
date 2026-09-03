import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DashboardSummary } from "@workspace/api-client-react";
import { Target } from "lucide-react";
import { formatNumber } from "@/lib/utils";

export function TopIndustries({ summary, isLoading }: { summary?: DashboardSummary, isLoading: boolean }) {
  return (
    <Card className="h-full flex flex-col shadow-sm" data-testid="card-top-industries">
      <CardHeader className="pb-4 border-b bg-muted/10">
        <div className="flex items-center gap-2">
          <div className="p-1.5 bg-primary/10 rounded-md">
            <Target className="h-4 w-4 text-primary shrink-0" />
          </div>
          <div>
            <CardTitle className="text-sm font-semibold">Top Industries</CardTitle>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0 flex-1">
        {isLoading ? (
          <div className="p-5 space-y-4">
            {[1,2,3].map(i => <div key={i} className="h-10 bg-muted/40 animate-pulse rounded" />)}
          </div>
        ) : summary?.top_industries.length === 0 ? (
          <div className="text-sm text-muted-foreground py-10 text-center">
            No industry data available.
          </div>
        ) : (
          <div className="divide-y divide-border/50">
            {summary?.top_industries.map((ind, i) => (
              <div
                key={i}
                className="flex items-center justify-between p-4 hover:bg-muted/20 transition-colors"
                data-testid={`industry-${i}`}
              >
                <div>
                  <p className="font-medium text-sm leading-none text-foreground">{ind.industry}</p>
                  <p className="text-[11px] text-muted-foreground mt-1.5 font-medium tabular-nums">
                    {formatNumber(ind.companies)} {ind.companies === 1 ? "ACCOUNT" : "ACCOUNTS"}
                  </p>
                </div>
                <div className="flex flex-col items-end">
                  <div className="text-base font-bold text-foreground tabular-nums">
                    {Math.round(ind.average_score)}
                  </div>
                  <div className="text-[9px] text-muted-foreground uppercase tracking-widest font-semibold mt-0.5">
                    Avg Score
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
