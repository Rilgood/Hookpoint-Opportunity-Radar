import * as React from "react";
import { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  isActionLoading?: boolean;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
  isActionLoading,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center border rounded-xl bg-card border-dashed">
      <div className="bg-muted p-4 rounded-full mb-4">
        <Icon className="h-8 w-8 text-muted-foreground" />
      </div>
      <h3 className="text-xl font-semibold mb-2">{title}</h3>
      <p className="text-muted-foreground max-w-[400px] mb-6">{description}</p>
      {actionLabel && onAction && (
        <Button
          onClick={onAction}
          disabled={isActionLoading}
          data-testid="button-empty-state-action"
        >
          {isActionLoading ? "Loading..." : actionLabel}
        </Button>
      )}
    </div>
  );
}
