import { useState } from "react";
import { Link } from "wouter";
import { useListRadarCompanies } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
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
  Search,
  Download,
  ExternalLink,
  Activity,
  ArrowRight,
} from "lucide-react";
import { getTierColor } from "@/lib/utils";

export default function Opportunities() {
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [tier, setTier] = useState<string>("all");
  const [page, setPage] = useState(1);

  // Use a simple timeout for debouncing to avoid an external hook dependency
  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setQ(e.target.value);
    // simple inline debounce logic is fine for basic uses, or just trigger on Enter
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      setDebouncedQ(q);
      setPage(1);
    }
  };

  const { data: response, isLoading } = useListRadarCompanies(
    {
      q: debouncedQ || undefined,
      tier: tier !== "all" ? (tier as any) : undefined,
      page,
      limit: 20,
    },
    {
      query: {
        queryKey: ["/api/v1/companies", { q: debouncedQ, tier, page }],
      },
    },
  );

  const exportUrl = `/api/v1/export/companies.csv?${new URLSearchParams({
    ...(debouncedQ ? { q: debouncedQ } : {}),
    ...(tier !== "all" ? { tier } : {}),
  }).toString()}`;

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">
            Opportunities
          </h1>
          <p className="text-muted-foreground mt-1">
            Ranked accounts based on intent and fit signals.
          </p>
        </div>
        <a href={exportUrl} download data-testid="link-export-csv">
          <Button variant="outline" className="gap-2">
            <Download className="h-4 w-4" />
            Export CSV
          </Button>
        </a>
      </div>

      <Card>
        <div className="p-4 border-b flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search companies..."
              className="pl-9"
              value={q}
              onChange={handleSearchChange}
              onKeyDown={handleKeyDown}
              data-testid="input-search-companies"
            />
          </div>
          <Select
            value={tier}
            onValueChange={(val) => {
              setTier(val);
              setPage(1);
            }}
          >
            <SelectTrigger
              className="w-full sm:w-[180px]"
              data-testid="select-tier-filter"
            >
              <SelectValue placeholder="Filter by Tier" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Tiers</SelectItem>
              <SelectItem value="hot">Hot</SelectItem>
              <SelectItem value="warm">Warm</SelectItem>
              <SelectItem value="watch">Watch</SelectItem>
              <SelectItem value="cold">Cold</SelectItem>
              <SelectItem value="suppressed">Suppressed</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="secondary"
            onClick={() => {
              setDebouncedQ(q);
              setPage(1);
            }}
            data-testid="button-apply-search"
          >
            Search
          </Button>
        </div>

        {isLoading ? (
          <div className="p-4">
            <TableSkeleton />
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Company</TableHead>
                <TableHead>Score</TableHead>
                <TableHead>Tier</TableHead>
                <TableHead className="hidden md:table-cell">Industry</TableHead>
                <TableHead className="hidden sm:table-cell">Status</TableHead>
                <TableHead className="hidden text-right sm:table-cell">
                  Action
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {response?.data.data.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="text-center py-8 text-muted-foreground"
                  >
                    No companies found matching your criteria.
                  </TableCell>
                </TableRow>
              ) : (
                response?.data.data.map((company) => (
                  <TableRow
                    key={company.id}
                    className="hover-elevate cursor-default group"
                    data-testid={`row-company-${company.id}`}
                  >
                    <TableCell>
                      <Link href={`/opportunities/${company.id}`}>
                        <span
                          className="font-medium text-foreground underline-offset-4 hover:underline focus-visible:underline"
                          data-testid={`link-company-name-${company.id}`}
                        >
                          {company.name}
                        </span>
                      </Link>
                      {company.domain && (
                        <div className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                          {company.domain}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2 font-mono">
                        <span className="text-lg font-bold">
                          {company.opportunity_score}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={
                          getTierColor(company.opportunity_tier) + " capitalize"
                        }
                      >
                        {company.opportunity_tier}
                      </Badge>
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-muted-foreground">
                      {company.industry || "—"}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <span className="capitalize text-sm">
                        {company.status}
                      </span>
                    </TableCell>
                    <TableCell className="hidden text-right sm:table-cell">
                      <Link href={`/opportunities/${company.id}`}>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="group-hover:bg-primary group-hover:text-primary-foreground transition-colors"
                          data-testid={`link-detail-${company.id}`}
                        >
                          Review <ArrowRight className="ml-2 h-4 w-4" />
                        </Button>
                      </Link>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        )}

        {/* Pagination */}
        {response && response.data.pages > 1 && (
          <div className="p-4 border-t flex items-center justify-between text-sm text-muted-foreground">
            <div>
              Showing {(page - 1) * 20 + 1} to{" "}
              {Math.min(page * 20, response.data.total)} of{" "}
              {response.data.total}
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page === 1}
                onClick={() => setPage((p) => p - 1)}
                data-testid="button-previous-page"
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page === response.data.pages}
                onClick={() => setPage((p) => p + 1)}
                data-testid="button-next-page"
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
