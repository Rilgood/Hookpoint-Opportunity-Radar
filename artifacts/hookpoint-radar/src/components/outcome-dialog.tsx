import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { OutcomeInputOutcomeType, Signal } from "@workspace/api-client-react";
import {
  CheckCircle2,
  XCircle,
  AlertCircle,
  Handshake,
  MessageSquare,
  ThumbsUp,
  ThumbsDown,
  Megaphone,
  Check,
} from "lucide-react";

interface OutcomeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (
    type: OutcomeInputOutcomeType,
    note?: string,
    amount?: number,
    occurred_at?: string,
    signal_key?: string,
  ) => void;
  isPending: boolean;
  companyName: string;
  signals: Signal[];
}

const OUTCOME_OPTIONS = [
  {
    value: OutcomeInputOutcomeType.contacted,
    label: "Contacted",
    icon: MessageSquare,
    desc: "Outreach initiated",
  },
  {
    value: OutcomeInputOutcomeType.meeting,
    label: "Meeting Booked",
    icon: Handshake,
    desc: "Discovery call scheduled",
  },
  {
    value: OutcomeInputOutcomeType.opportunity,
    label: "Qualified Opportunity",
    icon: CheckCircle2,
    desc: "Added to sales pipeline",
    color: "text-green-600",
  },
  {
    value: OutcomeInputOutcomeType.won,
    label: "Closed Won",
    icon: ThumbsUp,
    desc: "Deal closed successfully",
    color: "text-green-600",
  },
  {
    value: OutcomeInputOutcomeType.lost,
    label: "Closed Lost",
    icon: ThumbsDown,
    desc: "Deal did not close; record the reason",
  },
  {
    value: OutcomeInputOutcomeType.disqualified,
    label: "Disqualified",
    icon: XCircle,
    desc: "Not a fit for our product",
    color: "text-destructive",
  },
  {
    value: OutcomeInputOutcomeType.suppression_correct,
    label: "Suppression Correct",
    icon: Check,
    desc: "Confirm automated safety hold",
  },
  {
    value: OutcomeInputOutcomeType.suppression_wrong,
    label: "Suppression Incorrect",
    icon: AlertCircle,
    desc: "Flag the hold for review",
  },
];

export function OutcomeDialog({
  open,
  onOpenChange,
  onSubmit,
  isPending,
  companyName,
  signals = [],
}: OutcomeDialogProps) {
  const [selected, setSelected] = useState<OutcomeInputOutcomeType | "">("");
  const [note, setNote] = useState("");
  const [amount, setAmount] = useState("");
  const [occurredAt, setOccurredAt] = useState("");
  const [signalKey, setSignalKey] = useState("");

  useEffect(() => {
    if (!open) {
      setSelected("");
      setNote("");
      setAmount("");
      setOccurredAt("");
      setSignalKey("");
    }
  }, [open, companyName]);

  const handleOpenChange = (isOpen: boolean) => {
    onOpenChange(isOpen);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected) return;
    const amountNum = amount ? Number(amount) : undefined;
    const occurredIso = occurredAt
      ? new Date(`${occurredAt}T00:00:00`).toISOString()
      : undefined;
    onSubmit(
      selected,
      note.trim() || undefined,
      amountNum,
      occurredIso,
      signalKey || undefined,
    );
  };

  const needsConfirmation =
    selected === OutcomeInputOutcomeType.disqualified ||
    selected === OutcomeInputOutcomeType.lost;
  const suppressionFeedback =
    selected === OutcomeInputOutcomeType.suppression_correct ||
    selected === OutcomeInputOutcomeType.suppression_wrong;
  const today = new Date();
  const latestDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Record Outcome</DialogTitle>
            <DialogDescription>
              Record what happened with {companyName}. Sales outcomes inform
              pipeline history and future score evaluations.
            </DialogDescription>
          </DialogHeader>

          <div className="py-6 space-y-6">
            <RadioGroup
              value={selected}
              onValueChange={(val) =>
                setSelected(val as OutcomeInputOutcomeType)
              }
              className="grid grid-cols-2 gap-3"
            >
              {OUTCOME_OPTIONS.map((opt) => (
                <div key={opt.value} className="relative">
                  <RadioGroupItem
                    value={opt.value}
                    id={`outcome-${opt.value}`}
                    className="peer sr-only"
                  />
                  <Label
                    htmlFor={`outcome-${opt.value}`}
                    className="flex flex-col items-center justify-between rounded-md border-2 border-muted bg-popover p-4 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/5 cursor-pointer text-center"
                  >
                    <opt.icon
                      className={`mb-2 h-6 w-6 ${opt.color || "text-muted-foreground"}`}
                    />
                    <span className="font-semibold text-sm">{opt.label}</span>
                    <span className="text-[10px] text-muted-foreground mt-1 font-normal leading-tight">
                      {opt.desc}
                    </span>
                  </Label>
                </div>
              ))}
            </RadioGroup>

            {suppressionFeedback && (
              <p className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
                This records your review feedback. It does not remove a safety
                hold or change the account's pipeline stage.
              </p>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="amount">Amount (Optional)</Label>
                <Input
                  id="amount"
                  type="number"
                  min="0"
                  max="1000000000000000"
                  step="any"
                  placeholder="e.g. 50000"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="occurredAt">Date (Optional)</Label>
                <Input
                  id="occurredAt"
                  type="date"
                  max={latestDate}
                  value={occurredAt}
                  onChange={(e) => setOccurredAt(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Event date in your local time zone.
                </p>
              </div>
            </div>

            {signals && signals.length > 0 && (
              <div className="space-y-2">
                <Label>Associated Signal (Optional)</Label>
                <Select value={signalKey} onValueChange={setSignalKey}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a driving signal..." />
                  </SelectTrigger>
                  <SelectContent>
                    {signals.map((sig) => (
                      <SelectItem key={sig.signal_key} value={sig.signal_key}>
                        {sig.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="note">
                Notes {needsConfirmation ? "" : "(Optional)"}
              </Label>
              <Textarea
                id="note"
                placeholder={
                  needsConfirmation
                    ? "Please provide a reason..."
                    : "Add details about this outcome..."
                }
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="resize-none h-20"
                required={needsConfirmation}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={
                !selected || isPending || (needsConfirmation && !note.trim())
              }
              variant={needsConfirmation ? "destructive" : "default"}
              data-testid="btn-submit-outcome"
            >
              {isPending
                ? "Recording..."
                : needsConfirmation
                  ? "Confirm & Record"
                  : "Save Outcome"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
