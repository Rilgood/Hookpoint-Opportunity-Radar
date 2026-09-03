import {
  useGetRadarDashboard,
  useIngestRadarObservations,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { DashboardSkeleton } from "@/components/loading-states";
import { EmptyState } from "@/components/empty-state";
import {
  Radar,
  Target,
  Flame,
  Snowflake,
  AlertCircle,
  BarChart3,
  AlertTriangle,
  Activity,
  Plug,
} from "lucide-react";
import { formatNumber } from "@/lib/utils";
import { Link } from "wouter";
import {
  getGetRadarDashboardQueryKey,
  getGetRadarDataQualityQueryKey,
  getListRadarCompaniesQueryKey,
  getListRadarReviewQueueQueryKey,
  getListRadarSignalsQueryKey,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";

const SAMPLE_OBSERVATIONS = {
  records: [
    {
      source: "meta_ad_library",
      external_id: "demo-northstar-ads",
      type: "ad_snapshot",
      title: "Northstar Outdoor expanded its active campaign mix",
      confidence: 0.94,
      company: {
        name: "Northstar Outdoor (Demo)",
        domain: "northstar-outdoor.example",
        industry: "Retail",
        employee_count: 120,
      },
      attributes: {
        active_ads: 36,
        active_ads_delta_pct: 85,
        duplicate_creative_ratio: 0.68,
        median_creative_age_days: 31,
      },
    },
    {
      source: "social_analytics",
      external_id: "demo-northstar-social",
      type: "social_metric",
      title: "Engagement softened while paid activity increased",
      confidence: 0.88,
      company: {
        name: "Northstar Outdoor (Demo)",
        domain: "northstar-outdoor.example",
        industry: "Retail",
      },
      attributes: { engagement_rate_delta_pct: -34 },
    },
    {
      source: "company_news",
      external_id: "demo-harbor-funding",
      type: "funding",
      title: "Harbor Health raised a Series A",
      body: "The team raised funding to accelerate its national launch.",
      confidence: 0.91,
      company: {
        name: "Harbor Health (Demo)",
        domain: "harbor-health.example",
        industry: "Healthcare",
        employee_count: 78,
      },
      attributes: { amount: 12000000 },
    },
    {
      source: "executive_changes",
      external_id: "demo-harbor-leader",
      type: "leadership_change",
      title: "Harbor Health appoints a new CMO",
      confidence: 0.87,
      company: {
        name: "Harbor Health (Demo)",
        domain: "harbor-health.example",
        industry: "Healthcare",
      },
      attributes: { role: "Chief Marketing Officer" },
    },
    {
      source: "linkedin_jobs",
      external_id: "demo-brightline-hiring",
      type: "job_posting",
      title: "Brightline Home grows its performance creative team",
      body: "The company is also seeking a creative partner for its next growth phase.",
      confidence: 0.9,
      company: {
        name: "Brightline Home (Demo)",
        domain: "brightline-home.example",
        industry: "Home Services",
        employee_count: 210,
      },
      attributes: {
        role: "Growth Marketing Lead",
        marketing_openings_30d: 5,
        explicit_agency_search: true,
      },
    },
    {
      source: "risk_feed",
      external_id: "demo-riskline-review",
      type: "crisis",
      title: "Riskline Labs requires a manual safety review",
      body: "A material data breach is under investigation.",
      confidence: 0.96,
      company: {
        name: "Riskline Labs (Demo)",
        domain: "riskline-labs.example",
        industry: "Technology",
        employee_count: 440,
      },
      attributes: { severity: "critical" },
    },
  ],
};

export default function Dashboard() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: response, isLoading, isError } = useGetRadarDashboard();

  const ingestMutation = useIngestRadarObservations({
    mutation: {
      onSuccess: () => {
        void Promise.all([
          queryClient.invalidateQueries({
            queryKey: getGetRadarDashboardQueryKey(),
          }),
          queryClient.invalidateQueries({
            queryKey: getListRadarCompaniesQueryKey(),
          }),
          queryClient.invalidateQueries({
            queryKey: getListRadarSignalsQueryKey(),
          }),
          queryClient.invalidateQueries({
            queryKey: getGetRadarDataQualityQueryKey(),
          }),
          queryClient.invalidateQueries({
            queryKey: getListRadarReviewQueueQueryKey(),
          }),
        ]);
        toast({
          title: "Sample workspace ready",
          description:
            "Four clearly labeled demo accounts were scored using the real evidence engine.",
        });
      },
      onError: () => {
        toast({
          title: "Sample data could not be loaded",
          description:
            "The evidence engine did not accept the demo records. Please try again.",
          variant: "destructive",
        });
      },
    },
  });

  if (isLoading) return <DashboardSkeleton />;

  if (isError || !response?.data) {
    return (
      <Card className="mx-auto max-w-2xl">
        <CardContent className="py-14 text-center">
          <AlertTriangle className="mx-auto mb-4 h-8 w-8 text-destructive" />
          <h1 className="text-2xl font-bold">Radar is temporarily offline</h1>
          <p className="mx-auto mt-2 max-w-md text-muted-foreground">
            We could not reach the evidence engine. Refresh the page in a
            moment; your saved opportunities have not been changed.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (response.data.companies === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            Opportunity Radar
          </h1>
          <p className="text-muted-foreground mt-2">
            Intelligence workspace for growth teams. Detect and prioritize
            accounts based on evidence.
          </p>
        </div>

        <EmptyState
          icon={Radar}
          title="Radar is Empty"
          description="Your database contains no companies or observations yet. Connect sources or ingest sample data to see the platform in action."
          actionLabel="Load sample opportunities"
          onAction={() => ingestMutation.mutate({ data: SAMPLE_OBSERVATIONS })}
          isActionLoading={ingestMutation.isPending}
        />
      </div>
    );
  }

  const data = response?.data;

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">
            Dashboard
          </h1>
          <p className="text-muted-foreground mt-1">
            Overview of identified opportunities and signal volume.
          </p>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Accounts
            </CardTitle>
            <Target className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatNumber(data?.companies || 0)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-hot">
              Hot Opportunities
            </CardTitle>
            <Flame className="h-4 w-4 text-hot" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatNumber(data?.hot || 0)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Active Signals
            </CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatNumber(data?.active_signals || 0)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              +{formatNumber(data?.new_signals_7d || 0)} in last 7 days
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Connectors
            </CardTitle>
            <Plug className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {data?.connectors.enabled} / {data?.connectors.total}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Enabled sources
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Tier Distribution */}
        <Card className="col-span-1">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-primary" />
              Opportunity Pipeline
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-6">
              {data?.tiers.map((tier) => {
                const percentage =
                  data.companies > 0 ? (tier.count / data.companies) * 100 : 0;
                let colorClass = "bg-primary";
                if (tier.tier === "hot") colorClass = "bg-hot";
                if (tier.tier === "warm") colorClass = "bg-warm";
                if (tier.tier === "watch") colorClass = "bg-watch";
                if (tier.tier === "cold") colorClass = "bg-cold";
                if (tier.tier === "suppressed") colorClass = "bg-suppressed";

                return (
                  <div key={tier.tier} className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="capitalize font-medium">
                        {tier.tier}
                      </span>
                      <span className="text-muted-foreground">
                        {formatNumber(tier.count)}{" "}
                        {tier.count === 1 ? "account" : "accounts"}
                      </span>
                    </div>
                    <Progress
                      value={percentage}
                      indicatorClassName={colorClass}
                      className="h-2"
                    />
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Top Industries */}
        <Card className="col-span-1">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Target className="h-5 w-5 text-primary" />
              Top Industries by Score
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data?.top_industries.length === 0 ? (
              <div className="text-sm text-muted-foreground py-8 text-center">
                No industry data available yet.
              </div>
            ) : (
              <div className="space-y-4">
                {data?.top_industries.map((ind, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between border-b pb-3 last:border-0 last:pb-0"
                  >
                    <div>
                      <p className="font-medium text-sm">{ind.industry}</p>
                      <p className="text-xs text-muted-foreground">
                        {ind.companies}{" "}
                        {ind.companies === 1 ? "account" : "accounts"}
                      </p>
                    </div>
                    <div className="flex flex-col items-end">
                      <div className="text-lg font-bold">
                        {Math.round(ind.average_score)}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Avg Score
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
  );
}
