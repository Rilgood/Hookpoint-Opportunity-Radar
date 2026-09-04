import { useGetRadarAnalyticsInsights } from "@workspace/api-client-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/loading-states";
import { Lightbulb, Info, AlertTriangle } from "lucide-react";
import { formatDate } from "@/lib/utils";
import { 
  FocusList, 
  TruthChecks, 
  SignalEffectivenessTable, 
  SourceEffectivenessTable,
  SegmentsTables,
  TimingStats,
  LossReasons
} from "@/components/insights";

export default function Insights() {
  const { data: insightsRes, isLoading, isError } = useGetRadarAnalyticsInsights();

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64 mb-2" />
        <Skeleton className="h-4 w-96 mb-6" />
        <div className="grid grid-cols-1 gap-6">
          <Skeleton className="h-[200px] w-full" />
          <Skeleton className="h-[300px] w-full" />
        </div>
      </div>
    );
  }

  if (isError || !insightsRes?.data) {
    return (
      <div className="text-center py-32 bg-muted/20 rounded-xl border border-dashed">
        <AlertTriangle className="h-10 w-10 text-destructive mx-auto mb-4" />
        <h2 className="text-2xl font-bold mb-2">Insights Unavailable</h2>
        <p className="text-muted-foreground mb-6 max-w-md mx-auto">
          We couldn't load the team's learning data at this time. Please try again later.
        </p>
        <Button onClick={() => window.location.reload()} variant="outline">Retry</Button>
      </div>
    );
  }

  const data = insightsRes.data;

  return (
    <div className="space-y-8 animate-in fade-in duration-500 pb-12">
      <div>
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-3">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-3">
              <Lightbulb className="h-7 w-7 text-primary" />
              What the team is learning
            </h1>
            <p className="text-muted-foreground mt-2 font-medium">
              Observational analysis of labeled accounts, generated {formatDate(data.generated_at)}.
            </p>
          </div>
          <div className="flex items-center gap-4 bg-muted/30 px-4 py-2 rounded-xl border border-border shadow-sm">
            <div className="text-center">
              <span className="block text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1">Base Rate</span>
              <span className="text-lg font-black text-foreground">{data.base_rate.qualified_rate.toFixed(1)}%</span>
            </div>
            <div className="h-8 w-px bg-border" />
            <div className="text-center">
              <span className="block text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1">Sample Size</span>
              <span className="text-lg font-black text-foreground">{data.base_rate.labeled}</span>
            </div>
          </div>
        </div>
        
        <Alert className="bg-primary/5 dark:bg-primary/10 border-primary/20 mt-4 rounded-xl">
          <Info className="h-4 w-4 text-primary" />
          <AlertTitle className="text-sm font-bold text-foreground">Important Caveat</AlertTitle>
          <AlertDescription className="text-xs font-medium text-muted-foreground mt-1">
            These insights are strictly observational and derived from historically labeled accounts only. They do not automatically update the scoring engine. Use this dashboard to guide human review and playbook development.
          </AlertDescription>
        </Alert>
      </div>

      <FocusList focusList={data.focus_list} policy={data.focus_list_policy} />

      <div className="space-y-4">
        <h3 className="text-lg font-bold flex items-center gap-2">
           Truth Checks
        </h3>
        <p className="text-sm text-muted-foreground mb-4">
          Accounts where our evidence hypothesis diverged from reality.
        </p>
        <TruthChecks 
          falseConfidence={data.false_confidence}
          hiddenWins={data.hidden_wins}
          decayed={data.decayed_without_action}
        />
      </div>

      <SignalEffectivenessTable signals={data.signal_effectiveness} baseRate={data.base_rate.qualified_rate} />

      <SourceEffectivenessTable sources={data.source_effectiveness} />

      <div className="space-y-4">
        <h3 className="text-lg font-bold">
           Segment Performance
        </h3>
        <SegmentsTables segments={data.segments} baseRate={data.base_rate.qualified_rate} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <TimingStats timing={data.timing} />
        <LossReasons reasons={data.loss_reasons} />
      </div>
    </div>
  );
}
