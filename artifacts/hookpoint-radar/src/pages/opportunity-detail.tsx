import { useState } from "react";
import { useParams, Link } from "wouter";
import {
  useGetRadarCompany,
  useRecordRadarOutcome,
  OutcomeInputOutcomeType,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { getGetRadarCompanyQueryKey, getGetRadarDashboardQueryKey, getListRadarCompaniesQueryKey } from "@workspace/api-client-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/loading-states";
import { getTierColor, formatDate, humanizeLabel } from "@/lib/utils";
import {
  ArrowLeft,
  ExternalLink,
  Briefcase,
  Building2,
  Users,
  MapPin,
  Activity,
  CheckCircle2,
  XCircle,
  Lightbulb,
  GitMerge,
  History,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { OutcomeDialog } from "@/components/outcome-dialog";

export default function OpportunityDetail() {
  const { id } = useParams();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [outcomeDialogOpen, setOutcomeDialogOpen] = useState(false);

  const {
    data: response,
    isLoading,
    isError,
  } = useGetRadarCompany(id || "", {
    query: {
      enabled: !!id,
      queryKey: getGetRadarCompanyQueryKey(id || ""),
    },
  });

  const outcomeMutation = useRecordRadarOutcome({
    mutation: {
      onSuccess: () => {
        toast({
          title: "Outcome recorded",
          description: "The account status has been updated and metrics recalculated.",
        });
        setOutcomeDialogOpen(false);
        if (id) {
          void Promise.all([
            queryClient.invalidateQueries({
              queryKey: getGetRadarCompanyQueryKey(id),
            }),
            queryClient.invalidateQueries({
              queryKey: getListRadarCompaniesQueryKey(),
            }),
            queryClient.invalidateQueries({
              queryKey: getGetRadarDashboardQueryKey(),
            })
          ]);
        }
      },
      onError: () => {
        toast({
          title: "Error",
          description: "Failed to record outcome. Please try again.",
          variant: "destructive",
        });
      },
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-[300px] mb-8" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Skeleton className="h-[400px] w-full" />
          <Skeleton className="h-[600px] w-full lg:col-span-2" />
        </div>
      </div>
    );
  }

  if (isError || !response?.data) {
    return (
      <div className="text-center py-32 bg-muted/20 rounded-xl border border-dashed">
        <h2 className="text-2xl font-bold mb-2">Account Not Found</h2>
        <p className="text-muted-foreground mb-6 max-w-md mx-auto">
          This opportunity evidence packet could not be loaded or may have been deleted.
        </p>
        <Link href="/opportunities">
          <Button>Return to Opportunities</Button>
        </Link>
      </div>
    );
  }

  const { company, signals, observations, recommendation, outcomes } =
    response.data;

  const handleOutcomeSubmit = (type: OutcomeInputOutcomeType, note?: string) => {
    if (!id) return;
    outcomeMutation.mutate({ id, data: { outcome_type: type, note } });
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300 pb-12">
      <OutcomeDialog
        open={outcomeDialogOpen}
        onOpenChange={setOutcomeDialogOpen}
        onSubmit={handleOutcomeSubmit}
        isPending={outcomeMutation.isPending}
        companyName={company.name}
      />

      <div>
        <Link href="/opportunities">
          <Button
            variant="ghost"
            size="sm"
            className="mb-4 -ml-3 text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="mr-2 h-4 w-4" /> Back to Opportunities
          </Button>
        </Link>
        <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h1 className="text-3xl font-bold tracking-tight text-foreground">
                {company.name}
              </h1>
              <Badge
                variant="outline"
                className={
                  getTierColor(company.opportunity_tier) +
                  " capitalize text-sm px-3 shadow-sm"
                }
              >
                {company.opportunity_tier} Tier
              </Badge>
            </div>
            {company.website_url && (
              <a
                href={company.website_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:text-primary/80 hover:underline flex items-center text-sm font-medium mt-1"
              >
                {company.domain} <ExternalLink className="ml-1 h-3.5 w-3.5" />
              </a>
            )}
          </div>

          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground mr-2 hidden sm:inline-block">Status: <span className="font-semibold text-foreground capitalize">{company.status}</span></span>
            <Button
              variant="default"
              className="shadow-sm"
              onClick={() => setOutcomeDialogOpen(true)}
              data-testid="btn-open-outcome-dialog"
            >
              <GitMerge className="mr-2 h-4 w-4" /> Record Outcome
            </Button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column - Key Info & Recommendation */}
        <div className="space-y-6 lg:col-span-1">
          <Card className="border-slate-200 dark:border-slate-800 shadow-sm">
            <CardHeader className="pb-3 bg-slate-50/50 dark:bg-slate-900/50 border-b">
              <CardTitle className="text-lg font-bold">Account Profile</CardTitle>
            </CardHeader>
            <CardContent className="pt-4 space-y-4">
              <div className="grid grid-cols-2 gap-y-5 gap-x-4 text-sm">
                <div>
                  <p className="text-muted-foreground mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider">
                    <Building2 className="h-3.5 w-3.5" /> Industry
                  </p>
                  <p className="font-medium text-foreground">{company.industry || "Unknown"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider">
                    <Users className="h-3.5 w-3.5" /> Size
                  </p>
                  <p className="font-medium text-foreground">
                    {company.size_band || "Unknown"}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider">
                    <MapPin className="h-3.5 w-3.5" /> Location
                  </p>
                  <p className="font-medium text-foreground">
                    {company.city
                      ? `${company.city}, ${company.state || ""}`
                      : "Unknown"}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider">
                    <Activity className="h-3.5 w-3.5" /> Status
                  </p>
                  <p className="font-medium text-foreground capitalize">{company.status}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-slate-900 text-white border-slate-800 shadow-md">
            <CardHeader className="pb-3 border-b border-white/10">
              <CardTitle className="text-lg flex items-center gap-2 font-bold">
                <Lightbulb className="h-5 w-5 text-blue-400" />
                Score Engine: {company.opportunity_score}/100
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-4">
              <div className="space-y-3.5 text-sm font-medium">
                <div className="flex justify-between items-center border-b border-white/10 pb-2">
                  <span className="text-slate-300">Fit Score</span>
                  <span className="font-mono text-base">{company.fit_score}</span>
                </div>
                <div className="flex justify-between items-center border-b border-white/10 pb-2">
                  <span className="text-slate-300">Intent Score</span>
                  <span className="font-mono text-base">{company.intent_score}</span>
                </div>
                <div className="flex justify-between items-center border-b border-white/10 pb-2">
                  <span className="text-slate-300">Timing Score</span>
                  <span className="font-mono text-base">{company.timing_score}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-300">Risk Penalty</span>
                  <span className="font-mono text-base text-red-400">
                    {company.risk_score > 0 ? `-${company.risk_score}` : "0"}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

          {recommendation && (
            <Card className="border-blue-200 dark:border-blue-900 shadow-sm">
              <CardHeader className="pb-3 bg-blue-50/50 dark:bg-blue-950/20 border-b border-blue-100 dark:border-blue-900/50">
                <CardTitle className="text-lg font-bold text-blue-900 dark:text-blue-100">
                  Recommended Playbook
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-5 space-y-5 text-sm">
                <div>
                  <span className="font-bold text-foreground block mb-1.5 uppercase text-xs tracking-wider text-blue-600 dark:text-blue-400">
                    Target Offer
                  </span>
                  <p className="text-slate-700 dark:text-slate-300 leading-relaxed font-medium">
                    {recommendation.offer}
                  </p>
                </div>
                <div>
                  <span className="font-bold text-foreground block mb-1.5 uppercase text-xs tracking-wider text-blue-600 dark:text-blue-400">
                    Outreach Angle
                  </span>
                  <p className="text-slate-700 dark:text-slate-300 leading-relaxed font-medium">
                    {recommendation.outreach_angle}
                  </p>
                </div>
                {recommendation.proof_points &&
                  recommendation.proof_points.length > 0 && (
                    <div>
                      <span className="font-bold text-foreground block mb-2.5 uppercase text-xs tracking-wider text-blue-600 dark:text-blue-400">
                        Supporting Evidence
                      </span>
                      <ul className="space-y-3 text-muted-foreground">
                        {recommendation.proof_points.map((pt, i) => (
                          <li
                            key={`${pt.label}-${i}`}
                            className="rounded-lg border bg-white dark:bg-slate-900 shadow-sm p-3"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <span className="font-semibold text-foreground text-sm">
                                {pt.label}
                              </span>
                              <span className="shrink-0 font-mono text-xs font-bold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 px-1.5 py-0.5 rounded">
                                +{pt.contribution}
                              </span>
                            </div>
                            <p className="mt-1.5 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                              {pt.summary}
                            </p>
                            <p className="mt-2.5 text-[11px] font-medium text-slate-400 dark:text-slate-500 uppercase tracking-wide">
                              {pt.source_count}{" "}
                              {pt.source_count === 1 ? "source" : "sources"} &bull;{" "}
                              seen {formatDate(pt.last_seen_at)}
                            </p>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
              </CardContent>
            </Card>
          )}

          {outcomes && outcomes.length > 0 && (
            <Card className="border-slate-200 dark:border-slate-800 shadow-sm">
              <CardHeader className="pb-3 border-b">
                <CardTitle className="text-sm font-semibold flex items-center gap-2 text-muted-foreground">
                  <History className="h-4 w-4" /> Activity History
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4">
                <div className="space-y-4">
                  {outcomes.slice(0, 5).map((outcome: any, i) => (
                    <div key={i} className="flex gap-3 text-sm border-l-2 border-muted pl-4 py-1 relative">
                      <div className="absolute w-2 h-2 rounded-full bg-primary -left-[5px] top-2" />
                      <div className="flex-1">
                        <div className="font-semibold capitalize text-foreground">
                          {String(outcome.outcome_type).replace(/_/g, ' ')}
                        </div>
                        {outcome.note && (
                          <div className="text-muted-foreground text-xs mt-1 italic">
                            "{outcome.note}"
                          </div>
                        )}
                        <div className="text-[10px] text-muted-foreground mt-1 uppercase tracking-wider">
                          {formatDate(outcome.created_at)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right Column - Evidence (Signals & Observations) */}
        <div className="space-y-6 lg:col-span-2">
          <Card className="shadow-sm border-slate-200 dark:border-slate-800">
            <CardHeader className="bg-slate-50/50 dark:bg-slate-900/50 border-b">
              <CardTitle className="text-xl font-bold">Active Signals</CardTitle>
              <CardDescription className="text-sm mt-1">
                Synthesized drivers computing the final opportunity score.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-6">
              {signals.length === 0 ? (
                <div className="text-center py-10 text-muted-foreground text-sm border border-dashed rounded-lg bg-slate-50 dark:bg-slate-900/50">
                  No active signals detected for this account.
                </div>
              ) : (
                <div className="space-y-4">
                  {signals.map((signal) => (
                    <div
                      key={signal.id}
                      className="p-5 border border-slate-200 dark:border-slate-800 rounded-xl bg-card hover-elevate transition-all"
                    >
                      <div className="flex justify-between items-start mb-2.5">
                        <h4 className="font-bold text-base text-foreground leading-tight pr-4">{signal.label}</h4>
                        <Badge
                          variant="secondary"
                          className="capitalize text-xs font-semibold bg-slate-100 dark:bg-slate-800 shrink-0"
                        >
                          {humanizeLabel(signal.category)}
                        </Badge>
                      </div>
                      <p className="text-sm text-slate-600 dark:text-slate-400 mb-4 leading-relaxed">
                        {signal.summary}
                      </p>
                      <div className="flex flex-wrap items-center gap-y-2 gap-x-4 text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide bg-slate-50 dark:bg-slate-900/50 p-2.5 rounded-lg">
                        <span className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span> Contribution: +{signal.contribution}</span>
                        <span className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span> Evidence: {signal.source_count}{" "}
                          {signal.source_count === 1 ? "source" : "sources"}</span>
                        <span className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-green-500"></span> Seen: {formatDate(signal.first_seen_at)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="shadow-sm border-slate-200 dark:border-slate-800">
            <CardHeader className="bg-slate-50/50 dark:bg-slate-900/50 border-b">
              <CardTitle className="text-xl font-bold">Raw Observations</CardTitle>
              <CardDescription className="text-sm mt-1">
                Direct source evidence backing the active signals.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-6">
              {observations.length === 0 ? (
                <div className="text-center py-10 text-muted-foreground text-sm border border-dashed rounded-lg bg-slate-50 dark:bg-slate-900/50">
                  No raw observations available.
                </div>
              ) : (
                <div className="space-y-4">
                  {observations.map((obs) => (
                    <div
                      key={obs.id}
                      className="flex flex-col sm:flex-row gap-4 p-4 border border-slate-100 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 transition-colors rounded-xl bg-white dark:bg-slate-950 shadow-sm"
                    >
                      <div className="sm:w-28 shrink-0 pt-1">
                        <Badge
                          variant="outline"
                          className="text-[10px] w-full justify-center font-semibold bg-slate-50 dark:bg-slate-900"
                        >
                          {humanizeLabel(obs.source)}
                        </Badge>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-col sm:flex-row sm:items-center gap-2 mb-1.5">
                          <span className="font-bold text-sm text-foreground">
                            {obs.title}
                          </span>
                          <span className="text-[10px] font-semibold text-muted-foreground bg-muted px-2 py-0.5 rounded uppercase tracking-wider w-fit">
                            {humanizeLabel(obs.type)}
                          </span>
                        </div>
                        {obs.body && (
                          <p className="text-sm text-slate-600 dark:text-slate-400 line-clamp-3 leading-relaxed">
                            {obs.body}
                          </p>
                        )}
                        <div className="flex flex-wrap items-center gap-3 mt-3 text-xs font-medium text-slate-400 uppercase tracking-wide">
                          <span>{formatDate(obs.observed_at)}</span>
                          <span>&bull;</span>
                          <span>
                            Conf: {(obs.confidence * 100).toFixed(0)}%
                          </span>
                          {obs.url && (
                            <>
                              <span>&bull;</span>
                              <a
                                href={obs.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-primary hover:text-primary/80 hover:underline inline-flex items-center lowercase"
                              >
                                View source <ExternalLink className="h-3 w-3 ml-1" />
                              </a>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}