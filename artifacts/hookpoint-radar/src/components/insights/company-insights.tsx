import { useState } from "react";
import {
  CompanyInsights,
  OpportunityTier,
  InsightStoryEntry,
  CounterEvidence,
  ChangeSuggestion,
  CompanyInsightsComparableAccounts,
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
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import {
  CheckCircle2,
  AlertTriangle,
  Clock,
  TrendingUp,
  Info,
  ShieldAlert,
  Sparkles,
  Activity,
  History,
  Target,
  Search,
  ChevronDown,
  ChevronUp,
  AlertCircle,
} from "lucide-react";
import { getTierColor, formatDate } from "@/lib/utils";

// Helpers
const getDimensionColor = (dimension: string) => {
  switch (dimension.toLowerCase()) {
    case "need":
      return "bg-blue-500 dark:bg-blue-600";
    case "intent":
      return "bg-violet-500 dark:bg-violet-600";
    case "timing":
      return "bg-emerald-500 dark:bg-emerald-600";
    default:
      return "bg-slate-400 dark:bg-slate-500";
  }
};

const getUrgencyColor = (urgency: string) => {
  switch (urgency) {
    case "closing":
      return "bg-red-50 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800";
    case "building":
      return "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-900/30 dark:text-violet-400 dark:border-violet-800";
    default:
      return "bg-slate-50 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700";
  }
};

// Sub-components
export function WhyNowPanel({
  whyNow,
}: {
  whyNow: CompanyInsights["why_now"];
}) {
  if (!whyNow || whyNow.drivers.length === 0) return null;

  return (
    <Card className="shadow-sm border-slate-200 dark:border-slate-800">
      <CardHeader className="pb-3 bg-slate-50/50 dark:bg-slate-900/50 border-b">
        <CardTitle className="text-lg font-bold flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-primary" /> Why Now
        </CardTitle>
        <CardDescription className="text-sm font-medium text-foreground mt-1.5">
          {whyNow.headline}
        </CardDescription>
        <div className="flex flex-wrap gap-2 mt-2">
          {whyNow.active_dimensions.map((dim) => (
            <Badge
              key={dim}
              variant="secondary"
              className="capitalize text-[10px] font-semibold tracking-wider"
            >
              {dim} Active
            </Badge>
          ))}
        </div>
      </CardHeader>
      <CardContent className="pt-5 space-y-5">
        <div className="space-y-4">
          {whyNow.drivers.map((driver) => (
            <div key={driver.signal_key} className="space-y-2">
              <div className="flex items-start justify-between gap-2">
                <span className="text-sm font-semibold text-foreground leading-tight">
                  {driver.label}
                </span>
                <span className="text-xs font-mono font-bold text-muted-foreground whitespace-nowrap shrink-0 bg-muted px-1.5 py-0.5 rounded">
                  {driver.share_of_positive_contribution.toFixed(0)}%
                </span>
              </div>
              <div className="h-1.5 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden flex shadow-inner">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${getDimensionColor(driver.dimension)}`}
                  style={{
                    width: `${Math.max(1, driver.share_of_positive_contribution)}%`,
                  }}
                />
              </div>
              <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                {driver.is_new && (
                  <Badge
                    variant="default"
                    className="text-[9px] px-1.5 py-0 h-4 bg-primary text-primary-foreground uppercase tracking-wider"
                  >
                    New
                  </Badge>
                )}
                {driver.is_corroborated && (
                  <Badge
                    variant="outline"
                    className="text-[9px] px-1.5 py-0 h-4 border-primary/30 text-primary uppercase tracking-wider bg-primary/5"
                  >
                    Corroborated ({driver.source_count})
                  </Badge>
                )}
                <span className="text-[10px] text-muted-foreground font-medium flex items-center gap-1">
                  <Activity className="h-3 w-3" />{" "}
                  {(driver.confidence * 100).toFixed(0)}% conf
                </span>
                <span className="text-[10px] text-muted-foreground font-medium flex items-center gap-1">
                  <Clock className="h-3 w-3" /> last seen{" "}
                  {driver.days_since_last_seen}d ago
                </span>
                {driver.recency_factor >= 0.75 && (
                  <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-bold uppercase tracking-wider flex items-center gap-0.5 bg-emerald-50 dark:bg-emerald-900/30 px-1.5 rounded">
                    <TrendingUp className="h-3 w-3" /> Recent evidence
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export function ActionWindowPanel({
  actionWindow,
  currentScore,
  currentTier,
}: {
  actionWindow: CompanyInsights["action_window"];
  currentScore?: number;
  currentTier?: string;
}) {
  if (!actionWindow) return null;

  const urgencyClass = getUrgencyColor(actionWindow.urgency);

  return (
    <Card className="shadow-sm border-slate-200 dark:border-slate-800 h-full flex flex-col">
      <CardHeader className="pb-3 border-b border-slate-100 dark:border-slate-800/50">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
            Action Window
          </CardTitle>
          <Badge
            variant="outline"
            className={`capitalize shadow-sm ${urgencyClass} font-bold text-[10px]`}
          >
            {actionWindow.urgency}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="pt-5 space-y-5 flex-1 flex flex-col">
        {actionWindow.strongest_signal_label && (
          <div className="text-sm">
            <span className="font-semibold block mb-1 text-xs uppercase tracking-wider text-muted-foreground">
              Strongest signal decaying
            </span>
            <span className="font-medium text-foreground">
              {actionWindow.strongest_signal_label}
            </span>
          </div>
        )}
        <div className="bg-slate-50 dark:bg-slate-900/40 p-4 rounded-xl border border-slate-100 dark:border-slate-800 text-sm mt-auto">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-4">
            Projected decay (no new evidence)
          </p>
          <div className="flex items-center justify-between relative px-2">
            {/* Trend line */}
            <div className="absolute top-[18px] left-6 right-6 h-[2px] bg-slate-200 dark:bg-slate-700 -translate-y-1/2 z-0" />

            {/* Current -> 14d -> 30d */}
            <div className="relative z-10 flex flex-col items-center bg-slate-50 dark:bg-slate-900/40 px-2">
              <span className="text-xs font-bold text-foreground mb-1">
                Now
              </span>
              <div className="h-2.5 w-2.5 rounded-full bg-primary ring-4 ring-primary/20" />
              {currentScore !== undefined && (
                <div
                  className="mt-2 flex flex-col items-center"
                  data-testid="action-window-current-score"
                >
                  <span className="text-xs font-bold">
                    {Math.round(currentScore)}
                  </span>
                  {currentTier && (
                    <Badge
                      variant="outline"
                      className={`text-[9px] px-1.5 py-0 h-3 capitalize mt-1 border-transparent ${getTierColor(currentTier)}`}
                    >
                      {currentTier}
                    </Badge>
                  )}
                </div>
              )}
            </div>

            <div className="relative z-10 flex flex-col items-center bg-slate-50 dark:bg-slate-900/40 px-2">
              <span className="text-xs font-semibold text-muted-foreground mb-1">
                14d
              </span>
              <div className="h-2 w-2 rounded-full bg-slate-400" />
              <div className="mt-2 flex flex-col items-center">
                <span className="text-xs font-bold">
                  {Math.round(actionWindow.projected_score_in_14_days.score)}
                </span>
                <Badge
                  variant="outline"
                  className={`text-[9px] px-1.5 py-0 h-3 capitalize mt-1 border-transparent ${getTierColor(actionWindow.projected_score_in_14_days.tier)}`}
                >
                  {actionWindow.projected_score_in_14_days.tier}
                </Badge>
              </div>
            </div>

            <div className="relative z-10 flex flex-col items-center bg-slate-50 dark:bg-slate-900/40 px-2">
              <span className="text-xs font-semibold text-muted-foreground mb-1">
                30d
              </span>
              <div className="h-2 w-2 rounded-full bg-slate-300 dark:bg-slate-600" />
              <div className="mt-2 flex flex-col items-center">
                <span className="text-xs font-bold text-muted-foreground">
                  {Math.round(actionWindow.projected_score_in_30_days.score)}
                </span>
                <Badge
                  variant="outline"
                  className="text-[9px] px-1.5 py-0 h-3 capitalize mt-1 text-muted-foreground border-transparent"
                >
                  {actionWindow.projected_score_in_30_days.tier}
                </Badge>
              </div>
            </div>
          </div>
        </div>
        {actionWindow.days_until_half_strength !== null && (
          <p className="text-xs text-muted-foreground font-medium leading-relaxed bg-muted/50 p-2.5 rounded-lg border border-dashed text-center">
            If nothing new is observed, the strongest signal reaches half
            strength in{" "}
            <span className="font-bold text-foreground">
              {actionWindow.days_until_half_strength}
            </span>{" "}
            days.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export function CounterEvidencePanel({
  evidence,
}: {
  evidence: CounterEvidence[];
}) {
  return (
    <Card className="shadow-sm border-slate-200 dark:border-slate-800 h-full">
      <CardHeader className="pb-3 border-b border-slate-100 dark:border-slate-800/50">
        <CardTitle className="text-sm font-bold uppercase tracking-wider flex items-center gap-2 text-muted-foreground">
          <ShieldAlert className="h-4 w-4" /> What could be wrong
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-5">
        {!evidence || evidence.length === 0 ? (
          <div className="text-sm text-muted-foreground bg-muted/30 p-4 rounded-xl border border-dashed border-border/60 text-center h-full flex flex-col justify-center items-center">
            <CheckCircle2 className="h-8 w-8 text-emerald-500 mb-2 opacity-50" />
            <p className="font-semibold text-foreground mb-1">
              No counter-evidence detected in current data.
            </p>
            <p className="text-xs">
              Absence of evidence is not proof. Ensure diligence before
              outreach.
            </p>
          </div>
        ) : (
          <ul className="space-y-4 text-sm">
            {evidence
              .sort((a, b) => {
                const weight = { high: 3, medium: 2, low: 1 };
                return (
                  (weight[b.severity as keyof typeof weight] || 0) -
                  (weight[a.severity as keyof typeof weight] || 0)
                );
              })
              .map((item, i) => (
                <li
                  key={i}
                  className="flex items-start gap-3 bg-slate-50 dark:bg-slate-900/40 p-3 rounded-lg border border-slate-100 dark:border-slate-800"
                >
                  {item.severity === "high" ? (
                    <AlertTriangle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
                  ) : item.severity === "medium" ? (
                    <AlertCircle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                  ) : (
                    <Info className="h-4 w-4 text-slate-400 shrink-0 mt-0.5" />
                  )}
                  <div>
                    <span className="font-bold text-foreground block mb-0.5">
                      {item.title}
                    </span>
                    <span className="text-muted-foreground text-xs leading-relaxed">
                      {item.detail}
                    </span>
                  </div>
                </li>
              ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export function WhatWouldChangePanel({
  suggestions,
}: {
  suggestions: ChangeSuggestion[];
}) {
  if (!suggestions || suggestions.length === 0) return null;

  return (
    <Card className="shadow-sm border-slate-200 dark:border-slate-800 mt-6">
      <CardHeader className="pb-3 border-b border-slate-100 dark:border-slate-800/50 bg-slate-50/50 dark:bg-slate-900/20">
        <CardTitle className="text-sm font-bold uppercase tracking-wider flex items-center gap-2 text-muted-foreground">
          <Search className="h-4 w-4" /> Missing Evidence Targets
        </CardTitle>
        <CardDescription className="text-xs font-medium">
          Data gathering actions and their modeled effect on this account's
          score.
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {suggestions.map((sug, i) => (
            <div
              key={i}
              className="rounded-xl border border-border p-4 flex flex-col justify-between bg-card hover-elevate transition-all shadow-sm"
            >
              <div>
                <Badge
                  variant="outline"
                  className="mb-3 text-[9px] uppercase tracking-wider font-bold bg-muted/50 text-muted-foreground"
                >
                  {sug.dimension}
                </Badge>
                <p className="text-sm font-semibold text-foreground mb-4 leading-relaxed">
                  {sug.action}
                </p>
              </div>
              <div className="flex items-center gap-2 mt-auto pt-3 border-t border-border/50 text-xs font-bold text-muted-foreground bg-slate-50/50 dark:bg-slate-900/20 -mx-4 -mb-4 px-4 pb-4 rounded-b-xl">
                <TrendingUp className="h-4 w-4 text-primary" />
                <span className="text-primary text-sm">
                  {sug.expected_effect.score_delta > 0 ? "+" : ""}
                  {sug.expected_effect.score_delta} pts
                </span>
                <span className="text-slate-300 dark:text-slate-600">
                  &rarr;
                </span>
                <span className="capitalize">
                  {sug.expected_effect.projected_tier} tier
                </span>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export function ComparableAccountsPanel({
  comparable,
}: {
  comparable: CompanyInsightsComparableAccounts;
}) {
  if (!comparable) return null;

  const isMuted = !comparable.sufficient_sample;

  return (
    <Card className="shadow-sm border-slate-200 dark:border-slate-800 mt-6">
      <CardHeader className="pb-3 border-b border-slate-100 dark:border-slate-800/50 bg-slate-50/50 dark:bg-slate-900/20">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <CardTitle className="text-sm font-bold uppercase tracking-wider flex items-center gap-2 text-muted-foreground">
            <Target className="h-4 w-4" /> Comparable Accounts
          </CardTitle>
          {comparable.matched_on && comparable.matched_on.length > 0 && (
            <div className="flex gap-1.5 flex-wrap">
              {comparable.matched_on.map((m: string) => (
                <Badge
                  key={m}
                  variant="secondary"
                  className="text-[10px] capitalize font-bold bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 shadow-sm"
                >
                  Matched: {m}
                </Badge>
              ))}
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent
        className={`pt-6 ${isMuted ? "opacity-75 grayscale-[20%]" : ""}`}
      >
        {isMuted && (
          <Alert className="mb-6 bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900 rounded-xl">
            <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-500" />
            <AlertDescription className="text-xs font-semibold text-amber-800 dark:text-amber-400">
              Too few comparable accounts to rely on (n &lt; 5).{" "}
              {comparable.note}
            </AlertDescription>
          </Alert>
        )}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="space-y-1.5 p-4 rounded-xl bg-slate-50 dark:bg-slate-900/40 border border-slate-100 dark:border-slate-800 text-center">
            <p className="text-3xl font-black tracking-tight text-foreground">
              {comparable.labeled}
            </p>
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
              Labeled Peers
            </p>
          </div>
          <div className="space-y-1.5 p-4 rounded-xl bg-slate-50 dark:bg-slate-900/40 border border-slate-100 dark:border-slate-800 text-center">
            <div className="flex items-baseline justify-center gap-2">
              <p className="text-3xl font-black tracking-tight text-foreground">
                {comparable.labeled > 0
                  ? `${comparable.qualified_rate.toFixed(0)}%`
                  : "—"}
              </p>
            </div>
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
              qualified (vs{" "}
              {comparable.tenant_base_rate.labeled > 0
                ? `${comparable.tenant_base_rate.qualified_rate.toFixed(0)}%`
                : "—"}{" "}
              base)
            </p>
            <p className="text-[10px] text-muted-foreground font-medium pt-1">
              95% Range:{" "}
              {comparable.labeled > 0
                ? `${comparable.wilson_95_lower.toFixed(0)}% - ${comparable.wilson_95_upper.toFixed(0)}%`
                : "Unavailable without labeled peers"}
            </p>
          </div>
          <div className="space-y-1.5 p-4 rounded-xl bg-slate-50 dark:bg-slate-900/40 border border-slate-100 dark:border-slate-800 text-center">
            <p className="text-3xl font-black tracking-tight text-foreground">
              {comparable.median_days_signal_to_qualified !== null
                ? comparable.median_days_signal_to_qualified
                : "—"}
            </p>
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
              Median days
            </p>
            <p className="text-[10px] text-muted-foreground font-medium pt-1">
              From signal to outcome
            </p>
          </div>
        </div>
        {!isMuted && comparable.note && (
          <div className="mt-6 pt-5 border-t border-slate-100 dark:border-slate-800 flex justify-center text-center">
            <p className="text-xs text-muted-foreground font-medium max-w-lg bg-muted px-4 py-2 rounded-lg inline-block">
              {comparable.note}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function EvidenceTimeline({ story }: { story: InsightStoryEntry[] }) {
  const [expanded, setExpanded] = useState(false);
  if (!story || story.length === 0) return null;

  // We show oldest to newest to read as a story
  const sortedStory = [...story].sort(
    (a, b) => new Date(a.at).getTime() - new Date(b.at).getTime(),
  );

  const displayLimit = 8;
  const isExpandable = sortedStory.length > displayLimit;
  // If not expanded, show the LATEST items (end of the sorted array) so we see the climax.
  const visibleStory = expanded
    ? sortedStory
    : sortedStory.slice(-displayLimit);

  const getIcon = (kind: string) => {
    switch (kind) {
      case "signal_detected":
        return <Activity className="h-3.5 w-3.5" />;
      case "signal_corroborated":
        return <CheckCircle2 className="h-3.5 w-3.5" />;
      case "tier_changed":
        return <TrendingUp className="h-3.5 w-3.5" />;
      case "outcome_recorded":
        return <Target className="h-3.5 w-3.5" />;
      case "identity_reviewed":
        return <Search className="h-3.5 w-3.5" />;
      case "signal_expired":
        return <Clock className="h-3.5 w-3.5" />;
      default:
        return <Info className="h-3.5 w-3.5" />;
    }
  };

  return (
    <Card className="shadow-sm border-slate-200 dark:border-slate-800 mt-6">
      <CardHeader className="pb-3 border-b border-slate-100 dark:border-slate-800/50 bg-slate-50/50 dark:bg-slate-900/20">
        <CardTitle className="text-sm font-bold uppercase tracking-wider flex items-center gap-2 text-muted-foreground">
          <History className="h-4 w-4" /> Evidence Story
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-8">
        <div className="relative border-l-2 border-slate-100 dark:border-slate-800/80 ml-3 md:ml-4 space-y-7 pb-4">
          {isExpandable && !expanded && (
            <div className="absolute -top-6 left-[-11px] bg-background border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-full h-6 w-6 flex items-center justify-center text-slate-400 z-10 text-[10px] font-bold">
              ...
            </div>
          )}
          {visibleStory.map((entry, idx) => (
            <div key={idx} className="relative pl-6 md:pl-8 group">
              <div
                className={`absolute -left-[13px] bg-background border-2 rounded-full p-1
                ${entry.weight === "high" ? "border-primary text-primary h-7 w-7 -left-[15px] -top-1 bg-primary/5" : "border-slate-200 dark:border-slate-700 text-slate-400 h-6 w-6 top-0"}
                transition-colors group-hover:border-primary group-hover:text-primary group-hover:bg-primary/5 z-10 shadow-sm`}
              >
                <div className="absolute inset-0 flex items-center justify-center">
                  {getIcon(entry.kind)}
                </div>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-1 sm:gap-4 -mt-0.5">
                <div className="bg-slate-50 dark:bg-slate-900/30 p-3 rounded-lg border border-slate-100 dark:border-slate-800 group-hover:border-slate-200 dark:group-hover:border-slate-700 transition-colors w-full">
                  <h4
                    className={`font-bold text-foreground flex items-center gap-2 ${entry.weight === "high" ? "text-sm" : "text-xs"}`}
                  >
                    {entry.title}
                    {entry.weight === "high" && (
                      <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                    )}
                  </h4>
                  <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed font-medium">
                    {entry.detail}
                  </p>
                </div>
                <div className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-slate-400 whitespace-nowrap mt-2 sm:mt-1.5 sm:text-right">
                  {formatDate(entry.at)}
                </div>
              </div>
            </div>
          ))}
        </div>

        {isExpandable && (
          <div className="mt-6 pt-4 border-t border-slate-100 dark:border-slate-800 flex justify-center">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setExpanded(!expanded)}
              className="text-xs font-bold uppercase tracking-wider text-muted-foreground rounded-full px-6"
            >
              {expanded ? (
                <>
                  <ChevronUp className="mr-2 h-3.5 w-3.5" /> Collapse Story
                </>
              ) : (
                <>
                  <ChevronDown className="mr-2 h-3.5 w-3.5" /> Show full story (
                  {sortedStory.length} events)
                </>
              )}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function CompanyInsightsSection({
  insights,
  currentScore,
  currentTier,
}: {
  insights: CompanyInsights;
  currentScore?: number;
  currentTier?: string;
}) {
  return (
    <div className="space-y-6 animate-in fade-in duration-500 my-6">
      <WhyNowPanel whyNow={insights.why_now} />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <ActionWindowPanel
          actionWindow={insights.action_window}
          currentScore={currentScore}
          currentTier={currentTier}
        />
        <CounterEvidencePanel evidence={insights.counter_evidence} />
      </div>

      <WhatWouldChangePanel suggestions={insights.what_would_change} />

      <ComparableAccountsPanel comparable={insights.comparable_accounts} />

      <EvidenceTimeline story={insights.story} />
    </div>
  );
}
