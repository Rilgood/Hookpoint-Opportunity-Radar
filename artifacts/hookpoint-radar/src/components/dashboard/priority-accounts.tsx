import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Company } from "@workspace/api-client-react";
import { Link } from "wouter";
import { getTierColor } from "@/lib/utils";
import { Building2, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";

export function PriorityAccounts({ companies, isLoading }: { companies?: Company[], isLoading: boolean }) {
  return (
    <Card className="flex flex-col h-full shadow-sm border-border/80 rounded-xl" data-testid="card-priority-accounts">
      <CardHeader className="pb-4 border-b border-border/40">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg font-bold">Priority Accounts</CardTitle>
            <CardDescription className="mt-1 text-xs">Highest scoring opportunities detected.</CardDescription>
          </div>
          <Button variant="outline" size="sm" asChild className="h-8 text-xs font-semibold rounded-lg">
            <Link href="/opportunities" data-testid="link-view-all-accounts">
              View all
            </Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-0 flex-1 bg-card">
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
          <div className="divide-y divide-border/40">
            {/* Table Header like reference */}
            <div className="hidden sm:grid grid-cols-12 gap-4 px-6 py-3 text-[11px] font-bold text-muted-foreground uppercase tracking-wider bg-muted/10">
              <div className="col-span-5">Name & Domain</div>
              <div className="col-span-3">Industry</div>
              <div className="col-span-2 text-center">Status</div>
              <div className="col-span-2 text-right">Score</div>
            </div>

            {companies.map((company, index) => (
              <Link
                key={company.id}
                href={`/opportunities/${company.id}`}
                className="grid grid-cols-1 sm:grid-cols-12 gap-4 items-center px-6 py-4 hover:bg-muted/20 transition-colors group"
                data-testid={`link-company-${company.id}`}
              >
                <div className="col-span-5 flex items-center gap-3">
                  <div className="h-8 w-8 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0 border border-primary/10 text-xs font-bold shadow-sm">
                    {company.name.charAt(0)}
                  </div>
                  <div>
                    <h4 className="text-sm font-bold group-hover:text-primary transition-colors flex items-center gap-1.5 text-foreground">
                      {company.name}
                      <ExternalLink className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground" />
                    </h4>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {company.domain}
                    </p>
                  </div>
                </div>

                <div className="col-span-3 hidden sm:block text-sm text-muted-foreground font-medium">
                  {company.industry || "—"}
                </div>

                <div className="col-span-2 hidden sm:flex justify-center">
                  <span className={`capitalize inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-bold shadow-sm border ${getTierColor(company.opportunity_tier)}`}>
                    {company.opportunity_tier}
                  </span>
                </div>

                <div className="col-span-2 sm:col-span-2 flex justify-between sm:justify-end items-center">
                  <div className="sm:hidden">
                     <span className={`capitalize inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-bold shadow-sm border ${getTierColor(company.opportunity_tier)}`}>
                      {company.opportunity_tier}
                    </span>
                  </div>
                  <span className="text-base font-bold tabular-nums text-foreground">{Math.round(company.opportunity_score)}</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}