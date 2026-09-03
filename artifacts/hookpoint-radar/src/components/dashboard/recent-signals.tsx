import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Signal } from "@workspace/api-client-react";
import { Link } from "wouter";
import { formatDistanceToNow } from "date-fns";
import { ArrowRight, Activity, ChevronRight } from "lucide-react";

const getIndicatorColor = (tier: string) => {
  switch (tier) {
    case "hot": return "bg-hot";
    case "warm": return "bg-warm";
    case "watch": return "bg-watch";
    case "cold": return "bg-cold";
    case "suppressed": return "bg-suppressed";
    default: return "bg-muted";
  }
};

export function RecentSignals({ signals, isLoading }: { signals?: Signal[], isLoading: boolean }) {
  return (
    <Card className="flex flex-col h-full shadow-sm" data-testid="card-recent-signals">
      <CardHeader className="pb-4 border-b bg-muted/20">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" />
            <div>
              <CardTitle className="text-lg font-semibold">Recent Signals</CardTitle>
              <CardDescription className="mt-1">Latest market evidence.</CardDescription>
            </div>
          </div>
          <Link href="/signals" className="text-sm font-medium text-primary hover:text-primary/80 transition-colors flex items-center gap-1 group" data-testid="link-view-all-signals">
            View all <ArrowRight className="h-4 w-4 group-hover:translate-x-0.5 transition-transform" />
          </Link>
        </div>
      </CardHeader>
      <CardContent className="p-0 flex-1">
        {isLoading ? (
          <div className="p-6 space-y-6">
            {[1,2,3,4,5].map(i => (
              <div key={i} className="flex gap-4">
                <div className="w-2 h-2 rounded-full bg-muted/60 mt-2 shrink-0" />
                <div className="space-y-2 flex-1">
                  <div className="h-4 bg-muted/40 rounded w-3/4" />
                  <div className="h-3 bg-muted/40 rounded w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : !signals?.length ? (
          <div className="p-12 text-center flex flex-col items-center">
             <div className="h-12 w-12 rounded-full bg-muted/50 flex items-center justify-center mb-3">
               <Activity className="h-6 w-6 text-muted-foreground" />
             </div>
             <p className="text-sm font-medium text-foreground">No recent signals</p>
             <p className="text-xs text-muted-foreground mt-1">Connect sources to receive signals.</p>
          </div>
        ) : (
          <div className="divide-y divide-border/50">
            {signals.map(signal => {
              const indicator = getIndicatorColor(signal.opportunity_tier);
              return (
                <div key={signal.id} className="p-4 hover:bg-muted/20 transition-colors group relative" data-testid={`item-signal-${signal.id}`}>
                  <div className="flex gap-3">
                    <div className="mt-1 relative z-10 shrink-0">
                      <div className={`h-2.5 w-2.5 rounded-full ring-4 ring-background ${indicator}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-sm font-medium leading-snug line-clamp-2 pr-4 text-foreground">{signal.label}</p>
                        <span className="text-[10px] font-medium text-muted-foreground whitespace-nowrap pt-0.5 shrink-0 tabular-nums">
                          {formatDistanceToNow(new Date(signal.last_seen_at), { addSuffix: true })}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mt-2 text-xs">
                        <Link href={`/opportunities/${signal.company_id}`} className="font-medium text-foreground hover:text-primary transition-colors flex items-center gap-1">
                          {signal.company_name}
                        </Link>
                        <span className="text-muted-foreground/40">•</span>
                        <span className="text-muted-foreground capitalize bg-muted/40 px-1.5 py-0.5 rounded-sm">
                          {signal.category.replace(/_/g, ' ')}
                        </span>
                      </div>
                    </div>
                  </div>
                  <ChevronRight className="absolute right-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/30 opacity-0 group-hover:opacity-100 group-hover:translate-x-1 transition-all" />
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
