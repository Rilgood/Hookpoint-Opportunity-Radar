import { useParams, Link } from "wouter";
import {
  useGetRadarCompany,
  useRecordRadarOutcome,
  OutcomeInputOutcomeType,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { getGetRadarCompanyQueryKey } from "@workspace/api-client-react";
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
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function OpportunityDetail() {
  const { id } = useParams();
  const { toast } = useToast();
  const queryClient = useQueryClient();

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
          description: "The account status has been updated.",
        });
        if (id) {
          queryClient.invalidateQueries({
            queryKey: getGetRadarCompanyQueryKey(id),
          });
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
        <Skeleton className="h-8 w-[200px]" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (isError || !response?.data) {
    return (
      <div className="text-center py-20">
        <h2 className="text-2xl font-bold mb-2">Account Not Found</h2>
        <p className="text-muted-foreground mb-6">
          This opportunity evidence packet could not be loaded.
        </p>
        <Link href="/opportunities">
          <Button variant="outline">Return to list</Button>
        </Link>
      </div>
    );
  }

  const { company, signals, observations, recommendation, people } =
    response.data;

  const handleOutcome = (type: OutcomeInputOutcomeType) => {
    if (!id) return;
    outcomeMutation.mutate({ id, data: { outcome_type: type } });
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300 pb-12">
      <div>
        <Link href="/opportunities">
          <Button
            variant="ghost"
            size="sm"
            className="mb-4 -ml-3 text-muted-foreground"
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
                  " capitalize text-sm px-3"
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
                className="text-primary hover:underline flex items-center text-sm"
              >
                {company.domain} <ExternalLink className="ml-1 h-3 w-3" />
              </a>
            )}
          </div>

          <div className="flex gap-2 bg-card border rounded-md p-1">
            <Button
              size="sm"
              variant="ghost"
              className="text-green-600 hover:text-green-700 hover:bg-green-50"
              onClick={() => handleOutcome(OutcomeInputOutcomeType.opportunity)}
              disabled={outcomeMutation.isPending}
              data-testid="btn-mark-opportunity"
            >
              <CheckCircle2 className="mr-2 h-4 w-4" /> Accept
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive hover:text-destructive hover:bg-destructive/10"
              onClick={() =>
                handleOutcome(OutcomeInputOutcomeType.disqualified)
              }
              disabled={outcomeMutation.isPending}
              data-testid="btn-mark-disqualified"
            >
              <XCircle className="mr-2 h-4 w-4" /> Disqualify
            </Button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column - Key Info & Recommendation */}
        <div className="space-y-6 lg:col-span-1">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">Account Profile</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground mb-1 flex items-center gap-1">
                    <Building2 className="h-3 w-3" /> Industry
                  </p>
                  <p className="font-medium">{company.industry || "Unknown"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground mb-1 flex items-center gap-1">
                    <Users className="h-3 w-3" /> Size
                  </p>
                  <p className="font-medium">
                    {company.size_band || "Unknown"}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground mb-1 flex items-center gap-1">
                    <MapPin className="h-3 w-3" /> Location
                  </p>
                  <p className="font-medium">
                    {company.city
                      ? `${company.city}, ${company.state || ""}`
                      : "Unknown"}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground mb-1 flex items-center gap-1">
                    <Activity className="h-3 w-3" /> Status
                  </p>
                  <p className="font-medium capitalize">{company.status}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-primary text-primary-foreground border-primary-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <Lightbulb className="h-5 w-5 text-accent" />
                Score: {company.opportunity_score}/100
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3 text-sm opacity-90">
                <div className="flex justify-between items-center border-b border-white/10 pb-2">
                  <span>Fit Score</span>
                  <span className="font-mono">{company.fit_score}</span>
                </div>
                <div className="flex justify-between items-center border-b border-white/10 pb-2">
                  <span>Intent Score</span>
                  <span className="font-mono">{company.intent_score}</span>
                </div>
                <div className="flex justify-between items-center border-b border-white/10 pb-2">
                  <span>Timing Score</span>
                  <span className="font-mono">{company.timing_score}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span>Risk Penalty</span>
                  <span className="font-mono text-red-300">
                    {company.risk_score > 0 ? `-${company.risk_score}` : "0"}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

          {recommendation && (
            <Card className="border-accent">
              <CardHeader className="pb-3 bg-accent/5">
                <CardTitle className="text-lg text-foreground">
                  Playbook
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4 space-y-4 text-sm">
                <div>
                  <span className="font-semibold block mb-1">
                    Recommended Offer
                  </span>
                  <p className="text-muted-foreground">
                    {recommendation.offer}
                  </p>
                </div>
                <div>
                  <span className="font-semibold block mb-1">
                    Outreach Angle
                  </span>
                  <p className="text-muted-foreground">
                    {recommendation.outreach_angle}
                  </p>
                </div>
                {recommendation.proof_points &&
                  recommendation.proof_points.length > 0 && (
                    <div>
                      <span className="font-semibold block mb-1">
                        Proof Points
                      </span>
                      <ul className="space-y-2 text-muted-foreground">
                        {recommendation.proof_points.map((pt, i) => (
                          <li
                            key={`${pt.label}-${i}`}
                            className="rounded-md border bg-muted/30 p-3"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <span className="font-medium text-foreground">
                                {pt.label}
                              </span>
                              <span className="shrink-0 font-mono text-xs text-primary">
                                +{pt.contribution}
                              </span>
                            </div>
                            <p className="mt-1 text-xs leading-relaxed">
                              {pt.summary}
                            </p>
                            <p className="mt-2 text-[11px]">
                              {pt.source_count}{" "}
                              {pt.source_count === 1 ? "source" : "sources"} ·
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
        </div>

        {/* Right Column - Evidence (Signals & Observations) */}
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Active Signals</CardTitle>
              <CardDescription>
                Synthesized drivers behind the opportunity score.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {signals.length === 0 ? (
                <div className="text-center py-6 text-muted-foreground text-sm border border-dashed rounded-md">
                  No active signals detected.
                </div>
              ) : (
                <div className="space-y-4">
                  {signals.map((signal) => (
                    <div
                      key={signal.id}
                      className="p-4 border rounded-lg bg-card hover-elevate transition-all"
                    >
                      <div className="flex justify-between items-start mb-2">
                        <h4 className="font-semibold">{signal.label}</h4>
                        <Badge
                          variant="secondary"
                          className="capitalize text-xs"
                        >
                          {humanizeLabel(signal.category)}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground mb-3">
                        {signal.summary}
                      </p>
                      <div className="flex items-center gap-4 text-xs text-muted-foreground font-medium">
                        <span>Contribution: +{signal.contribution}</span>
                        <span>
                          Evidence: {signal.source_count}{" "}
                          {signal.source_count === 1 ? "source" : "sources"}
                        </span>
                        <span>Seen: {formatDate(signal.first_seen_at)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Raw Observations</CardTitle>
              <CardDescription>
                Source evidence backing the active signals.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {observations.length === 0 ? (
                <div className="text-center py-6 text-muted-foreground text-sm border border-dashed rounded-md">
                  No raw observations available.
                </div>
              ) : (
                <div className="space-y-3">
                  {observations.map((obs) => (
                    <div
                      key={obs.id}
                      className="flex gap-4 p-3 border-b last:border-0 hover:bg-muted/50 transition-colors rounded-sm"
                    >
                      <div className="w-16 shrink-0 pt-1">
                        <Badge
                          variant="outline"
                          className="text-[10px] w-full justify-center"
                        >
                          {humanizeLabel(obs.source)}
                        </Badge>
                      </div>
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-medium text-sm">
                            {obs.title}
                          </span>
                          <span className="text-xs text-muted-foreground bg-muted px-1.5 rounded">
                            {humanizeLabel(obs.type)}
                          </span>
                        </div>
                        {obs.body && (
                          <p className="text-sm text-muted-foreground line-clamp-2">
                            {obs.body}
                          </p>
                        )}
                        <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                          <span>{formatDate(obs.observed_at)}</span>
                          <span>
                            Confidence: {(obs.confidence * 100).toFixed(0)}%
                          </span>
                          {obs.url && (
                            <a
                              href={obs.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-primary hover:underline inline-flex items-center"
                            >
                              Source <ExternalLink className="h-3 w-3 ml-0.5" />
                            </a>
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
