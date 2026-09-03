import {
  useListRadarConnectors,
  useUpdateRadarConnector,
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
import { Skeleton } from "@/components/loading-states";
import { useToast } from "@/hooks/use-toast";
import { Plug, CheckCircle2, AlertCircle, Clock, Info, ShieldAlert } from "lucide-react";
import { humanizeLabel } from "@/lib/utils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export default function Sources() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: response, isLoading } = useListRadarConnectors();

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

  const handleToggle = (key: string, enabled: boolean) => {
    updateMutation.mutate({ key, data: { enabled } });
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
          Connectors marked as <strong>Awaiting configuration</strong> require credentials to be provisioned server-side by an administrator before they can be enabled here.
        </AlertDescription>
      </Alert>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {response?.data.map((connector) => {
          const isPush = connector.mode === "push";

          return (
            <Card
              key={connector.connector_key}
              className={`border-2 transition-colors ${
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
                          : connector.configured
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
                    onCheckedChange={(val) =>
                      handleToggle(connector.connector_key, val)
                    }
                    disabled={
                      !connector.implemented ||
                      !connector.configured ||
                      isPush ||
                      updateMutation.isPending
                    }
                    aria-label={`${connector.enabled ? "Disable" : "Enable"} ${connector.label}`}
                    data-testid={`switch-${connector.connector_key}`}
                    className="data-[state=checked]:bg-primary"
                  />
                  {isPush && (
                    <span className="text-[10px] text-muted-foreground mt-1 bg-muted px-1.5 py-0.5 rounded">Push Mode</span>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                <div className="flex items-center justify-between border-t border-border/50 pt-3">
                  <span className="text-muted-foreground font-medium">Status</span>
                  <Badge
                    variant={connector.enabled ? "default" : "secondary"}
                    className={!connector.enabled && !connector.configured ? "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400" : ""}
                  >
                    {!connector.configured ? "Awaiting credentials" : humanizeLabel(connector.status)}
                  </Badge>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground font-medium">Sync Cadence</span>
                  <span className="font-medium flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5 text-muted-foreground" /> {connector.cadence}
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground font-medium">Last Run</span>
                  <span className="font-medium">
                    {connector.last_run_at
                      ? new Date(connector.last_run_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                      : "Never"}
                  </span>
                </div>

                {/* State explanations */}
                <div className="pt-2">
                  {!connector.implemented && (
                    <div className="p-2.5 bg-slate-100 dark:bg-slate-800/50 text-slate-600 dark:text-slate-400 rounded-md text-xs flex items-start gap-2 border border-slate-200 dark:border-slate-700/50">
                      <Info className="h-4 w-4 mt-0.5 shrink-0" />
                      <div>
                        <strong>In Development:</strong> This integration is planned but not yet implemented by the engineering team.
                      </div>
                    </div>
                  )}
                  {connector.implemented && !connector.configured && (
                    <div className="flex items-start gap-2 rounded-md bg-amber-50 dark:bg-amber-950/30 p-2.5 text-xs text-amber-800 dark:text-amber-400 border border-amber-200 dark:border-amber-800/50">
                      <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                      <div>
                        <strong>Action Required:</strong> Provide {connector.provider} API credentials to your administrator to enable this source.
                      </div>
                    </div>
                  )}
                  {connector.implemented &&
                    connector.configured &&
                    isPush && (
                      <div className="flex items-start gap-2 rounded-md bg-blue-50 dark:bg-blue-950/30 p-2.5 text-xs text-blue-800 dark:text-blue-400 border border-blue-200 dark:border-blue-800/50">
                        <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
                        <div>
                          <strong>Push Mode Active:</strong> This connector receives webhooks. It is permanently enabled while configured and does not require manual toggling.
                        </div>
                      </div>
                    )}
                  {connector.last_error && connector.enabled && (
                    <div className="p-2.5 bg-destructive/10 text-destructive rounded-md text-xs flex items-start gap-2 border border-destructive/20">
                      <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                      <div>
                        <strong className="block mb-0.5">Sync Error:</strong>
                        {connector.last_error}
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
