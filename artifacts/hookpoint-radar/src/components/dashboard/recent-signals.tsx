import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Signal } from "@workspace/api-client-react";
import { Link } from "wouter";
import { formatDistanceToNow } from "date-fns";
import { Activity } from "lucide-react";
import { Button } from "@/components/ui/button";

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
    <Card className="flex flex-col h-full shadow-sm border-border/80 rounded-xl" data-testid="card-recent-signals">
      <CardHeader className="pb-4 border-b border-border/40">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg font-bold">Recent Signals</CardTitle>
            <CardDescription className="mt-1 text-xs">Latest market evidence.</CardDescription>
          </div>
          <Button variant="outline" size="sm" asChild className="h-8 text-xs font-semibold rounded-lg">
             <Link href="/signals" data-testid="link-view-all-signals">
               View all
             </Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-0 flex-1 bg-card">
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
          <div className="divide-y divide-border/40">
            {signals.map(signal => {
              const indicator = getIndicatorColor(signal.opportunity_tier);
              return (
                <div key={signal.id} className="p-5 hover:bg-muted/20 transition-colors group relative" data-testid={`item-signal-${signal.id}`}>
                  <div className="flex gap-4">
                    <div className="mt-1.5 relative z-10 shrink-0">
                      <div className={`h-2.5 w-2.5 rounded-full ring-4 ring-background ${indicator}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-3 mb-1">
                        <Link href={`/opportunities/${signal.company_id}`} className="text-xs font-bold text-muted-foreground hover:text-primary transition-colors">
                          {signal.company_name}
                        </Link>
                        <span className="text-[10px] font-semibold text-muted-foreground/60 whitespace-nowrap uppercase tracking-wider">
                          {formatDistanceToNow(new Date(signal.last_seen_at), { addSuffix: true })}
                        </span>
                      </div>
                      <p className="text-sm font-semibold leading-snug line-clamp-2 text-foreground mb-2">
                        {signal.label}
                      </p>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider bg-muted/50 px-2 py-1 rounded-md">
                          {signal.category.replace(/_/g, ' ')}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}