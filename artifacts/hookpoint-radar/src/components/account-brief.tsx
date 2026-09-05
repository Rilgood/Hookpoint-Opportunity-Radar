import { useState } from "react";
import type {
  CompanyDetail,
  CompanyInsights,
} from "@workspace/api-client-react";
import {
  Copy,
  Check,
  ArrowUpRight,
  FileText,
  ShieldCheck,
  ArrowRight,
  Clock3,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { buildAccountBrief, safeEvidenceUrl } from "@/lib/account-brief";
import { useToast } from "@/hooks/use-toast";
import { formatDate } from "@/lib/utils";

export function AccountBrief({
  detail,
  insights,
}: {
  detail: CompanyDetail;
  insights?: CompanyInsights;
}) {
  const brief = buildAccountBrief(detail, insights);
  const [draft, setDraft] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();
  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast({
        title: "Copied",
        description: "Ready to paste into your CRM or account notes.",
      });
    } catch {
      toast({
        title: "Clipboard unavailable",
        description: "Open the brief to select and copy its text.",
        variant: "destructive",
      });
    }
  }
  const points = insights
    ? [
        detail.company.opportunity_score,
        insights.action_window.projected_score_in_14_days.score,
        insights.action_window.projected_score_in_30_days.score,
      ]
    : [];
  return (
    <section
      className="glass-panel overflow-hidden rounded-[28px] border border-white/80"
      aria-label="Account decision brief"
    >
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/70 bg-white/30 px-5 py-5 sm:px-7">
        <div className="flex items-center gap-3.5">
          <span className="glass-inset flex size-12 items-center justify-center rounded-2xl text-primary">
            <FileText className="size-5" />
          </span>
          <div>
            <h2 className="text-lg font-semibold tracking-tight">
              The account brief
            </h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Facts, hypotheses and your next step.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            className="h-10 rounded-full px-4"
            onClick={() => setDraft(brief.text)}
          >
            Open brief
          </Button>
          <Button
            size="sm"
            className="h-10 rounded-full px-4"
            onClick={() => void copy(brief.text)}
          >
            {copied ? (
              <Check className="mr-2 size-4" />
            ) : (
              <Copy className="mr-2 size-4" />
            )}
            Copy brief
          </Button>
        </div>
      </div>
      <div className="grid gap-3 p-3 sm:p-4 lg:grid-cols-[1.1fr_1fr_1fr]">
        <div className="p-4 sm:p-5">
          <p
            className={`mb-4 inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold ${brief.ready ? "border-emerald-200/60 bg-emerald-50/80 text-emerald-700" : "border-amber-200/60 bg-amber-50/80 text-amber-800"}`}
          >
            <ShieldCheck className="size-4" />
            {brief.status}
          </p>
          <h3 className="text-[22px] font-semibold leading-snug tracking-tight">
            {brief.next}
          </h3>
          <p className="mt-3 text-sm leading-7 text-muted-foreground">
            {brief.hypothesis}
          </p>
          {brief.draft && (
            <Button
              variant="outline"
              className="mt-5 h-11 rounded-full px-4"
              onClick={() => setDraft(brief.draft)}
            >
              Prepare outreach draft <ArrowRight className="ml-2 size-4" />
            </Button>
          )}
          <p className="mt-4 text-xs leading-5 text-muted-foreground">
            {detail.recommendation
              ? "Rule-based recommendation · review before acting"
              : "Evidence review · no active commercial recommendation"}
          </p>
        </div>
        <div className="glass-inset rounded-[22px] p-5">
          <h3 className="page-eyebrow mb-5">Latest observations</h3>
          <ol className="space-y-5">
            {brief.evidence.map((item, index) => (
              <li key={item.id} className="flex gap-3">
                <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border border-white/90 bg-white/70 text-[10px] font-semibold text-primary">
                  0{index + 1}
                </span>
                <div>
                  <p className="text-sm font-medium leading-relaxed">
                    {item.title}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {item.source.replaceAll("_", " ")} ·{" "}
                    {formatDate(item.observed_at)}
                  </p>
                  {safeEvidenceUrl(item.url) ? (
                    <a
                      href={safeEvidenceUrl(item.url)!}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 inline-flex items-center gap-1 rounded-md text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                    >
                      Verify source <ArrowUpRight className="size-3.5" />
                    </a>
                  ) : (
                    <p className="mt-1 text-xs text-amber-700">
                      Source link not supplied
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ol>
          {!brief.evidence.length && (
            <p className="text-sm text-muted-foreground">
              No dated observations are available as of this brief.
            </p>
          )}
          {brief.excludedObservations > 0 && (
            <p className="mt-3 text-xs text-amber-700">
              {brief.excludedObservations} future-dated or undated observation
              {brief.excludedObservations === 1 ? " is" : "s are"} excluded.
            </p>
          )}
        </div>
        <div className="p-4 sm:p-5">
          <h3 className="page-eyebrow mb-5 flex items-center gap-2">
            <Clock3 className="size-4" />
            If no new evidence arrives
          </h3>
          {points.length > 0 ? (
            <div className="glass-inset rounded-[20px] p-4">
              <svg
                viewBox="0 0 240 90"
                role="img"
                aria-label={`Score projection: ${points[0]} now, ${points[1]} in 14 days, ${points[2]} in 30 days`}
                className="h-20 w-full overflow-visible drop-shadow-[0_2px_3px_rgba(0,90,220,0.12)]"
              >
                <line
                  x1="10"
                  y1="80"
                  x2="230"
                  y2="80"
                  stroke="currentColor"
                  className="text-border"
                />
                <polyline
                  points={points
                    .map((score, i) => `${10 + i * 110},${80 - score * 0.65}`)
                    .join(" ")}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-primary"
                />
                {points.map((score, i) => (
                  <circle
                    key={i}
                    cx={10 + i * 110}
                    cy={80 - score * 0.65}
                    r="4"
                    fill="currentColor"
                    className="text-primary"
                  />
                ))}
              </svg>
              <div className="mt-2 flex justify-between text-xs text-muted-foreground">
                {points.map((score, i) => (
                  <div key={i} className={i === 2 ? "text-right" : ""}>
                    <strong className="block text-xl font-semibold tracking-tight tabular-nums text-foreground">
                      {score}
                    </strong>
                    {["Today", "+14 days", "+30 days"][i]}
                  </div>
                ))}
              </div>
              <p className="mt-4 text-xs leading-5 text-muted-foreground">
                Evidence decay projection, not a deadline to buy.
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Timing projection is unavailable.
            </p>
          )}
          <div className="mt-5 border-t border-white/80 pt-5">
            <p className="mb-2 text-sm font-semibold tracking-tight">
              Before you act
            </p>
            <p className="text-sm leading-7 text-muted-foreground">
              {brief.questions[0] ||
                "Confirm current priorities with the account directly."}
            </p>
          </div>
        </div>
      </div>
      <Dialog
        open={draft !== null}
        onOpenChange={(open) => !open && setDraft(null)}
      >
        <DialogContent className="glass-panel rounded-[28px] border-white/90 p-6 sm:max-w-2xl sm:rounded-[28px] sm:p-8">
          <DialogHeader>
            <DialogTitle className="text-2xl font-semibold tracking-tight">
              Review and adapt
            </DialogTitle>
            <DialogDescription className="leading-6">
              Check the sources and tailor the wording. Nothing is sent
              automatically.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            aria-label="Brief or outreach draft"
            value={draft || ""}
            onChange={(event) => setDraft(event.target.value)}
            className="glass-inset min-h-[360px] rounded-[20px] border-white/80 p-5 text-sm leading-7"
          />
          <Button
            className="h-11 rounded-full"
            onClick={() => void copy(draft || "")}
          >
            <Copy className="mr-2 size-4" />
            Copy text
          </Button>
        </DialogContent>
      </Dialog>
    </section>
  );
}
