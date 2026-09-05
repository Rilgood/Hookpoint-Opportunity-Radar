import { Link } from "wouter";
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
import {
  Plug,
  AlertCircle,
  Clock,
  Info,
  ShieldAlert,
  Settings,
  CalendarClock,
  User,
} from "lucide-react";
import { humanizeLabel } from "@/lib/utils";
import {
  lastRunSummary,
  nextRunLabel,
  scheduleNotice,
  toneBadgeClasses,
  toneClasses,
} from "@/lib/connector-schedule";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ConnectorDialog } from "@/components/sources/connector-dialog";

export default function Sources() {
  const localWorkspace =
    import.meta.env.DEV && import.meta.env.VITE_LOCAL_DEMO === "true";
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const {
    data: response,
    isLoading,
    isError,
    refetch,
  } = useListRadarConnectors();

  const [selectedConnector, setSelectedConnector] = useState<Connector | null>(
    null,
  );
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
    if (localWorkspace) return;
    if (!enabled) {
      updateMutation.mutate({
        key: connector.connector_key,
        data: { enabled: false },
      });
      return;
    }

    const isPush = connector.mode === "push";
    const isManual = connector.cadence === "manual";

    const config = connector.config as
      { scheduleInput?: Record<string, unknown> } | undefined;
    const scheduleInput = config?.scheduleInput;
    const hasScheduleInput = Boolean(
      scheduleInput && Object.keys(scheduleInput).length > 0,
    );

    if (!isPush && !isManual && !hasScheduleInput) {
      // Must configure schedule_input first for recurring pull connectors
      setSelectedConnector(connector);
      setDialogOpen(true);
    } else {
      updateMutation.mutate({
        key: connector.connector_key,
        data: { enabled: true },
      });
    }
  };

  const handleConfigure = (connector: Connector) => {
    if (localWorkspace) return;
    setSelectedConnector(connector);
    setDialogOpen(true);
  };

  const getReadinessLabel = (connector: Connector) => {
    if (connector.mode === "push" && connector.configured)
      return "Signed endpoint";
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

  if (isError)
    return (
      <div className="glass-panel rounded-[30px] p-10 text-center">
        <h1 className="text-2xl font-semibold">
          Sources are temporarily unavailable
        </h1>
        <p className="my-4 text-muted-foreground">
          We could not check your integrations.
        </p>
        <Button onClick={() => void refetch()}>Retry sources</Button>
      </div>
    );

  if (isLoading) {
    return (
      <div className="space-y-7">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-24 w-full rounded-[24px]" />
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-56 w-full rounded-[24px]" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-7 animate-in fade-in duration-500 pb-12">
      <div className="flex items-start gap-4 sm:gap-5">
        <span className="glass-panel flex size-14 shrink-0 items-center justify-center rounded-[20px] text-primary sm:size-16">
          <Plug className="size-6 sm:size-7" />
        </span>
        <div className="min-w-0">
          <h1 className="text-4xl font-semibold tracking-[-0.045em] text-foreground sm:text-[2.75rem]">
            Data Sources
          </h1>
          <p className="mt-3 max-w-2xl text-[15px] leading-7 text-muted-foreground">
            Manage integrations providing evidence for opportunity detection.
          </p>
        </div>
      </div>

      <div className="glass-inset flex flex-wrap items-center justify-between gap-4 p-5">
        <p className="text-sm text-muted-foreground">
          Start with a source that matches your workflow.
        </p>
        <Button asChild variant="outline" className="rounded-full">
          <Link href="/setup">Open guided setup</Link>
        </Button>
      </div>
      {localWorkspace ? (
        <Alert
          className="glass-toolbar rounded-[24px] border-white/80 px-6 py-5 [&>svg]:left-5 [&>svg]:top-5 [&>svg]:text-primary"
          data-testid="local-source-limit"
        >
          <ShieldAlert className="h-5 w-5 text-slate-600 dark:text-slate-400" />
          <AlertTitle className="font-semibold leading-6">
            Source controls are read-only locally
          </AlertTitle>
          <AlertDescription className="mt-1 max-w-4xl leading-6 text-muted-foreground">
            Live connector runs and scheduling are disabled in this isolated
            local workspace. Review the available integrations here; enable
            collection in a connected workspace.
          </AlertDescription>
        </Alert>
      ) : (
        <Alert className="glass-toolbar rounded-[24px] border-white/80 px-6 py-5 [&>svg]:left-5 [&>svg]:top-5 [&>svg]:text-primary">
          <ShieldAlert className="h-5 w-5 text-slate-600 dark:text-slate-400" />
          <AlertTitle className="font-semibold leading-6">
            Credentials stay on the server
          </AlertTitle>
          <AlertDescription className="mt-1 max-w-4xl leading-6 text-muted-foreground">
            Source credentials (API keys, tokens, client secrets) are never
            solicited or displayed in the browser. Connectors marked as{" "}
            <strong>Awaiting credentials</strong> require credentials to be
            provisioned server-side by an administrator before they can be
            enabled here.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
        {response?.data.map((connector) => {
          const isPush = connector.mode === "push";
          const noKey = [
            "gdelt",
            "sec_edgar",
            "nppes",
            "usa_spending",
          ].includes(connector.connector_key);
          const managed = connector.connector_key === "google_sheets";

          const isGoogleSheetsUnconfigured = managed && !connector.configured;
          const needsRealConfig =
            !connector.configured && !noKey && !isGoogleSheetsUnconfigured;
          const actionDisabled =
            localWorkspace ||
            !connector.implemented ||
            (!connector.configured && !noKey);
          const lastRun = lastRunSummary(connector);
          const notice = scheduleNotice(connector);
          const scheduleState = connector.schedule?.state;
          // The schedule notice already quotes the last error for these states.
          const showLastError =
            Boolean(connector.last_error) &&
            connector.enabled &&
            scheduleState !== "input_rejected" &&
            scheduleState !== "backoff" &&
            !(scheduleState === "due" && notice?.tone === "warning");

          return (
            <Card
              key={connector.connector_key}
              className={`glass-panel flex flex-col rounded-[26px] transition-[border-color,box-shadow] duration-300 ${
                connector.enabled
                  ? "border-primary/25 ring-1 ring-primary/10"
                  : "border-white/80 hover:border-white"
              }`}
            >
              <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0 p-5 pb-4 sm:p-6 sm:pb-4">
                <div className="min-w-0">
                  <CardTitle className="flex items-start gap-3 text-base font-semibold leading-6 text-foreground">
                    <span className="glass-inset flex size-9 shrink-0 items-center justify-center rounded-xl">
                      <Plug
                        className={`size-4 ${
                          connector.enabled
                            ? "text-primary"
                            : connector.configured || noKey || managed
                              ? "text-muted-foreground"
                              : "text-amber-600"
                        }`}
                      />
                    </span>
                    <span className="pt-1.5">{connector.label}</span>
                  </CardTitle>
                  <CardDescription className="mt-3 text-xs leading-5 text-muted-foreground">
                    {humanizeLabel(connector.provider)} &bull;{" "}
                    {humanizeLabel(connector.category)}
                  </CardDescription>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1 pt-2">
                  <Switch
                    checked={connector.enabled}
                    onCheckedChange={(val) => handleToggle(connector, val)}
                    disabled={
                      actionDisabled || isPush || updateMutation.isPending
                    }
                    aria-label={`${connector.enabled ? "Disable" : "Enable"} ${connector.label}`}
                    data-testid={`switch-${connector.connector_key}`}
                    className="border-white/80 shadow-inner data-[state=checked]:bg-primary"
                  />
                  {isPush && (
                    <span className="mt-2 rounded-full bg-white/60 px-2 py-1 text-[10px] font-medium text-muted-foreground">
                      Push Mode
                    </span>
                  )}
                </div>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col space-y-4 px-5 pb-5 text-sm sm:px-6 sm:pb-6">
                <div className="glass-inset space-y-3.5 rounded-[20px] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-muted-foreground font-medium">
                      Status
                    </span>
                    <Badge
                      variant={connector.enabled ? "default" : "secondary"}
                      className={
                        needsRealConfig
                          ? "rounded-full border border-amber-200/70 bg-amber-50/80 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400"
                          : "rounded-full"
                      }
                    >
                      {getReadinessLabel(connector)}
                    </Badge>
                  </div>

                  <div className="flex items-center justify-between gap-3">
                    <span className="text-muted-foreground font-medium">
                      Sync Cadence
                    </span>
                    <span className="font-medium flex items-center gap-1.5">
                      <Clock className="h-3.5 w-3.5 text-muted-foreground" />{" "}
                      {connector.cadence}
                    </span>
                  </div>

                  <div className="flex items-start justify-between gap-2">
                    <span className="text-muted-foreground font-medium">
                      Last Run
                    </span>
                    <span
                      className="font-medium text-right flex flex-col items-end gap-1"
                      data-testid={`text-last-run-${connector.connector_key}`}
                    >
                      <span>{lastRun.time}</span>
                      {lastRun.outcome && (
                        <span className="flex items-center gap-1.5">
                          <Badge
                            className={`${toneBadgeClasses[lastRun.tone]} text-[10px] px-1.5 py-0`}
                            data-testid={`badge-last-run-outcome-${connector.connector_key}`}
                          >
                            {lastRun.outcome}
                          </Badge>
                          <span
                            className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground"
                            data-testid={`text-last-run-trigger-${connector.connector_key}`}
                          >
                            {lastRun.run?.trigger === "scheduled" ? (
                              <CalendarClock className="h-3 w-3" />
                            ) : (
                              <User className="h-3 w-3" />
                            )}
                            {lastRun.trigger}
                          </span>
                        </span>
                      )}
                    </span>
                  </div>

                  <div className="flex items-start justify-between gap-2">
                    <span className="text-muted-foreground font-medium">
                      Next Run
                    </span>
                    <span
                      className={`font-medium text-right ${connector.schedule?.will_run ? "" : "text-muted-foreground"}`}
                      title={connector.schedule?.reason}
                      data-testid={`text-next-run-${connector.connector_key}`}
                    >
                      {nextRunLabel(connector.schedule)}
                    </span>
                  </div>
                </div>

                {/* State explanations */}
                <div className="flex-1 space-y-2 pt-1">
                  {!connector.implemented && (
                    <div className="flex items-start gap-2 rounded-2xl border border-white/75 bg-white/45 p-3 text-xs leading-5 text-slate-600 dark:bg-slate-800/50 dark:text-slate-400">
                      <Info className="h-4 w-4 mt-0.5 shrink-0" />
                      <div>
                        <strong>In Development:</strong> This integration is
                        planned but not yet implemented.
                      </div>
                    </div>
                  )}
                  {!localWorkspace &&
                    connector.implemented &&
                    needsRealConfig && (
                      <div className="flex items-start gap-2 rounded-2xl bg-amber-50/80 dark:bg-amber-950/30 p-3 text-xs leading-5 text-amber-800 dark:text-amber-400 border border-amber-200/70 dark:border-amber-800/50">
                        <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                        <div>
                          <strong>Action Required:</strong> Provide API
                          credentials to your administrator to enable this
                          source.
                        </div>
                      </div>
                    )}
                  {!localWorkspace &&
                    connector.implemented &&
                    isGoogleSheetsUnconfigured && (
                      <div className="flex items-start gap-2 rounded-2xl bg-amber-50/80 dark:bg-amber-950/30 p-3 text-xs leading-5 text-amber-800 dark:text-amber-400 border border-amber-200/70 dark:border-amber-800/50">
                        <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                        <div>
                          <strong>Action Required:</strong> The managed Replit
                          connection is attached, but an administrator must bind
                          an allowed sheet to this workspace via
                          GOOGLE_SHEETS_TENANT_BINDINGS.
                        </div>
                      </div>
                    )}
                  {notice && (
                    <div
                      className={`p-3 rounded-2xl text-xs leading-5 flex items-start gap-2 border ${toneClasses[notice.tone]}`}
                      data-testid={`schedule-notice-${connector.connector_key}`}
                    >
                      {notice.tone === "error" ? (
                        <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                      ) : (
                        <Clock className="h-4 w-4 shrink-0 mt-0.5" />
                      )}
                      <div className="line-clamp-4" title={notice.body}>
                        <strong className="block mb-0.5">{notice.title}</strong>
                        {notice.body}
                      </div>
                    </div>
                  )}
                  {showLastError && connector.last_error && (
                    <div
                      className={`p-3 rounded-2xl text-xs leading-5 flex items-start gap-2 border ${
                        connector.last_error.includes("HTTP 429")
                          ? "bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-400 border-amber-200 dark:border-amber-800/50"
                          : "bg-destructive/10 text-destructive border-destructive/20"
                      }`}
                    >
                      {connector.last_error.includes("HTTP 429") ? (
                        <Clock className="h-4 w-4 shrink-0 mt-0.5" />
                      ) : (
                        <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                      )}
                      <div
                        className="line-clamp-3"
                        title={connector.last_error}
                      >
                        <strong className="block mb-0.5">
                          {connector.last_error.includes("HTTP 429")
                            ? "Provider Throttling:"
                            : "Sync Error:"}
                        </strong>
                        {connector.last_error}
                      </div>
                    </div>
                  )}
                </div>

                {/* Action footer */}
                <div className="mt-auto border-t border-white/70 pt-4">
                  <Button
                    variant="outline"
                    className="h-11 w-full justify-center rounded-2xl border-white/80 bg-white/60 shadow-sm disabled:opacity-60"
                    disabled={actionDisabled}
                    onClick={() => handleConfigure(connector)}
                    data-testid={`btn-configure-${connector.connector_key}`}
                  >
                    <Settings className="mr-2 h-4 w-4" />
                    {localWorkspace ? "Unavailable locally" : "Configure & Run"}
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
