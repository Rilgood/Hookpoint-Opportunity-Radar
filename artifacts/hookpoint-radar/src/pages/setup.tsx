import { useState } from "react";
import { Link } from "wouter";
import {
  ArrowUpRight,
  ArrowRight,
  Check,
  Circle,
  Compass,
  Database,
  KeyRound,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import {
  useGetRadarWorkspaceReadiness,
  useListRadarConnectors,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ConnectorDialog } from "@/components/sources/connector-dialog";

export default function Setup() {
  const readiness = useGetRadarWorkspaceReadiness();
  const connectors = useListRadarConnectors();
  const [selectedKey, setSelectedKey] = useState("google_sheets");
  const [configure, setConfigure] = useState(false);
  if (readiness.isLoading)
    return (
      <div className="space-y-6">
        <Skeleton className="h-20 w-72" />
        <Skeleton className="h-96 w-full rounded-[30px]" />
      </div>
    );
  if (readiness.isError || !readiness.data)
    return (
      <div className="glass-panel rounded-[30px] p-10 text-center">
        <h1 className="text-2xl font-semibold">Setup status is unavailable</h1>
        <p className="my-4 text-muted-foreground">
          We could not check your workspace. Retry to get its current status.
        </p>
        <Button onClick={() => void readiness.refetch()}>
          Retry setup check
        </Button>
      </div>
    );
  const data = readiness.data.data;
  const local = data.mode === "local";
  const available = data.sources.filter((source) => source.implemented);
  const planned = data.sources.filter((source) => !source.implemented);
  const selected =
    available.find((source) => source.key === selectedKey) || available[0];
  const connector =
    connectors.data?.data.find(
      (source) => source.connector_key === selected?.key,
    ) || null;
  const completed = data.steps.filter((step) => step.complete).length;
  const refresh = () => {
    void readiness.refetch();
    void connectors.refetch();
  };
  return (
    <div className="space-y-7 pb-12 animate-in fade-in duration-500">
      <header className="flex flex-wrap items-end justify-between gap-5">
        <div>
          <p className="mb-3 text-[10px] font-semibold uppercase tracking-[.18em] text-slate-500">
            Your workspace, connected
          </p>
          <h1 className="text-4xl font-semibold tracking-[-.05em] sm:text-5xl">
            From signal to action<span className="text-primary">.</span>
          </h1>
          <p className="mt-4 max-w-xl text-sm leading-7 text-muted-foreground">
            Start with one trusted source. Review what it tells you, give the
            next step an owner, and learn from the result.
          </p>
        </div>
        <Button
          variant="outline"
          className="rounded-full gap-2"
          onClick={refresh}
          disabled={readiness.isFetching}
        >
          <RefreshCw
            className={`size-4 ${readiness.isFetching ? "animate-spin" : ""}`}
          />
          Refresh status
        </Button>
      </header>
      <div className="grid items-start gap-6 xl:grid-cols-[290px_minmax(0,1fr)]">
        <aside className="glass-panel rounded-[28px] p-6">
          <div className="flex items-center gap-3">
            <span className="glass-inset rounded-2xl p-3 text-primary">
              <Compass className="size-5" />
            </span>
            <div>
              <h2 className="font-semibold">First value</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                {completed} of {data.steps.length} milestones observed
              </p>
            </div>
          </div>
          <ol className="mt-7 space-y-6">
            {data.steps.map((step, index) => (
              <li key={step.key} className="flex gap-3">
                <span
                  className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border text-xs ${step.complete ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-white/60 text-slate-500"}`}
                >
                  {step.complete ? <Check className="size-3.5" /> : index + 1}
                </span>
                <div>
                  <Link
                    href={step.href}
                    className="text-sm font-semibold hover:text-primary"
                  >
                    {step.title}
                  </Link>
                  <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
                    {step.detail}
                  </p>
                  <p className="mt-2 text-[10px] font-medium text-slate-500">
                    {step.value.toLocaleString()} saved{" "}
                    {step.key === "collect"
                      ? "observations"
                      : step.key === "review"
                        ? "reviews"
                        : step.key === "act"
                          ? "actions"
                          : "outcomes"}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </aside>
        <section
          className="glass-panel overflow-hidden rounded-[30px]"
          aria-labelledby="source-setup-title"
        >
          <div className="border-b border-white/80 bg-white/30 p-6 sm:p-8">
            <p className="text-[10px] font-semibold uppercase tracking-[.16em] text-primary">
              01 · Start collecting
            </p>
            <h2
              id="source-setup-title"
              className="mt-3 text-2xl font-semibold tracking-tight"
            >
              Choose your first source.
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {available.length} adapters are implemented. Public sources need a
              target; private sources also need server credentials.
            </p>
            <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {["google_sheets", "generic_webhook", "gdelt", "newsapi"].map(
                (key) => {
                  const source = available.find((item) => item.key === key);
                  return (
                    source && (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setSelectedKey(key)}
                        aria-pressed={selected?.key === key}
                        className={`rounded-2xl border p-3 text-left text-xs font-semibold transition-colors ${selected?.key === key ? "border-blue-200 bg-blue-50/80 text-blue-800 shadow-sm" : "border-white bg-white/40 text-slate-600 hover:bg-white/80"}`}
                      >
                        {source.label}
                        <span className="mt-1 block text-[10px] font-normal opacity-75">
                          {source.purpose}
                        </span>
                      </button>
                    )
                  );
                },
              )}
            </div>
            <label
              className="mt-5 block text-xs font-medium text-slate-600"
              htmlFor="setup-source"
            >
              All implemented sources
            </label>
            <select
              id="setup-source"
              className="glass-field mt-2 h-10 w-full rounded-xl px-3 text-sm"
              value={selected?.key}
              onChange={(event) => setSelectedKey(event.target.value)}
            >
              {available.map((source) => (
                <option key={source.key} value={source.key}>
                  {source.label}
                </option>
              ))}
            </select>
          </div>
          {selected && (
            <div className="space-y-6 p-6 sm:p-8">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-xl font-semibold tracking-tight">
                    {selected.label}
                  </h3>
                  <span className="rounded-full border border-slate-200/60 bg-white/60 px-2.5 py-1 text-[10px] text-slate-600">
                    {selected.configured
                      ? "Configuration present"
                      : "Configuration needed"}
                  </span>
                </div>
                <p className="mt-3 text-sm leading-7 text-muted-foreground">
                  {selected.description}
                </p>
              </div>
              <div className="grid gap-5 sm:grid-cols-2">
                <div className="glass-inset p-5">
                  <KeyRound className="mb-3 size-4 text-primary" />
                  <h4 className="text-sm font-semibold">Server requirements</h4>
                  {selected.requirements.length ? (
                    <ul className="mt-3 space-y-3">
                      {selected.requirements.map((requirement) => (
                        <li
                          key={requirement.name}
                          className="flex items-start gap-2 text-xs"
                        >
                          {requirement.present ? (
                            <Check className="mt-0.5 size-3.5 shrink-0 text-emerald-700" />
                          ) : (
                            <Circle className="mt-0.5 size-3.5 shrink-0 text-slate-400" />
                          )}
                          <span className="min-w-0">
                            <code className="break-all text-[11px]">
                              {requirement.name}
                            </code>
                            <span className="mt-1 block text-muted-foreground">
                              {requirement.present
                                ? "Present; live access still needs verification"
                                : "Add to the server environment"}
                            </span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-3 text-xs leading-6 text-muted-foreground">
                      No provider credentials required. A successful import is
                      still needed to verify access.
                    </p>
                  )}
                </div>
                <div className="glass-inset p-5">
                  <Database className="mb-3 size-4 text-primary" />
                  <h4 className="text-sm font-semibold">Prepare the input</h4>
                  <ul className="mt-3 space-y-2">
                    {selected.inputs.map((input) => (
                      <li
                        key={input}
                        className="flex gap-2 text-xs leading-5 text-muted-foreground"
                      >
                        <span className="mt-2 size-1 shrink-0 rounded-full bg-slate-400" />
                        {input}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
              {selected.latest_run && (
                <div className="rounded-2xl border border-slate-200/70 bg-white/50 p-4 text-xs leading-6">
                  <strong>Last run: {selected.latest_run.status}</strong>
                  <span className="ml-2 text-muted-foreground">
                    {selected.latest_run.finished_at
                      ? new Date(
                          selected.latest_run.finished_at,
                        ).toLocaleString()
                      : "In progress"}
                  </span>
                  <p>
                    {selected.latest_run.seen} seen ·{" "}
                    {selected.latest_run.inserted} inserted ·{" "}
                    {selected.latest_run.rejected} rejected
                  </p>
                  {selected.latest_run.inserted === 0 && (
                    <p className="text-muted-foreground">
                      This run did not add new evidence.
                    </p>
                  )}
                </div>
              )}
              {local ? (
                <div className="rounded-2xl border border-blue-100 bg-blue-50/50 p-4 text-xs leading-6 text-blue-900">
                  <strong>Local workspace.</strong> Live collection is disabled
                  here. Provision the requirements on your authenticated
                  deployment, then return to configure a focused import. Your
                  saved work and reviews can be used locally.
                </div>
              ) : !selected.configured ? (
                <p className="text-xs leading-6 text-muted-foreground">
                  Add the missing requirements on the server and refresh this
                  page. Credentials stay outside the browser.
                </p>
              ) : selected.mode === "push" ? (
                <p className="text-xs leading-6 text-muted-foreground">
                  Send a signed event using the webhook contract in the
                  connector handoff guide. Inbound access is controlled by the
                  server signing secret and your workspace API key.
                </p>
              ) : (
                <p className="text-xs leading-6 text-muted-foreground">
                  Start with a small import. Review rejected records and account
                  identity before enabling a recurring schedule.
                </p>
              )}
              <div className="flex flex-wrap gap-3">
                <Button
                  className="rounded-full"
                  onClick={() => setConfigure(true)}
                  disabled={
                    local ||
                    !selected.configured ||
                    !connector ||
                    selected.mode === "push"
                  }
                >
                  Configure first import
                  <ArrowRight className="ml-2 size-4" />
                </Button>
                <Button variant="outline" asChild className="rounded-full">
                  <Link href="/sources">
                    Manage sources
                    <ArrowUpRight className="ml-2 size-4" />
                  </Link>
                </Button>
              </div>
              {connectors.isError && (
                <p role="alert" className="text-xs text-destructive">
                  Source controls could not load.{" "}
                  <button
                    className="underline"
                    onClick={() => void connectors.refetch()}
                  >
                    Retry controls
                  </button>
                </p>
              )}
            </div>
          )}
        </section>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="glass-panel rounded-[28px] p-6 sm:p-7">
          <div className="flex items-center gap-3">
            <ShieldCheck className="size-5 text-primary" />
            <h2 className="font-semibold">Runtime checks</h2>
            <span className="ml-auto text-xs text-muted-foreground">
              {local ? "Local" : data.mode}
            </span>
          </div>
          <dl className="mt-5 grid grid-cols-2 gap-5 text-sm">
            {[
              ["Schema", `Migration ${data.runtime.schema_version}`],
              ["Storage", data.runtime.storage_mode.replaceAll("_", " ")],
              [
                "API authentication",
                data.runtime.authenticated ? "Required" : "Disabled",
              ],
              [
                "Collection scheduler",
                data.runtime.scheduler_enabled ? "Enabled" : "Disabled",
              ],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="mt-1 font-medium">{value}</dd>
              </div>
            ))}
          </dl>
          {data.runtime.issues.map((issue) => (
            <p
              key={issue.code}
              className="mt-4 text-xs leading-6 text-amber-800"
            >
              {issue.message}
            </p>
          ))}
          <p className="mt-5 text-xs leading-6 text-muted-foreground">
            These checks describe this running workspace. Deployment, real
            sign-in and backup restoration are separate release checks in the
            production runbook.
          </p>
        </section>
        <section className="glass-panel rounded-[28px] p-6 sm:p-7">
          <h2 className="font-semibold">Learning needs real outcomes.</h2>
          <p className="mt-4 text-3xl font-semibold tracking-tight">
            {data.calibration.labeled_accounts}
            <span className="ml-2 text-xs font-normal tracking-normal text-muted-foreground">
              accounts with an eligible outcome label
            </span>
          </p>
          <p className="mt-3 text-sm leading-7 text-muted-foreground">
            Scores explain the current evidence. They are not a probability of
            winning. Record qualified and negative outcomes to measure whether
            priorities are useful.
          </p>
          <p className="mt-3 text-xs leading-6 text-muted-foreground">
            Monitoring requires at least {data.calibration.minimum_sample}{" "}
            eligible accounts and {data.calibration.min_each_class} in each
            class. Model changes also require a separate training cohort, a
            held-out evaluation and explicit approval.
          </p>
          <Link
            href="/insights"
            className="mt-4 inline-flex items-center gap-2 text-xs font-semibold text-primary"
          >
            Open outcome insights
            <ArrowRight className="size-3.5" />
          </Link>
        </section>
      </div>
      <details className="glass-inset p-5 text-sm">
        <summary className="cursor-pointer font-medium">
          Planned native integrations · {planned.length}
        </summary>
        <p className="mt-3 max-w-3xl text-xs leading-6 text-muted-foreground">
          These catalog entries still need a provider adapter. They cannot be
          activated by adding a key. Equivalent observations can enter through
          the signed webhook or authorized Sheets import.
        </p>
        <p className="mt-3 text-xs leading-7 text-slate-600">
          {planned.map((source) => source.label).join(" · ")}
        </p>
      </details>
      <ConnectorDialog
        connector={connector}
        open={configure}
        onOpenChange={setConfigure}
      />
    </div>
  );
}
