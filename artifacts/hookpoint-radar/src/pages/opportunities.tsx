import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useLocation, useSearch } from "wouter";
import {
  CompanyStatus,
  useListRadarCompanies,
  type ListRadarCompaniesParams,
} from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TableSkeleton } from "@/components/loading-states";
import {
  AlertCircle,
  ArrowRight,
  CheckCheck,
  Download,
  Flame,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Target,
  X,
} from "lucide-react";
import { getTierColor, humanizeLabel } from "@/lib/utils";
import {
  DEFAULT_OPPORTUNITY_FILTERS,
  evidenceAge,
  opportunityFilterParams,
  opportunityReviewCue,
  parseOpportunityFilters,
  type OpportunityFilters,
} from "@/lib/opportunity-triage";

const PAGE_SIZE = 20;
const STATUS_LABELS: Record<CompanyStatus, string> = {
  prospect: "Prospect",
  accepted: "Accepted",
  rejected: "Rejected",
  contacted: "Contacted",
  replied: "Replied",
  meeting: "Meeting booked",
  opportunity: "Qualified opportunity",
  customer: "Customer",
  lost: "Closed lost",
  disqualified: "Disqualified",
};

export default function Opportunities() {
  const search = useSearch();
  const [, navigate] = useLocation();
  const filters = parseOpportunityFilters(search);
  const [draftSearch, setDraftSearch] = useState(filters.q);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => setDraftSearch(filters.q), [filters.q]);
  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        event.key === "/" &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !target?.isContentEditable &&
        !target?.closest(
          "input, textarea, select, [role='combobox'], [role='dialog']",
        )
      ) {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, []);

  const updateFilters = (patch: Partial<OpportunityFilters>) => {
    const next = { ...filters, ...patch, page: patch.page ?? 1 };
    if (patch.q !== undefined) setDraftSearch(next.q);
    const params = opportunityFilterParams(next);
    if (next.page > 1) params.set("page", String(next.page));
    const query = params.toString();
    navigate(`/opportunities${query ? `?${query}` : ""}`);
  };

  const params: ListRadarCompaniesParams & { status?: CompanyStatus } = {
    q: filters.q || undefined,
    tier: filters.tier !== "all" ? filters.tier : undefined,
    status: filters.status !== "all" ? filters.status : undefined,
    identity_review_status:
      filters.identity !== "all" ? filters.identity : undefined,
    page: filters.page,
    limit: PAGE_SIZE,
  };
  const {
    data: response,
    isLoading,
    isFetching,
    isError,
    refetch,
  } = useListRadarCompanies(params);
  const results = response?.data;
  const hasFilters = Boolean(
    filters.q ||
    filters.tier !== "all" ||
    filters.status !== "all" ||
    filters.identity !== "all",
  );
  const exportUrl = `/api/v1/export/companies.csv?${opportunityFilterParams(filters).toString()}`;

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    updateFilters({ q: draftSearch.trim().slice(0, 100) });
  };

  return (
    <div className="space-y-7 animate-in fade-in duration-500 pb-10">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="page-eyebrow mb-3">Your account workbench</p>
          <h1 className="text-4xl font-semibold tracking-[-0.045em] text-foreground sm:text-[2.75rem]">
            Opportunities
          </h1>
          <p className="mt-3 max-w-xl text-[15px] leading-7 text-muted-foreground">
            Find the next account worth your attention. Check the evidence,
            choose a play, and move the conversation forward.
          </p>
        </div>
        <Button
          variant="outline"
          className="h-11 shrink-0 self-start gap-2 rounded-full px-5 sm:self-auto"
          asChild
        >
          <a href={exportUrl} download data-testid="link-export-csv">
            <Download className="h-4 w-4" />
            Export this view
          </a>
        </Button>
      </div>

      <div
        className="glass-toolbar flex w-fit max-w-full flex-wrap gap-1.5 rounded-[22px] p-1.5"
        aria-label="Quick views"
      >
        {(
          [
            {
              label: "All accounts",
              icon: Target,
              active: !hasFilters,
              patch: DEFAULT_OPPORTUNITY_FILTERS,
            },
            {
              label: "Hot tier",
              icon: Flame,
              active:
                filters.tier === "hot" &&
                filters.status === "all" &&
                filters.identity === "all" &&
                !filters.q,
              patch: { ...DEFAULT_OPPORTUNITY_FILTERS, tier: "hot" },
            },
            {
              label: "Needs identity review",
              icon: ShieldCheck,
              active:
                filters.identity === "needs_review" &&
                filters.tier === "all" &&
                filters.status === "all" &&
                !filters.q,
              patch: {
                ...DEFAULT_OPPORTUNITY_FILTERS,
                identity: "needs_review",
              },
            },
            {
              label: "Contacted",
              icon: CheckCheck,
              active:
                filters.status === "contacted" &&
                filters.tier === "all" &&
                filters.identity === "all" &&
                !filters.q,
              patch: { ...DEFAULT_OPPORTUNITY_FILTERS, status: "contacted" },
            },
          ] satisfies Array<{
            label: string;
            icon: typeof Target;
            active: boolean;
            patch: Partial<OpportunityFilters>;
          }>
        ).map((view) => (
          <Button
            key={view.label}
            variant={view.active ? "default" : "outline"}
            size="sm"
            className={`h-10 gap-2 rounded-2xl px-4 ${view.active ? "shadow-sm" : "border-transparent bg-transparent shadow-none hover:bg-white/70"}`}
            aria-pressed={view.active}
            onClick={() => updateFilters(view.patch)}
          >
            <view.icon className="h-3.5 w-3.5" />
            {view.label}
          </Button>
        ))}
      </div>

      <Card className="glass-panel overflow-hidden rounded-[28px] border-white/80">
        <form
          onSubmit={submitSearch}
          className="space-y-4 border-b border-white/70 bg-white/20 p-4 sm:p-6"
        >
          <div className="glass-inset flex gap-2 rounded-[22px] p-1.5">
            <div className="relative min-w-0 flex-1">
              <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                ref={searchRef}
                aria-label="Search companies"
                placeholder="Search company, domain, industry, or city…"
                className="h-12 rounded-2xl border-transparent bg-transparent pl-11 pr-11 shadow-none"
                value={draftSearch}
                maxLength={100}
                onChange={(event) => setDraftSearch(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    setDraftSearch("");
                    updateFilters({ q: "" });
                  }
                }}
                data-testid="input-search-companies"
              />
              <kbd className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded-md border border-white/80 bg-white/55 px-1.5 py-0.5 text-xs text-muted-foreground sm:block">
                /
              </kbd>
            </div>
            <Button
              type="submit"
              variant="secondary"
              className="h-12 rounded-2xl px-5"
              data-testid="button-apply-search"
            >
              Search
            </Button>
          </div>
          <div className="flex flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:items-center">
            <SlidersHorizontal className="mx-1 hidden h-4 w-4 shrink-0 text-muted-foreground sm:block" />
            <Select
              value={filters.tier}
              onValueChange={(value) =>
                updateFilters({ tier: value as OpportunityFilters["tier"] })
              }
            >
              <SelectTrigger
                className="h-11 w-full rounded-2xl border-white/80 bg-white/55 sm:w-[160px]"
                aria-label="Filter by tier"
                data-testid="select-tier-filter"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All tiers</SelectItem>
                <SelectItem value="hot">Hot</SelectItem>
                <SelectItem value="warm">Warm</SelectItem>
                <SelectItem value="watch">Watch</SelectItem>
                <SelectItem value="cold">Cold</SelectItem>
                <SelectItem value="suppressed">Suppressed</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={filters.status}
              onValueChange={(value) =>
                updateFilters({ status: value as OpportunityFilters["status"] })
              }
            >
              <SelectTrigger
                className="h-11 w-full rounded-2xl border-white/80 bg-white/55 sm:w-[190px]"
                aria-label="Filter by pipeline stage"
                data-testid="select-status-filter"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All pipeline stages</SelectItem>
                {Object.values(CompanyStatus).map((status) => (
                  <SelectItem key={status} value={status}>
                    {STATUS_LABELS[status]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={filters.identity}
              onValueChange={(value) =>
                updateFilters({
                  identity: value as OpportunityFilters["identity"],
                })
              }
            >
              <SelectTrigger
                className="h-11 w-full rounded-2xl border-white/80 bg-white/55 sm:w-[185px]"
                aria-label="Filter by identity review"
                data-testid="select-identity-review-filter"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All identity states</SelectItem>
                <SelectItem value="needs_review">Needs review</SelectItem>
                <SelectItem value="unreviewed">Unreviewed</SelectItem>
                <SelectItem value="confirmed">Confirmed</SelectItem>
                <SelectItem value="separated">Separated</SelectItem>
              </SelectContent>
            </Select>
            {hasFilters && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-11 gap-1.5 rounded-2xl text-muted-foreground"
                onClick={() => updateFilters(DEFAULT_OPPORTUNITY_FILTERS)}
              >
                <X className="h-3.5 w-3.5" />
                Clear filters
              </Button>
            )}
          </div>
        </form>

        <div className="flex min-h-14 items-center justify-between gap-3 border-b border-white/70 bg-white/20 px-5 py-3 text-xs text-muted-foreground sm:px-6">
          <p aria-live="polite">
            {isError ? (
              "Account data unavailable"
            ) : isLoading ? (
              "Finding opportunities…"
            ) : (
              <>
                <span className="font-semibold text-foreground">
                  {results?.total ?? 0}
                </span>{" "}
                {hasFilters ? "matching" : "total"} accounts{" "}
                <span className="mx-1.5 text-muted-foreground/40">/</span>{" "}
                Ranked by opportunity score
              </>
            )}
          </p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-9 gap-1.5 rounded-xl px-3 text-xs"
            disabled={isFetching}
            onClick={() => void refetch()}
            aria-label="Refresh opportunities"
          >
            <RefreshCw
              className={`h-3 w-3 ${isFetching ? "animate-spin" : ""}`}
            />
            <span className="hidden sm:inline">Refresh</span>
          </Button>
        </div>

        {isError ? (
          <div className="px-6 py-20 text-center" role="alert">
            <AlertCircle className="mx-auto mb-4 h-8 w-8 text-amber-600" />
            <h2 className="text-lg font-semibold">
              Opportunities could not be loaded
            </h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
              Your filters are saved in this view. Retry to reconnect to your
              account data.
            </p>
            <Button
              className="mt-5 gap-2"
              variant="outline"
              onClick={() => void refetch()}
              disabled={isFetching}
            >
              <RefreshCw className="h-4 w-4" />
              Try again
            </Button>
          </div>
        ) : isLoading ? (
          <div className="p-5">
            <TableSkeleton />
          </div>
        ) : !results?.data.length ? (
          <div className="bg-gradient-to-b from-white/10 to-white/35 px-6 py-20 text-center sm:py-24">
            <span className="glass-inset mx-auto mb-6 flex size-16 items-center justify-center rounded-[22px] text-primary">
              <Search className="size-7" />
            </span>
            <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">
              {filters.page > 1 && results?.total
                ? "This page has no accounts"
                : hasFilters
                  ? "No accounts match this view"
                  : "Your next opportunity starts with evidence"}
            </h2>
            <p className="mx-auto mt-3 max-w-md text-sm leading-7 text-muted-foreground">
              {filters.page > 1 && results?.total
                ? "The list has changed. Return to the first page to review the current results."
                : hasFilters
                  ? "Broaden the search or clear a filter to find more accounts."
                  : "Connect a source to start ranking companies from real observations."}
            </p>
            {filters.page > 1 && results?.total ? (
              <Button
                className="mt-6 h-11 rounded-full px-5"
                variant="outline"
                onClick={() => updateFilters({ page: 1 })}
              >
                Return to first page
              </Button>
            ) : hasFilters ? (
              <Button
                className="mt-6 h-11 rounded-full px-5"
                variant="outline"
                onClick={() => updateFilters(DEFAULT_OPPORTUNITY_FILTERS)}
              >
                Clear filters
              </Button>
            ) : (
              <Button className="mt-6 h-11 gap-2 rounded-full px-5" asChild>
                <Link href="/sources">
                  Connect a source
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
            )}
          </div>
        ) : (
          <Table>
            <TableHeader className="bg-white/25">
              <TableRow className="border-white/70 hover:bg-transparent">
                <TableHead className="h-12 pl-6">Account</TableHead>
                <TableHead>Priority</TableHead>
                <TableHead className="hidden xl:table-cell">
                  Review cue
                </TableHead>
                <TableHead className="hidden md:table-cell">Evidence</TableHead>
                <TableHead className="hidden sm:table-cell">
                  Pipeline stage
                </TableHead>
                <TableHead className="pr-5 text-right">
                  <span className="sr-only">Action</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {results.data.map((company) => {
                const cue = opportunityReviewCue(company);
                const age = evidenceAge(company.last_observed_at);
                return (
                  <TableRow
                    key={company.id}
                    className="group border-white/70 transition-colors hover:bg-white/55"
                    data-testid={`row-company-${company.id}`}
                  >
                    <TableCell className="max-w-[260px] py-6 pl-6">
                      <Link
                        href={`/opportunities/${company.id}`}
                        className="font-semibold text-foreground underline-offset-4 hover:text-primary hover:underline focus-visible:underline"
                        data-testid={`link-company-name-${company.id}`}
                      >
                        {company.name}
                      </Link>
                      <div className="mt-1 truncate text-xs text-muted-foreground">
                        {company.domain || "Domain not recorded"}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-x-2 gap-y-1 text-xs text-muted-foreground">
                        <span>{company.industry || "Industry unknown"}</span>
                        {company.owner_name && (
                          <span className="border-l pl-2">
                            {company.owner_name}
                          </span>
                        )}
                      </div>
                      <p
                        className={`mt-2 text-xs xl:hidden ${cue.attention ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground"}`}
                      >
                        {cue.title}
                      </p>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-baseline gap-1">
                        <span className="text-2xl font-semibold tracking-tight tabular-nums">
                          {Math.round(company.opportunity_score)}
                        </span>
                        <span className="text-[11px] text-muted-foreground">
                          /100
                        </span>
                      </div>
                      <Badge
                        variant="outline"
                        className={`mt-1.5 text-[11px] capitalize ${getTierColor(company.opportunity_tier)}`}
                      >
                        {company.opportunity_tier}
                      </Badge>
                    </TableCell>
                    <TableCell className="hidden max-w-[230px] xl:table-cell">
                      <p
                        className={`text-sm font-medium ${cue.attention ? "text-amber-700 dark:text-amber-400" : "text-foreground"}`}
                      >
                        {cue.title}
                      </p>
                      <p className="mt-1 max-w-[210px] text-xs leading-relaxed text-muted-foreground">
                        {cue.detail}
                      </p>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <p
                        className={`whitespace-nowrap text-xs font-medium ${age.stale ? "text-amber-700 dark:text-amber-400" : "text-foreground"}`}
                        title={company.last_observed_at || undefined}
                      >
                        {age.label}
                      </p>
                      <p className="mt-1.5 whitespace-nowrap text-[11px] text-muted-foreground">
                        {Math.round(company.identity_confidence * 100)}%
                        identity match
                      </p>
                      {company.identity_review_status === "needs_review" && (
                        <span className="mt-1 block text-[11px] font-medium text-amber-700 dark:text-amber-400">
                          Identity review needed
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <span className="text-xs font-medium">
                        {STATUS_LABELS[company.status] ||
                          humanizeLabel(company.status)}
                      </span>
                    </TableCell>
                    <TableCell className="pr-5 text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-10 gap-1.5 rounded-full text-primary group-hover:bg-primary/10"
                        asChild
                      >
                        <Link
                          href={`/opportunities/${company.id}`}
                          aria-label={`Review ${company.name}`}
                          data-testid={`link-detail-${company.id}`}
                        >
                          <span className="hidden lg:inline">Review</span>
                          <ArrowRight className="h-4 w-4" />
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}

        {!isError && results && results.total > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/70 bg-white/20 px-6 py-4 text-xs text-muted-foreground">
            <span>
              Showing{" "}
              {results.data.length ? (filters.page - 1) * PAGE_SIZE + 1 : 0}–
              {results.data.length
                ? Math.min(filters.page * PAGE_SIZE, results.total)
                : 0}{" "}
              of {results.total} accounts
            </span>
            {results.pages > 1 && (
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={filters.page === 1}
                  onClick={() => updateFilters({ page: filters.page - 1 })}
                  data-testid="button-previous-page"
                >
                  Previous
                </Button>
                <span className="px-1">
                  {filters.page} / {results.pages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={filters.page >= results.pages}
                  onClick={() => updateFilters({ page: filters.page + 1 })}
                  data-testid="button-next-page"
                >
                  Next
                </Button>
              </div>
            )}
          </div>
        )}
      </Card>
      <p className="flex items-start gap-2 px-2 text-xs leading-relaxed text-muted-foreground">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        Scores rank evidence for review; they are not purchase probabilities.
        Review cues use account stage, identity, and observation freshness.
      </p>
    </div>
  );
}
