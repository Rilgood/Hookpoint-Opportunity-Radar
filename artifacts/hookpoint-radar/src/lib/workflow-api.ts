import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";

export type WorkItemStatus = "open" | "done" | "dismissed";
export type WorkQueueView =
  | "all"
  | "open"
  | "due"
  | "today"
  | "overdue"
  | "upcoming"
  | "snoozed"
  | "completed"
  | "dismissed";
export interface WorkItem {
  id: string;
  company_id: string;
  company_name: string;
  company_status: string;
  title: string;
  owner_name: string | null;
  due_at: string | null;
  note: string | null;
  status: WorkItemStatus;
  snoozed_until: string | null;
  resolution_note: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  created_by: string;
  updated_by: string;
  is_actionable: boolean;
  suggested_next_action: string | null;
}
export interface WorkQueueCounts {
  all: number;
  open: number;
  due: number;
  today: number;
  overdue: number;
  upcoming: number;
  snoozed: number;
  completed: number;
  dismissed: number;
}
export interface WorkQueueParams {
  view?: WorkQueueView;
  company_id?: string;
  owner_name?: string;
  q?: string;
  limit?: number;
  offset?: number;
  time_zone?: string;
}
export interface WorkItemInput {
  company_id: string;
  title: string;
  owner_name?: string | null;
  due_at?: string | null;
  note?: string | null;
}
export interface WorkItemUpdate {
  title?: string;
  owner_name?: string | null;
  due_at?: string | null;
  note?: string | null;
  status?: WorkItemStatus;
  snoozed_until?: string | null;
  resolution_note?: string | null;
}
export interface WorkQueueResponse {
  data: {
    data: WorkItem[];
    total: number;
    limit: number;
    offset: number;
    counts: WorkQueueCounts;
    as_of: string;
    time_zone: string;
  };
  meta?: { request_id: string; duration_ms: number };
}
export interface WorkItemResponse {
  data: WorkItem;
}
export const WORK_ITEMS_QUERY_KEY = ["/api/v1/work-items"] as const;

export function localTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}
export function workItemsUrl(params: WorkQueueParams = {}) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== "") query.set(key, String(value));
  });
  return `/api/v1/work-items${query.size ? `?${query}` : ""}`;
}
export function useWorkItems(params: WorkQueueParams, enabled = true) {
  return useQuery({
    queryKey: [...WORK_ITEMS_QUERY_KEY, params],
    queryFn: ({ signal }) =>
      customFetch<WorkQueueResponse>(workItemsUrl(params), {
        signal,
        responseType: "json",
      }),
    enabled,
    refetchInterval: 60_000,
  });
}
export type WorkItemCommand =
  | { kind: "create"; data: WorkItemInput }
  | { kind: "update"; id: string; data: WorkItemUpdate };
export function useSaveWorkItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (command: WorkItemCommand) =>
      customFetch<WorkItemResponse>(
        command.kind === "create"
          ? "/api/v1/work-items"
          : `/api/v1/work-items/${encodeURIComponent(command.id)}`,
        {
          method: command.kind === "create" ? "POST" : "PATCH",
          body: JSON.stringify(command.data),
          responseType: "json",
        },
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: WORK_ITEMS_QUERY_KEY }),
  });
}
export function workItemError(error: unknown): string {
  if (error && typeof error === "object" && "data" in error) {
    const data = error.data as { error?: { message?: string } } | undefined;
    if (data?.error?.message) return data.error.message;
  }
  return "The action could not be saved. Your changes are still here; please retry.";
}
export function localDateTimeInput(value: string | Date): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
export function nextActionDate() {
  const date = new Date();
  date.setHours(date.getHours() + 1, 0, 0, 0);
  return localDateTimeInput(date);
}
export function formatWorkDate(
  value: string | null,
  timeZone = localTimeZone(),
) {
  if (!value || !Number.isFinite(Date.parse(value))) return "No due date";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(new Date(value));
}
