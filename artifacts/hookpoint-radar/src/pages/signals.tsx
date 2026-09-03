import { useState } from "react";
import { Link } from "wouter";
import { useListRadarSignals } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TableSkeleton } from "@/components/loading-states";
import { Activity, ArrowRight, ExternalLink } from "lucide-react";
import { formatDate, humanizeLabel } from "@/lib/utils";

export default function Signals() {
  const { data: response, isLoading } = useListRadarSignals(
    { limit: 50 },
    {
      query: {
        queryKey: ["/api/v1/signals", { limit: 50 }],
      },
    },
  );

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">
          Active Signals
        </h1>
        <p className="text-muted-foreground mt-1">
          The synthesized events and patterns triggering account prioritization.
        </p>
      </div>

      <Card>
        {isLoading ? (
          <div className="p-4">
            <TableSkeleton />
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Signal</TableHead>
                <TableHead>Account Context</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>First Seen</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {response?.data.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="text-center py-8 text-muted-foreground"
                  >
                    No active signals detected.
                  </TableCell>
                </TableRow>
              ) : (
                response?.data.map((signal) => (
                  <TableRow
                    key={signal.id}
                    className="hover-elevate cursor-default"
                  >
                    <TableCell className="max-w-[300px]">
                      <div className="font-medium text-foreground mb-1">
                        {signal.label}
                      </div>
                      <div
                        className="text-xs text-muted-foreground line-clamp-2"
                        title={signal.summary}
                      >
                        {signal.summary}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Link href={`/opportunities/${signal.company_id}`}>
                        <div className="font-medium text-primary hover:underline cursor-pointer">
                          {signal.company_name}
                        </div>
                      </Link>
                      {signal.domain && (
                        <div className="text-xs text-muted-foreground">
                          {signal.domain}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="capitalize">
                        {humanizeLabel(signal.category)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {formatDate(signal.first_seen_at)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Link href={`/opportunities/${signal.company_id}`}>
                        <Button
                          variant="ghost"
                          size="sm"
                          data-testid={`link-company-${signal.company_id}`}
                        >
                          View Account <ArrowRight className="ml-2 h-4 w-4" />
                        </Button>
                      </Link>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
