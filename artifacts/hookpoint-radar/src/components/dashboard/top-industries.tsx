import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DashboardSummary } from "@workspace/api-client-react";
import { formatNumber } from "@/lib/utils";

export function TopIndustries({ summary, isLoading }: { summary?: DashboardSummary, isLoading: boolean }) {
  if (isLoading) {
    return (
      <Card className="h-full shadow-sm rounded-xl border-border/80">
        <CardContent className="p-6"><div className="h-48 bg-muted/40 animate-pulse rounded-md" /></CardContent>
      </Card>
    );
  }

  const industries = [...(summary?.top_industries || [])]
    .sort((a, b) => b.companies - a.companies)
    .slice(0, 5);

  const max = Math.max(...industries.map(i => i.companies), 1);

  return (
    <Card className="h-full shadow-sm border-border/80 rounded-xl" data-testid="card-top-industries">
      <CardHeader className="pb-4 border-b border-border/40">
        <CardTitle className="text-sm font-bold">Top Industries</CardTitle>
      </CardHeader>
      <CardContent className="p-6">
        {industries.length === 0 ? (
           <div className="h-full flex items-center justify-center text-sm text-muted-foreground font-medium">
             No industry data available
           </div>
        ) : (
          <div className="space-y-4">
            {industries.map((item) => (
              <div key={item.industry} className="space-y-1.5">
                <div className="flex justify-between text-xs font-bold text-foreground">
                  <span>{item.industry}</span>
                  <span>{formatNumber(item.companies)}</span>
                </div>
                <div className="h-2 w-full bg-muted/50 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary/80 rounded-full"
                    style={{ width: `${(item.companies / max) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}