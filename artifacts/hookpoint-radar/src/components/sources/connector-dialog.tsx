import { Link } from "wouter";
import { Textarea } from "@/components/ui/textarea";
import React, { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Connector,
  ConnectorRunInput,
  useRunRadarConnector,
  useUpdateRadarConnector,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { humanizeLabel } from "@/lib/utils";
import { CheckCircle2, Play, Calendar, AlertCircle } from "lucide-react";
import { ConnectorRunHistory } from "@/components/sources/connector-run-history";
import {
  getListRadarConnectorsQueryKey,
  getListRadarConnectorRunsQueryKey,
  getGetRadarDashboardQueryKey,
  getListRadarCompaniesQueryKey,
  getListRadarSignalsQueryKey,
  getGetRadarDataQualityQueryKey,
  getListRadarReviewQueueQueryKey,
} from "@workspace/api-client-react";

// The form schema encompasses all possible fields for all connectors.
const connectorSchema = z.object({
  spreadsheet_target: z.string().optional(),
  range: z.string().optional(),
  company_name: z.string().optional(),
  company_domain: z.string().optional(),
  actor_input: z
    .string()
    .max(100_000)
    .optional()
    .refine((value) => {
      if (!value?.trim()) return true;
      try {
        const parsed = JSON.parse(value);
        return (
          parsed !== null &&
          typeof parsed === "object" &&
          !Array.isArray(parsed)
        );
      } catch {
        return false;
      }
    }, "Enter a valid JSON object using your actor’s input schema."),
  query: z.string().optional(),
  cik: z.string().optional(),
  npi: z.string().optional(),
  state: z.string().optional(),
  start_date: z.string().optional(),
  end_date: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).optional(),
});

type FormValues = z.infer<typeof connectorSchema>;

interface ConnectorDialogProps {
  connector: Connector | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ConnectorDialog({
  connector,
  open,
  onOpenChange,
}: ConnectorDialogProps) {
  const [isSuccessRun, setIsSuccessRun] = useState(false);
  const [runStats, setRunStats] = useState<{
    seen: number;
    inserted: number;
    duplicates: number;
    rejected: number;
    signals: number;
  } | null>(null);

  const { toast } = useToast();
  const queryClient = useQueryClient();

  const form = useForm<FormValues>({
    resolver: zodResolver(connectorSchema),
    defaultValues: {
      spreadsheet_target: "",
      range: "",
      company_name: "",
      company_domain: "",
      actor_input: "",
      query: "",
      cik: "",
      npi: "",
      state: "",
      start_date: "",
      end_date: "",
      limit: 10,
    },
  });

  // Reset form when connector changes or dialog opens
  useEffect(() => {
    if (open && connector) {
      setIsSuccessRun(false);
      setRunStats(null);
      const config = connector.config as
        { scheduleInput?: Record<string, any> } | undefined;
      const scheduleInput = config?.scheduleInput;
      if (scheduleInput) {
        form.reset({
          spreadsheet_target:
            scheduleInput.spreadsheet_url || scheduleInput.spreadsheet_id || "",
          range:
            scheduleInput.range ||
            (key === "google_sheets" ? "Sheet1!A1:Z500" : ""),
          company_name: scheduleInput.company?.name || "",
          company_domain: scheduleInput.company?.domain || "",
          actor_input: scheduleInput.actor_input
            ? JSON.stringify(scheduleInput.actor_input, null, 2)
            : "",
          query: scheduleInput.query || "",
          cik: scheduleInput.cik || "",
          npi: scheduleInput.npi || "",
          state: scheduleInput.state || "",
          start_date: scheduleInput.start_date || "",
          end_date: scheduleInput.end_date || "",
          limit: scheduleInput.limit || 10,
        });
      } else {
        form.reset({
          spreadsheet_target: "",
          range: key === "google_sheets" ? "Sheet1!A1:Z500" : "",
          company_name: "",
          company_domain: "",
          actor_input: "",
          query: "",
          cik: "",
          npi: "",
          state: "",
          start_date: "",
          end_date: "",
          limit: 10,
        });
      }
    }
  }, [open, connector, form]);

  const runMutation = useRunRadarConnector({
    mutation: {
      onSuccess: (response) => {
        setIsSuccessRun(true);
        const data = response.data;
        if (data) {
          setRunStats({
            seen: data.seen || 0,
            inserted: data.inserted || 0,
            duplicates: data.duplicates || 0,
            rejected: data.rejected || 0,
            signals: data.signals_created || 0,
          });
        }

        toast({
          title: data?.rejected
            ? "Import needs review"
            : data?.inserted
              ? "Evidence imported"
              : "No new evidence",
          description: data?.rejected
            ? `${data.rejected} records were rejected. Review data quality before relying on this import.`
            : data?.inserted
              ? `${data.inserted} observations saved. Review account identity and evidence next.`
              : "The run completed without adding observations. Check the target, date range and duplicates.",
        });

        queryClient.invalidateQueries({
          queryKey: ["/api/v1/workspace-readiness"],
        });
        // Invalidate queries so new data appears
        queryClient.invalidateQueries({
          queryKey: getListRadarConnectorsQueryKey(),
        });
        queryClient.invalidateQueries({
          queryKey: getListRadarConnectorRunsQueryKey(),
        });
        queryClient.invalidateQueries({
          queryKey: getGetRadarDashboardQueryKey(),
        });
        queryClient.invalidateQueries({
          queryKey: getListRadarCompaniesQueryKey(),
        });
        queryClient.invalidateQueries({
          queryKey: getListRadarSignalsQueryKey(),
        });
        queryClient.invalidateQueries({
          queryKey: getGetRadarDataQualityQueryKey(),
        });
        queryClient.invalidateQueries({
          queryKey: getListRadarReviewQueueQueryKey(),
        });
      },
      onError: (error) => {
        const err = error as { data?: { error?: { message?: string } } };
        // A failed run is still a run: refresh the history and the connector state it changed.
        queryClient.invalidateQueries({
          queryKey: getListRadarConnectorsQueryKey(),
        });
        queryClient.invalidateQueries({
          queryKey: getListRadarConnectorRunsQueryKey(),
        });
        toast({
          title: "Run failed",
          description:
            err?.data?.error?.message ||
            "An unexpected error occurred while running.",
          variant: "destructive",
        });
      },
    },
  });

  const updateMutation = useUpdateRadarConnector({
    mutation: {
      onSuccess: () => {
        toast({
          title: "Schedule saved",
          description: "Connector schedule has been updated and enabled.",
        });
        queryClient.invalidateQueries({
          queryKey: getListRadarConnectorsQueryKey(),
        });
        queryClient.invalidateQueries({
          queryKey: ["/api/v1/workspace-readiness"],
        });
        onOpenChange(false);
      },
      onError: (error) => {
        const err = error as { data?: { error?: { message?: string } } };
        toast({
          title: "Failed to schedule",
          description:
            err?.data?.error?.message ||
            "An unexpected error occurred while scheduling.",
          variant: "destructive",
        });
      },
    },
  });

  if (!connector) return null;

  const key = connector.connector_key;
  const isPush = connector.mode === "push";
  const isRecurring = connector.cadence !== "manual" && !isPush;

  const prepareInput = (values: FormValues): ConnectorRunInput => {
    const saved = (
      connector.config as { scheduleInput?: Record<string, any> } | undefined
    )?.scheduleInput;
    // The focused form only owns visible fields. Preserve provider-specific
    // settings and extra identity fields that may have been saved via the API.
    const input: Record<string, any> = { ...saved };
    const hasCompanyFields =
      ["gdelt", "newsapi", "sec_edgar", "usa_spending", "nppes"].includes(
        key,
      ) || key.startsWith("apify_");
    if (hasCompanyFields) {
      const company = { ...saved?.company };
      delete company.name;
      delete company.domain;
      if (values.company_name?.trim())
        company.name = values.company_name.trim();
      if (values.company_domain?.trim())
        company.domain = values.company_domain.trim();
      if (Object.keys(company).length) input.company = company;
      else delete input.company;
    }
    const replaceField = (field: string, value?: string | number) => {
      delete input[field];
      const normalized = typeof value === "string" ? value.trim() : value;
      if (normalized !== undefined && normalized !== "")
        input[field] = normalized;
    };
    if (key === "google_sheets") {
      delete input.spreadsheet_url;
      delete input.spreadsheet_id;
      const target = values.spreadsheet_target?.trim();
      if (target)
        input[
          target.startsWith("https://docs.google.com/")
            ? "spreadsheet_url"
            : "spreadsheet_id"
        ] = target;
      replaceField("range", values.range);
    } else {
      if (key === "gdelt" || key === "newsapi")
        replaceField("query", values.query);
      if (key === "sec_edgar") replaceField("cik", values.cik);
      if (key === "nppes") {
        replaceField("npi", values.npi);
        replaceField("state", values.state);
      }
      if (key === "usa_spending") {
        replaceField("start_date", values.start_date);
        replaceField("end_date", values.end_date);
      }
      if (key !== "generic_webhook") replaceField("limit", values.limit);
    }
    if (key.startsWith("apify_")) {
      delete input.actor_input;
      if (values.actor_input?.trim())
        input.actor_input = JSON.parse(values.actor_input);
    }
    return input as ConnectorRunInput;
  };

  const handleRunNow = form.handleSubmit((values) => {
    runMutation.mutate({
      key: connector.connector_key,
      data: prepareInput(values),
    });
  });

  const handleSaveSchedule = form.handleSubmit((values) => {
    updateMutation.mutate({
      key: connector.connector_key,
      data: {
        enabled: true,
        schedule_input: prepareInput(values),
      },
    });
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Configure {connector.label}</DialogTitle>
          <DialogDescription>
            {key === "google_sheets" &&
              "Managed Replit connection. Enter your sheet details below."}
            {key === "gdelt" && "News & Events. No credentials required."}
            {key === "sec_edgar" && "SEC Filings. No credentials required."}
            {key === "nppes" &&
              "Healthcare Provider Data. No credentials required. Firmographic enrichment, not buyer intent."}
            {key === "usa_spending" &&
              "Federal Awards. No credentials required."}
            {key === "newsapi" && "Dated news coverage for a named company."}
            {key.startsWith("apify_") &&
              "Use the input schema of the actor configured for this source."}
            {key === "generic_webhook" &&
              "Webhooks require server-side configuration and signed events."}
          </DialogDescription>
        </DialogHeader>

        {isSuccessRun ? (
          <div className="py-6 flex flex-col items-center justify-center space-y-4 text-center">
            <div
              className={`h-12 w-12 rounded-full flex items-center justify-center ${runStats?.rejected ? "bg-amber-100 text-amber-700" : runStats?.inserted ? "bg-green-100 text-green-600" : "bg-slate-100 text-slate-500"}`}
            >
              {runStats?.inserted && !runStats.rejected ? (
                <CheckCircle2 className="h-6 w-6" />
              ) : (
                <AlertCircle className="h-6 w-6" />
              )}
            </div>
            <div>
              <h3 className="text-lg font-medium text-foreground">
                {runStats?.rejected
                  ? "Import needs review"
                  : runStats?.inserted
                    ? "Evidence imported"
                    : "No new evidence"}
              </h3>
              <p className="text-sm text-muted-foreground mt-1">
                {runStats?.rejected
                  ? "Some records were rejected. Inspect them before relying on this import."
                  : runStats?.inserted
                    ? "Open the imported accounts to review their identity and evidence."
                    : "No observations were added. The source may have no matches or only previously imported records."}
              </p>
            </div>

            {runStats && (
              <div className="grid grid-cols-2 gap-4 w-full mt-4 text-left">
                <div className="bg-slate-50 dark:bg-slate-900 p-3 rounded-md border border-border">
                  <span className="text-xs text-muted-foreground block">
                    Observations Seen
                  </span>
                  <span className="text-lg font-semibold">{runStats.seen}</span>
                </div>
                <div className="bg-slate-50 dark:bg-slate-900 p-3 rounded-md border border-border">
                  <span className="text-xs text-muted-foreground block">
                    Inserted
                  </span>
                  <span className="text-lg font-semibold text-green-600">
                    {runStats.inserted}
                  </span>
                </div>
                <div className="bg-slate-50 dark:bg-slate-900 p-3 rounded-md border border-border">
                  <span className="text-xs text-muted-foreground block">
                    Duplicates Skipped
                  </span>
                  <span className="text-lg font-semibold text-amber-600">
                    {runStats.duplicates}
                  </span>
                </div>
                <div className="bg-slate-50 dark:bg-slate-900 p-3 rounded-md border border-border">
                  <span className="text-xs text-muted-foreground block">
                    New signals
                  </span>
                  <span className="text-lg font-semibold text-primary">
                    {runStats.signals}
                  </span>
                </div>
              </div>
            )}

            {!!runStats?.rejected && (
              <p className="text-sm text-amber-800">
                {runStats.rejected} rejected records ·{" "}
                <Link
                  href="/quality"
                  onClick={() => onOpenChange(false)}
                  className="underline"
                >
                  Review data quality
                </Link>
              </p>
            )}
            {!!runStats?.inserted && (
              <Button asChild variant="outline">
                <Link href="/opportunities" onClick={() => onOpenChange(false)}>
                  Review accounts
                </Link>
              </Button>
            )}
            <Button
              onClick={() => onOpenChange(false)}
              className="mt-4 w-full"
              data-testid="button-close-success"
            >
              Close
            </Button>
          </div>
        ) : (
          <Form {...form}>
            <form className="space-y-4">
              {key === "google_sheets" && (
                <>
                  <div className="bg-blue-50 dark:bg-blue-900/20 text-blue-800 dark:text-blue-300 p-3 rounded-md text-xs mb-4">
                    <strong>Required headers:</strong> type, title, and
                    (company_name or company_domain).
                    <br />
                    <strong>Optional headers:</strong> body, url, external_id,
                    observed_at, amount, industry, city, state, country.
                  </div>
                  <FormField
                    control={form.control}
                    name="spreadsheet_target"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Spreadsheet URL or ID</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="https://docs.google.com/spreadsheets/d/..."
                            {...field}
                            data-testid="input-spreadsheet-url"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="range"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Sheet Range (A1 notation)</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="Sheet1!A1:Z500"
                            {...field}
                            data-testid="input-range"
                          />
                        </FormControl>
                        <FormDescription>E.g., Sheet1!A1:Z500.</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </>
              )}

              {(key === "gdelt" ||
                key === "newsapi" ||
                key.startsWith("apify_") ||
                key === "sec_edgar" ||
                key === "usa_spending" ||
                key === "nppes") && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="company_name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          {key === "nppes"
                            ? "Organization Name"
                            : "Company Name"}
                        </FormLabel>
                        <FormControl>
                          <Input
                            placeholder="Acme Corp"
                            {...field}
                            data-testid="input-company-name"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="company_domain"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Company Domain</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="acme.com"
                            {...field}
                            data-testid="input-company-domain"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              )}

              {(key === "gdelt" || key === "newsapi") && (
                <FormField
                  control={form.control}
                  name="query"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Focused Query (Optional)</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="expansion OR acquisition"
                          {...field}
                          data-testid="input-query"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              {key === "sec_edgar" && (
                <FormField
                  control={form.control}
                  name="cik"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>CIK (Central Index Key)</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="0000320193"
                          {...field}
                          data-testid="input-cik"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              {key === "nppes" && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="npi"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>NPI</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="1234567890"
                            {...field}
                            data-testid="input-npi"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="state"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>State</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="NY"
                            {...field}
                            data-testid="input-state"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              )}

              {key === "usa_spending" && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="start_date"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Start Date</FormLabel>
                        <FormControl>
                          <Input
                            type="date"
                            {...field}
                            data-testid="input-start-date"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="end_date"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>End Date</FormLabel>
                        <FormControl>
                          <Input
                            type="date"
                            {...field}
                            data-testid="input-end-date"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              )}

              {key !== "generic_webhook" && key !== "google_sheets" && (
                <FormField
                  control={form.control}
                  name="limit"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Result Limit</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min="1"
                          max="100"
                          {...field}
                          data-testid="input-limit"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              {key.startsWith("apify_") && (
                <FormField
                  control={form.control}
                  name="actor_input"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Actor input JSON</FormLabel>
                      <FormControl>
                        <Textarea
                          {...field}
                          placeholder={'{"startUrls": []}'}
                          rows={6}
                          className="font-mono text-xs"
                        />
                      </FormControl>
                      <FormDescription>
                        Use the schema of your configured actor. Put targets and
                        collection limits here; keep credentials in the server
                        environment.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
              {key === "generic_webhook" && (
                <div className="p-4 bg-muted text-muted-foreground rounded-md text-sm border">
                  <AlertCircle className="h-5 w-5 mb-2 text-primary" />
                  This connector is configured server-side for push events. The
                  signing secret is maintained in your environment variables.
                </div>
              )}
            </form>
          </Form>
        )}

        {!isSuccessRun && !isPush && (
          <div className="mt-2 border-t border-border/60 pt-4">
            <ConnectorRunHistory connectorKey={key} enabled={open} />
          </div>
        )}

        {!isSuccessRun && (
          <DialogFooter className="mt-4 gap-2 sm:gap-0">
            {key !== "generic_webhook" && (
              <>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleRunNow}
                  disabled={runMutation.isPending || updateMutation.isPending}
                  data-testid="button-run-now"
                  className="w-full sm:w-auto"
                >
                  <Play className="mr-2 h-4 w-4" />
                  {runMutation.isPending ? "Running..." : "Run Now"}
                </Button>
                {isRecurring && (
                  <Button
                    type="button"
                    onClick={handleSaveSchedule}
                    disabled={updateMutation.isPending || runMutation.isPending}
                    data-testid="button-save-schedule"
                    className="w-full sm:w-auto"
                  >
                    <Calendar className="mr-2 h-4 w-4" />
                    {updateMutation.isPending ? "Saving..." : "Save & Schedule"}
                  </Button>
                )}
              </>
            )}
            {key === "generic_webhook" && (
              <Button
                type="button"
                onClick={() => onOpenChange(false)}
                data-testid="button-close"
              >
                Close
              </Button>
            )}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
