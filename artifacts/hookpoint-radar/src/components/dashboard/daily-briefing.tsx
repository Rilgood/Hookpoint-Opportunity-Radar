import type {
  AnalyticsInsights,
  Company,
  DataQuality,
  FocusAccount,
} from "@workspace/api-client-react";
import { Link } from "wouter";
import {
  ArrowRight,
  ArrowUpRight,
  Clock3,
  Crosshair,
  ShieldAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getTierColor } from "@/lib/utils";

export function focusAction(account: FocusAccount, company?: Company) {
  if (
    account.identity_confidence < 0.8 ||
    company?.identity_review_status === "needs_review"
  )
    return "Verify identity before outreach";
  if (!company) return "Open the account to review evidence and next steps";
  if (["customer", "lost", "rejected", "disqualified"].includes(company.status))
    return "Review the closed account history";
  if (
    ["contacted", "replied", "meeting", "opportunity"].includes(company.status)
  )
    return "Review the last conversation and agree the next step";
  if (["hot", "warm"].includes(account.opportunity_tier))
    return "Review evidence and prepare your approach";
  return "Research the account and close evidence gaps";
}

export function DailyBriefing({
  insights,
  companies,
  quality,
}: {
  insights: AnalyticsInsights;
  companies?: Company[];
  quality?: DataQuality;
}) {
  const [first, ...rest] = insights.focus_list;
  const profile = companies?.find(
    (company) => company.id === first?.company_id,
  );
  return (
    <section
      className="grid gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(300px,1fr)]"
      aria-label="Daily priorities"
    >
      <div className="glass-panel relative isolate overflow-hidden rounded-[30px]">
        <div
          className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_100%_0%,rgba(172,203,255,.24),transparent_62%)]"
          aria-hidden="true"
        />
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/70 px-6 py-5 sm:px-7">
          <span className="flex items-center gap-2.5 text-xs font-medium text-slate-700">
            <span className="glass-inset flex size-7 items-center justify-center rounded-full text-primary">
              <Crosshair className="size-3.5" strokeWidth={1.5} />
            </span>
            First on your radar
          </span>
          <span className="text-[10px] font-medium uppercase tracking-[.12em] text-slate-400">
            Evidence-led priority
          </span>
        </div>
        {first ? (
          <div className="p-6 sm:p-7">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 pt-1">
                <p className="text-xs text-slate-500">
                  {profile?.industry || "Account to review"}
                  {profile?.domain ? ` · ${profile.domain}` : ""}
                </p>
                <h2 className="mt-3 text-[28px] font-semibold leading-[1.12] tracking-[-.045em] text-slate-950 sm:text-[34px]">
                  {first.name}
                </h2>
                <p className="mt-3 max-w-[320px] text-sm leading-relaxed text-slate-600">
                  {focusAction(first, profile)}
                </p>
              </div>
              <div className="glass-inset relative flex size-[88px] shrink-0 flex-col items-center justify-center rounded-full border border-white/90 shadow-[inset_0_1px_0_white,0_8px_24px_rgba(89,136,211,.08)] sm:size-[100px]">
                <span className="text-[34px] font-medium leading-none tracking-[-.065em] text-primary tabular-nums sm:text-[40px]">
                  {first.opportunity_score}
                </span>
                <span className="mt-1.5 text-[10px] text-slate-500">
                  score / 100
                </span>
              </div>
            </div>
            <ul className="my-6 space-y-3">
              {(first.reasons.length
                ? first.reasons
                : ["Ranked by current fit, need, intent, timing and risk."]
              ).map((reason) => (
                <li
                  key={reason}
                  className="flex gap-3 text-xs leading-[1.7] text-slate-500"
                >
                  <span
                    className="mt-1.5 size-1.5 shrink-0 rounded-full border border-primary/35 bg-white/80"
                    aria-hidden="true"
                  />
                  {reason}
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap items-center justify-between gap-4 border-t border-white/80 pt-5">
              <span className="text-[10px] leading-[1.7] text-slate-500">
                Priority {first.priority_score} · Includes focus adjustments
                <br />A ranking signal, not a purchase probability.
              </span>
              <Button
                asChild
                className="h-10 rounded-full px-4 text-xs font-medium shadow-[0_5px_16px_rgba(37,99,235,.15)]"
              >
                <Link href={`/opportunities/${first.company_id}`}>
                  Open account brief <ArrowUpRight className="ml-2 size-3.5" />
                </Link>
              </Button>
            </div>
          </div>
        ) : (
          <div className="p-7 sm:p-9">
            <h2 className="text-2xl font-medium tracking-[-.035em] text-slate-950">
              No open accounts to prioritize
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-slate-500">
              Closed and suppressed accounts are excluded from the focus list.
            </p>
            <Button
              asChild
              variant="outline"
              className="glass-inset mt-6 rounded-full"
            >
              <Link href="/opportunities">
                Explore accounts <ArrowRight className="ml-2 size-3.5" />
              </Link>
            </Button>
          </div>
        )}
      </div>
      <div className="glass-panel flex flex-col overflow-hidden rounded-[30px]">
        <div className="flex items-center justify-between border-b border-white/70 px-6 py-6">
          <h2 className="text-sm font-medium tracking-[-.02em] text-slate-800">
            Up next
          </h2>
          <Link
            href="/opportunities"
            className="group flex items-center gap-1 text-xs font-medium text-slate-500 transition-colors hover:text-primary"
          >
            All accounts{" "}
            <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </div>
        <div className="flex-1 divide-y divide-white/65">
          {rest.slice(0, 3).map((account, index) => (
            <Link
              key={account.company_id}
              href={`/opportunities/${account.company_id}`}
              className="group flex items-start gap-3 px-6 py-5 transition-colors hover:bg-white/45"
            >
              <span className="mt-0.5 text-[11px] font-medium text-slate-400 tabular-nums">
                0{index + 2}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium tracking-[-.015em] text-slate-800 transition-colors group-hover:text-primary">
                  {account.name}
                </p>
                <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
                  {focusAction(
                    account,
                    companies?.find(
                      (company) => company.id === account.company_id,
                    ),
                  )}
                </p>
              </div>
              <Badge
                variant="outline"
                className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${getTierColor(account.opportunity_tier)}`}
              >
                {account.opportunity_score}
              </Badge>
            </Link>
          ))}
          {!rest.length && (
            <p className="px-6 py-8 text-sm leading-relaxed text-slate-500">
              More open accounts will appear as evidence arrives.
            </p>
          )}
        </div>
        <div className="grid grid-cols-2 border-t border-white/80 bg-white/20 px-2 py-2">
          <Link
            href="/quality"
            className="group rounded-2xl px-4 py-3 transition-colors hover:bg-white/50"
          >
            <div className="flex items-center gap-2">
              <ShieldAlert
                className="size-3.5 text-amber-600/80"
                strokeWidth={1.5}
              />
              <strong className="text-xl font-medium tracking-tight text-slate-800 tabular-nums">
                {quality?.identity.needs_review ?? "—"}
              </strong>
            </div>
            <span className="mt-1 block text-[11px] text-slate-500">
              Identity reviews
            </span>
          </Link>
          <Link
            href="/quality"
            className="group rounded-2xl px-4 py-3 transition-colors hover:bg-white/50"
          >
            <div className="flex items-center gap-2">
              <Clock3 className="size-3.5 text-primary/75" strokeWidth={1.5} />
              <strong className="text-xl font-medium tracking-tight text-slate-800 tabular-nums">
                {quality?.stale_companies ?? "—"}
              </strong>
            </div>
            <span className="mt-1 block text-[11px] text-slate-500">
              Stale accounts
            </span>
          </Link>
        </div>
      </div>
    </section>
  );
}
