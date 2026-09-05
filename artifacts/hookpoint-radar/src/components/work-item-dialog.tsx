import { useEffect, useState, type FormEvent } from "react";
import { Link } from "wouter";
import {
  getListRadarCompaniesQueryKey,
  useListRadarCompanies,
} from "@workspace/api-client-react";
import { CalendarClock, Check, Clock3, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  localDateTimeInput,
  localTimeZone,
  nextActionDate,
  useSaveWorkItem,
  workItemError,
  type WorkItem,
  type WorkItemCommand,
} from "@/lib/workflow-api";

export type WorkItemDialogMode =
  "create" | "edit" | "snooze" | "reschedule" | "dismiss";
export interface WorkItemAccount {
  id: string;
  name: string;
  owner_name?: string | null;
  suggested_next_action?: string | null;
}
interface WorkItemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode?: WorkItemDialogMode;
  item?: WorkItem;
  account?: WorkItemAccount;
  onSaved?: () => void;
}
const TITLES: Record<WorkItemDialogMode, string> = {
  create: "Plan a next action",
  edit: "Edit action",
  snooze: "Snooze action",
  reschedule: "Reschedule action",
  dismiss: "Dismiss action",
};
function snoozeDateAfter(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return localDateTimeInput(date);
}

export function WorkItemDialog({
  open,
  onOpenChange,
  mode = "create",
  item,
  account,
  onSaved,
}: WorkItemDialogProps) {
  const { toast } = useToast();
  const save = useSaveWorkItem();
  const [companyId, setCompanyId] = useState("");
  const [companySearch, setCompanySearch] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [title, setTitle] = useState("");
  const [owner, setOwner] = useState("");
  const [date, setDate] = useState("");
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const fullForm = mode === "create" || mode === "edit";
  useEffect(() => {
    if (!open) return;
    setCompanyId(account?.id || item?.company_id || "");
    setTitle(
      (item?.title || account?.suggested_next_action || "").slice(0, 240),
    );
    setOwner(item?.owner_name || account?.owner_name || "");
    setDate(
      mode === "snooze"
        ? snoozeDateAfter(1)
        : item?.due_at
          ? localDateTimeInput(item.due_at)
          : mode === "edit"
            ? ""
            : nextActionDate(),
    );
    setNote(item?.note || "");
    setReason("");
    setError("");
    setCompanySearch("");
    setSearchQuery("");
  }, [open, mode, item?.id, account?.id]);
  useEffect(() => {
    const timer = window.setTimeout(
      () => setSearchQuery(companySearch.trim()),
      250,
    );
    return () => window.clearTimeout(timer);
  }, [companySearch]);
  const accounts = useListRadarCompanies(
    { q: searchQuery || undefined, limit: 30 },
    {
      query: {
        enabled: open && mode === "create" && !account,
        queryKey: getListRadarCompaniesQueryKey({
          q: searchQuery || undefined,
          limit: 30,
        }),
      },
    },
  );

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    // Native date pickers and autofill can change the displayed control before
    // React receives a change event. Submit the value the operator can see.
    const submittedDate = String(
      new FormData(event.currentTarget).get("action_date") || "",
    );
    if (mode !== "dismiss") setDate(submittedDate);
    setError("");
    if (fullForm && (!companyId || !title.trim())) {
      setError("Choose an account and add a clear next action.");
      return;
    }
    const timestamp =
      mode !== "dismiss" && submittedDate
        ? new Date(submittedDate).getTime()
        : null;
    const dateRequired = mode !== "dismiss" && mode !== "edit";
    if (
      (dateRequired && !submittedDate) ||
      (submittedDate && mode !== "dismiss" && !Number.isFinite(timestamp))
    ) {
      setError("Choose a valid due date and time.");
      return;
    }
    if (mode === "snooze" && timestamp! <= Date.now()) {
      setError("Snooze until a future date and time.");
      return;
    }
    if (mode === "dismiss" && !reason.trim()) {
      setError("Add a reason before dismissing this action.");
      return;
    }
    if (
      timestamp !== null &&
      localDateTimeInput(new Date(timestamp)) !== submittedDate
    ) {
      setError(
        "This local time is unavailable because of a clock change. Choose another time.",
      );
      return;
    }
    const due = timestamp === null ? null : new Date(timestamp).toISOString();
    let command: WorkItemCommand;
    if (mode === "create")
      command = {
        kind: "create",
        data: {
          company_id: companyId,
          title: title.trim(),
          owner_name: owner.trim() || null,
          due_at: due,
          note: note.trim() || null,
        },
      };
    else if (!item) {
      setError(
        "This action is no longer available. Close the dialog and refresh the queue.",
      );
      return;
    } else if (mode === "dismiss")
      command = {
        kind: "update",
        id: item.id,
        data: { status: "dismissed", resolution_note: reason.trim() },
      };
    else if (mode === "snooze")
      command = { kind: "update", id: item.id, data: { snoozed_until: due } };
    else if (mode === "reschedule")
      command = {
        kind: "update",
        id: item.id,
        data: { due_at: due, snoozed_until: null },
      };
    else
      command = {
        kind: "update",
        id: item.id,
        data: {
          title: title.trim(),
          owner_name: owner.trim() || null,
          due_at: due,
          note: note.trim() || null,
        },
      };
    save.mutate(command, {
      onSuccess: () => {
        toast({
          title:
            mode === "create"
              ? "Next action planned"
              : mode === "dismiss"
                ? "Action dismissed"
                : mode === "snooze"
                  ? "Action snoozed"
                  : "Action updated",
          description:
            "Saved in your work queue. No message or email was sent.",
        });
        onOpenChange(false);
        onSaved?.();
      },
      onError: (failure) => setError(workItemError(failure)),
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!save.isPending) onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-[550px]">
        <form onSubmit={submit} className="space-y-5">
          <DialogHeader>
            <div className="glass-inset mb-2 flex size-10 items-center justify-center rounded-2xl text-primary">
              <CalendarClock className="size-5" strokeWidth={1.5} />
            </div>
            <DialogTitle className="text-2xl font-medium tracking-tight">
              {TITLES[mode]}
            </DialogTitle>
            <DialogDescription>
              {mode === "snooze"
                ? "Hide this action from active views until the chosen time. Its original due date stays the same."
                : mode === "reschedule"
                  ? "Choose a new due date. Rescheduling also clears any active snooze."
                  : mode === "dismiss"
                    ? "Record why this action is no longer needed. The action and your reason stay in the queue history."
                    : "Keep the next step, owner, and timing together. Reminders appear only in this workspace."}
            </DialogDescription>
          </DialogHeader>
          {(account || item) && (
            <div className="glass-inset rounded-xl px-4 py-3 text-sm">
              <p className="font-medium text-foreground">
                {account?.name || item?.company_name}
              </p>
              {!fullForm && (
                <p className="mt-1 text-muted-foreground">{item?.title}</p>
              )}
            </div>
          )}
          {mode === "create" && !account && (
            <div className="space-y-2">
              <Label htmlFor="work-account-search">Account</Label>
              <div className="relative">
                <Search className="absolute left-3 top-3 size-4 text-muted-foreground" />
                <Input
                  id="work-account-search"
                  placeholder="Find an account…"
                  className="pl-9"
                  value={companySearch}
                  onChange={(event) => setCompanySearch(event.target.value)}
                  maxLength={100}
                />
              </div>
              <Select
                value={companyId}
                onValueChange={(value) => {
                  setCompanyId(value);
                  const selected = accounts.data?.data.data.find(
                    (entry) => entry.id === value,
                  );
                  setOwner(selected?.owner_name || "");
                }}
              >
                <SelectTrigger aria-label="Choose an account">
                  <SelectValue
                    placeholder={
                      accounts.isLoading
                        ? "Loading accounts…"
                        : "Choose an account"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {accounts.data?.data.data.map((entry) => (
                    <SelectItem
                      key={entry.id}
                      value={entry.id}
                      disabled={[
                        "customer",
                        "lost",
                        "rejected",
                        "disqualified",
                      ].includes(entry.status)}
                    >
                      {entry.name}
                      {entry.domain ? ` · ${entry.domain}` : ""}
                      {[
                        "customer",
                        "lost",
                        "rejected",
                        "disqualified",
                      ].includes(entry.status)
                        ? " · Workflow closed"
                        : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {accounts.isError && (
                <p className="text-xs text-destructive">
                  Accounts could not be loaded.{" "}
                  <button
                    type="button"
                    className="underline"
                    onClick={() => void accounts.refetch()}
                  >
                    Retry
                  </button>
                </p>
              )}
              {accounts.data?.data.total === 0 && (
                <p className="text-xs text-muted-foreground">
                  No accounts found. Add or import an account before planning an
                  action.{" "}
                  <Link
                    href="/setup"
                    className="text-primary underline underline-offset-2"
                  >
                    Open workspace setup
                  </Link>
                </p>
              )}
            </div>
          )}
          {fullForm && (
            <>
              <div className="space-y-2">
                <Label htmlFor="work-title">Next action</Label>
                <Input
                  id="work-title"
                  placeholder="e.g. Review the launch evidence with the owner"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  maxLength={240}
                  required
                  autoFocus={!!account}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="work-owner">
                  Owner name{" "}
                  <span className="font-normal text-muted-foreground">
                    (optional)
                  </span>
                </Label>
                <Input
                  id="work-owner"
                  placeholder="Who will take the next step?"
                  value={owner}
                  onChange={(event) => setOwner(event.target.value)}
                  maxLength={200}
                />
              </div>
            </>
          )}
          {mode !== "dismiss" && (
            <div className="space-y-2">
              <Label htmlFor="work-due">
                {mode === "snooze" ? "Snooze until" : "Due date and time"}
              </Label>
              <Input
                id="work-due"
                name="action_date"
                type="datetime-local"
                value={date}
                onChange={(event) => setDate(event.target.value)}
                required={mode !== "edit"}
              />
              <p className="text-xs text-muted-foreground">
                Your time zone: {localTimeZone().replaceAll("_", " ")}
              </p>
              {mode === "snooze" && (
                <div className="flex gap-2 pt-1">
                  {[
                    { label: "Tomorrow", days: 1 },
                    { label: "In 3 days", days: 3 },
                  ].map((option) => (
                    <Button
                      key={option.days}
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setDate(snoozeDateAfter(option.days))}
                      className="h-7 rounded-full text-xs"
                    >
                      {option.label}
                    </Button>
                  ))}
                </div>
              )}
            </div>
          )}
          {fullForm && (
            <div className="space-y-2">
              <Label htmlFor="work-note">
                Context{" "}
                <span className="font-normal text-muted-foreground">
                  (optional)
                </span>
              </Label>
              <Textarea
                id="work-note"
                placeholder="Add useful context, questions, or preparation notes."
                value={note}
                onChange={(event) => setNote(event.target.value)}
                maxLength={2000}
                rows={3}
              />
            </div>
          )}
          {mode === "dismiss" && (
            <div className="space-y-2">
              <Label htmlFor="work-reason">Reason for dismissal</Label>
              <Textarea
                id="work-reason"
                placeholder="Why is this action no longer needed?"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                maxLength={2000}
                required
                rows={4}
              />
              <p className="text-xs text-muted-foreground">
                This does not disqualify the account or change its pipeline
                stage.
              </p>
            </div>
          )}
          {error && (
            <p
              role="alert"
              className="rounded-xl border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive"
            >
              {error}
            </p>
          )}
          <DialogFooter className="gap-2 border-t border-white/60 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={save.isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={
                save.isPending || (mode === "dismiss" && !reason.trim())
              }
              variant={mode === "dismiss" ? "destructive" : "default"}
            >
              {save.isPending ? (
                "Saving…"
              ) : mode === "create" ? (
                <>
                  <Check className="mr-2 size-4" />
                  Plan action
                </>
              ) : mode === "dismiss" ? (
                "Dismiss with reason"
              ) : mode === "snooze" ? (
                <>
                  <Clock3 className="mr-2 size-4" />
                  Snooze action
                </>
              ) : (
                "Save changes"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
