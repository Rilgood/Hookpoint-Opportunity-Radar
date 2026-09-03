import {
  useGetRadarDashboard,
  useIngestRadarObservations,
  useListRadarCompanies,
  useListRadarSignals,
  useGetRadarDataQuality,
  useListRadarReviewQueue,
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
import { Radar, AlertTriangle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

import {
  KpiGrid,
  PriorityAccounts,
  RecentSignals,
  PipelineDistribution,
  TopIndustries,
  DataReadiness,
  ReviewAlert,
} from "@/components/dashboard";

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
  
  const { data: dashboardRes, isLoading: isDashboardLoading, isError } = useGetRadarDashboard();
  const { data: companiesRes, isLoading: isCompaniesLoading } = useListRadarCompanies({ limit: 5 });
  const { data: signalsRes, isLoading: isSignalsLoading } = useListRadarSignals({ limit: 4 });
  const { data: qualityRes, isLoading: isQualityLoading } = useGetRadarDataQuality();
  const { data: reviewRes, isLoading: isReviewLoading } = useListRadarReviewQueue({ limit: 5 });

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

  if (isDashboardLoading) return <DashboardSkeleton />;

  if (isError || !dashboardRes?.data) {
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

  if (dashboardRes.data.companies === 0) {
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

  const summary = dashboardRes.data;
  const companies = companiesRes?.data.data;
  const signals = signalsRes?.data;
  const quality = qualityRes?.data;
  const reviewItems = reviewRes?.data;

  return (
    <div className="space-y-6 animate-in fade-in duration-500 pb-10">
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

      {!isReviewLoading && reviewItems && reviewItems.length > 0 && (
        <ReviewAlert items={reviewItems} />
      )}

      <KpiGrid summary={summary} quality={quality} />

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
