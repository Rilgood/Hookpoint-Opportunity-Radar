import { AlertTriangle, ChevronRight } from "lucide-react";
import { Link } from "wouter";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ReviewQueueItem } from "@workspace/api-client-react";
import { formatNumber } from "@/lib/utils";

export function ReviewAlert({ items }: { items: ReviewQueueItem[] }) {
  if (!items || items.length === 0) return null;

  return (
    <Alert className="bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800 rounded-xl">
      <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-500" />
      <div className="flex items-center justify-between w-full">
        <div>
          <AlertTitle className="text-amber-800 dark:text-amber-400 font-bold">Review required</AlertTitle>
          <AlertDescription className="text-amber-700/90 dark:text-amber-500/90 mt-1 text-sm font-medium">
            {formatNumber(items.length)} account{items.length === 1 ? '' : 's'} require manual review due to low confidence scores or conflicting signals.
          </AlertDescription>
        </div>
        <Link href="/quality" className="shrink-0 flex items-center text-sm font-bold text-amber-700 hover:text-amber-900 transition-colors">
          Resolve <ChevronRight className="h-4 w-4 ml-1" />
        </Link>
      </div>
    </Alert>
  );
}