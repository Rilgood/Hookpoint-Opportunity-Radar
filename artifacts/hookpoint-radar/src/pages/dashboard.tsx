import { DailyWorkQueue } from "@/components/dashboard/daily-work-queue";
import { useId, useState } from "react";
import { Link } from "wouter";
import {
  useGetRadarDashboard,
  useListRadarCompanies,
  useListRadarSignals,
  useGetRadarDataQuality,
  useListRadarConnectors,
  useGetRadarAnalyticsInsights,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  AlertTriangle,
  RefreshCw,
  ArrowUpRight,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { DashboardSkeleton } from "@/components/loading-states";
import {
  KpiGrid,
  RecentSignals,
  PipelineDistribution,
  TopIndustries,
  CalibrationAnalytics,
} from "@/components/dashboard";
import { DailyBriefing } from "@/components/dashboard/daily-briefing";
import { workspaceHealth } from "@/lib/workspace-health";

function GlassRadarIllustration() {
  const id = useId().replaceAll(":", "");
  return (
    <div
      className="pointer-events-none relative mx-auto w-full max-w-[490px] select-none"
      aria-hidden="true"
    >
      <svg
        viewBox="0 0 520 440"
        fill="none"
        className="relative w-full overflow-visible"
      >
        <defs>
          <radialGradient id={`${id}-halo`}>
            <stop stopColor="#B3D2FF" stopOpacity=".58" />
            <stop offset="1" stopColor="#D8E8FF" stopOpacity="0" />
          </radialGradient>
          <linearGradient
            id={`${id}-disc`}
            x1="153"
            y1="100"
            x2="355"
            y2="320"
            gradientUnits="userSpaceOnUse"
          >
            <stop stopColor="white" stopOpacity=".96" />
            <stop offset=".42" stopColor="#F6FAFF" stopOpacity=".65" />
            <stop offset="1" stopColor="#B8D3F9" stopOpacity=".55" />
          </linearGradient>
          <linearGradient
            id={`${id}-rim`}
            x1="145"
            y1="108"
            x2="353"
            y2="332"
            gradientUnits="userSpaceOnUse"
          >
            <stop stopColor="white" />
            <stop offset=".44" stopColor="white" stopOpacity=".35" />
            <stop offset=".72" stopColor="#A6C1EA" stopOpacity=".75" />
            <stop offset="1" stopColor="white" />
          </linearGradient>
          <linearGradient
            id={`${id}-orbit`}
            x1="55"
            y1="130"
            x2="454"
            y2="310"
            gradientUnits="userSpaceOnUse"
          >
            <stop stopColor="#A6BBDD" stopOpacity=".15" />
            <stop offset=".46" stopColor="white" />
            <stop offset=".8" stopColor="#9DBBE8" stopOpacity=".55" />
            <stop offset="1" stopColor="white" stopOpacity=".9" />
          </linearGradient>
          <radialGradient id={`${id}-core`} cx=".34" cy=".18" r=".9">
            <stop stopColor="#9CC5FF" />
            <stop offset=".48" stopColor="#2879EF" />
            <stop offset="1" stopColor="#1552C6" />
          </radialGradient>
          <linearGradient
            id={`${id}-shine`}
            x1="224"
            y1="173"
            x2="290"
            y2="259"
            gradientUnits="userSpaceOnUse"
          >
            <stop stopColor="white" stopOpacity=".95" />
            <stop offset=".5" stopColor="white" stopOpacity=".22" />
            <stop offset="1" stopColor="white" stopOpacity="0" />
          </linearGradient>
          <filter
            id={`${id}-shadow`}
            x="0"
            y="0"
            width="520"
            height="440"
            filterUnits="userSpaceOnUse"
          >
            <feGaussianBlur stdDeviation="15" />
          </filter>
          <filter
            id={`${id}-lens-shadow`}
            x="45"
            y="28"
            width="448"
            height="390"
            filterUnits="userSpaceOnUse"
          >
            <feDropShadow
              dx="0"
              dy="20"
              stdDeviation="18"
              floodColor="#779BCE"
              floodOpacity=".16"
            />
          </filter>
        </defs>
        <ellipse
          cx="267"
          cy="224"
          rx="248"
          ry="204"
          fill={`url(#${id}-halo)`}
        />
        <ellipse
          cx="267"
          cy="353"
          rx="123"
          ry="14"
          fill="#789DCF"
          opacity=".17"
          filter={`url(#${id}-shadow)`}
        />
        <g filter={`url(#${id}-lens-shadow)`}>
          <circle
            cx="263"
            cy="209"
            r="137"
            fill={`url(#${id}-disc)`}
            stroke={`url(#${id}-rim)`}
            strokeWidth="2"
          />
          <circle cx="263" cy="209" r="122" stroke="white" strokeOpacity=".8" />
          <circle
            cx="263"
            cy="209"
            r="98"
            stroke="#9EBBE6"
            strokeOpacity=".27"
          />
          <circle cx="263" cy="209" r="74" stroke="white" strokeOpacity=".9" />
          <path
            d="M263 81V116M263 302V337M135 209H170M356 209H391"
            stroke="#9CB5D8"
            strokeOpacity=".35"
          />
          <path
            d="M166 123C198 83 268 68 322 95"
            stroke="white"
            strokeWidth="4"
            strokeLinecap="round"
            opacity=".7"
          />
        </g>
        <ellipse
          cx="263"
          cy="212"
          rx="205"
          ry="62"
          transform="rotate(-29 263 212)"
          stroke={`url(#${id}-orbit)`}
          strokeWidth="2.5"
        />
        <ellipse
          cx="263"
          cy="212"
          rx="205"
          ry="62"
          transform="rotate(-29 263 212)"
          stroke="white"
          strokeOpacity=".55"
          strokeWidth=".65"
        />
        <circle
          cx="263"
          cy="209"
          r="50"
          fill={`url(#${id}-core)`}
          stroke="white"
          strokeWidth="1.5"
        />
        <circle cx="263" cy="209" r="45" stroke="white" strokeOpacity=".18" />
        <path
          d="M228 182C234 168 255 159 274 164"
          stroke={`url(#${id}-shine)`}
          strokeWidth="3"
          strokeLinecap="round"
        />
        <circle
          cx="263"
          cy="209"
          r="24"
          stroke="white"
          strokeOpacity=".85"
          strokeWidth="1.4"
        />
        <circle
          cx="263"
          cy="209"
          r="13"
          stroke="white"
          strokeOpacity=".65"
          strokeWidth="1.2"
        />
        <path
          d="M263 209L280 192"
          stroke="white"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        <circle cx="263" cy="209" r="3" fill="white" />
        <path
          d="M374 296L385 296M379.5 290.5V301.5"
          stroke="#96B4DD"
          strokeWidth="1.2"
          opacity=".6"
        />
        <path
          d="M114 129L122 129M118 125V133"
          stroke="#A8BCD8"
          strokeWidth="1"
          opacity=".55"
        />
      </svg>
      <div className="absolute bottom-[7%] left-1/2 flex -translate-x-1/2 items-center gap-2.5 whitespace-nowrap rounded-full border border-white/90 bg-white/55 px-4 py-2 text-[11px] font-medium tracking-[.02em] text-slate-500 shadow-[0_5px_20px_rgba(67,103,157,.05)] backdrop-blur-xl">
        <span className="size-1.5 rounded-full border border-slate-400" />
        Awaiting your first source
      </div>
    </div>
  );
}

export default function Dashboard() {
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const dashboard = useGetRadarDashboard();
  const companies = useListRadarCompanies({ limit: 40 });
  const signals = useListRadarSignals({ limit: 4 });
  const quality = useGetRadarDataQuality();
  const connectors = useListRadarConnectors();
  const insights = useGetRadarAnalyticsInsights();
  const health = workspaceHealth(connectors.data?.data);
  const localWorkspace =
    import.meta.env.DEV && import.meta.env.VITE_LOCAL_DEMO === "true";
  const refresh = async () => {
    setRefreshing(true);
    try {
      await queryClient.invalidateQueries();
    } finally {
      setRefreshing(false);
    }
  };
  if (dashboard.isLoading) return <DashboardSkeleton />;
  if (dashboard.isError || !dashboard.data?.data)
    return (
      <Card className="glass-panel mx-auto max-w-2xl rounded-[30px]">
        <CardContent className="py-14 text-center">
          <AlertTriangle className="mx-auto mb-4 size-10 text-destructive" />
          <h1 className="text-2xl font-semibold tracking-tight">
            Radar is temporarily offline
          </h1>
          <p className="mt-3 text-muted-foreground">
            We could not load your workspace. Your saved opportunities have not
            been changed.
          </p>
          <Button
            onClick={() => void dashboard.refetch()}
            variant="outline"
            className="mt-6 rounded-full"
          >
            Retry connection
          </Button>
        </CardContent>
      </Card>
    );
  const summary = dashboard.data.data;
  const sampleCount =
    companies.data?.data.data.filter((company) =>
      company.name.includes("(Demo)"),
    ).length || 0;
  const allSample = summary.companies > 0 && sampleCount === summary.companies;
  const empty = summary.companies === 0;
  return (
    <div className="dashboard space-y-6 pb-8 animate-in fade-in duration-700 sm:space-y-7">
      <div className="flex flex-wrap items-end justify-between gap-4 px-1 pb-1 pt-2 sm:pt-3">
        <div>
          <p className="mb-3 flex items-center gap-2.5 text-[10px] font-semibold uppercase tracking-[.19em] text-slate-500">
            <span className="h-px w-6 bg-slate-400/60" />
            Opportunity intelligence
          </p>
          <h1 className="text-[36px] font-semibold leading-[1.08] tracking-[-.055em] text-slate-950 sm:text-[48px]">
            Your daily radar<span className="text-primary">.</span>
          </h1>
          <p className="mt-3 text-sm tracking-[-.01em] text-slate-500 sm:text-[15px]">
            Know who to focus on. Understand why. Make the next move.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => void refresh()}
          disabled={refreshing}
          className="glass-inset h-10 gap-2 rounded-full border-white/90 px-4 text-xs font-medium text-slate-600 shadow-sm"
        >
          <RefreshCw
            className={`size-3.5 ${refreshing ? "animate-spin" : ""}`}
          />
          {refreshing ? "Refreshing" : "Refresh view"}
        </Button>
      </div>

      {empty ? (
        <>
          <section
            className="glass-panel relative isolate overflow-hidden rounded-[32px] sm:rounded-[38px]"
            aria-labelledby="empty-workspace-title"
          >
            <div
              className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_91%_30%,rgba(163,199,255,.25),transparent_60%)]"
              aria-hidden="true"
            />
            <div className="relative grid items-center lg:grid-cols-[1.05fr_1fr]">
              <div className="relative z-10 px-6 pb-1 pt-8 sm:px-10 sm:pt-11 lg:py-12 xl:pl-12">
                <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-white/80 bg-white/50 px-3 py-1.5 text-[10px] font-medium tracking-[.08em] text-slate-500 shadow-[inset_0_1px_0_rgba(255,255,255,.8)]">
                  <span className="size-1 rounded-full bg-slate-400" />A FRESH
                  WORKSPACE
                </div>
                <h2
                  id="empty-workspace-title"
                  className="max-w-[420px] text-[34px] font-medium leading-[1.12] tracking-[-.05em] text-slate-950 sm:text-[42px] xl:text-[46px]"
                >
                  A clearer view starts
                  <br className="hidden sm:block" /> with evidence.
                </h2>
                <p className="mt-5 max-w-[360px] text-sm leading-[1.8] text-slate-500">
                  <span className="font-medium text-slate-700">
                    Your workspace is empty.
                  </span>{" "}
                  No accounts or market evidence have been collected.
                </p>
                <Button
                  asChild
                  className="mt-7 h-11 rounded-full px-5 text-[13px] font-medium shadow-[0_6px_18px_rgba(37,99,235,.19)]"
                >
                  <Link href="/setup">
                    Set up your workspace
                    <ArrowUpRight className="ml-2 size-4" />
                  </Link>
                </Button>
                <p className="mt-4 max-w-[330px] text-[11px] leading-relaxed text-slate-500">
                  {localWorkspace
                    ? "Live collection is disabled locally. Source setup requires a configured, authenticated deployment."
                    : "Start with a trusted source. Every opportunity keeps its evidence, timestamps, and scoring explanation."}
                </p>
              </div>
              <div className="relative -mt-2 px-3 pb-4 sm:-mt-5 sm:px-9 lg:mt-0 lg:px-0 lg:pb-0">
                <GlassRadarIllustration />
              </div>
            </div>
          </section>
          <KpiGrid summary={summary} quality={quality.data?.data} />
        </>
      ) : (
        <>
          <KpiGrid summary={summary} quality={quality.data?.data} />
          <DailyWorkQueue />
          {insights.data?.data ? (
            <DailyBriefing
              insights={insights.data.data}
              companies={companies.data?.data.data}
              quality={quality.data?.data}
            />
          ) : (
            <Card className="glass-panel rounded-[28px]">
              <CardContent className="p-7">
                <p className="text-muted-foreground">
                  {insights.isLoading
                    ? "Preparing your priorities…"
                    : "Your priority list could not be loaded."}
                </p>
                {insights.isError && (
                  <Button
                    variant="outline"
                    className="mt-3 rounded-full"
                    onClick={() => void insights.refetch()}
                  >
                    Retry priorities
                  </Button>
                )}
              </CardContent>
            </Card>
          )}
          <div className="grid gap-5 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <RecentSignals
                signals={signals.data?.data}
                isLoading={signals.isLoading}
              />
              {signals.isError && (
                <p role="alert" className="mt-2 text-sm text-destructive">
                  Recent signals are unavailable. Refresh to retry.
                </p>
              )}
            </div>
            <PipelineDistribution summary={summary} isLoading={false} />
          </div>
          <Accordion
            type="single"
            collapsible
            className="glass-panel rounded-[26px] px-6"
          >
            <AccordionItem value="performance" className="border-0">
              <AccordionTrigger className="text-sm font-medium">
                Model performance & market coverage
              </AccordionTrigger>
              <AccordionContent className="space-y-6 pt-3">
                <p className="text-sm text-muted-foreground">
                  Use recorded outcomes to assess whether your ranking rules
                  predict useful conversations. A score is not a measured
                  conversion probability.
                </p>
                <CalibrationAnalytics />
                <TopIndustries summary={summary} isLoading={false} />
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </>
      )}

      <div
        className="flex flex-wrap items-center justify-between gap-x-5 gap-y-2 px-2 text-xs"
        role="status"
      >
        <div className="flex items-center gap-2.5">
          <span
            className={`size-1.5 rounded-full ${health.tone === "warning" ? "bg-amber-500" : health.tone === "success" ? "bg-emerald-500" : "bg-slate-400"}`}
          />
          <span className="font-medium text-slate-600">
            {allSample
              ? "Sample workspace · fictional companies"
              : sampleCount
                ? "Workspace includes sample accounts"
                : health.label}
          </span>
        </div>
        <Link
          href="/sources"
          className="group flex items-center gap-1.5 font-medium text-slate-600 transition-colors hover:text-primary"
        >
          Manage sources{" "}
          <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
        </Link>
        {!empty && (
          <p className="w-full text-xs leading-relaxed text-slate-500">
            {allSample
              ? "Explore real scoring and workflows with labeled examples. These are not live leads."
              : localWorkspace
                ? "Local workspace · live collection is disabled in this runtime."
                : health.detail}
          </p>
        )}
      </div>
    </div>
  );
}
