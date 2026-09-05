import { useState } from "react";
import {
  useListRadarConnectors,
  useUpdateRadarConnector,
  Connector,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { getListRadarConnectorsQueryKey } from "@workspace/api-client-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/loading-states";
import { useToast } from "@/hooks/use-toast";
import { Plug, AlertCircle, Clock, Info, ShieldAlert, Settings, CalendarClock, User } from "lucide-react";
import { humanizeLabel } from "@/lib/utils";
import { lastRunSummary, nextRunLabel, scheduleNotice, toneBadgeClasses, toneClasses } from "@/lib/connector-schedule";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ConnectorDialog } from "@/components/sources/connector-dialog";

export default function Sources() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: response, isLoading } = useListRadarConnectors();

  const [selectedConnector, setSelectedConnector] = useState<Connector | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const updateMutation = useUpdateRadarConnector({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: getListRadarConnectorsQueryKey(),
        });
        toast({
          title: "Connector updated",
          description: "The source status has been updated successfully.",
        });
      },
      onError: () => {
        toast({
          title: "Error",
          description: "Failed to update connector state.",
          variant: "destructive",
        });
      },
    },
  });

  const handleToggle = (connector: Connector, enabled: boolean) => {
    if (!enabled) {
      updateMutation.mutate({ key: connector.connector_key, data: { enabled: false } });
      return;
    }

    const isPush = connector.mode === "push";
    const isManual = connector.cadence === "manual";

    const config = connector.config as { scheduleInput?: Record<string, unknown> } | undefined;
    const scheduleInput = config?.scheduleInput;
    const hasScheduleInput = Boolean(scheduleInput && Object.keys(scheduleInput).length > 0);

    if (!isPush && !isManual && !hasScheduleInput) {
      // Must configure schedule_input first for recurring pull connectors
      setSelectedConnector(connector);
      setDialogOpen(true);
    } else {
      updateMutation.mutate({ key: connector.connector_key, data: { enabled: true } });
    }
  };

  const handleConfigure = (connector: Connector) => {
    setSelectedConnector(connector);
    setDialogOpen(true);
  };

  const getReadinessLabel = (connector: Connector) => {
    if (connector.configured) return humanizeLabel(connector.status);

    const key = connector.connector_key;
    if (["gdelt", "sec_edgar", "nppes", "usa_spending"].includes(key)) {
      return "No credentials required";
    }
    if (key === "google_sheets") {
      return "Awaiting sheet binding";
    }
    return "Awaiting credentials";
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-24 w-full" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-56 w-full" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500 pb-12">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">
          Data Sources
        </h1>
        <p className="text-muted-foreground mt-1 text-lg">
          Manage integrations providing evidence for opportunity detection.
        </p>
      </div>

      <Alert className="bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800">
        <ShieldAlert className="h-5 w-5 text-slate-600 dark:text-slate-400" />
        <AlertTitle className="font-semibold">Secure Credential Handoff</AlertTitle>
        <AlertDescription className="mt-1 text-muted-foreground">
          To maintain zero-trust security, source credentials (API keys, tokens, client secrets) are never solicited or displayed in the browser.
          Connectors marked as <strong>Awaiting credentials</strong> require credentials to be provisioned server-side by an administrator before they can be enabled here.
        </AlertDescription>
      </Alert>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {response?.data.map((connector) => {
          const isPush = connector.mode === "push";
          const noKey = ["gdelt", "sec_edgar", "nppes", "usa_spending"].includes(connector.connector_key);
          const managed = connector.connector_key === "google_sheets";

          const isGoogleSheetsUnconfigured = managed && !connector.configured;
          const needsRealConfig = !connector.configured && !noKey && !isGoogleSheetsUnconfigured;
          const actionDisabled = !connector.implemented || (!connector.configured && !noKey);
          const lastRun = lastRunSummary(connector);
          const notice = scheduleNotice(connector);
          const scheduleState = connector.schedule?.state;
          // The schedule notice already quotes the last error for these states.
          const showLastError = Boolean(connector.last_error) && connector.enabled
            && scheduleState !== "input_rejected" && scheduleState !== "backoff" && !(scheduleState === "due" && notice?.tone === "warning");

          return (
            <Card
              key={connector.connector_key}
              className={`border-2 transition-colors flex flex-col ${
                connector.enabled
                  ? "border-primary/30 bg-primary/[0.02] shadow-sm"
                  : "border-border/60 hover:border-border"
              }`}
            >
              <CardHeader className="pb-3 flex flex-row items-start justify-between space-y-0">
                <div>
                  <CardTitle className="text-lg flex items-center gap-2 font-bold text-foreground">
                    <Plug
                      className={`h-5 w-5 ${
                        connector.enabled
                          ? "text-primary"
                          : (connector.configured || noKey || managed)
                            ? "text-muted-foreground"
                            : "text-amber-500/70"
                      }`}
                    />
                    {connector.label}
                  </CardTitle>
                  <CardDescription className="mt-1 font-medium text-xs tracking-wide uppercase text-muted-foreground/80">
                    {humanizeLabel(connector.provider)} &bull;{" "}
                    {humanizeLabel(connector.category)}
                  </CardDescription>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <Switch
                    checked={connector.enabled}
                    onCheckedChange={(val) => handleToggle(connector, val)}
                    disabled={
                      actionDisabled ||
                      isPush ||
                      updateMutation.isPending
                    }
                    aria-label={`${connector.enabled ? "Disable" : "Enable"} ${connector.label}`}
                    data-testid={`switch-${connector.connector_key}`}
                    className="data-[state=checked]:bg-primary"
                  />
                  {isPush && (
                    <span className="text-[10px] text-muted-foreground mt-1 bg-muted px-1.5 py-0.5 rounded font-medium">Push Mode</span>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-4 text-sm flex-1 flex flex-col">
                <div className="flex items-center justify-between border-t border-border/50 pt-3">
                  <span className="text-muted-foreground font-medium">Status</span>
                  <Badge
                    variant={connector.enabled ? "default" : "secondary"}
                    className={needsRealConfig ? "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400" : ""}
                  >
                    {getReadinessLabel(connector)}
                  </Badge>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground font-medium">Sync Cadence</span>
                  <span className="font-medium flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5 text-muted-foreground" /> {connector.cadence}
                  </span>
                </div>

                <div className="flex items-start justify-between gap-2">
                  <span className="text-muted-foreground font-medium">Last Run</span>
                  <span className="font-medium text-right flex flex-col items-end gap-1" data-testid={`text-last-run-${connector.connector_key}`}>
                    <span>{lastRun.time}</span>
                    {lastRun.outcome && (
                      <span className="flex items-center gap-1.5">
                        <Badge className={`${toneBadgeClasses[lastRun.tone]} text-[10px] px-1.5 py-0`} data-testid={`badge-last-run-outcome-${connector.connector_key}`}>
                          {lastRun.outcome}
                        </Badge>
                        <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground" data-testid={`text-last-run-trigger-${connector.connector_key}`}>
                          {lastRun.run?.trigger === "scheduled" ? <CalendarClock className="h-3 w-3" /> : <User className="h-3 w-3" />}
                          {lastRun.trigger}
                        </span>
                      </span>
                    )}
                  </span>
                </div>

                <div className="flex items-start justify-between gap-2">
                  <span className="text-muted-foreground font-medium">Next Run</span>
                  <span
                    className={`font-medium text-right ${connector.schedule?.will_run ? "" : "text-muted-foreground"}`}
                    title={connector.schedule?.reason}
                    data-testid={`text-next-run-${connector.connector_key}`}
                  >
                    {nextRunLabel(connector.schedule)}
                  </span>
                </div>

                {/* State explanations */}
                <div className="pt-2 flex-1 space-y-2">
                  {!connector.implemented && (
                    <div className="p-2.5 bg-slate-100 dark:bg-slate-800/50 text-slate-600 dark:text-slate-400 rounded-md text-xs flex items-start gap-2 border border-slate-200 dark:border-slate-700/50">
                      <Info className="h-4 w-4 mt-0.5 shrink-0" />
                      <div>
                        <strong>In Development:</strong> This integration is planned but not yet implemented.
                      </div>
                    </div>
                  )}
                  {connector.implemented && needsRealConfig && (
                    <div className="flex items-start gap-2 rounded-md bg-amber-50 dark:bg-amber-950/30 p-2.5 text-xs text-amber-800 dark:text-amber-400 border border-amber-200 dark:border-amber-800/50">
                      <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                      <div>
                        <strong>Action Required:</strong> Provide API credentials to your administrator to enable this source.
                      </div>
                    </div>
                  )}
                  {connector.implemented && isGoogleSheetsUnconfigured && (
                    <div className="flex items-start gap-2 rounded-md bg-amber-50 dark:bg-amber-950/30 p-2.5 text-xs text-amber-800 dark:text-amber-400 border border-amber-200 dark:border-amber-800/50">
                      <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                      <div>
                        <strong>Action Required:</strong> The managed Replit connection is attached, but an administrator must bind an allowed sheet to this workspace via GOOGLE_SHEETS_TENANT_BINDINGS.
                      </div>
                    </div>
                  )}
                  {notice && (
                    <div
                      className={`p-2.5 rounded-md text-xs flex items-start gap-2 border ${toneClasses[notice.tone]}`}
                      data-testid={`schedule-notice-${connector.connector_key}`}
                    >
                      {notice.tone === "error" ? <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" /> : <Clock className="h-4 w-4 shrink-0 mt-0.5" />}
                      <div className="line-clamp-4" title={notice.body}>
                        <strong className="block mb-0.5">{notice.title}</strong>
                        {notice.body}
                      </div>
                    </div>
                  )}
                  {showLastError && connector.last_error && (
                    <div className={`p-2.5 rounded-md text-xs flex items-start gap-2 border ${
                      connector.last_error.includes('HTTP 429')
                        ? 'bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-400 border-amber-200 dark:border-amber-800/50'
                        : 'bg-destructive/10 text-destructive border-destructive/20'
                    }`}>
                      {connector.last_error.includes('HTTP 429') ? (
                        <Clock className="h-4 w-4 shrink-0 mt-0.5" />
                      ) : (
                        <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                      )}
                      <div className="line-clamp-3" title={connector.last_error}>
                        <strong className="block mb-0.5">
                          {connector.last_error.includes('HTTP 429') ? 'Provider Throttling:' : 'Sync Error:'}
                        </strong>
                        {connector.last_error}
                      </div>
                    </div>
                  )}
                </div>

                {/* Action footer */}
                <div className="pt-4 border-t border-border/50 mt-auto">
                  <Button
                    variant="outline"
                    className="w-full justify-center bg-background/50 backdrop-blur-sm"
                    disabled={actionDisabled}
                    onClick={() => handleConfigure(connector)}
                    data-testid={`btn-configure-${connector.connector_key}`}
                  >
                    <Settings className="mr-2 h-4 w-4" />
                    Configure & Run
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <ConnectorDialog
        connector={selectedConnector}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />
    </div>
  );
}