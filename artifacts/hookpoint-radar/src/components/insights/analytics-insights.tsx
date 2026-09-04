import { useState } from "react";
import { 
  AnalyticsInsights, 
  FocusAccount, 
  EffectivenessRow, 
  SourceEffectivenessRow, 
  SegmentInsight,
  AccountException,
  AnalyticsInsightsDecayedWithoutActionItem,
  AnalyticsInsightsLossReasonsItem, AnalyticsInsightsFocusListPolicy } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Link } from "wouter";
import { 
  Target, Info, AlertTriangle, TrendingUp, TrendingDown, Eye, CheckCircle2, 
  Clock, ArrowRight, BarChart3, Database, ChevronDown, ChevronUp, Users, Box 
} from "lucide-react";
import { getTierColor, formatDate } from "@/lib/utils";

// Common Range Bar Component
function RangeBar({ 
  value, 
  lower, 
  upper, 
  baseline 
}: { 
  value: number; 
  lower: number; 
  upper: number; 
  baseline?: number; 
}) {
  return (
    <div className="relative h-2 w-full bg-slate-100 dark:bg-slate-800 rounded-full mt-2 shadow-inner">
      {baseline !== undefined && (
        <div 
          className="absolute top-1/2 -translate-y-1/2 h-4 w-0.5 bg-slate-400 dark:bg-slate-500 z-10"
          style={{ left: `${Math.min(100, Math.max(0, baseline))}%` }}
          title={`Base rate: ${baseline.toFixed(1)}%`}
        />
      )}
      <div 
        className="absolute top-0 h-full bg-primary/20 dark:bg-primary/30 rounded-full"
        style={{ 
          left: `${Math.max(0, lower)}%`, 
          width: `${Math.min(100, upper) - Math.max(0, lower)}%` 
        }}
      />
      <div 
        className="absolute top-1/2 -translate-y-1/2 h-3.5 w-3.5 rounded-full bg-primary z-20 shadow-sm border-2 border-white dark:border-slate-950"
        style={{ left: `calc(${Math.min(100, Math.max(0, value))}% - 7px)` }}
      />
    </div>
  );
}

export function FocusList({ 
  focusList, 
  policy 
}: { 
  focusList: FocusAccount[]; 
  policy: AnalyticsInsightsFocusListPolicy;
}) {
  if (!focusList || focusList.length === 0) {
    return (
      <Card className="shadow-sm border-slate-200 dark:border-slate-800 h-full">
        <CardHeader>
          <CardTitle className="text-lg font-bold flex items-center gap-2">
            <Target className="h-5 w-5 text-primary" /> Today's Focus
          </CardTitle>
        </CardHeader>
        <CardContent className="py-8 text-center text-muted-foreground bg-muted/20 m-6 mt-0 rounded-lg border border-dashed">
          <CheckCircle2 className="h-8 w-8 text-slate-300 mx-auto mb-3" />
          <p className="font-medium text-foreground">No active priority accounts</p>
          <p className="text-xs mt-1">Open accounts appear here ranked by score plus evidence-based adjustments once data is present.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="shadow-sm border-slate-200 dark:border-slate-800 h-full flex flex-col">
      <CardHeader className="pb-3 border-b border-slate-100 dark:border-slate-800/50 bg-slate-50/50 dark:bg-slate-900/20">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg font-bold flex items-center gap-2">
            <Target className="h-5 w-5 text-primary" /> Today's Focus
          </CardTitle>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="sm" className="h-8 text-xs font-bold uppercase tracking-wider text-muted-foreground hover:bg-white dark:hover:bg-slate-800">
                <Info className="h-3.5 w-3.5 mr-1.5" /> How this is formed
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80 text-sm shadow-xl rounded-xl border-slate-200 dark:border-slate-800">
              <div className="space-y-2">
                <p className="font-bold text-foreground">Focus List Policy</p>
                <p className="text-muted-foreground text-xs leading-relaxed">{policy.note} Open (non-closed, non-suppressed) accounts are eligible; each adjustment applies at most once.</p>
                <div className="bg-slate-50 dark:bg-slate-900 p-3 rounded-lg border border-slate-100 dark:border-slate-800 text-xs space-y-2 mt-3">
                  {([
                    ['New positive signal within 14 days', policy.new_signal_14d],
                    ['Positive signal with multiple sources', policy.corroborated_positive_signal],
                    ['Identity confidence below 80%', policy.identity_unverified],
                    ['Projected 14-day score falls below warm', policy.closing_urgency],
                  ] as const).map(([label, value]) => (
                    <div key={label} className="flex justify-between items-center gap-3">
                      <span className="font-semibold text-muted-foreground uppercase tracking-wider text-[10px]">{label}</span>
                      <span className="font-mono font-bold text-foreground bg-white dark:bg-slate-950 px-1.5 py-0.5 rounded shadow-sm border border-slate-100 dark:border-slate-800">{value > 0 ? `+${value}` : value} pts</span>
                    </div>
                  ))}
                </div>
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </CardHeader>
      <CardContent className="p-0 flex-1">
        <div className="divide-y divide-slate-100 dark:divide-slate-800/50">
          {focusList.map((account) => (
            <Link 
              key={account.company_id} 
              href={`/opportunities/${account.company_id}`}
              className="block p-5 hover:bg-slate-50 dark:hover:bg-slate-900/40 transition-colors group focus-list-row"
              data-testid={`focus-list-row-${account.company_id}`}
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2.5 mb-2">
                    <h4 className="font-bold text-foreground group-hover:text-primary transition-colors text-base">
                      {account.name}
                    </h4>
                    <Badge variant="outline" className={`text-[10px] uppercase font-bold tracking-wider h-5 px-1.5 border-transparent ${getTierColor(account.opportunity_tier)}`}>
                      {account.opportunity_tier}
                    </Badge>
                  </div>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {account.reasons.length === 0 ? (
                      <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                        Ranked by opportunity score alone; no adjustments applied
                      </span>
                    ) : account.reasons.map((r, i) => (
                      <span key={i} className="text-[10px] font-bold uppercase tracking-wider bg-slate-100 dark:bg-slate-800/80 text-slate-500 dark:text-slate-400 px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700 shadow-sm">
                        {r}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="text-right shrink-0 flex flex-col items-end">
                  <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1">Priority</span>
                  <span className="text-2xl font-black tabular-nums text-foreground group-hover:text-primary transition-colors">
                    {Math.round(account.priority_score)}
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export function TruthChecks({ 
  falseConfidence, 
  hiddenWins, 
  decayed 
}: { 
  falseConfidence: AccountException[];
  hiddenWins: AccountException[];
  decayed: AnalyticsInsightsDecayedWithoutActionItem[];
}) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6" data-testid="insight-truth-checks">
      {/* False Confidence */}
      <Card className="shadow-sm border-slate-200 dark:border-slate-800 flex flex-col">
        <CardHeader className="pb-3 border-b bg-red-50/70 dark:bg-red-950/20 border-red-100 dark:border-red-900/50">
          <CardTitle className="text-sm font-bold text-red-700 dark:text-red-400 flex items-center gap-2 uppercase tracking-wider">
            <AlertTriangle className="h-4 w-4" /> False Confidence
          </CardTitle>
          <CardDescription className="text-xs font-medium mt-1 text-red-600/80 dark:text-red-400/80">Accounts that were Hot/Warm but resulted in a negative outcome.</CardDescription>
        </CardHeader>
        <CardContent className="pt-0 p-0 flex-1">
          {falseConfidence.length === 0 ? (
            <div className="p-8 text-center flex flex-col items-center justify-center h-full">
              <CheckCircle2 className="h-8 w-8 text-emerald-500 mb-3 opacity-80" />
              <p className="text-xs font-bold text-foreground uppercase tracking-wider mb-1">No false confidence</p>
              <p className="text-xs text-muted-foreground font-medium">None detected in current labeled data.</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800/50">
              {falseConfidence.map(acc => (
                <Link key={acc.company_id} href={`/opportunities/${acc.company_id}`} className="block p-4 hover:bg-slate-50 dark:hover:bg-slate-900/30 transition-colors">
                  <div className="flex justify-between items-start mb-2">
                    <span className="font-bold text-sm text-foreground">{acc.name}</span>
                    <span className="text-[10px] font-mono font-bold text-red-700 bg-red-100 px-1.5 py-0.5 rounded shadow-sm border border-red-200 dark:bg-red-900/50 dark:text-red-300 dark:border-red-800">Score {Math.round(acc.score_at_outcome)}</span>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2 font-medium">{acc.note || "No note provided"}</p>
                  <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mt-3">{formatDate(acc.occurred_at)} &bull; {acc.outcome_type}</p>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Hidden Wins */}
      <Card className="shadow-sm border-slate-200 dark:border-slate-800 flex flex-col">
        <CardHeader className="pb-3 border-b bg-emerald-50/70 dark:bg-emerald-950/20 border-emerald-100 dark:border-emerald-900/50">
          <CardTitle className="text-sm font-bold text-emerald-700 dark:text-emerald-400 flex items-center gap-2 uppercase tracking-wider">
            <Eye className="h-4 w-4" /> Hidden Wins
          </CardTitle>
          <CardDescription className="text-xs font-medium mt-1 text-emerald-600/80 dark:text-emerald-400/80">Accounts that were Cold/Watch but reached a qualified outcome.</CardDescription>
        </CardHeader>
        <CardContent className="pt-0 p-0 flex-1">
          {hiddenWins.length === 0 ? (
            <div className="p-8 text-center flex flex-col items-center justify-center h-full">
              <CheckCircle2 className="h-8 w-8 text-emerald-500 mb-3 opacity-80" />
              <p className="text-xs font-bold text-foreground uppercase tracking-wider mb-1">No hidden wins</p>
              <p className="text-xs text-muted-foreground font-medium">None detected in current labeled data.</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800/50">
              {hiddenWins.map(acc => (
                <Link key={acc.company_id} href={`/opportunities/${acc.company_id}`} className="block p-4 hover:bg-slate-50 dark:hover:bg-slate-900/30 transition-colors">
                  <div className="flex justify-between items-start mb-2">
                    <span className="font-bold text-sm text-foreground">{acc.name}</span>
                    <span className="text-[10px] font-mono font-bold text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded shadow-sm border border-emerald-200 dark:bg-emerald-900/50 dark:text-emerald-300 dark:border-emerald-800">Score {Math.round(acc.score_at_outcome)}</span>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2 font-medium">{acc.note || "No note provided"}</p>
                  <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mt-3">{formatDate(acc.occurred_at)} &bull; {acc.outcome_type}</p>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Decayed Without Action */}
      <Card className="shadow-sm border-slate-200 dark:border-slate-800 flex flex-col">
        <CardHeader className="pb-3 border-b bg-amber-50/70 dark:bg-amber-950/20 border-amber-100 dark:border-amber-900/50">
          <CardTitle className="text-sm font-bold text-amber-700 dark:text-amber-400 flex items-center gap-2 uppercase tracking-wider">
            <Clock className="h-4 w-4" /> Decayed w/o Action
          </CardTitle>
          <CardDescription className="text-xs font-medium mt-1 text-amber-600/80 dark:text-amber-400/80">Open accounts where a positive signal expired in the last 90 days and no outcome has been recorded.</CardDescription>
        </CardHeader>
        <CardContent className="pt-0 p-0 flex-1">
          {decayed.length === 0 ? (
            <div className="p-8 text-center flex flex-col items-center justify-center h-full">
              <CheckCircle2 className="h-8 w-8 text-emerald-500 mb-3 opacity-80" />
              <p className="text-xs font-bold text-foreground uppercase tracking-wider mb-1">No decayed accounts</p>
              <p className="text-xs text-muted-foreground font-medium">No expired opportunities detected.</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800/50">
              {decayed.map(acc => (
                <Link key={acc.company_id} href={`/opportunities/${acc.company_id}`} className="block p-4 hover:bg-slate-50 dark:hover:bg-slate-900/30 transition-colors">
                  <div className="flex justify-between items-start mb-2">
                    <span className="font-bold text-sm text-foreground">{acc.name}</span>
                    <span className="text-[10px] font-mono font-bold text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded shadow-sm border border-amber-200 dark:bg-amber-900/50 dark:text-amber-300 dark:border-amber-800">Score {Math.round(acc.opportunity_score)}</span>
                  </div>
                  <p className="text-xs text-muted-foreground bg-white dark:bg-slate-950 p-2 rounded border border-slate-100 dark:border-slate-800 line-clamp-2 font-medium shadow-sm">{acc.expired_signal_label}</p>
                  <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mt-3">Expired {formatDate(acc.expired_at)}</p>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export function SignalEffectivenessTable({ 
  signals, 
  baseRate 
}: { 
  signals: EffectivenessRow[]; 
  baseRate: number;
}) {
  const [sortBy, setSortBy] = useState<'labeled' | 'lift'>('labeled');

  const sorted = [...signals].sort((a, b) => {
    if (sortBy === 'labeled') return b.labeled - a.labeled;
    if (sortBy === 'lift') return (b.lift_vs_base_pp || 0) - (a.lift_vs_base_pp || 0);
    return 0;
  });

  return (
    <Card className="shadow-sm border-slate-200 dark:border-slate-800 mt-6" data-testid="insight-signal-effectiveness">
      <CardHeader className="pb-4 border-b border-slate-100 dark:border-slate-800/50 bg-slate-50/50 dark:bg-slate-900/20">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <CardTitle className="text-lg font-bold flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-primary" /> Signal Effectiveness
            </CardTitle>
            <CardDescription className="text-xs font-medium mt-1">
              Qualified rate among labeled accounts where each signal was present before the label, compared with the base rate ({baseRate.toFixed(1)}%). Observational, not causal.
            </CardDescription>
          </div>
          <div className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-800/80 p-1 rounded-lg self-start sm:self-auto border border-slate-200 dark:border-slate-700">
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={() => setSortBy('labeled')} 
              className={`h-7 text-[10px] font-bold uppercase tracking-wider px-3 rounded-md ${sortBy === 'labeled' ? 'bg-white dark:bg-slate-900 shadow-sm text-foreground' : 'text-muted-foreground'}`}
            >
              By Volume
            </Button>
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={() => setSortBy('lift')}
              className={`h-7 text-[10px] font-bold uppercase tracking-wider px-3 rounded-md ${sortBy === 'lift' ? 'bg-white dark:bg-slate-900 shadow-sm text-foreground' : 'text-muted-foreground'}`}
            >
              By Lift
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0 overflow-x-auto">
        <div className="min-w-[800px]">
          <div className="grid grid-cols-12 gap-4 px-6 py-3 text-[10px] font-bold text-muted-foreground uppercase tracking-wider bg-slate-50/80 dark:bg-slate-900/40 border-b border-slate-100 dark:border-slate-800/50">
            <div className="col-span-4">Signal</div>
            <div className="col-span-2 text-center">Volume</div>
            <div className="col-span-3">Qualified Rate (95% CI)</div>
            <div className="col-span-2 text-center">Lift vs Base</div>
            <div className="col-span-1 text-center">Verdict</div>
          </div>
          <div className="divide-y divide-slate-100 dark:divide-slate-800/50">
            {sorted.map((sig, i) => {
              const isInsufficient = sig.verdict === 'insufficient';
              return (
                <div key={i} className={`grid grid-cols-12 gap-4 px-6 py-4 items-center ${isInsufficient ? 'opacity-50 grayscale-[30%]' : ''} hover:bg-slate-50 dark:hover:bg-slate-900/30 transition-colors`}>
                  <div className="col-span-4">
                    <p className="text-sm font-bold text-foreground mb-1.5 leading-snug">{sig.label}</p>
                    <Badge variant="outline" className="text-[9px] uppercase tracking-wider font-bold bg-muted/30 text-muted-foreground border-transparent">{sig.dimension}</Badge>
                  </div>
                  <div className="col-span-2 text-center">
                    <span className="text-lg font-black text-foreground block">{sig.labeled}</span>
                    <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider">labeled</span>
                  </div>
                  <div className="col-span-3">
                    <div className="flex items-baseline justify-between mb-1.5">
                      <span className="text-sm font-black text-foreground">{sig.qualified_rate.toFixed(1)}%</span>
                      <span className="text-[10px] font-semibold text-muted-foreground">{sig.qualified} qual</span>
                    </div>
                    <RangeBar value={sig.qualified_rate} lower={sig.wilson_95_lower} upper={sig.wilson_95_upper} baseline={baseRate} />
                  </div>
                  <div className="col-span-2 text-center flex flex-col items-center justify-center">
                    {sig.lift_vs_base_pp !== null ? (
                      <Badge variant="outline" className={`border-transparent font-bold text-xs shadow-sm ${
                        sig.lift_vs_base_pp > 0 ? 'text-primary bg-primary/10 border-primary/20' : 
                        sig.lift_vs_base_pp < 0 ? 'text-red-600 bg-red-50 border-red-200 dark:text-red-400 dark:bg-red-900/30 dark:border-red-800' : 
                        'text-muted-foreground bg-muted'
                      }`}>
                        {sig.lift_vs_base_pp > 0 ? '+' : ''}{sig.lift_vs_base_pp.toFixed(1)} pp
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground font-semibold">—</span>
                    )}
                  </div>
                  <div className="col-span-1 text-center flex justify-center">
                    <Badge variant="outline" className={`text-[9px] uppercase font-bold tracking-wider text-center justify-center w-full shadow-sm border border-transparent ${
                      sig.verdict === 'associated_with_pipeline' ? 'bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400' :
                      sig.verdict === 'activity_without_pipeline' ? 'bg-coral-50 text-coral-700 dark:bg-coral-900/30 dark:text-coral-400' :
                      sig.verdict === 'neutral' ? 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300' :
                      'bg-transparent text-muted-foreground border border-dashed border-slate-300 dark:border-slate-700 shadow-none'
                    }`}>
                      {sig.verdict === 'associated_with_pipeline' ? 'Positive' : 
                       sig.verdict === 'activity_without_pipeline' ? 'Negative' : 
                       sig.verdict === 'neutral' ? 'Neutral' : 'Need Data'}
                    </Badge>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function SourceEffectivenessTable({ sources }: { sources: SourceEffectivenessRow[] }) {
  return (
    <Card className="shadow-sm border-slate-200 dark:border-slate-800 mt-6">
      <CardHeader className="pb-4 border-b border-slate-100 dark:border-slate-800/50 bg-slate-50/50 dark:bg-slate-900/20">
        <CardTitle className="text-lg font-bold flex items-center gap-2">
          <Database className="h-5 w-5 text-primary" /> Source Effectiveness
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0 overflow-x-auto">
        <div className="min-w-[800px]">
          <div className="grid grid-cols-12 gap-4 px-6 py-3 text-[10px] font-bold text-muted-foreground uppercase tracking-wider bg-slate-50/80 dark:bg-slate-900/40 border-b border-slate-100 dark:border-slate-800/50">
            <div className="col-span-3">Source</div>
            <div className="col-span-2 text-right">Accounts</div>
            <div className="col-span-2 text-right">Labeled</div>
            <div className="col-span-2 text-right">Qual Rate</div>
            <div className="col-span-2 text-right">Last Obs</div>
            <div className="col-span-1 text-center">Status</div>
          </div>
          <div className="divide-y divide-slate-100 dark:divide-slate-800/50">
            {sources.map((src, i) => (
              <div key={i} className="grid grid-cols-12 gap-4 px-6 py-4 items-center hover:bg-slate-50 dark:hover:bg-slate-900/30 transition-colors">
                <div className="col-span-3 font-bold text-sm text-foreground">{src.source}</div>
                <div className="col-span-2 text-right text-sm font-semibold">{src.accounts_touched}</div>
                <div className="col-span-2 text-right text-sm font-semibold">{src.labeled_accounts}</div>
                <div className="col-span-2 text-right font-black text-primary text-base">{src.qualified_rate.toFixed(1)}%</div>
                <div className="col-span-2 text-right text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                  {src.days_since_last_observation}d ago
                </div>
                <div className="col-span-1 text-center flex justify-center">
                  <Badge variant="outline" className={`text-[9px] uppercase font-bold tracking-wider text-center justify-center w-full shadow-sm border border-transparent ${
                    src.verdict === 'producing_pipeline' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' :
                    src.verdict === 'stale' ? 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' :
                    'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                  }`}>
                    {src.verdict === 'producing_pipeline' ? 'Active' : src.verdict === 'stale' ? 'Stale' : 'Monitor'}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function SegmentTable({ 
  title, 
  icon: Icon,
  data, 
  baseRate 
}: { 
  title: string, 
  icon: any,
  data: SegmentInsight[], 
  baseRate: number 
}) {
  return (
    <Card className="shadow-sm border-slate-200 dark:border-slate-800 h-full">
      <CardHeader className="pb-3 border-b border-slate-100 dark:border-slate-800/50 bg-slate-50/50 dark:bg-slate-900/20">
        <CardTitle className="text-sm font-bold uppercase tracking-wider flex items-center gap-2 text-muted-foreground">
          <Icon className="h-4 w-4" /> {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="divide-y divide-slate-100 dark:divide-slate-800/50">
          {data.map((seg, i) => (
            <div key={i} className={`p-5 ${!seg.sufficient_sample ? 'opacity-60 grayscale-[30%]' : ''} hover:bg-slate-50 dark:hover:bg-slate-900/20 transition-colors`}>
              <div className="flex justify-between items-center mb-3">
                <span className="font-bold text-sm text-foreground">{seg.segment}</span>
                <span className="text-[10px] font-mono font-bold text-muted-foreground bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded uppercase tracking-wider">{seg.labeled} labeled</span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <div className="w-full">
                  <RangeBar value={seg.qualified_rate} lower={seg.wilson_95_lower} upper={seg.wilson_95_upper} baseline={baseRate} />
                </div>
                <span className="text-sm font-black w-12 text-right">{seg.qualified_rate.toFixed(0)}%</span>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export function SegmentsTables({ 
  segments, 
  baseRate 
}: { 
  segments: { by_industry: SegmentInsight[], by_size_band: SegmentInsight[] },
  baseRate: number
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
      <SegmentTable title="By Industry" icon={Box} data={segments.by_industry} baseRate={baseRate} />
      <SegmentTable title="By Size Band" icon={Users} data={segments.by_size_band} baseRate={baseRate} />
    </div>
  );
}

export function TimingStats({ timing }: { timing: AnalyticsInsights['timing'] }) {
  return (
    <Card className="shadow-sm border-slate-200 dark:border-slate-800 h-full flex flex-col">
      <CardHeader className="pb-3 border-b border-slate-100 dark:border-slate-800/50 bg-slate-50/50 dark:bg-slate-900/20">
        <CardTitle className="text-sm font-bold uppercase tracking-wider flex items-center gap-2 text-muted-foreground">
          <Clock className="h-4 w-4" /> Time to Qualified Outcome
        </CardTitle>
        <CardDescription className="text-xs font-medium mt-1">From first signal detection to qualified outcome</CardDescription>
      </CardHeader>
      <CardContent className="pt-8 pb-8 flex-1 flex flex-col justify-center">
        {timing.sample === 0 ? (
          <div className="text-center text-muted-foreground opacity-60">
            <Clock className="h-10 w-10 mx-auto mb-3" />
            <p className="text-sm font-bold uppercase tracking-wider">Not enough qualified accounts yet</p>
          </div>
        ) : (
          <div className="flex flex-col items-center">
            <p className="text-6xl font-black text-primary mb-2 tracking-tighter">
              {timing.median_days_first_signal_to_qualified !== null ? Math.round(timing.median_days_first_signal_to_qualified) : "—"}
            </p>
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-6">Median Days</p>
            <div className="flex items-center gap-6 text-sm font-bold bg-slate-50 dark:bg-slate-900/40 px-6 py-3 rounded-xl border border-slate-100 dark:border-slate-800 shadow-sm">
              <span className="flex flex-col items-center"><span className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">p25</span>{timing.p25 !== null ? Math.round(timing.p25) : "—"}d</span>
              <span className="text-slate-300 dark:text-slate-700 h-6 w-[2px] bg-slate-200 dark:bg-slate-700"></span>
              <span className="flex flex-col items-center"><span className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">p75</span>{timing.p75 !== null ? Math.round(timing.p75) : "—"}d</span>
            </div>
            <p className="text-[10px] text-muted-foreground mt-5 font-bold uppercase tracking-wider italic opacity-80">Based on {timing.sample} recent qualified accounts</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function LossReasons({ reasons }: { reasons: AnalyticsInsightsLossReasonsItem[] }) {
  if (!reasons || reasons.length === 0) return null;

  return (
    <Card className="shadow-sm border-slate-200 dark:border-slate-800 h-full flex flex-col">
      <CardHeader className="pb-3 border-b border-slate-100 dark:border-slate-800/50 bg-slate-50/50 dark:bg-slate-900/20">
        <CardTitle className="text-sm font-bold uppercase tracking-wider flex items-center gap-2 text-muted-foreground">
          <TrendingDown className="h-4 w-4" /> Recent Loss Reasons
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0 flex-1">
        <div className="divide-y divide-slate-100 dark:divide-slate-800/50">
          {reasons.slice(0, 5).map(acc => (
            <div key={acc.company_id} className="p-4 hover:bg-slate-50 dark:hover:bg-slate-900/30 transition-colors">
              <div className="flex justify-between items-start mb-2">
                <span className="font-bold text-sm text-foreground">{acc.name}</span>
                <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider">{formatDate(acc.occurred_at)}</span>
              </div>
              <p className="text-xs text-muted-foreground font-medium italic border-l-2 border-slate-300 dark:border-slate-700 pl-3 py-0.5 my-2.5 leading-relaxed bg-slate-50 dark:bg-slate-900/20 rounded-r-md">
                "{acc.note}"
              </p>
              <div className="flex gap-2 text-[9px] text-slate-500 font-bold uppercase tracking-wider">
                <span>{acc.outcome_type}</span>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
