import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ExternalLink, ShieldCheck } from "lucide-react";
import {
  useListRadarEvidenceReviews,
  useReviewRadarEvidence,
  type EvidenceReviewEntry,
  type ListRadarEvidenceReviewsParams,
  type ReviewEvidenceInputStatus,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { safeEvidenceUrl } from "@/lib/account-brief";
import { useToast } from "@/hooks/use-toast";

const labels = {
  all: "All evidence",
  unreviewed: "Unreviewed",
  verified: "Verified",
  rejected: "Rejected",
  needs_review: "Needs review",
};
export function EvidenceReviewPanel({ companyId }: { companyId: string }) {
  const [status, setStatus] =
    useState<ListRadarEvidenceReviewsParams["status"]>("all");
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<EvidenceReviewEntry | null>(null);
  const [decision, setDecision] =
    useState<ReviewEvidenceInputStatus>("verified");
  const [note, setNote] = useState("");
  const [saveError, setSaveError] = useState("");
  const query = useListRadarEvidenceReviews(companyId, {
    status,
    limit: 5,
    offset,
  });
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const mutation = useReviewRadarEvidence({
    mutation: {
      onSuccess: () => {
        void queryClient.invalidateQueries({
          predicate: (entry) =>
            String(entry.queryKey[0]).startsWith("/api/v1/"),
        });
        setSelected(null);
        toast({
          title: "Evidence review saved",
          description:
            "The account score and recommendation have been refreshed.",
        });
      },
      onError: (error) =>
        setSaveError(
          error instanceof Error
            ? error.message
            : "The review could not be saved. Try again.",
        ),
    },
  });
  const openReview = (item: EvidenceReviewEntry) => {
    setSelected(item);
    setDecision(item.status === "unreviewed" ? "verified" : item.status);
    setNote(item.note || "");
    setSaveError("");
  };
  const result = query.data?.data;
  return (
    <section
      className="glass-panel rounded-[28px] p-5 sm:p-7"
      aria-labelledby="evidence-review-title"
    >
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2
            id="evidence-review-title"
            className="flex items-center gap-2 text-lg font-semibold"
          >
            <ShieldCheck className="size-5 text-primary" />
            Evidence review
          </h2>
          <p className="mt-2 max-w-2xl text-xs leading-6 text-muted-foreground">
            Verify the source, date and company match. Rejected evidence is
            excluded from current scoring. Verification records your review
            without boosting the score.
          </p>
        </div>
        <select
          aria-label="Filter evidence reviews"
          className="glass-field h-10 rounded-xl px-3 text-xs"
          value={status}
          onChange={(event) => {
            setStatus(
              event.target.value as ListRadarEvidenceReviewsParams["status"],
            );
            setOffset(0);
          }}
        >
          {Object.entries(labels).map(([value, label]) => (
            <option value={value} key={value}>
              {label}
            </option>
          ))}
        </select>
      </div>
      {query.isLoading && (
        <p role="status" className="py-8 text-sm text-muted-foreground">
          Loading evidence…
        </p>
      )}
      {query.isError && (
        <div role="alert" className="py-6 text-sm text-destructive">
          Evidence reviews could not load.{" "}
          <button className="underline" onClick={() => void query.refetch()}>
            Retry
          </button>
        </div>
      )}
      {result && !query.isError && (
        <>
          <div className="mt-5 divide-y divide-slate-200/60">
            {result.data.map((item) => {
              const url = safeEvidenceUrl(item.url);
              return (
                <article
                  key={item.observation_id}
                  className="flex flex-wrap items-start justify-between gap-4 py-4"
                >
                  <div className="min-w-0 flex-1 basis-56">
                    <p className="text-sm font-medium leading-6">
                      {item.title}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                      <span>{item.source}</span>
                      <time dateTime={item.observed_at}>
                        {new Date(item.observed_at).toLocaleString()}
                      </time>
                      {url && (
                        <a
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-primary"
                        >
                          View source
                          <ExternalLink className="size-3" />
                        </a>
                      )}
                    </div>
                    <p
                      className={`mt-2 text-[11px] ${item.status === "rejected" ? "text-amber-800" : item.status === "verified" ? "text-emerald-700" : "text-slate-500"}`}
                    >
                      {labels[item.status]}
                      {item.status === "rejected"
                        ? " · Excluded from scoring"
                        : ""}
                      {item.reviewed_at
                        ? ` · ${new Date(item.reviewed_at).toLocaleDateString()}`
                        : ""}
                    </p>
                    {item.note && (
                      <p className="mt-2 whitespace-pre-wrap break-words text-xs leading-6 text-muted-foreground">
                        {item.note}
                      </p>
                    )}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="rounded-full text-xs"
                    onClick={() => openReview(item)}
                  >
                    Review evidence
                  </Button>
                </article>
              );
            })}
          </div>
          {result.total === 0 && (
            <p className="py-8 text-sm text-muted-foreground">
              {status === "all"
                ? "No observations are available for review yet."
                : `No ${labels[status || "all"].toLowerCase()} evidence.`}
            </p>
          )}
          {result.total > 5 && (
            <div className="mt-3 flex items-center justify-between gap-2 border-t border-slate-200/60 pt-4 text-xs text-muted-foreground">
              <span>
                {Math.min(offset + 1, result.total)}–
                {Math.min(offset + 5, result.total)} of {result.total}
              </span>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={offset === 0}
                  onClick={() => setOffset(Math.max(0, offset - 5))}
                >
                  Previous
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={offset + 5 >= result.total}
                  onClick={() => setOffset(offset + 5)}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </>
      )}
      <Dialog
        open={!!selected}
        onOpenChange={(open) => {
          if (!open && !mutation.isPending) setSelected(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Review this evidence</DialogTitle>
            <DialogDescription>{selected?.title}</DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!selected || (decision !== "verified" && !note.trim()))
                return;
              setSaveError("");
              mutation.mutate({
                id: companyId,
                data: {
                  observation_id: selected.observation_id,
                  status: decision,
                  note: note.trim() || null,
                },
              });
            }}
            className="space-y-5"
          >
            <div>
              <label
                htmlFor="evidence-decision"
                className="text-sm font-medium"
              >
                Decision
              </label>
              <select
                id="evidence-decision"
                className="glass-field mt-2 h-11 w-full rounded-xl px-3 text-sm"
                value={decision}
                onChange={(event) =>
                  setDecision(event.target.value as ReviewEvidenceInputStatus)
                }
              >
                <option value="verified">
                  Verified — source and account match
                </option>
                <option value="needs_review">
                  Needs review — keep visible for research
                </option>
                <option value="rejected">Reject — exclude from scoring</option>
              </select>
            </div>
            <div>
              <label htmlFor="evidence-note" className="text-sm font-medium">
                Review note{" "}
                {decision === "verified" ? "(optional)" : "(required)"}
              </label>
              <Textarea
                id="evidence-note"
                className="mt-2"
                maxLength={2000}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                required={decision !== "verified"}
                placeholder="Explain the source, relevance or identity issue…"
              />
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                Needs review keeps the existing scoring contribution. Rejected
                observations remain in the audit trail and can be verified
                later.
              </p>
            </div>
            {saveError && (
              <p role="alert" className="text-sm text-destructive">
                {saveError}
              </p>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={mutation.isPending}
                onClick={() => setSelected(null)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={
                  mutation.isPending ||
                  (decision !== "verified" && !note.trim())
                }
              >
                {mutation.isPending ? "Saving…" : "Save evidence review"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
