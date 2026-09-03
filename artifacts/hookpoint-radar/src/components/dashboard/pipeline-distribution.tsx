import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DashboardSummary } from "@workspace/api-client-react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from "recharts";

const COLORS: Record<string, string> = {
  hot: "hsl(var(--color-hot-hsl))",
  warm: "hsl(var(--color-warm-hsl))",
  watch: "hsl(var(--color-watch-hsl))",
  cold: "hsl(var(--color-cold-hsl))",
  suppressed: "hsl(var(--color-suppressed-hsl))",
};

export function PipelineDistribution({ summary, isLoading }: { summary?: DashboardSummary, isLoading: boolean }) {
  if (isLoading) {
    return (
      <Card className="h-full shadow-sm rounded-xl border-border/80">
        <CardContent className="p-6"><div className="h-48 bg-muted/40 animate-pulse rounded-md" /></CardContent>
      </Card>
    );
  }

  const data = (summary?.tiers || [])
    .map(t => ({
      name: t.tier.charAt(0).toUpperCase() + t.tier.slice(1),
      value: t.count,
      tier: t.tier
    }))
    .filter(d => d.value > 0);

  return (
    <Card className="h-full shadow-sm border-border/80 rounded-xl" data-testid="card-pipeline-distribution">
      <CardHeader className="pb-2 border-b border-border/40">
        <CardTitle className="text-sm font-bold">Pipeline Distribution</CardTitle>
      </CardHeader>
      <CardContent className="p-6">
        {data.length === 0 ? (
          <div className="h-[200px] flex items-center justify-center text-sm text-muted-foreground font-medium">
            No pipeline data available
          </div>
        ) : (
          <div className="h-[200px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={80}
                  paddingAngle={5}
                  dataKey="value"
                  stroke="none"
                >
                  {data.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[entry.tier] || "hsl(var(--muted))"} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value: number) => [value, "Accounts"]}
                  contentStyle={{ borderRadius: "8px", border: "1px solid hsl(var(--border))", boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.05)" }}
                />
                <Legend
                  verticalAlign="bottom"
                  height={36}
                  iconType="circle"
                  formatter={(value) => <span className="text-xs font-semibold text-foreground ml-1">{value}</span>}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}