import {
  useGetRadarDataQuality,
  useListRadarReviewQueue,
} from "@workspace/api-client-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/loading-states";
import {
  ShieldCheck,
  AlertTriangle,
  ArrowRight,
  Activity,
  Database,
  CheckCircle2,
} from "lucide-react";
import { formatNumber } from "@/lib/utils";
import { Link } from "wouter";

export default function Quality() {
  const { data: qualityResponse, isLoading: qualityLoading } =
    useGetRadarDataQuality();
  const { data: queueResponse, isLoading: queueLoading } =
    useListRadarReviewQueue({ limit: 10 });

  if (qualityLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      </div>
    );
  }

  const q = qualityResponse?.data;

  return (
    <div className="space-y-6 animate-in fade-in duration-500 pb-12">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">
          Data Quality
        </h1>
        <p className="text-muted-foreground mt-1">
          Monitor system health, evidence integrity, and human review queues.
        </p>
      </div>

      {q && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center text-muted-foreground">
                <Database className="mr-2 h-4 w-4" /> Ingestion Health
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold mb-1">
                {formatNumber(q.observations.total)}
              </div>
              <p className="text-xs text-muted-foreground mb-4">
                Total observations
              </p>

              <div className="space-y-3">
                <div className="flex justify-between text-sm">
                  <span>7d Ingested</span>
                  <span className="font-medium text-green-600">
                    +{formatNumber(q.observations.ingested_7d)}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span>7d Rejection Rate</span>
                  <span className="font-medium text-amber-600">
                    {(q.rejections.rejection_rate_7d * 100).toFixed(1)}%
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span>Avg Confidence</span>
                  <span className="font-medium text-primary">
                    {(q.observations.average_confidence * 100).toFixed(0)}%
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center text-muted-foreground">
                <ShieldCheck className="mr-2 h-4 w-4" /> Identity Resolution
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold mb-1">
                {(q.identity.average_confidence * 100).toFixed(1)}%
              </div>
              <p className="text-xs text-muted-foreground mb-4">
                Average match confidence
              </p>

              <div className="space-y-3">
                <div className="flex justify-between text-sm">
                  <span>Missing Domain</span>
                  <span className="font-medium text-destructive">
                    {formatNumber(q.identity.missing_domain)}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span>Stale Accounts</span>
                  <span className="font-medium text-amber-600">
                    {formatNumber(q.stale_companies)}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center text-muted-foreground">
                <Activity className="mr-2 h-4 w-4" /> Connector Status
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold mb-1">
                {q.connector_health.enabled}
              </div>
              <p className="text-xs text-muted-foreground mb-4">
                Active data sources
              </p>

              <div className="space-y-3">
                <div className="flex justify-between text-sm items-center">
                  <span>Degraded</span>
                  {q.connector_health.degraded > 0 ? (
                    <Badge
                      variant="destructive"
                      className="bg-amber-500/10 text-amber-600 hover:bg-amber-500/20"
                    >
                      {q.connector_health.degraded}
                    </Badge>
                  ) : (
                    <span className="flex items-center text-green-600 text-xs">
                      <CheckCircle2 className="h-3 w-3 mr-1" /> 0
                    </span>
                  )}
                </div>
                <div className="flex justify-between text-sm items-center">
                  <span>Failing</span>
                  {q.connector_health.errors > 0 ? (
                    <Badge variant="destructive">
                      {q.connector_health.errors}
                    </Badge>
                  ) : (
                    <span className="flex items-center text-green-600 text-xs">
                      <CheckCircle2 className="h-3 w-3 mr-1" /> 0
                    </span>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Human Review Queue
            </CardTitle>
            <CardDescription>
              Accounts marked as 'Suppressed' or requiring manual intervention
              due to conflicting signals.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {queueLoading ? (
              <Skeleton className="h-40 w-full" />
            ) : queueResponse?.data.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground bg-muted/30 rounded-md border border-dashed">
                <CheckCircle2 className="h-8 w-8 text-green-500 mx-auto mb-3" />
                <p>The review queue is currently empty. Great job!</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Company</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Review reason</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {queueResponse?.data.map((company) => (
                    <TableRow key={company.id}>
                      <TableCell>
                        <div className="font-medium text-foreground">
                          {company.name}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {company.domain}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className="bg-suppressed/10 text-suppressed border-suppressed/20 capitalize"
                        >
                          {company.opportunity_tier}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {company.opportunity_tier === "suppressed"
                          ? "Safety hold"
                          : company.identity_confidence < 0.85
                            ? "Identity confidence"
                            : "Evidence conflict"}
                      </TableCell>
                      <TableCell className="text-right">
                        <Link href={`/opportunities/${company.id}`}>
                          <Button
                            variant="outline"
                            size="sm"
                            data-testid={`link-review-${company.id}`}
                          >
                            Review <ArrowRight className="ml-2 h-4 w-4" />
                          </Button>
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
