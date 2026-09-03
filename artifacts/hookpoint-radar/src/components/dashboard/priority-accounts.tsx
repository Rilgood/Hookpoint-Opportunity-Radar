import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Company } from "@workspace/api-client-react";
import { Link } from "wouter";
import { getTierColor } from "@/lib/utils";
import { Building2, ArrowRight, ExternalLink } from "lucide-react";

export function PriorityAccounts({ companies, isLoading }: { companies?: Company[], isLoading: boolean }) {
  return (
    <Card className="flex flex-col h-full shadow-sm" data-testid="card-priority-accounts">
      <CardHeader className="pb-4 border-b bg-muted/20">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg font-semibold">Priority Accounts</CardTitle>
            <CardDescription className="mt-1">Highest scoring opportunities detected.</CardDescription>
          </div>
          <Link href="/opportunities" className="text-sm font-medium text-primary hover:text-primary/80 transition-colors flex items-center gap-1 group" data-testid="link-view-all-accounts">
            View all <ArrowRight className="h-4 w-4 group-hover:translate-x-0.5 transition-transform" />
          </Link>
        </div>
      </CardHeader>
      <CardContent className="p-0 flex-1">
        {isLoading ? (
          <div className="p-6 space-y-4">
            {[1,2,3,4,5].map(i => <div key={i} className="h-14 bg-muted/40 animate-pulse rounded-md" />)}
          </div>
        ) : !companies?.length ? (
          <div className="p-12 text-center flex flex-col items-center">
             <div className="h-12 w-12 rounded-full bg-muted/50 flex items-center justify-center mb-3">
               <Building2 className="h-6 w-6 text-muted-foreground" />
             </div>
             <p className="text-sm font-medium text-foreground">No priority accounts</p>
             <p className="text-xs text-muted-foreground mt-1">Waiting for high-scoring signals to arrive.</p>
          </div>
        ) : (
          <div className="divide-y divide-border/50">
            {companies.map((company, index) => (
              <Link 
                key={company.id} 
                href={`/opportunities/${company.id}`} 
                className="flex items-center justify-between p-4 hover:bg-muted/30 transition-colors group" 
                data-testid={`link-company-${company.id}`}
              >
                <div className="flex items-center gap-4">
                  <div className="h-10 w-10 rounded-lg bg-primary/5 text-primary flex items-center justify-center shrink-0 border border-primary/10 shadow-sm">
                    <span className="font-bold text-sm">{index + 1}</span>
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold group-hover:text-primary transition-colors flex items-center gap-1.5">
                      {company.name}
                      <ExternalLink className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground" />
                    </h4>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {company.industry} {company.domain ? <span className="opacity-60 px-1">•</span> : ''} {company.domain}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-6 text-right">
                  <div className="hidden sm:block">
                    <span className={`capitalize inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold shadow-sm border ${getTierColor(company.opportunity_tier)}`}>
                      {company.opportunity_tier}
                    </span>
                  </div>
                  <div className="w-14 flex flex-col items-end">
                    <span className="text-lg font-bold block leading-none tabular-nums">{Math.round(company.opportunity_score)}</span>
                    <span className="text-[10px] text-muted-foreground uppercase font-medium mt-1">Score</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
