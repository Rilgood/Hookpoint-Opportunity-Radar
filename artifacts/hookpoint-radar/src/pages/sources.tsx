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
import { Plug, CheckCircle2, AlertCircle, Clock } from "lucide-react";
import { humanizeLabel } from "@/lib/utils";

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
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-48 w-full" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">
          Data Sources
        </h1>
        <p className="text-muted-foreground mt-1">
          Manage integrations providing evidence for opportunity detection.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {response?.data.map((connector) => (
          <Card
            key={connector.connector_key}
            className={`border-2 ${connector.enabled ? "border-primary/20 bg-primary/5" : "border-border"}`}
          >
            <CardHeader className="pb-3 flex flex-row items-start justify-between space-y-0">
              <div>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Plug
                    className={`h-5 w-5 ${connector.enabled ? "text-primary" : "text-muted-foreground"}`}
                  />
                  {connector.label}
                </CardTitle>
                <CardDescription className="mt-1 capitalize">
                  {humanizeLabel(connector.provider)} ·{" "}
                  {humanizeLabel(connector.category)}
                </CardDescription>
              </div>
              <Switch
                checked={connector.enabled}
                onCheckedChange={(val) =>
                  handleToggle(connector.connector_key, val)
                }
                disabled={
                  !connector.implemented ||
                  !connector.configured ||
                  connector.mode === "push" ||
                  updateMutation.isPending
                }
                aria-label={`${connector.enabled ? "Disable" : "Enable"} ${connector.label}`}
                data-testid={`switch-${connector.connector_key}`}
              />
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div className="flex items-center justify-between border-t pt-3">
                <span className="text-muted-foreground">Status</span>
                <Badge variant={connector.enabled ? "default" : "secondary"}>
                  {humanizeLabel(connector.status)}
                </Badge>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Sync Cadence</span>
                <span className="font-medium flex items-center gap-1">
                  <Clock className="h-3 w-3" /> {connector.cadence}
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Last Run</span>
                <span className="font-medium">
                  {connector.last_run_at
                    ? new Date(connector.last_run_at).toLocaleDateString()
                    : "Never"}
                </span>
              </div>

              {!connector.implemented && (
                <div className="mt-4 p-2 bg-muted text-muted-foreground rounded text-xs flex items-center gap-2">
                  <AlertCircle className="h-4 w-4" />
                  Integration coming soon
                </div>
              )}
              {connector.implemented && !connector.configured && (
                <div className="mt-4 flex items-center gap-2 rounded bg-muted p-2 text-xs text-muted-foreground">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  Add provider credentials before enabling this source
                </div>
              )}
              {connector.implemented &&
                connector.configured &&
                connector.mode === "push" && (
                  <div className="mt-4 flex items-center gap-2 rounded bg-muted p-2 text-xs text-muted-foreground">
                    <CheckCircle2 className="h-4 w-4 shrink-0" />
                    Ready to receive incoming evidence
                  </div>
                )}
              {connector.last_error && connector.enabled && (
                <div className="mt-4 p-2 bg-destructive/10 text-destructive rounded text-xs flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  {connector.last_error}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
