import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { DashboardSummary } from "@workspace/api-client-react";
import { BarChart3 } from "lucide-react";
import { formatNumber } from "@/lib/utils";

export function PipelineDistribution({ summary, isLoading }: { summary?: DashboardSummary, isLoading: boolean }) {
  return (
    <Card className="h-full flex flex-col shadow-sm" data-testid="card-pipeline">
      <CardHeader className="pb-4 border-b bg-muted/10">
        <div className="flex items-center gap-2">
          <div className="p-1.5 bg-primary/10 rounded-md">
            <BarChart3 className="h-4 w-4 text-primary shrink-0" />
          </div>
          <div>
            <CardTitle className="text-sm font-semibold">Opportunity Pipeline</CardTitle>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-5 flex-1">
        {isLoading ? (
          <div className="space-y-5">
            {[1,2,3,4,5].map(i => <div key={i} className="h-8 bg-muted/40 animate-pulse rounded" />)}
          </div>
        ) : (
          <div className="space-y-5">
            {summary?.tiers.map((tier) => {
              const percentage = summary.companies > 0 ? (tier.count / summary.companies) * 100 : 0;
              let colorClass = "bg-primary";
              if (tier.tier === "hot") colorClass = "bg-hot";
              if (tier.tier === "warm") colorClass = "bg-warm";
              if (tier.tier === "watch") colorClass = "bg-watch";
              if (tier.tier === "cold") colorClass = "bg-cold";
              if (tier.tier === "suppressed") colorClass = "bg-suppressed";

              return (
                <div key={tier.tier} className="space-y-1.5 group" data-testid={`pipeline-tier-${tier.tier}`}>
                  <div className="flex items-center justify-between text-sm">
                    <span className="capitalize font-medium text-foreground group-hover:text-primary transition-colors">
                      {tier.tier}
                    </span>
                    <span className="text-muted-foreground font-medium tabular-nums">
                      {formatNumber(tier.count)} <span className="text-xs font-normal opacity-60">({Math.round(percentage)}%)</span>
                    </span>
                  </div>
                  <Progress
                    value={percentage}
                    indicatorClassName={colorClass}
                    className="h-1.5 bg-muted/40"
                  />
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
