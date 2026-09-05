import { useState } from "react";
import { useParams, Link, useLocation } from "wouter";
import {
  useGetRadarCompany,
  useConfirmRadarIdentity,
  useMergeRadarCompanyIdentity,
  useSeparateRadarCompanyIdentity,
  useListRadarCompanies,
  useRecordRadarOutcome,
  useGetRadarCompanyInsights,
  OutcomeInputOutcomeType,
  OutcomeInput,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetRadarCompanyQueryKey,
  getGetRadarDashboardQueryKey,
  getListRadarCompaniesQueryKey,
  getGetRadarOutcomeAnalyticsQueryKey,
  getGetRadarCompanyInsightsQueryKey,
  getGetRadarAnalyticsInsightsQueryKey,
} from "@workspace/api-client-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  AlertCircle,
  ShieldCheck,
  Split,
  CalendarPlus,
  ArrowRight,
  ListTodo,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { AccountBrief } from "@/components/account-brief";
import { OutcomeDialog } from "@/components/outcome-dialog";
import { WorkItemDialog } from "@/components/work-item-dialog";
import { EvidenceReviewPanel } from "@/components/evidence-review-panel";
import { CompanyInsightsSection } from "@/components/insights";
import { buildAccountBrief, safeEvidenceUrl } from "@/lib/account-brief";
import {
  formatWorkDate,
  localTimeZone,
  useWorkItems,
  WORK_ITEMS_QUERY_KEY,
} from "@/lib/workflow-api";

type RecommendationPanelsProps = {
  recommendation: {
    offer: string;
    outreach_angle: string;
    proof_points?: Array<{
      label: string;
      contribution?: number;
      summary: string;
      source_count?: number;
      last_seen_at?: string;
    }>;
  } | null;
  mergedRecommendationContexts: Array<{
    source_company_id: string;
    source_name: string;
    merged_at: string;
    offer: string;
    headline?: string | null;
    rationale: string;
    outreach_angle: string;
    next_action: string;
    proof_points: Array<{
      label: string;
      summary: string;
    }>;
  }>;
};

export function RecommendationPanels({
  recommendation,
  mergedRecommendationContexts,
}: RecommendationPanelsProps) {
  return (
    <>
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
                          {typeof pt.contribution === "number" && (
                            <span className="shrink-0 font-mono text-xs font-bold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 px-1.5 py-0.5 rounded">
                              {pt.contribution} units
                            </span>
                          )}
                        </div>
                        <p className="mt-1.5 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                          {pt.summary}
                        </p>
                        <p className="mt-2.5 text-[11px] font-medium text-slate-400 dark:text-slate-500 uppercase tracking-wide">
                          {pt.source_count !== undefined && (
                            <>
                              {pt.source_count}{" "}
                              {pt.source_count === 1 ? "source" : "sources"}{" "}
                              &bull;{" "}
                            </>
                          )}
                          seen{" "}
                          {pt.last_seen_at
                            ? formatDate(pt.last_seen_at)
                            : "unknown"}
                        </p>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
          </CardContent>
        </Card>
      )}

      {mergedRecommendationContexts.length > 0 && (
        <Card className="border-slate-200 dark:border-slate-800 shadow-sm">
          <CardHeader className="pb-3 border-b bg-slate-50/70 dark:bg-slate-900/40">
            <CardTitle className="text-lg flex items-center gap-2">
              <History className="h-5 w-5 text-slate-500" />
              Retained merged-account context
            </CardTitle>
            <CardDescription>
              Historical research retained for reference. It is not an active
              recommendation or an outreach instruction.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-4 space-y-4">
            {mergedRecommendationContexts.map((context, index) => (
              <section
                key={`${context.source_company_id}-${context.merged_at}-${index}`}
                className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950/30"
              >
                <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 pb-3 dark:border-slate-800">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Merged source account
                    </p>
                    <p className="mt-1 font-semibold text-foreground">
                      {context.source_name}
                    </p>
                  </div>
                  <Badge
                    variant="outline"
                    className="font-normal text-muted-foreground"
                  >
                    Merged {formatDate(context.merged_at)}
                  </Badge>
                </div>
                <div className="space-y-4 pt-4 text-sm">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Former offer
                    </p>
                    <p className="mt-1 font-medium text-foreground">
                      {context.offer}
                    </p>
                  </div>
                  {context.headline && (
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Original headline
                      </p>
                      <p className="mt-1 text-muted-foreground">
                        {context.headline}
                      </p>
                    </div>
                  )}
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Retained rationale
                    </p>
                    <p className="mt-1 leading-relaxed text-muted-foreground">
                      {context.rationale}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Original outreach angle
                    </p>
                    <p className="mt-1 leading-relaxed text-muted-foreground">
                      {context.outreach_angle}
                    </p>
                  </div>
                  {context.proof_points.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Retained proof points
                      </p>
                      <ul className="mt-2 space-y-2">
                        {context.proof_points.map((point, pointIndex) => (
                          <li
                            key={`${point.label}-${pointIndex}`}
                            className="rounded-md bg-slate-50 px-3 py-2 dark:bg-slate-900"
                          >
                            <p className="font-medium text-foreground">
                              {point.label}
                            </p>
                            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                              {point.summary}
                            </p>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <div className="rounded-md border border-dashed border-slate-200 px-3 py-2 dark:border-slate-700">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Former next step · reference only
                    </p>
                    <p className="mt-1 text-muted-foreground">
                      {context.next_action}
                    </p>
                  </div>
                </div>
              </section>
            ))}
          </CardContent>
        </Card>
      )}
    </>
  );
}

export default function OpportunityDetail() {
  const { id } = useParams();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [outcomeDialogOpen, setOutcomeDialogOpen] = useState(false);
  const [workDialogOpen, setWorkDialogOpen] = useState(false);
  const companyWork = useWorkItems(
    { company_id: id, view: "open", limit: 3, time_zone: localTimeZone() },
    !!id,
  );
  const [identityDialog, setIdentityDialog] = useState<
    "confirm" | "merge" | "separate" | null
  >(null);
  const [identityType, setIdentityType] = useState<
    "domain" | "crm_id" | "linkedin_url"
  >("domain");
  const [identityValue, setIdentityValue] = useState("");
  const [mergeTarget, setMergeTarget] = useState("");
  const [separatedName, setSeparatedName] = useState("");
  const [selectedAliases, setSelectedAliases] = useState<string[]>([]);

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

  const { data: insightsResponse, isLoading: isInsightsLoading } =
    useGetRadarCompanyInsights(id || "", {
      query: {
        enabled: !!id,
        queryKey: getGetRadarCompanyInsightsQueryKey(id || ""),
      },
    });

  const outcomeMutation = useRecordRadarOutcome({
    mutation: {
      onSuccess: () => {
        toast({
          title: "Outcome recorded",
          description:
            "Saved to account history. The latest pipeline state and analytics will refresh.",
        });
        setOutcomeDialogOpen(false);
        if (id) {
          void Promise.all([
            queryClient.invalidateQueries({ queryKey: WORK_ITEMS_QUERY_KEY }),
            queryClient.invalidateQueries({
              queryKey: getGetRadarCompanyQueryKey(id),
            }),
            queryClient.invalidateQueries({
              queryKey: getListRadarCompaniesQueryKey(),
            }),
            queryClient.invalidateQueries({
              queryKey: getGetRadarDashboardQueryKey(),
            }),
            queryClient.invalidateQueries({
              queryKey: getGetRadarOutcomeAnalyticsQueryKey(),
            }),
            queryClient.invalidateQueries({
              queryKey: getGetRadarCompanyInsightsQueryKey(id),
            }),
            queryClient.invalidateQueries({
              queryKey: getGetRadarAnalyticsInsightsQueryKey(),
            }),
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
  const refreshIdentity = () => {
    if (!id) return;
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: WORK_ITEMS_QUERY_KEY }),
      queryClient.invalidateQueries({
        queryKey: getGetRadarCompanyQueryKey(id),
      }),
      queryClient.invalidateQueries({
        queryKey: getListRadarCompaniesQueryKey(),
      }),
      queryClient.invalidateQueries({ queryKey: ["/api/v1/review-queue"] }),
      queryClient.invalidateQueries({
        queryKey: getGetRadarCompanyInsightsQueryKey(id),
      }),
    ]);
  };
  const identitySuccess = (message: string) => {
    toast({ title: "Identity review saved", description: message });
    setIdentityDialog(null);
    setSelectedAliases([]);
    refreshIdentity();
  };
  const confirmMutation = useConfirmRadarIdentity({
    mutation: {
      onSuccess: () =>
        identitySuccess("The authoritative identity is confirmed."),
      onError: () =>
        toast({ title: "Unable to confirm identity", variant: "destructive" }),
    },
  });
  const mergeMutation = useMergeRadarCompanyIdentity({
    mutation: {
      onSuccess: (result) => {
        identitySuccess("The accounts were merged and the action was audited.");
        if (result.data.target_company_id)
          setLocation(`/opportunities/${result.data.target_company_id}`);
      },
      onError: () =>
        toast({
          title: "Unable to merge accounts",
          description: "Review the target and try again.",
          variant: "destructive",
        }),
    },
  });
  const separateMutation = useSeparateRadarCompanyIdentity({
    mutation: {
      onSuccess: () =>
        identitySuccess(
          "A separate account was created for the selected aliases.",
        ),
      onError: () =>
        toast({ title: "Unable to separate identity", variant: "destructive" }),
    },
  });
  const { data: companyList } = useListRadarCompanies(
    { limit: 200 },
    {
      query: {
        enabled: identityDialog === "merge",
        queryKey: ["/api/v1/companies", { limit: 200, identityDialog }],
      },
    },
  );

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
          This opportunity evidence packet could not be loaded or may have been
          deleted.
        </p>
        <Link href="/opportunities">
          <Button>Return to Opportunities</Button>
        </Link>
      </div>
    );
  }

  const {
    company,
    signals,
    observations,
    recommendation,
    merged_recommendation_contexts: mergedRecommendationContexts,
    outcomes,
    identity_review: identityReview,
  } = response.data;
  const activeSignals = signals.filter((signal) => signal.status === "active");
  const workflowClosed = [
    "customer",
    "lost",
    "rejected",
    "disqualified",
  ].includes(company.status);
  const workQueueLink = `/work-queue?view=all&company_id=${encodeURIComponent(company.id)}`;
  const historicalSignals = signals.filter(
    (signal) => signal.status !== "active",
  );

  const handleOutcomeSubmit = (
    type: OutcomeInputOutcomeType,
    note?: string,
    amount?: number,
    occurred_at?: string,
    signal_key?: string,
  ) => {
    if (!id) return;

    const data: OutcomeInput = {
      outcome_type: type,
    };

    if (note && note.trim()) {
      data.note = note.trim();
    }

    if (amount !== undefined) Object.assign(data, { amount });
    if (occurred_at && occurred_at.trim())
      Object.assign(data, { occurred_at: occurred_at.trim() });
    if (signal_key && signal_key.trim())
      Object.assign(data, { signal_key: signal_key.trim() });

    outcomeMutation.mutate({ id, data });
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300 pb-12">
      <OutcomeDialog
        key={`outcome-${company.id}`}
        open={outcomeDialogOpen}
        onOpenChange={setOutcomeDialogOpen}
        onSubmit={handleOutcomeSubmit}
        isPending={outcomeMutation.isPending}
        companyName={company.name}
        signals={signals}
      />
      <Dialog
        open={identityDialog !== null}
        onOpenChange={(open) => !open && setIdentityDialog(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {identityDialog === "confirm"
                ? "Confirm authoritative identity"
                : identityDialog === "merge"
                  ? "Merge duplicate accounts"
                  : "Separate account identity"}
            </DialogTitle>
            <DialogDescription>
              {identityDialog === "confirm"
                ? "This records a reviewer-approved canonical identifier."
                : "This is a high-risk operation. It only proceeds after this explicit confirmation and is permanently audited."}
            </DialogDescription>
          </DialogHeader>
          {identityDialog === "confirm" && (
            <div className="space-y-4">
              <Select
                value={identityType}
                onValueChange={(value) =>
                  setIdentityType(value as typeof identityType)
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="domain">Authoritative domain</SelectItem>
                  <SelectItem value="crm_id">CRM ID</SelectItem>
                  <SelectItem value="linkedin_url">
                    LinkedIn identity
                  </SelectItem>
                </SelectContent>
              </Select>
              <Input
                value={identityValue}
                onChange={(event) => setIdentityValue(event.target.value)}
                placeholder="Enter the verified value"
              />
            </div>
          )}
          {identityDialog === "merge" && (
            <div className="space-y-3">
              <Label>Keep this target account</Label>
              <Select value={mergeTarget} onValueChange={setMergeTarget}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose the surviving account" />
                </SelectTrigger>
                <SelectContent>
                  {companyList?.data.data
                    .filter((candidate) => candidate.id !== id)
                    .map((candidate) => (
                      <SelectItem key={candidate.id} value={candidate.id}>
                        {candidate.name}
                        {candidate.domain ? ` — ${candidate.domain}` : ""}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {identityDialog === "separate" && (
            <div className="space-y-4">
              <Input
                value={separatedName}
                onChange={(event) => setSeparatedName(event.target.value)}
                placeholder="Name of the new account"
              />
              <div className="space-y-2">
                <Label>Aliases to move</Label>
                {identityReview.aliases.map((alias) => (
                  <label
                    key={alias.id}
                    className="flex items-center gap-2 rounded border p-2 text-sm"
                  >
                    <Checkbox
                      checked={selectedAliases.includes(alias.id)}
                      onCheckedChange={(checked) =>
                        setSelectedAliases((previous) =>
                          checked
                            ? [...previous, alias.id]
                            : previous.filter((id) => id !== alias.id),
                        )
                      }
                    />{" "}
                    <span className="font-medium">
                      {humanizeLabel(alias.alias_type)}:
                    </span>{" "}
                    {alias.alias_value}
                  </label>
                ))}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setIdentityDialog(null)}>
              Cancel
            </Button>
            <Button
              variant={identityDialog === "confirm" ? "default" : "destructive"}
              disabled={
                confirmMutation.isPending ||
                mergeMutation.isPending ||
                separateMutation.isPending ||
                (identityDialog === "confirm" && !identityValue.trim()) ||
                (identityDialog === "merge" && !mergeTarget) ||
                (identityDialog === "separate" &&
                  (!separatedName.trim() || !selectedAliases.length))
              }
              onClick={() => {
                if (!id) return;
                if (identityDialog === "confirm")
                  confirmMutation.mutate({
                    id,
                    data: {
                      identity_type: identityType,
                      value: identityValue.trim(),
                    },
                  });
                if (identityDialog === "merge")
                  mergeMutation.mutate({
                    id,
                    data: { target_company_id: mergeTarget, confirmed: true },
                  });
                if (identityDialog === "separate")
                  separateMutation.mutate({
                    id,
                    data: {
                      name: separatedName.trim(),
                      alias_ids: selectedAliases,
                      confirmed: true,
                    },
                  });
              }}
            >
              {identityDialog === "confirm"
                ? "Confirm identity"
                : identityDialog === "merge"
                  ? "Confirm merge"
                  : "Confirm separation"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
            {safeEvidenceUrl(company.website_url) && (
              <a
                href={safeEvidenceUrl(company.website_url)!}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:text-primary/80 hover:underline flex items-center text-sm font-medium mt-1"
              >
                {company.domain} <ExternalLink className="ml-1 h-3.5 w-3.5" />
              </a>
            )}
          </div>

          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground mr-2 hidden sm:inline-block">
              Status:{" "}
              <span className="font-semibold text-foreground capitalize">
                {company.status}
              </span>
            </span>
            <Button
              variant="outline"
              onClick={() => setWorkDialogOpen(true)}
              disabled={workflowClosed}
              title={
                workflowClosed
                  ? "Reopen this account before planning a new action."
                  : undefined
              }
              data-testid="btn-plan-next-action"
            >
              <CalendarPlus className="mr-2 h-4 w-4" /> Plan next action
            </Button>
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

      <AccountBrief
        key={company.id}
        detail={response.data}
        insights={insightsResponse?.data}
      />

      <section
        className="glass-panel overflow-hidden rounded-[26px]"
        aria-label="Account next actions"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/70 px-5 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <span className="glass-inset flex size-9 items-center justify-center rounded-xl text-primary">
              <ListTodo className="size-4" />
            </span>
            <div>
              <h2 className="text-base font-semibold tracking-tight">
                Next actions
              </h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Saved owners, dates, and follow-through. In-app reminders only.
              </p>
            </div>
          </div>
          <Link href={workQueueLink}>
            <Button variant="ghost" size="sm" className="gap-2 rounded-full">
              Open work queue <ArrowRight className="size-3.5" />
            </Button>
          </Link>
        </div>
        <div className="px-5 py-4 sm:px-6">
          {companyWork.isError ? (
            <div
              role="alert"
              className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground"
            >
              <p>Saved actions could not be loaded.</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void companyWork.refetch()}
              >
                Retry actions
              </Button>
            </div>
          ) : companyWork.isLoading ? (
            <p className="text-sm text-muted-foreground" role="status">
              Loading saved actions…
            </p>
          ) : companyWork.data?.data.data?.length ? (
            <ul className="divide-y divide-white/70">
              {companyWork.data.data.data.map((item) => (
                <li
                  key={item.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
                >
                  <div className="min-w-0">
                    <Link
                      href={workQueueLink}
                      className="text-sm font-medium hover:text-primary"
                    >
                      {item.title}
                    </Link>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {item.owner_name || "Unassigned"} ·{" "}
                      {formatWorkDate(item.due_at)}
                      {item.snoozed_until &&
                      item.status === "open" &&
                      Date.parse(item.snoozed_until) >
                        Date.parse(companyWork.data.data.as_of)
                        ? ` · Snoozed until ${formatWorkDate(item.snoozed_until)}`
                        : ""}
                    </p>
                  </div>
                  <Badge variant="outline" className="rounded-full text-[10px]">
                    {item.status === "done"
                      ? "Completed"
                      : humanizeLabel(item.status)}
                  </Badge>
                </li>
              ))}
            </ul>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-4 py-2">
              <div>
                <p className="text-sm font-medium">
                  {workflowClosed
                    ? "This account's workflow is closed."
                    : companyWork.data?.data.counts?.all
                      ? "No active actions in this account."
                      : "Turn the brief into a clear next step."}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {workflowClosed
                    ? "Reopen the account before planning new work. Existing actions remain in queue history."
                    : companyWork.data?.data.counts?.all
                      ? "Your snoozed, completed, or dismissed actions stay in the work queue."
                      : "No actions planned yet. Add a task with an owner and a date when you are ready."}
                </p>
              </div>
              {!workflowClosed && (
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-full"
                  onClick={() => setWorkDialogOpen(true)}
                >
                  <CalendarPlus className="mr-2 size-3.5" />
                  Plan an action
                </Button>
              )}
            </div>
          )}
          {companyWork.data?.data.total !== undefined &&
            companyWork.data.data.total > 3 && (
              <p className="mt-3 text-xs text-muted-foreground">
                Showing 3 of {companyWork.data.data.total} active actions. Open
                the queue to review all.
              </p>
            )}
        </div>
      </section>
      <WorkItemDialog
        open={workDialogOpen}
        onOpenChange={setWorkDialogOpen}
        account={{
          id: company.id,
          name: company.name,
          owner_name: company.owner_name,
          suggested_next_action: buildAccountBrief(
            response.data,
            insightsResponse?.data,
          ).next,
        }}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column - Key Info & Recommendation */}
        <div className="space-y-6 lg:col-span-1">
          <Card className="border-slate-200 dark:border-slate-800 shadow-sm">
            <CardHeader className="pb-3 bg-slate-50/50 dark:bg-slate-900/50 border-b">
              <CardTitle className="text-lg font-bold">
                Account Profile
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-4 space-y-4">
              <div className="grid grid-cols-2 gap-y-5 gap-x-4 text-sm">
                <div>
                  <p className="text-muted-foreground mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider">
                    <Building2 className="h-3.5 w-3.5" /> Industry
                  </p>
                  <p className="font-medium text-foreground">
                    {company.industry || "Unknown"}
                  </p>
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
                  <p className="font-medium text-foreground capitalize">
                    {company.status}
                  </p>
                </div>
                <div className="col-span-2 pt-3 mt-1 border-t space-y-2">
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-muted-foreground flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider">
                      Identity Resolution
                    </p>
                    <span
                      className={`font-mono text-xs font-bold px-1.5 py-0.5 rounded ${
                        company.identity_confidence < 0.8
                          ? "text-amber-700 bg-amber-50 dark:text-amber-400 dark:bg-amber-900/30"
                          : "text-blue-600 bg-blue-50 dark:text-blue-400 dark:bg-blue-900/30"
                      }`}
                    >
                      {(company.identity_confidence * 100).toFixed(0)}% Conf
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground font-medium leading-relaxed">
                    Resolved via{" "}
                    <span className="text-foreground font-semibold lowercase">
                      {humanizeLabel(company.identity_method)}
                    </span>{" "}
                    matching.
                    {company.identity_confidence < 0.8 && (
                      <span className="block mt-1.5 text-amber-700 dark:text-amber-400 font-semibold p-2 bg-amber-50/50 dark:bg-amber-900/20 rounded-md border border-amber-100 dark:border-amber-900/50">
                        <AlertCircle className="inline-block h-3.5 w-3.5 mr-1 align-text-bottom" />
                        Confidence is low. Manual verification is required
                        before initiating outreach.
                      </span>
                    )}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="border-amber-200 dark:border-amber-900 shadow-sm">
            <CardHeader className="pb-3 border-b bg-amber-50/50 dark:bg-amber-950/20">
              <CardTitle className="text-lg flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-amber-600" /> Identity
                review
              </CardTitle>
              <CardDescription>
                Review lineage before using this account for outreach.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-4 space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">
                  Review status
                </span>
                <Badge variant="outline" className="capitalize">
                  {humanizeLabel(identityReview.status)}
                </Badge>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  onClick={() => {
                    setIdentityValue(
                      company.domain ||
                        company.crm_id ||
                        company.linkedin_url ||
                        "",
                    );
                    setIdentityDialog("confirm");
                  }}
                >
                  Confirm identity
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setIdentityDialog("merge")}
                >
                  Merge duplicate
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setIdentityDialog("separate")}
                >
                  <Split className="mr-1 h-3.5 w-3.5" /> Separate
                </Button>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                  Known aliases
                </p>
                {identityReview.aliases.length ? (
                  <div className="space-y-1">
                    {identityReview.aliases.map((alias) => (
                      <p key={alias.id} className="text-sm">
                        <span className="font-medium">
                          {humanizeLabel(alias.alias_type)}:
                        </span>{" "}
                        {alias.alias_value}{" "}
                        <span className="text-xs text-muted-foreground">
                          ({alias.source || "manual"})
                        </span>
                      </p>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No aliases recorded.
                  </p>
                )}
              </div>
              {identityReview.conflicting_attributes.length > 0 && (
                <div className="rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/30">
                  <p className="text-xs font-semibold uppercase tracking-wider text-amber-800 dark:text-amber-300 mb-2">
                    Conflicting attributes
                  </p>
                  {identityReview.conflicting_attributes
                    .slice(0, 4)
                    .map((conflict: any, index) => (
                      <p
                        key={index}
                        className="text-xs text-amber-900 dark:text-amber-200"
                      >
                        {humanizeLabel(conflict.field)}: “
                        {String(conflict.incoming_value)}” differs from “
                        {String(conflict.canonical_value)}”
                      </p>
                    ))}
                </div>
              )}
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                  Lineage & audit trail
                </p>
                {[
                  ...identityReview.actions,
                  ...identityReview.resolution_events,
                ]
                  .slice(0, 5)
                  .map((item: any, index) => (
                    <p
                      key={index}
                      className="text-xs text-muted-foreground border-l-2 pl-2 py-1"
                    >
                      {humanizeLabel(item.action || item.method)} ·{" "}
                      {formatDate(item.created_at)}
                      {item.actor ? ` · ${item.actor}` : ""}
                    </p>
                  ))}
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
                  <span className="font-mono text-base">
                    {company.fit_score}
                  </span>
                </div>
                <div className="flex justify-between items-center border-b border-white/10 pb-2">
                  <span className="text-slate-300">Need Score</span>
                  <span className="font-mono text-base">
                    {company.need_score}
                  </span>
                </div>
                <div className="flex justify-between items-center border-b border-white/10 pb-2">
                  <span className="text-slate-300">Intent Score</span>
                  <span className="font-mono text-base">
                    {company.intent_score}
                  </span>
                </div>
                <div className="flex justify-between items-center border-b border-white/10 pb-2">
                  <span className="text-slate-300">Timing Score</span>
                  <span className="font-mono text-base">
                    {company.timing_score}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-300">Risk Score</span>
                  <span className="font-mono text-base text-red-400">
                    {company.risk_score}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right Column - Timeline & Insights */}
        <div className="space-y-6 lg:col-span-2">
          {isInsightsLoading ? (
            <div className="space-y-4 mb-6">
              <Skeleton className="h-12 w-1/3" />
              <Skeleton className="h-48 w-full" />
            </div>
          ) : insightsResponse?.data ? (
            <CompanyInsightsSection
              insights={insightsResponse.data}
              currentScore={company.opportunity_score}
              currentTier={company.opportunity_tier}
            />
          ) : null}

          <RecommendationPanels
            recommendation={recommendation ?? null}
            mergedRecommendationContexts={mergedRecommendationContexts}
          />

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
                    <div
                      key={i}
                      className="flex gap-3 text-sm border-l-2 border-muted pl-4 py-1 relative"
                    >
                      <div className="absolute w-2 h-2 rounded-full bg-primary -left-[5px] top-2" />
                      <div className="flex-1">
                        <div className="font-semibold capitalize text-foreground">
                          {String(outcome.outcome_type).replace(/_/g, " ")}
                        </div>
                        {outcome.note && (
                          <div className="text-muted-foreground text-xs mt-1 italic">
                            "{outcome.note}"
                          </div>
                        )}
                        <div className="text-[10px] text-muted-foreground mt-1 uppercase tracking-wider">
                          {formatDate(
                            outcome.occurred_at || outcome.created_at,
                          )}
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
              <CardTitle className="text-xl font-bold">
                Active Signals
              </CardTitle>
              <CardDescription className="text-sm mt-1">
                Synthesized drivers computing the final opportunity score.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-6">
              {activeSignals.length === 0 ? (
                <div className="text-center py-10 text-muted-foreground text-sm border border-dashed rounded-lg bg-slate-50 dark:bg-slate-900/50">
                  No active signals detected for this account.
                </div>
              ) : (
                <div className="space-y-4">
                  {activeSignals.map((signal) => (
                    <div
                      key={signal.id}
                      data-testid={`active-signal-${signal.id}`}
                      className="p-5 border border-slate-200 dark:border-slate-800 rounded-xl bg-card hover-elevate transition-all"
                    >
                      <div className="flex justify-between items-start mb-2.5">
                        <h4 className="font-bold text-base text-foreground leading-tight pr-4">
                          {signal.label}
                        </h4>
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
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs bg-slate-50 dark:bg-slate-900/50 p-3 rounded-lg border border-slate-100 dark:border-slate-800">
                        <div>
                          <p className="text-muted-foreground uppercase tracking-wider font-semibold mb-1 text-[10px]">
                            {signal.dimension === "risk"
                              ? "Risk contribution"
                              : "Signal contribution"}
                          </p>
                          <p
                            className={`font-mono font-bold ${signal.dimension === "risk" ? "text-amber-700 dark:text-amber-400" : "text-blue-600 dark:text-blue-400"}`}
                          >
                            {signal.contribution.toFixed(1)} units
                          </p>
                        </div>
                        <div>
                          <p className="text-muted-foreground uppercase tracking-wider font-semibold mb-1 text-[10px]">
                            Model Params
                          </p>
                          <p className="font-medium text-foreground">
                            Wt: {(signal.base_weight || 0).toFixed(1)} &times;
                            Str: {(signal.strength || 0).toFixed(1)}
                          </p>
                        </div>
                        <div>
                          <p className="text-muted-foreground uppercase tracking-wider font-semibold mb-1 text-[10px]">
                            Evidence Quality
                          </p>
                          <p className="font-medium text-foreground flex items-center gap-1">
                            {(signal.confidence
                              ? signal.confidence * 100
                              : 0
                            ).toFixed(0)}
                            % Conf
                          </p>
                        </div>
                        <div>
                          <p className="text-muted-foreground uppercase tracking-wider font-semibold mb-1 text-[10px]">
                            Volume
                          </p>
                          <p className="font-medium text-foreground">
                            {signal.source_count} sources &bull;{" "}
                            {signal.evidence_count || 0} hits
                          </p>
                        </div>
                      </div>
                      <div className="mt-3 flex items-center justify-between text-[11px] font-medium text-slate-400 uppercase tracking-wide">
                        <span>
                          First seen: {formatDate(signal.first_seen_at)}
                        </span>
                        <span>
                          Last seen: {formatDate(signal.last_seen_at)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {historicalSignals.length > 0 && (
                <details className="mt-5 rounded-xl border border-dashed p-4">
                  <summary className="cursor-pointer text-sm font-semibold">
                    Historical signals ({historicalSignals.length})
                  </summary>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Retained for context; these signals are not active score
                    drivers.
                  </p>
                  <div className="mt-4 space-y-4">
                    {historicalSignals.map((signal) => (
                      <div
                        key={signal.id}
                        data-testid={`historical-signal-${signal.id}`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm font-medium">{signal.label}</p>
                          <Badge variant="outline" className="capitalize">
                            {humanizeLabel(signal.status)}
                          </Badge>
                        </div>
                        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                          {signal.summary}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Last seen: {formatDate(signal.last_seen_at)}
                        </p>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </CardContent>
          </Card>

          <EvidenceReviewPanel key={company.id} companyId={company.id} />
          <Card className="shadow-sm border-slate-200 dark:border-slate-800">
            <CardHeader className="bg-slate-50/50 dark:bg-slate-900/50 border-b">
              <CardTitle className="text-xl font-bold">
                Raw Observations
              </CardTitle>
              <CardDescription className="text-sm mt-1">
                Source records retained for verification, including older
                observations.
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
                        {obs.review_status &&
                          obs.review_status !== "unreviewed" && (
                            <p
                              className={`mt-2 text-[10px] leading-relaxed ${obs.review_status === "rejected" ? "text-amber-700" : "text-muted-foreground"}`}
                            >
                              {obs.review_status === "rejected"
                                ? "Rejected · excluded from scoring"
                                : humanizeLabel(obs.review_status)}
                            </p>
                          )}
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
                          <span>
                            {Number.isFinite(Date.parse(obs.observed_at))
                              ? formatDate(obs.observed_at)
                              : "Date unavailable"}
                          </span>
                          {Date.parse(obs.observed_at) > Date.now() && (
                            <span className="text-amber-700">
                              Future-dated record · verify event time
                            </span>
                          )}
                          <span>&bull;</span>
                          <span>
                            Conf: {(obs.confidence * 100).toFixed(0)}%
                          </span>
                          {safeEvidenceUrl(obs.url) ? (
                            <>
                              <span>&bull;</span>
                              <a
                                href={safeEvidenceUrl(obs.url)!}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-primary hover:text-primary/80 hover:underline inline-flex items-center lowercase"
                              >
                                View source{" "}
                                <ExternalLink className="h-3 w-3 ml-1" />
                              </a>
                            </>
                          ) : (
                            <span className="text-amber-700">
                              Source link unavailable
                            </span>
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
