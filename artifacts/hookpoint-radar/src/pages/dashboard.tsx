import {
  useGetRadarDashboard,
  useIngestRadarObservations,
  useListRadarCompanies,
  useListRadarSignals,
  useGetRadarDataQuality,
  useListRadarReviewQueue,
  useListRadarConnectors,
  getGetRadarDashboardQueryKey,
  getListRadarCompaniesQueryKey,
  getListRadarSignalsQueryKey,
  getGetRadarDataQualityQueryKey,
  getListRadarReviewQueueQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { DashboardSkeleton } from "@/components/loading-states";
import { EmptyState } from "@/components/empty-state";
import { Radar, AlertTriangle, Info, Plug } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

import {
  KpiGrid,
  PriorityAccounts,
  RecentSignals,
  PipelineDistribution,
  TopIndustries,
  DataReadiness,
  ReviewAlert,
  CalibrationAnalytics,
} from "@/components/dashboard";
import { useMemo, useState } from "react";

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
  const [hideBanner, setHideBanner] = useState(false);

  const { data: dashboardRes, isLoading: isDashboardLoading, isError } = useGetRadarDashboard();
  const { data: companiesRes, isLoading: isCompaniesLoading } = useListRadarCompanies({ limit: 5 });
  const { data: signalsRes, isLoading: isSignalsLoading } = useListRadarSignals({ limit: 4 });
  const { data: qualityRes, isLoading: isQualityLoading } = useGetRadarDataQuality();
  const { data: reviewRes, isLoading: isReviewLoading } = useListRadarReviewQueue({ limit: 5 });
  const { data: connectorsRes, isLoading: isConnectorsLoading } = useListRadarConnectors();

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
          description: "Four clearly labeled demo accounts were scored using the real evidence engine.",
        });
      },
      onError: () => {
        toast({
          title: "Sample data could not be loaded",
          description: "The evidence engine did not accept the demo records. Please try again or check your network.",
          variant: "destructive",
        });
      },
    },
  });

  const pilotState = useMemo(() => {
    if (!connectorsRes?.data) return "loading";
    const connectors = connectorsRes.data;
    if (connectors.length === 0) return "demo"; // No connectors available

    const configured = connectors.filter(c => c.configured);
    const enabled = connectors.filter(c => c.enabled);

    if (configured.length === 0) return "awaiting_credentials";
    if (enabled.length > 0 && enabled.length < connectors.filter(c => c.implemented).length) return "partial";
    if (enabled.length > 0) return "ready";
    return "demo";
  }, [connectorsRes]);

  if (isDashboardLoading || isConnectorsLoading) return <DashboardSkeleton />;

  if (isError || !dashboardRes?.data) {
    return (
      <Card className="mx-auto max-w-2xl border-destructive/20 shadow-md rounded-xl">
        <CardContent className="py-14 text-center">
          <AlertTriangle className="mx-auto mb-4 h-10 w-10 text-destructive" />
          <h1 className="text-2xl font-bold">Radar is temporarily offline</h1>
          <p className="mx-auto mt-2 max-w-md text-muted-foreground leading-relaxed">
            We could not reach the evidence engine. Refresh the page in a
            moment; your saved opportunities have not been changed.
          </p>
          <Button onClick={() => window.location.reload()} variant="outline" className="mt-6 rounded-lg font-semibold">
            Retry Connection
          </Button>
        </CardContent>
      </Card>
    );
  }

  const isDemoDataOnly = companiesRes?.data.data.every(c => c.name.includes("(Demo)")) && companiesRes?.data.data.length > 0;

  if (dashboardRes.data.companies === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">
            Opportunity Radar
          </h1>
          <p className="text-muted-foreground mt-2 font-medium">
            Intelligence workspace for growth teams. Detect and prioritize
            accounts based on evidence.
          </p>
        </div>

        {pilotState === "awaiting_credentials" && (
          <Alert className="bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800 mb-6 rounded-xl">
            <Plug className="h-5 w-5 text-amber-600 dark:text-amber-500" />
            <AlertTitle className="text-amber-800 dark:text-amber-400 font-bold">Awaiting Source Credentials</AlertTitle>
            <AlertDescription className="text-amber-700/90 dark:text-amber-500/90 mt-1 font-medium">
              Your workspace is empty because data sources are waiting to be configured.
              Head to the Sources tab to review requirements, or load sample data below to evaluate the platform UI.
            </AlertDescription>
          </Alert>
        )}

        <EmptyState
          icon={Radar}
          title="Radar is Empty"
          description="Your database contains no companies or observations yet. Configure sources in the Sources tab or ingest safe demo data to explore the workspace."
          actionLabel="Load sample opportunities"
          onAction={() => ingestMutation.mutate({ data: SAMPLE_OBSERVATIONS })}
          isActionLoading={ingestMutation.isPending}
        />
      </div>
    );
  }

  const summary = dashboardRes.data;
  const companies = companiesRes?.data.data;
  const signals = signalsRes?.data;
  const quality = qualityRes?.data;
  const reviewItems = reviewRes?.data;

  return (
    <div className="space-y-8 animate-in fade-in duration-500 pb-10">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold tracking-tight text-foreground">
              Dashboard
            </h1>
            {isDemoDataOnly && (
              <span className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-bold bg-blue-50 text-blue-700 border-blue-200 uppercase tracking-wider">
                Demo Mode
              </span>
            )}
          </div>
          <p className="text-muted-foreground mt-1 font-medium">
            Overview of identified opportunities and signal volume.
          </p>
        </div>
      </div>

      {!hideBanner && (
        <Alert className="bg-primary/5 border-primary/20 rounded-xl flex flex-col md:flex-row gap-4 items-start md:items-center justify-between">
          <div className="flex gap-4">
            <div className="bg-primary/10 p-2 rounded-lg shrink-0 mt-0.5">
              <Info className="h-5 w-5 text-primary" />
            </div>
            <div>
              <AlertTitle className="font-bold text-foreground">Pilot Readiness Status</AlertTitle>
              <AlertDescription className="mt-1 text-muted-foreground font-medium">
                {pilotState === "demo" || isDemoDataOnly
                  ? "You are currently viewing safe demo data. The scoring engine is active, but live ingestion is disabled until sources are configured."
                  : pilotState === "awaiting_credentials"
                  ? "Live ingestion is paused. Data sources are implemented but awaiting production credentials."
                  : pilotState === "partial"
                  ? "Workspace is partially connected. Some data sources are active while others await configuration."
                  : "Workspace is fully connected and actively ingesting live signals."}
              </AlertDescription>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setHideBanner(true)} className="shrink-0 -mr-2 font-bold rounded-lg text-muted-foreground">
            Dismiss
          </Button>
        </Alert>
      )}

      {!isReviewLoading && reviewItems && reviewItems.length > 0 && (
        <ReviewAlert items={reviewItems} />
      )}

      <KpiGrid summary={summary} quality={quality} />

      <CalibrationAnalytics />

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 flex flex-col gap-6">
          <PriorityAccounts companies={companies} isLoading={isCompaniesLoading} />
        </div>
        <div className="xl:col-span-1 flex flex-col gap-6">
          <RecentSignals signals={signals} isLoading={isSignalsLoading} />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1">
          <PipelineDistribution summary={summary} isLoading={isDashboardLoading} />
        </div>
        <div className="lg:col-span-1">
          <TopIndustries summary={summary} isLoading={isDashboardLoading} />
        </div>
        <div className="lg:col-span-1">
          <DataReadiness quality={quality} summary={summary} isLoading={isQualityLoading} />
        </div>
      </div>
    </div>
  );
}