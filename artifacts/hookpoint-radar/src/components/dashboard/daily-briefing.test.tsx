import { describe, expect, it } from "vitest";
import type { Company, FocusAccount } from "@workspace/api-client-react";
import { focusAction } from "./daily-briefing";

const focus = {
  company_id: "account",
  identity_confidence: 0.95,
  opportunity_tier: "hot",
} as FocusAccount;
const profile = (status: string) =>
  ({ status, identity_review_status: "confirmed" }) as Company;

describe("daily priority action semantics", () => {
  it("uses current sales stage before suggesting a new approach", () => {
    for (const status of ["contacted", "replied", "meeting", "opportunity"])
      expect(focusAction(focus, profile(status))).toContain(
        "last conversation",
      );
    expect(focusAction(focus, profile("prospect"))).toContain(
      "prepare your approach",
    );
  });
  it("does not infer prospecting readiness when the profile has not loaded", () => {
    expect(focusAction(focus)).toBe(
      "Open the account to review evidence and next steps",
    );
  });
  it("respects identity review and closed workflow states", () => {
    expect(
      focusAction(focus, {
        ...profile("prospect"),
        identity_review_status: "needs_review",
      }),
    ).toContain("Verify identity");
    for (const status of ["customer", "lost", "rejected", "disqualified"])
      expect(focusAction(focus, profile(status))).toContain(
        "closed account history",
      );
  });
});
