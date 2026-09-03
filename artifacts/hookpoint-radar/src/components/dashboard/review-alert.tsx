import { AlertTriangle, ChevronRight } from "lucide-react";
import { Link } from "wouter";
import { ReviewQueueItem } from "@workspace/api-client-react";

export function ReviewAlert({ items }: { items?: ReviewQueueItem[] }) {
  if (!items || items.length === 0) return null;

  return (
    <div className="bg-gradient-to-r from-amber-500/10 to-amber-500/5 border border-amber-500/20 rounded-lg p-3 px-4 flex items-center justify-between shadow-sm animate-in slide-in-from-top-2 duration-300" data-testid="alert-review-queue">
      <div className="flex items-center gap-3">
        <div className="bg-amber-500/20 p-2 rounded-full">
          <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-500" />
        </div>
        <div>
          <p className="text-sm font-medium text-foreground">
            Human review requested
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {items.length} {items.length === 1 ? "account needs" : "accounts need"} identity or opportunity verification.
          </p>
        </div>
      </div>
      <Link href="/quality" className="flex shrink-0 items-center gap-1 rounded-md bg-amber-500 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition-colors hover:bg-amber-600" data-testid="link-review-queue">
        <span className="hidden sm:inline">Review queue</span>
        <span className="sm:hidden">Review</span>
        <ChevronRight className="h-3 w-3" />
      </Link>
    </div>
  );
}
