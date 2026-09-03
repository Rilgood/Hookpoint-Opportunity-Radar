import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatNumber(num: number): string {
  if (num >= 1000000000) return (num / 1000000000).toFixed(1) + "B";
  if (num >= 1000000) return (num / 1000000).toFixed(1) + "M";
  if (num >= 1000) return (num / 1000).toFixed(1) + "K";
  return num.toString();
}

export function formatCurrency(num: number): string {
  return "$" + formatNumber(num);
}

export function humanizeLabel(value: string): string {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

export function getTierColor(tier: string): string {
  switch (tier) {
    case "hot":
      return "text-hot bg-hot/10 border-hot/20";
    case "warm":
      return "text-warm bg-warm/10 border-warm/20";
    case "watch":
      return "text-watch bg-watch/10 border-watch/20";
    case "cold":
      return "text-cold bg-cold/10 border-cold/20";
    case "suppressed":
      return "text-suppressed bg-suppressed/10 border-suppressed/20";
    default:
      return "text-muted-foreground bg-muted border-border";
  }
}
